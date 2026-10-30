import { IntegrationTestButton } from "@/components/dashboard/IntegrationTestButton";
import { Badge, PageHeader, fmtAgo } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { CAPABILITIES, type Connection, type ConnectionStatus, getConnections } from "@/lib/integrations";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const STATUS: Record<ConnectionStatus, { tone: "good" | "warn" | "info" | "bad" | "neutral"; label: string }> = {
  verified: { tone: "good", label: "Verified" },
  configured: { tone: "info", label: "Configured" },
  degraded: { tone: "bad", label: "Degraded" },
  not_configured: { tone: "neutral", label: "Not configured" },
  mock: { tone: "warn", label: "Mock" },
};

const KIND_LABEL: Record<Connection["kind"], string> = { mock: "Mock", test: "Test adapter", builtin: "Built in", bridge: "Proposed contract", vendor: "Vendor API" };
const KIND_HINT: Record<Connection["kind"], string> = {
  mock: "Synthetic or no-op; demo only",
  test: "Controllable adapter for automated tests",
  builtin: "Handled inside this app",
  bridge: "A contract this app proposes for a Cartage-side service; unverified until the real service passes a test",
  vendor: "Implemented from the vendor's public API docs",
};

export default async function ConsoleIntegrationsPage() {
  await requireRole(["admin"]);
  const connections = await getConnections(getStore());
  const count = (s: ConnectionStatus) => connections.filter((c) => c.status === s).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Revenue engineering"
        title="Integrations"
        description="Each step of the pipeline and the adapter actually doing it. Credentials alone only make a connection Configured; it becomes Verified when a test or a real call succeeds against that provider. Values are never displayed."
      />

      <section className="card mb-5 p-4">
        <div className="card-title">Connection health</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="good">{count("verified")} verified</Badge>
          <Badge tone="info">{count("configured")} configured</Badge>
          <Badge tone="bad">{count("degraded")} degraded</Badge>
          <Badge>{count("not_configured")} not configured</Badge>
          <Badge tone="warn">{count("mock")} mock</Badge>
        </div>
        <ol className="mt-3 flex flex-wrap items-center gap-1 text-[12px] text-[var(--muted)]">
          {CAPABILITIES.filter((c) => c.key !== "platform").map((c, i) => {
            const items = connections.filter((x) => x.capability === c.key);
            const worst = items.some((x) => x.status === "degraded") ? "bad" : items.some((x) => x.status === "not_configured") ? "neutral" : items.every((x) => x.status === "mock") ? "warn" : "good";
            return (
              <li key={c.key} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true">→</span>}
                <a href={`#${c.key}`} className="no-underline">
                  <Badge tone={worst}>{c.label}</Badge>
                </a>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="space-y-6">
        {CAPABILITIES.map((cap) => {
          const items = connections.filter((c) => c.capability === cap.key);
          if (!items.length) return null;
          return (
            <section key={cap.key} id={cap.key}>
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <h2 className="text-[13px] font-semibold">{cap.label}</h2>
                <span className="text-[12px] text-[var(--muted)]">{cap.blurb}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((c) => (
                  <ConnectionCard key={c.id} c={c} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ConnectionCard({ c }: { c: Connection }) {
  const s = STATUS[c.status];
  return (
    <article className="card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{c.name}</h3>
        <span className="flex gap-1">
          {c.status !== "mock" && <Badge title={KIND_HINT[c.kind]}>{KIND_LABEL[c.kind]}</Badge>}
          <Badge tone={s.tone}>{s.label}</Badge>
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
        <dt className="text-[var(--muted)]">Provider</dt>
        <dd className="mono">{c.provider}</dd>
        <dt className="text-[var(--muted)]">Transport</dt>
        <dd>{c.transport}</dd>
        {c.actions.length > 0 && (
          <>
            <dt className="text-[var(--muted)]">Actions</dt>
            <dd>{c.actions.join(", ")}</dd>
          </>
        )}
        <dt className="text-[var(--muted)]">Last success</dt>
        <dd>{c.lastSuccessAt ? fmtAgo(c.lastSuccessAt) : "never"}</dd>
        <dt className="text-[var(--muted)]">Last error</dt>
        <dd className={c.lastError ? "text-[var(--bad)]" : ""} title={c.lastError?.message}>
          {c.lastError ? `${fmtAgo(c.lastError.at)}: ${c.lastError.message.slice(0, 140)}` : "none"}
        </dd>
        <dt className="text-[var(--muted)]">Next action</dt>
        <dd className="font-medium">{c.nextAction}</dd>
      </dl>
      <p className="text-[12.5px] leading-snug text-[var(--text-2)]">
        {c.mode}. {c.unlocks}
      </p>
      {c.envVars.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {c.envVars.map((v) => (
            <span key={v.name} className="pill mono" title={`${v.set ? "set" : "not set"}${v.secret ? " · secret" : ""}`}>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: v.set ? "var(--good)" : "transparent", border: v.set ? "none" : "1px solid var(--muted)" }} />
              {v.name}
            </span>
          ))}
        </div>
      )}
      {c.steps.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--muted)]">Setup ({c.steps.length} steps)</summary>
          <ol className="mt-1 list-decimal space-y-1 pl-5 leading-snug">
            {c.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        {c.docsUrl ? (
          <a href={c.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--info)]">
            docs ↗
          </a>
        ) : (
          <span />
        )}
        {c.test?.available && <IntegrationTestButton id={c.id} provider={c.provider} needsEmail={Boolean(c.test.needsRecipient)} sideEffect={c.test.sideEffect} />}
      </div>
      {c.lastTest && (
        <div className={`text-[11.5px] ${c.lastTest.ok ? "text-[var(--muted)]" : "text-[var(--bad)]"}`}>
          Last test {fmtAgo(c.lastTest.at)} by {c.lastTest.by}: {c.lastTest.message}
        </div>
      )}
    </article>
  );
}
