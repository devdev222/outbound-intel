import { IntegrationTestButton } from "@/components/dashboard/IntegrationTestButton";
import { Badge, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getIntegrations, type IntegrationStatus } from "@/lib/integrations";

export const dynamic = "force-dynamic";

const CATEGORY_ORDER: IntegrationStatus["category"][] = ["Intelligence", "Data", "Content", "Outreach", "Activation", "Analytics", "Storage"];

function tone(status: IntegrationStatus["status"]): { tone: "good" | "warn" | "info" | "neutral"; label: string } {
  switch (status) {
    case "connected":
      return { tone: "good", label: "connected" };
    case "mock":
      return { tone: "warn", label: "mock" };
    case "manual":
      return { tone: "info", label: "manual" };
    default:
      return { tone: "neutral", label: "not configured" };
  }
}

export default async function ConsoleIntegrationsPage() {
  await requireRole(["admin"]);
  const integrations = getIntegrations();
  const counts = {
    connected: integrations.filter((i) => i.status === "connected").length,
    mock: integrations.filter((i) => i.status === "mock").length,
    manual: integrations.filter((i) => i.status === "manual").length,
    missing: integrations.filter((i) => i.status === "not_configured"),
  };
  const groups = CATEGORY_ORDER.map((cat) => ({ cat, items: integrations.filter((i) => i.category === cat) })).filter((g) => g.items.length);

  return (
    <div className="page">
      <PageHeader eyebrow="Revenue engineering" title="Integrations" description="Keys live in the server environment (.env.local locally, project settings on Vercel). This page shows what is connected, what each connection unlocks, how to set it up, and lets you test it. Values are never displayed." />

      <section className="card mb-5 p-4">
        <div className="card-title">Connection health</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="good">{counts.connected} connected</Badge>
          <Badge tone="warn">{counts.mock} mock</Badge>
          <Badge tone="info">{counts.manual} manual</Badge>
          <Badge>{counts.missing.length} not configured</Badge>
        </div>
        {counts.missing.length > 0 && (
          <div className="mt-2 text-xs text-[var(--muted)]">
            Selected but missing credentials: {counts.missing.map((i) => i.name).join(", ")}
          </div>
        )}
      </section>

      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.cat}>
            <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--muted)]">{g.cat}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.items.map((i) => {
                const t = tone(i.status);
                return (
                  <article key={i.id} className="card flex flex-col gap-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">{i.name}</h3>
                      <Badge tone={t.tone}>{t.label}</Badge>
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      mode: <span className="mono text-[var(--text)]">{i.mode}</span>
                    </div>
                    <p className="text-[13px] leading-snug text-[var(--text-2)]">{i.unlocks}</p>
                    {i.envVars.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {i.envVars.map((v) => (
                          <span key={v.name} className="pill mono" title={`${v.set ? "set" : "not set"}${v.secret ? " · secret" : ""}`}>
                            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: v.set ? "var(--good)" : "transparent", border: v.set ? "none" : "1px solid var(--muted)" }} />
                            {v.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {i.steps.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-[var(--muted)]">Setup ({i.steps.length} steps)</summary>
                        <ol className="mt-1 list-decimal space-y-1 pl-5 leading-snug">
                          {i.steps.map((s, idx) => (
                            <li key={idx}>{s}</li>
                          ))}
                        </ol>
                      </details>
                    )}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                      {i.docsUrl ? (
                        <a href={i.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--info)]">
                          docs ↗
                        </a>
                      ) : (
                        <span />
                      )}
                      {i.testable && <IntegrationTestButton id={i.id} needsEmail={i.id === "resend"} />}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
