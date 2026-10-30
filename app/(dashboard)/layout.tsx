import Link from "next/link";
import type { ReactNode } from "react";
import { NavLinks } from "@/components/dashboard/NavLinks";
import { config, describeProviders } from "@/lib/config";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const providers = describeProviders();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 no-underline">
              <span className="inline-block h-6 w-6 rounded-md bg-[var(--accent)]" aria-hidden />
              <span className="text-sm font-semibold tracking-wide">{config.brandName}</span>
              <span className="text-sm text-[var(--muted)]">Outbound Intelligence Engine</span>
            </Link>
            {config.demoBanner && <span className="pill pill-warn">demo / synthetic data</span>}
          </div>
          <NavLinks />
        </div>
        <div className="border-t border-[var(--border)] bg-[var(--panel)]">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-1.5 px-4 py-1.5">
            <span className="mr-1 text-[11px] uppercase tracking-wider text-[var(--muted)]">adapters</span>
            {Object.entries(providers).map(([k, v]) => (
              <span key={k} className="pill mono" title={`${k}: ${v}`}>
                <span className="text-[var(--muted)]">{k}:</span> {v}
              </span>
            ))}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </div>
  );
}
