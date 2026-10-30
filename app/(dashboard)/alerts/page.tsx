import Link from "next/link";
import { AlertCard } from "@/components/dashboard/AlertCard";
import { MarkCalledButton } from "@/components/dashboard/MarkCalledButton";
import { fmtTime } from "@/components/dashboard/format";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const store = getStore();
  const [alerts, queue, accounts] = await Promise.all([store.listAlerts(), store.listCallQueue(), store.listAccounts()]);
  const slugById = new Map(accounts.map((a) => [a.id, a.slug]));
  const queued = queue.filter((c) => c.status === "queued").length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Rep activation</h1>
        <p className="text-sm text-[var(--muted)]">
          {alerts.length} alerts · {queued} calls queued · what Slack and the Dialer receive
        </p>
      </div>

      <section className="panel overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-2">
          <h2 className="font-semibold">Call queue</h2>
          <span className="text-xs text-[var(--muted)]">Cartage Dialer queue (local mirror)</span>
        </div>
        {queue.length ? (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-4 py-1.5">Queued</th>
                <th className="px-2 py-1.5">Account</th>
                <th className="px-2 py-1.5">Contact</th>
                <th className="px-2 py-1.5">Phone</th>
                <th className="px-2 py-1.5">Context</th>
                <th className="px-2 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((c) => {
                const slug = slugById.get(c.accountId);
                return (
                  <tr key={c.id} className="border-t border-[var(--border)] align-top">
                    <td className="mono px-4 py-1.5 text-xs text-[var(--muted)]">{fmtTime(c.createdAt)}</td>
                    <td className="px-2 py-1.5">
                      {slug ? (
                        <Link href={`/accounts/${slug}`} className="no-underline hover:underline">
                          {slug}
                        </Link>
                      ) : (
                        <span className="text-[var(--muted)]">deleted</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{c.contactName}</td>
                    <td className="mono px-2 py-1.5">{c.phone ?? <span className="text-[var(--muted)]">none</span>}</td>
                    <td className="max-w-[420px] px-2 py-1.5 text-xs text-[var(--text)]/80">{c.context}</td>
                    <td className="px-2 py-1.5">
                      <MarkCalledButton id={c.id} status={c.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="px-4 pb-4 text-sm text-[var(--muted)]">Nothing queued. Calls appear here when Jerry activates a rep.</div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Alert feed</h2>
        {alerts.length ? alerts.map((a) => <AlertCard key={a.id} alert={a} showCompanyLink />) : <div className="panel p-4 text-sm text-[var(--muted)]">No alerts yet. Open an account and run the hot-lead scenario.</div>}
      </section>
    </div>
  );
}
