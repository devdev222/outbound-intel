import { z } from "zod";
import { config } from "@/lib/config";
import { markAgentRun } from "@/lib/engine/accounts";
import { angleFor, firstName, loadProofLine, type ProofLine, roiDefaultsFor, signalPhrase, topSignal } from "@/lib/engine/campaign";
import { generateStructured, llmAvailable } from "@/lib/llm";
import type { Account, Campaign, ScoringModel, VideoBeats } from "@/lib/types";
import { type AgentContext, type AgentDefinition, mapLimit } from "./base";

/**
 * Video Agent: the creative director for the 15-25 second personalized video.
 *
 * It reads the whole dossier the rest of the team produced (verified signals
 * with evidence, Research brief, pain hypothesis, learned angle, ICP persona,
 * ROI defaults, matched case study, experiment arm) and writes a beat sheet:
 *   hook  - says the contact's name and the top verified signal
 *   proof - one number from the matched case study or peer outcome
 *   ask   - the page link and a 15-minute slot
 * then a spoken script that fits the time budget. For the AI arm it submits
 * the script to the video provider (Tavus) and tracks rendering; for the rep
 * arm it issues a recording brief and waits for a human to attach the clip.
 * It rewrites the script when Research later changes a verified signal.
 */

const WORDS_MIN = 35;
const WORDS_MAX = 75;
const WORDS_PER_SECOND = 2.6;
const MAX_ATTEMPTS = 3;

const BeatsSchema = z.object({
  hook: z.string().describe("1 sentence, says the first name, references the single strongest verified signal; no 'I hope this finds you well'"),
  proof: z.string().describe("1 sentence citing the provided customer result verbatim; if none is provided, a sentence about the page's estimate with NO customer claim"),
  ask: z.string().describe("1 sentence: the page has their numbers, ask for fifteen minutes"),
  script: z.string().describe("The full spoken script = hook + one bridge sentence + proof + ask, 45-65 words, conversational, no bullet points"),
});

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateSeconds(script: string): number {
  return Math.round(wordCount(script) / WORDS_PER_SECOND);
}

export function templateBeats(account: Account, model: ScoringModel, proofLine: ProofLine | null = null): VideoBeats & { script: string } {
  const sig = topSignal(account);
  const first = firstName(account);
  const roi = roiDefaultsFor(account);
  const hook = `Hi ${first}, this is ${config.brandName}. I noticed ${signalPhrase(sig, account)} at ${account.companyName}.`;
  const bridge = `Teams at your volume, around ${roi.shipmentsPerMonth.toLocaleString()} loads a month, usually hit a wall where every new shipment means another phone call.`;
  // Only approved proof (or a labelled demo placeholder) is ever cited; otherwise no customer claim.
  const proof = proofLine ? proofLine.sentence : "The page shows an estimate built from your own numbers.";
  const ask = "I put together a page with your numbers; the link is below. Worth fifteen minutes?";
  void angleFor(account, model, "A");
  return { hook, proof, ask, script: `${hook} ${bridge} ${proof} ${ask}` };
}

export function buildDossier(account: Account, model: ScoringModel, proofLine: ProofLine | null = null): string {
  const c = account.campaign;
  const verified = account.signals.filter((s) => s.status === "verified" && s.type !== "intent");
  const hyp = account.signals.filter((s) => s.status === "hypothesis");
  const patterns = new Map(model.signalPatterns.map((p) => [p.key, p]));
  return [
    `Company: ${account.companyName} | ${account.industry} | ${account.employeeCount} employees | ${account.hqCity}, ${account.hqState}`,
    `Contact: ${account.contact ? `${account.contact.name}, ${account.contact.title}` : "unknown"} (persona: ${account.recommendedPersona ?? "n/a"})`,
    `Verified signals (with learned lift): ${verified.map((s) => `${s.label}${s.value ? ` (${s.value})` : ""} [${patterns.get(s.key)?.lift ?? "?"}x] evidence: ${s.evidence[0]?.title ?? "n/a"}`).join("; ") || "none"}`,
    `Hypotheses (do NOT state as fact): ${hyp.map((s) => s.label).join("; ") || "none"}`,
    `Research brief: ${account.brief ?? "n/a"}`,
    `Pain hypothesis: ${account.painHypothesis ?? "n/a"}`,
    `Messaging angle: ${c?.angle ?? account.messagingAngle ?? "n/a"}`,
    `ROI defaults: ${JSON.stringify(c?.roiDefaults ?? roiDefaultsFor(account))}`,
    `Customer proof you may cite: ${proofLine ? `"${proofLine.title}": ${proofLine.value} ${proofLine.metric}` : "NONE - make no customer claim and use no customer numbers"}`,
    `Experiment arm: ${c ? `${c.arms.videoType} video, ${c.arms.personalization} personalization, angle ${c.arms.angleVariant}` : "n/a"}`,
    `Page: ${c?.pageUrl ?? "n/a"}`,
  ].join("\n");
}

