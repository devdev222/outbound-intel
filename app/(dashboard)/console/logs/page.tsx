import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { LLM_MODEL, llmAvailable, llmStats } from "@/lib/llm";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  await requireRole(["admin"]);
  const store = getStore();
  const [runs, failed, awaiting, activity, accounts] = await Promise.all([
    store.listAgentRuns({ limit: 200 }),
    store.listOutreach({ status: "failed", limit: 50 }),
    store.listOutreach({ status: "awaiting_rep", limit: 200 }),
    store.listActivity({ limit: 3000 }),
    store.listAccounts(),
  ]);
  const slugOf = new Map(accounts.map((a) => [a.id, a.slug]));
  const errors = runs.filter((r) => r.status === "error");
  const others = runs.filter((r) => r.status !== "error").slice(0, 60);
  const webhooks = activity.filter((e) => e.actor === "webhook").slice(0, 40);
  const fmt = (iso: string | null | undefined) => (iso ? iso.slice(5, 16).replace("T", " ") : "–");

  return (
    <div className="page">
      <PageHeader eyebrow="Revenue engineering" title="Logs and errors" description="Agent executions, failed deliveries and inbound webhook activity. Errors first." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={errors.length ? "bad" : "good"}>{errors.length} agent errors (last {runs.length} runs)</Badge>
        <Badge tone={failed.length ? "bad" : "good"}>{failed.length} failed touches</Badge>
        <Badge tone="warn">{awaiting.length} touches awaiting a rep</Badge>
        <Badge tone={llmAvailable() ? "good" : "neutral"}>{llmAvailable() ? `Claude ${LLM_MODEL}` : "Claude off"}</Badge>
        <Badge>LLM calls {llmStats.calls} · failures {llmStats.failures}</Badge>
        {llmStats.lastError && <Badge tone="bad">last LLM error: {llmStats.lastError}</Badge>}
      </div>

      <Card title="Agent errors" hint={errors.length ? "expand a row for the stack" : "none in the recent window"} padded={false} className="mb-4">
        {errors.length ? (
          <div className="divide-y divide-[var(--border)]">
            {errors.map((r) => (
              <details key={r.id} className="px-4 py-2">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="mono text-xs text-[var(--muted)]">{fmt(r.startedAt)}</span>
                  <span className="font-medium">{r.agentId}</span>
                  <span className="text-xs text-[var(--bad)]">{r.summary}</span>
                </summary>
                <pre className="mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-[var(--bad)]">{r.error ?? "(no stack)"}</pre>
                {r.details.length > 0 && <pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-[var(--text-2)]">{r.details.join("\n")}</pre>}
              </details>
            ))}
          </div>
        ) : (
          <div className="p-4 text-sm text-[var(--muted)]">No agent errors.</div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Failed and waiting touches" hint="retries happen automatically; failures after 3 attempts land here" padded={false}>
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Step</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {[...failed, ...awaiting.slice(0, 30)].map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/accounts/${slugOf.get(t.accountId) ?? ""}`} className="text-[var(--info)]">
                      {slugOf.get(t.accountId) ?? t.accountId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="text-xs">
                    {t.step} · {t.channel}
                  </td>
                  <td>
                    <span className={t.status === "failed" ? "pill pill-bad" : "pill pill-warn"}>{t.status.replace(/_/g, " ")}</span>
                  </td>
                  <td className="text-xs text-[var(--muted)]">{t.note ?? ""}</td>
                </tr>
              ))}
              {!failed.length && !awaiting.length && (
                <tr>
                  <td colSpan={4} className="text-sm text-[var(--muted)]">
                    Nothing failed or waiting.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <Card title="Inbound webhooks" hint="recent deliveries from Clay, Tavus, Resend, RB2B, Calendly" padded={false}>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Account</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((e) => (
                <tr key={e.id}>
                  <td className="mono text-xs text-[var(--muted)]">{fmt(e.at)}</td>
                  <td className="mono text-xs">{e.action}</td>
                  <td className="text-xs">{slugOf.get(e.accountId) ?? ""}</td>
                  <td className="text-xs">{e.summary}</td>
                </tr>
              ))}
              {!webhooks.length && (
                <tr>
                  <td colSpan={4} className="text-sm text-[var(--muted)]">
                    No webhook deliveries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="mt-4" title="Recent runs" hint={`${others.length} most recent non-error runs`} padded={false}>
        <table className="table">
          <thead>
            <tr>
              <th>Started</th>
              <th>Agent</th>
              <th>Status</th>
              <th className="text-right">Processed</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {others.map((r) => (
              <tr key={r.id}>
                <td className="mono text-xs text-[var(--muted)]">{fmt(r.startedAt)}</td>
                <td>{r.agentId}</td>
                <td>
                  <span className={r.status === "ok" ? "pill pill-good" : "pill"}>{r.status}</span>
                </td>
                <td className="text-right">{r.processed}</td>
                <td className="text-xs">{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
