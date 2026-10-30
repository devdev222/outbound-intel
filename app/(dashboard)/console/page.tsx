import Link from "next/link";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { AGENTS } from "@/lib/agents";
import { loopStatus } from "@/lib/agents/runtime";
import { requireRole } from "@/lib/auth";
import { getConnections } from "@/lib/integrations";
import { getStore } from "@/lib/store";
import { getSettings } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  await requireRole(["admin"]);
  const store = getStore();
  const [accounts, states, runs, model, settings] = await Promise.all([store.listAccounts(), store.getAgentStates(), store.listAgentRuns({ limit: 100 }), store.getLatestModel(), getSettings()]);
  const integrations = await getConnections(store);
  const missing = integrations.filter((i) => i.status === "not_configured");
  const degraded = integrations.filter((i) => i.status === "degraded");
  const loop = loopStatus();
  const erroring = AGENTS.filter((a) => states.find((s) => s.agentId === a.id)?.lastStatus === "error");
  const recentErrors = runs.filter((r) => r.status === "error").length;
  const bySource = new Map<string, number>();
  for (const a of accounts) bySource.set(a.facts.source, (bySource.get(a.facts.source) ?? 0) + 1);
  const freshness = settings.automation.signalFreshnessDays;
  const stale = accounts.reduce((n, a) => n + a.signals.filter((s) => s.type !== "intent" && (Date.now() - new Date(s.detectedAt).getTime()) / 86_400_000 > freshness).length, 0);
  const auto = settings.automation;

  const links = [
    ["/console/agents", "Agents"],
    ["/console/integrations", "Integrations"],
    ["/console/data", "Data sources"],
    ["/console/scoring", "Scoring model"],
    ["/console/automation", "Automation"],
    ["/console/logs", "Logs & errors"],
    ["/console/audit", "Audit"],
    ["/lab", "Experiments"],
  ];

  return (
    <div className="page">
      <PageHeader eyebrow="Revenue engineering" title="Console" description="Operational health of the infrastructure behind the revenue platform. Everything here is secondary to the executive and BDR workspaces." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Integrations" actions={<Link href="/console/integrations" className="text-xs text-[var(--info)]">manage</Link>}>
          <div className="flex flex-wrap gap-2">
            <Badge tone="good">{integrations.filter((i) => i.status === "verified").length} verified</Badge>
            <Badge tone="info">{integrations.filter((i) => i.status === "configured").length} configured</Badge>
            {degraded.length > 0 && <Badge tone="bad">{degraded.length} degraded</Badge>}
            <Badge tone="warn">{integrations.filter((i) => i.status === "mock").length} mock</Badge>
            <Badge>{missing.length} not configured</Badge>
          </div>
          {degraded.length > 0 && <div className="mt-2 text-xs text-[var(--bad)]">Degraded: {degraded.map((m) => m.name).join(", ")}</div>}
          {missing.length > 0 && <div className="mt-2 text-xs text-[var(--muted)]">Missing: {missing.map((m) => m.name).join(", ")}</div>}
        </Card>
        <Card title="Agents" actions={<Link href="/console/agents" className="text-xs text-[var(--info)]">manage</Link>}>
          <div className="flex flex-wrap gap-2">
            <Badge tone={loop.running ? "good" : "neutral"}>{loop.running ? "loop running" : "loop stopped"}</Badge>
            <Badge tone={erroring.length ? "bad" : "good"}>{erroring.length ? `${erroring.length} erroring` : "healthy"}</Badge>
            <Badge>{recentErrors} errors in last {runs.length} runs</Badge>
          </div>
          {erroring.length > 0 && <div className="mt-2 text-xs text-[var(--muted)]">{erroring.map((a) => a.name).join(", ")}</div>}
          <div className="mt-2 text-xs text-[var(--muted)]">Last tick {loop.lastTickAt ? loop.lastTickAt.slice(0, 16).replace("T", " ") : "–"}</div>
        </Card>
        <Card title="Automation" actions={<Link href="/console/automation" className="text-xs text-[var(--info)]">manage</Link>}>
          <div className="flex flex-wrap gap-2">
            <Badge tone={auto.autoSendEmail ? "good" : "warn"}>email {auto.autoSendEmail ? "auto" : "approval"}</Badge>
            <Badge tone={auto.autoLaunchCampaigns ? "good" : "warn"}>campaigns {auto.autoLaunchCampaigns ? "auto" : "paused"}</Badge>
            <Badge tone={auto.autoProposeGifts ? "good" : "neutral"}>gifts {auto.autoProposeGifts ? "proposed" : "manual"}</Badge>
            <Badge tone={auto.requireFollowUpApproval ? "info" : "neutral"}>follow-ups {auto.requireFollowUpApproval ? "reviewed" : "auto"}</Badge>
          </div>
        </Card>
        <Card title="Data sources" actions={<Link href="/console/data" className="text-xs text-[var(--info)]">inspect</Link>}>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Store" value={store.kind} />
            <Stat label="Model" value={model ? `v${model.version}` : "–"} sub={model ? `${model.baseline.n} records` : undefined} />
            <Stat label="Accounts" value={accounts.length} sub={[...bySource.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")} />
            <Stat label="Stale signals" value={stale} sub={`older than ${freshness} days`} />
          </div>
        </Card>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className="btn btn-sm">
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