export async function writeScript(account: Account, ctx: AgentContext): Promise<{ beats: VideoBeats; script: string; generatedBy: "llm" | "template" }> {
  const proofLine = await loadProofLine(account);
  const template = templateBeats(account, ctx.model, proofLine);
  const deep = account.campaign?.arms.personalization !== "conventional";
  if (!llmAvailable() || !deep) return { beats: { hook: template.hook, proof: template.proof, ask: template.ask }, script: template.script, generatedBy: "template" };

  const r = await generateStructured({
    schema: BeatsSchema,
    effort: "low",
    system:
      `You are the Video Agent for ${config.brandName}, a managed transportation provider. You write 15-25 second personalized video scripts a sales rep (or their AI likeness) speaks to one prospect. ` +
      "Use only the dossier. Never state a hypothesis as fact. One number only. Warm, direct, no hype, no exclamation marks, no 'I hope you are well'. The script must read naturally out loud.",
    user: `${buildDossier(account, ctx.model, proofLine)}\n\nTemplate draft to beat (keep the facts): ${template.script}`,
  });
  if (!r) return { beats: { hook: template.hook, proof: template.proof, ask: template.ask }, script: template.script, generatedBy: "template" };
  const words = wordCount(r.script);
  if (words < WORDS_MIN || words > WORDS_MAX) {
    ctx.log(`video: script for ${account.slug} was ${words} words; using template`);
    return { beats: { hook: template.hook, proof: template.proof, ask: template.ask }, script: template.script, generatedBy: "template" };
  }
  return { beats: { hook: r.hook, proof: r.proof, ask: r.ask }, script: r.script, generatedBy: "llm" };
}

export function recordingBrief(account: Account, campaign: Campaign): string {
  const first = firstName(account);
  return [
    `Record a 15-25 second selfie video for ${account.companyName} (${first}, ${account.contact?.title ?? "decision maker"}).`,
    `Hook: ${campaign.videoBeats?.hook ?? ""}`,
    `Proof: ${campaign.videoBeats?.proof ?? ""}`,
    `Ask: ${campaign.videoBeats?.ask ?? ""}`,
    `Mention the page: ${campaign.pageUrl}`,
    `Natural light, phone at eye level, say the name in the first 3 seconds. Upload to Loom or Drive and paste the share link on this account page.`,
  ].join("\n");
}

