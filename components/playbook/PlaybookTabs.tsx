import Link from "next/link";

const TABS = [
  { href: "/playbook", label: "Playbook" },
  { href: "/playbook/sequences", label: "Sequences" },
  { href: "/playbook/templates", label: "Templates" },
];

/** Section tabs for the team's own content. */
export function PlaybookTabs({ current, counts }: { current: string; counts?: Partial<Record<string, number>> }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-1 border-b border-[var(--border)]">
      {TABS.map((t) => {
        const active = t.href === current;
        const n = counts?.[t.href];
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${active ? "border-[var(--text)] font-semibold text-[var(--text)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}
          >
            {t.label}
            {n !== undefined && <span className="ml-1.5 rounded-full bg-[var(--surface-2)] px-1.5 text-[11px] text-[var(--muted)]">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
