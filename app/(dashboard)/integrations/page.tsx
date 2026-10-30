import { IntegrationTestButton } from "@/components/dashboard/IntegrationTestButton";
import { getIntegrations, type IntegrationStatus } from "@/lib/integrations";

export const dynamic = "force-dynamic";

const CATEGORY_ORDER: IntegrationStatus["category"][] = ["Intelligence", "Data", "Content", "Outreach", "Activation", "Analytics", "Storage"];

function statusPill(status: IntegrationStatus["status"]): { cls: string; label: string } {
  switch (status) {
    case "connected":
      return { cls: "pill pill-good", label: "connected" };
    case "mock":
      return { cls: "pill pill-warn", label: "mock" };
    case "manual":
      return { cls: "pill pill-info", label: "manual" };
    default:
      return { cls: "pill", label: "not configured" };
  }
}

export default async function IntegrationsPage() {
  const integrations = getIntegrations();
  const connected = integrations.filter((i) => i.status === "connected").length;
  const groups = CATEGORY_ORDER.map((cat) => ({ cat, items: integrations.filter((i) => i.category === cat) })).filter((g) => g.items.length);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          Every external system sits behind an adapter selected by environment variables. Keys live in the server environment: <span className="mono">.env.local</span>{" "}
          locally, the project settings on Vercel. This page shows what is connected, what each connection unlocks, how to set it up, and lets you test it. Values are never
          displayed here.
        </p>
        <div className="mt-2 flex gap-2 text-xs">
          <span className="pill pill-good">{connected} connected</span>
          <span className="pill pill-warn">{integrations.filter((i) => i.status === "mock").length} mock</span>
          <span className="pill">{integrations.filter((i) => i.status === "not_configured").length} not configured</span>
          <span className="pill pill-info">{integrations.filter((i) => i.status === "manual").length} manual</span>
        </div>
      </div>

      {integrations.length === 0 && <div className="panel p-4 text-sm text-[var(--muted)]">No integrations registered.</div>}

      {groups.map((g) => (
        <section key={g.cat} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{g.cat}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {g.items.map((i) => {
              const pill = statusPill(i.status);
              return (
                <article key={i.id} className="panel flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{i.name}</h3>
                    <span className={pill.cls}>{pill.label}</span>
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    mode: <span className="mono text-[var(--text)]">{i.mode}</span>
                  </div>
                  <p className="text-sm leading-snug">{i.unlocks}</p>

                  {i.envVars.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {i.envVars.map((v) => (
                        <span key={v.name} className="pill mono" title={`${v.set ? "set" : "not set"}${v.secret ? " · secret" : ""}`}>
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: v.set ? "var(--good)" : "transparent", border: v.set ? "none" : "1px solid var(--muted)" }}
                          />
                          {v.name}
                          {v.secret && <span className="text-[var(--muted)]">·s</span>}
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
  );
}
