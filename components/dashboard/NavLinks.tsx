"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Pipeline" },
  { href: "/accounts", label: "Accounts" },
  { href: "/agents", label: "Agents" },
  { href: "/intelligence", label: "Intelligence" },
  { href: "/alerts", label: "Alerts" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${active ? "bg-[var(--panel-2)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
