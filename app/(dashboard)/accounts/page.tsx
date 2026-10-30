import Link from "next/link";
import { AccountTable } from "@/components/dashboard/AccountTable";
import { STATUS_ORDER, statusLabel } from "@/components/dashboard/format";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status, q } = await searchParams;
  const all = await getStore().listAccounts();
  const query = (q ?? "").trim().toLowerCase();
  const filtered = all
    .filter((a) => !status || a.status === status)
    .filter(
      (a) =>
        !query ||
        a.companyName.toLowerCase().includes(query) ||
        a.industry.toLowerCase().includes(query) ||
        a.hqCity.toLowerCase().includes(query) ||
        a.signals.some((s) => s.key.includes(query) || s.label.toLowerCase().includes(query)) ||
        (a.contact?.name.toLowerCase().includes(query) ?? false),
    );

  const hrefFor = (s: string | null) => {
    const p = new URLSearchParams();
    if (s) p.set("status", s);
    if (q) p.set("q", q);
    const qs = p.toString();
    return `/accounts${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Accounts</h1>
          <p className="text-sm text-[var(--muted)]">
            {filtered.length.toLocaleString("en-US")} of {all.length.toLocaleString("en-US")}
          </p>
        </div>
        <form method="get" action="/accounts" className="flex items-center gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search company, industry, signal, contact"
            className="w-72 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={hrefFor(null)} className={`pill no-underline ${!status ? "pill-accent" : ""}`}>
          all
        </Link>
        {STATUS_ORDER.map((s) => (
          <Link key={s} href={hrefFor(s)} className={`pill no-underline ${status === s ? "pill-accent" : ""}`}>
            {statusLabel(s)} · {all.filter((a) => a.status === s).length}
          </Link>
        ))}
      </div>

      <AccountTable accounts={filtered} emptyText={all.length ? "No accounts match this filter." : "No accounts yet. Seed demo data from the Pipeline page."} />
    </div>
  );
}
