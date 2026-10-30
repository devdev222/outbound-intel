import "../scripts/_env";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AGENTS } from "@/lib/agents";
import { runAgent, tick } from "@/lib/agents/runtime";
import { recordEngagement } from "@/lib/engine/engagement";
import { recordOutcome } from "@/lib/engine/outcomes";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";
import type { Account } from "@/lib/types";

/**
 * The engine as an MCP server, so Jerry, Claude Desktop, Claude Code or any
 * other MCP client can query and drive it. stdio transport.
 *
 *   claude mcp add outbound-intel -- npm --prefix <repo> run -s mcp
 *
 * Built on @modelcontextprotocol/sdk v1.x (McpServer.registerTool with a zod
 * raw shape). Docs: https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md
 */

// stdio transport owns stdout; keep every log on stderr.
console.log = (...args: unknown[]) => console.error(...args);

const server = new McpServer({ name: "outbound-intel", version: "0.1.0" });

function summarize(a: Account) {
  return {
    slug: a.slug,
    company: a.companyName,
    industry: a.industry,
    employees: a.employeeCount,
    status: a.status,
    score: a.scores?.total ?? null,
    priority: a.priority,
    engagement: a.engagementScore,
    verifiedSignals: a.verifiedSignals,
    hypotheses: a.hypotheses,
    contact: a.contact ? `${a.contact.name}, ${a.contact.title}` : null,
    pageUrl: a.campaign?.pageUrl ?? null,
  };
}

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

server.registerTool(
  "list_hot_leads",
  {
    title: "List hot leads",
    description: "Accounts with the highest priority right now (engaged or hot), with their signals and contact.",
    inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
  },
  async ({ limit }) => {
    const accounts = (await getStore().listAccounts()).filter((a) => ["engaged", "hot", "meeting_booked"].includes(a.status)).slice(0, limit);
    return text(accounts.map(summarize));
  },
);

server.registerTool(
  "search_accounts",
  {
    title: "Search accounts",
    description: "Search scored accounts by company name, industry, signal or status.",
    inputSchema: {
      query: z.string().default(""),
      status: z.string().optional(),
      minScore: z.number().min(0).max(100).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    },
  },
  async ({ query, status, minScore, limit }) => {
    const q = query.toLowerCase();
    const rows = (await getStore().listAccounts())
      .filter((a) => !status || a.status === status)
      .filter((a) => (a.scores?.total ?? 0) >= minScore)
      .filter((a) => !q || a.companyName.toLowerCase().includes(q) || a.industry.toLowerCase().includes(q) || a.signals.some((s) => s.key.includes(q) || s.label.toLowerCase().includes(q)))
      .slice(0, limit);
    return text(rows.map(summarize));
  },
);

server.registerTool(
  "get_account_brief",
  {
    title: "Get account brief",
    description: "Full brief for one account: score breakdown and explanation, signals with evidence, pain hypothesis, messaging angle, campaign, recent engagement and alerts.",
    inputSchema: { slug: z.string() },
  },
  async ({ slug }) => {
    const store = getStore();
    const a = await store.getAccountBySlug(slug);
    if (!a) return { content: [{ type: "text", text: `No account with slug ${slug}` }], isError: true };
    const [events, alerts, outreach, activity] = await Promise.all([
      store.listEvents({ accountId: a.id, limit: 20 }),
      store.listAlerts({ accountId: a.id, limit: 5 }),
      store.listOutreach({ accountId: a.id }),
      store.listActivity({ accountId: a.id, limit: 40 }),
    ]);
    return text({
      ...summarize(a),
      scores: a.scores,
      scoreExplanation: a.scoreExplanation,
      brief: a.brief,
      painHypothesis: a.painHypothesis,
      messagingAngle: a.messagingAngle,
      recommendedPersona: a.recommendedPersona,
      missingInfo: a.missingInfo,
      signals: a.signals.map((s) => ({ key: s.key, status: s.status, confidence: s.confidence, evidence: s.evidence.map((e) => ({ title: e.title, url: e.url })) })),
      campaign: a.campaign,
      recentEvents: events.map((e) => ({ at: e.createdAt, type: e.eventType, properties: e.properties })),
      alerts: alerts.map((al) => ({ at: al.createdAt, talkTrack: al.payload.talkTrack, triggeredBy: al.payload.triggeredBy })),
      outreach: outreach.map((t) => ({ id: t.id, step: t.step, channel: t.channel, status: t.status, scheduledFor: t.scheduledFor, note: t.note })),
      video: a.campaign ? { status: a.campaign.videoStatus, source: a.campaign.videoSource, beats: a.campaign.videoBeats, url: a.campaign.videoUrl, scriptVersion: a.campaign.scriptVersion } : null,
      teamActivity: activity.map((e) => ({ at: e.at, actor: e.actor, action: e.action, summary: e.summary })),
    });
  },
);

