import Link from "next/link";
import type { Account } from "@/lib/types";
import { fmtInt, scoreColor, statusLabel, statusPillClass } from "./format";

export function AccountTable({ accounts, emptyText = "No accounts yet. Seed demo data from the Pipeline page." }: { accounts: Account[]; emptyText?: string }) {
  if (!accounts.length) {
    return <div className="panel p-6 text-sm text-[var(--muted)]">{emptyText}</div>;
  }
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="sticky top-0 bg-[var(--panel)] text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
          <tr>
            <th className="px-3 py-2">Score</th>
            <th className="px-3 py-2">Priority</th>
            <th className="px-3 py-2">Company</th>
            <th className="px-3 py-2">Industry</th>
            <th className="px-3 py-2 text-right">Employees</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Verified signals</th>
            <th className="px-3 py-2">Contact</th>
            <th className="px-3 py-2 text-right">Engagement</th>
            <th className="px-3 py-2">Page</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const total = a.scores?.total ?? 0;
            return (
              <tr key={a.id} className="border-t border-[var(--border)] hover:bg-[var(--panel-2)]/60">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="mono w-7 text-right font-semibold" style={{ color: scoreColor(total) }}>
                      {a.scores ? total : "-"}
                    </span>
                    <span className="bar w-16">
                      <span style={{ width: `${total}%` }} />
                    </span>
                  </div>
                </td>
                <td className="mono px-3 py-2">{a.priority}</td>
                <td className="px-3 py-2">
                  <Link href={`/accounts/${a.slug}`} className="font-medium text-[var(--text)] no-underline hover:underline">
                    {a.companyName}
                  </Link>
                  <div className="text-xs text-[var(--muted)]">
                    {a.hqCity}, {a.hqState}
                  </div>
                </td>
                <td className="px-3 py-2 text-[var(--muted)]">{a.industry}</td>
                <td className="mono px-3 py-2 text-right text-[var(--muted)]">{fmtInt(a.employeeCount)}</td>
                <td className="px-3 py-2">
                  <span className={statusPillClass(a.status)}>{statusLabel(a.status)}</span>
                </td>
                <td className="max-w-[260px] px-3 py-2 text-xs">
                  {a.verifiedSignals.length ? (
                    a.verifiedSignals.slice(0, 2).map((s) => (
                      <div key={s} className="truncate" title={s}>
                        {s}
                      </div>
                    ))
                  ) : (
                    <span className="text-[var(--muted)]">none yet</span>
                  )}
                  {a.verifiedSignals.length > 2 && <div className="text-[var(--muted)]">+{a.verifiedSignals.length - 2} more</div>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {a.contact ? (
                    <>
                      <div>{a.contact.name}</div>
                      <div className="text-[var(--muted)]">{a.contact.title}</div>
                    </>
                  ) : (
                    <span className="text-[var(--muted)]">-</span>
                  )}
                </td>
                <td className="mono px-3 py-2 text-right">{a.engagementScore}</td>
                <td className="px-3 py-2 text-xs">
                  {a.campaign ? (
                    <a href={`/for/${a.slug}`} target="_blank" rel="noreferrer" className="text-[var(--info)]">
                      /for/{a.slug}
                    </a>
                  ) : (
                    <span className="text-[var(--muted)]">-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
