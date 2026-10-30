"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export interface NavSection {
  label: string;
  items: { href: string; label: string }[];
}

export function NavRail({ brand, sections }: { brand: string; sections: NavSection[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(href + "/")) || (href === "/console" && pathname === "/console");
  const nav = (
    <nav className="flex flex-col gap-5 px-3 py-4">
      <Link href="/" className="px-2 text-[15px] font-semibold tracking-tight">
        {brand}
      </Link>
      {sections.map((s) => (
        <div key={s.label}>
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{s.label}</div>
          <ul className="flex flex-col gap-0.5">
            {s.items.map((it) => (
              <li key={it.href}>
                <Link
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className={`block rounded-md px-2 py-1.5 text-[13px] ${isActive(it.href) ? "bg-[var(--surface-2)] font-semibold text-[var(--text)]" : "text-[var(--text-2)] hover:bg-[var(--surface-2)]"}`}
                >
                  {it.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <>
      <aside className="hidden w-56 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] md:block">{nav}</aside>
      <button className="btn btn-sm fixed bottom-4 left-4 z-30 md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Toggle navigation">
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <div className="fixed inset-0 z-20 bg-black/20 md:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-64 overflow-y-auto bg-[var(--surface)]" onClick={(e) => e.stopPropagation()}>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