server.registerTool(
  "list_rep_tasks",
  {
    title: "List rep tasks",
    description: "Outreach touches waiting on a human (LinkedIn messages, InMail, gifts, manual emails, estimate requests), newest first.",
    inputSchema: { limit: z.number().int().min(1).max(100).default(25) },
  },
  async ({ limit }) => {
    const store = getStore();
    const tasks = await store.listOutreach({ status: "awaiting_rep", limit });
    const accounts = new Map((await store.listAccounts()).map((a) => [a.id, a]));
    return text(
      tasks.map((t) => ({
        id: t.id,
        company: accounts.get(t.accountId)?.companyName,
        slug: accounts.get(t.accountId)?.slug,
        channel: t.channel,
        step: t.step,
        subject: t.subject,
        body: t.body,
        note: t.note,
        taskUrl: t.taskUrl,
      })),
    );
  },
);

server.registerTool(
  "complete_rep_task",
  {
    title: "Complete a rep task",
    description: "Mark a rep task as sent (records the send as engagement) or skipped.",
    inputSchema: { id: z.string(), status: z.enum(["sent", "skipped"]) },
  },
  async ({ id, status }) => {
    const { completeRepTask } = await import("@/lib/engine/outreach");
    const touch = await completeRepTask(getStore(), id, status, "mcp");
    if (!touch) return { content: [{ type: "text", text: `No task with id ${id}` }], isError: true };
    return text({ id: touch.id, status: touch.status, channel: touch.channel, step: touch.step });
  },
);

server.registerTool(
  "record_engagement",
  {
    title: "Record engagement",
    description: "Record an engagement event for an account (page_view, video_75, calculator_completed, case_study_viewed, booking_clicked, email_reply, ...). Triggers rep activation when a threshold is crossed.",
    inputSchema: { slug: z.string(), eventType: z.string(), properties: z.record(z.string(), z.unknown()).default({}) },
  },
  async ({ slug, eventType, properties }) => {
    const store = getStore();
    const a = await store.getAccountBySlug(slug);
    if (!a) return { content: [{ type: "text", text: `No account with slug ${slug}` }], isError: true };
    const r = await recordEngagement(store, getProviders(), a, { eventType, properties, visitorId: "mcp" });
    if (r.activationTriggered) void runAgent("jerry");
    return text({ engagementScore: r.account.engagementScore, priority: r.account.priority, status: r.account.status, activationTriggered: r.activationTriggered, reason: r.reason });
  },
);

server.registerTool(
  "log_outcome",
  {
    title: "Log outcome",
    description: "Log a sales outcome (replied, meeting_booked, opportunity_created, deal_won, deal_lost, no_response, disqualified). Terminal outcomes feed the learning loop.",
    inputSchema: {
      slug: z.string(),
      outcomeType: z.enum(["replied", "meeting_booked", "opportunity_created", "deal_won", "deal_lost", "no_response", "disqualified"]),
      value: z.number().optional(),
      notes: z.string().optional(),
    },
  },
  async ({ slug, outcomeType, value, notes }) => {
    const store = getStore();
    const a = await store.getAccountBySlug(slug);
    if (!a) return { content: [{ type: "text", text: `No account with slug ${slug}` }], isError: true };
    const r = await recordOutcome(store, getProviders(), a, { outcomeType, value, notes, source: "mcp" });
    if (r.fedBack) void runAgent("learning", { force: true });
    return text({ outcome: r.outcome, status: r.account.status, fedBackToHistory: r.fedBack });
  },
);

server.registerTool(
  "get_model_summary",
  {
    title: "Get scoring model summary",
    description: "Current learned model: version, weights vs priors, strongest signal patterns, ICP buckets and playbook summary.",
    inputSchema: {},
  },
  async () => {
    const m = await getStore().getLatestModel();
    if (!m) return text({ model: null });
    return text({
      version: m.version,
      trainedAt: m.trainedAt,
      baseline: m.baseline,
      weights: m.weights,
      priorWeights: m.priorWeights,
      topPatterns: m.signalPatterns.filter((p) => p.withN >= 5).slice(0, 10).map((p) => ({ key: p.key, lift: p.lift, with: `${p.withWon}/${p.withN}`, weight: p.weight })),
      topIndustries: m.icp.industries.filter((b) => b.n >= 5).slice(0, 5),
      topPersonas: m.icp.personas.filter((b) => b.n >= 5).slice(0, 5),
      playbook: m.playbook.summary,
      notes: m.notes,
    });
  },
);

server.registerTool(
  "run_agent",
  {
    title: "Run an agent",
    description: `Run one of the team's agents now: ${AGENTS.map((a) => a.id).join(", ")}. Use "tick" to run every agent whose cadence has elapsed.`,
    inputSchema: { agentId: z.string() },
  },
  async ({ agentId }) => {
    if (agentId === "tick") return text((await tick()).map((r) => ({ agent: r.agentId, status: r.status, summary: r.summary })));
    const def = AGENTS.find((a) => a.id === agentId);
    if (!def) return { content: [{ type: "text", text: `Unknown agent ${agentId}` }], isError: true };
    const run = await runAgent(def.id, { force: true });
    return text({ agent: run.agentId, status: run.status, processed: run.processed, summary: run.summary, details: run.details });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("outbound-intel MCP server ready (stdio)");