async function processAccount(account: Account, ctx: AgentContext, reason: "new" | "rewrite" | "retry"): Promise<Account> {
  const c = account.campaign!;
  let campaign: Campaign = { ...c };

  if (reason !== "retry") {
    const { beats, script, generatedBy } = await writeScript(account, ctx);
    campaign = { ...campaign, videoBeats: beats, videoScript: script, scriptVersion: (c.scriptVersion ?? 0) + 1 };
    ctx.activity(account.id, "script_written", `Video script v${campaign.scriptVersion} written (${generatedBy}, ~${estimateSeconds(script)}s)${reason === "rewrite" ? " after upstream signals changed" : ""}`, [
      `Hook: ${beats.hook}`,
      `Proof: ${beats.proof}`,
      `Ask: ${beats.ask}`,
    ]);
  }

  if (campaign.arms.videoType === "rep") {
    campaign = { ...campaign, videoSource: "rep", videoStatus: "awaiting_recording", videoBrief: recordingBrief(account, campaign), videoStatusDetails: "waiting for a rep to record and attach the clip" };
    if (reason !== "retry") ctx.activity(account.id, "recording_brief_issued", "Rep-video arm: recording brief issued; waiting for the clip", [campaign.videoBrief ?? ""]);
    return markAgentRun({ ...account, campaign }, "video");
  }

  try {
    const video = await ctx.providers.video.createVideo({
      script: campaign.videoScript,
      name: `${account.companyName} - ${account.slug} v${campaign.scriptVersion}`,
      accountSlug: account.slug,
      callbackUrl: `${config.appUrl}/api/webhooks/tavus${config.tavus.webhookSecret ? `?token=${encodeURIComponent(config.tavus.webhookSecret)}` : ""}`,
    });
    campaign = {
      ...campaign,
      videoSource: "ai",
      videoId: video.videoId,
      videoStatus: video.status,
      videoUrl: video.hostedUrl,
      videoThumbnailUrl: video.thumbnailUrl,
      videoStatusDetails: video.statusDetails,
      videoAttempts: (c.videoAttempts ?? 0) + 1,
    };
    ctx.activity(account.id, "video_submitted", `Video submitted to ${ctx.providers.video.name} (${video.status})`, [video.statusDetails ?? ""]);
  } catch (err) {
    const msg = (err as Error).message;
    campaign = { ...campaign, videoSource: "ai", videoStatus: "failed", videoStatusDetails: msg, videoAttempts: (c.videoAttempts ?? 0) + 1 };
    ctx.log(`video: provider failed for ${account.slug}: ${msg}`);
    ctx.activity(account.id, "video_failed", `Video provider failed (attempt ${campaign.videoAttempts})`, [msg]);
  }
  return markAgentRun({ ...account, campaign }, "video");
}

export const videoAgent: AgentDefinition = {
  id: "video",
  name: "Video Agent",
  role: "personalized video",
  description: "Writes the 15-25s beat sheet and script from the whole team's dossier, submits AI renders to Tavus or issues a rep recording brief, tracks rendering, and rewrites when signals change.",
  cadenceSeconds: 30,
  step: 4,
  async run(ctx) {
    const all = (await ctx.store.listAccounts()).filter((a) => a.campaign && !["lost", "disqualified"].includes(a.status));
    const work: { account: Account; reason: "new" | "rewrite" | "retry" }[] = [];
    for (const a of all) {
      const c = a.campaign!;
      if (c.videoStatus === "pending") work.push({ account: a, reason: "new" });
      else if (c.videoStatus === "failed" && (c.videoAttempts ?? 0) < MAX_ATTEMPTS) work.push({ account: a, reason: "retry" });
      else if (["script_ready", "awaiting_recording", "ready"].includes(c.videoStatus) && (a.agentRuns.research ?? "") > (a.agentRuns.video ?? "") && c.videoSource !== "rep") {
        work.push({ account: a, reason: "rewrite" });
      }
    }
    const batch = work.slice(0, ctx.batchSize);
    await mapLimit(batch, config.agents.llmConcurrency, async ({ account, reason }) => {
      const updated = await processAccount(account, ctx, reason);
      await ctx.store.upsertAccount(updated);
    });

    // Poll renders in flight.
    let polled = 0;
    for (const a of all.filter((x) => x.campaign?.videoStatus === "rendering" && x.campaign.videoId).slice(0, 20)) {
      try {
        const v = await ctx.providers.video.getVideo(a.campaign!.videoId!);
        if (v.status !== a.campaign!.videoStatus) {
          await ctx.store.upsertAccount({
            ...a,
            campaign: { ...a.campaign!, videoStatus: v.status, videoUrl: v.hostedUrl ?? a.campaign!.videoUrl, videoThumbnailUrl: v.thumbnailUrl ?? a.campaign!.videoThumbnailUrl, videoStatusDetails: v.statusDetails },
          });
          ctx.activity(a.id, v.status === "ready" ? "video_ready" : "video_status", `Video ${v.status}${v.hostedUrl ? `: ${v.hostedUrl}` : ""}`);
          polled++;
        }
      } catch (err) {
        ctx.log(`video: poll failed for ${a.slug}: ${(err as Error).message}`);
      }
    }

    const n = (r: "new" | "rewrite" | "retry") => batch.filter((w) => w.reason === r).length;
    return {
      processed: batch.length + polled,
      summary: `${n("new")} scripts written, ${n("rewrite")} rewritten, ${n("retry")} retried${polled ? `, ${polled} renders updated` : ""}, ${work.length - batch.length} waiting`,
    };
  },
};
