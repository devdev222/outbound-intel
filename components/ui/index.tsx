import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Small, server-renderable UI primitives shared by every workspace. Keep them
 * boring and consistent: cards, KPIs, badges, buttons, empty states, tabs.
 */

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--muted)]">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] text-[var(--muted)]">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, hint, actions, children, className = "", padded = true }: { title?: string; hint?: string; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`card ${padded ? "p-4" : ""} ${className}`}>
      {(title || actions) && (
        <header className={`flex items-start justify-between gap-3 ${padded ? "mb-3" : "px-4 pt-4 pb-2"}`}>
          <div>
            {title && <div className="card-title">{title}</div>}
            {hint && <div className="card-hint mt-0.5">{hint}</div>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint, estimate, tone }: { label: string; value: string; hint?: string; estimate?: boolean; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-[var(--good)]" : tone === "warn" ? "text-[var(--warn)]" : tone === "bad" ? "text-[var(--bad)]" : "";
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="card-title">{label}</div>
        {estimate && <span className="pill" title="Derived from assumptions or synthetic data, not a verified figure">estimate</span>}
      </div>
      <div className={`kpi-value mt-2 ${color}`}>{value}</div>
      {hint && <div className="card-hint mt-1">{hint}</div>}
    </div>
  );
}

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";
export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  const cls = tone === "neutral" ? "pill" : `pill pill-${tone}`;
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-[14px] font-semibold">{title}</div>
      {body && <div className="max-w-md text-[13px] text-[var(--muted)]">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Tabs({
  tabs,
  current,
  base,
  param = "tab",
  keep = {},
}: {
  tabs: { key: string; label: string; count?: number }[];
  current: string;
  base: string;
  param?: string;
  /** Other query parameters to carry over (filters, rep, search). Empty values are dropped. */
  keep?: Record<string, string | null | undefined>;
}) {
  const hrefFor = (key: string) => {
    const [path, query = ""] = base.split("?");
    const sp = new URLSearchParams(query);
    for (const [k, v] of Object.entries(keep)) if (v) sp.set(k, v);
    sp.set(param, key);
    return `${path}?${sp.toString()}`;
  };
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-[var(--border)]">
      {tabs.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            href={hrefFor(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${active ? "border-[var(--text)] font-semibold text-[var(--text)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 rounded-full bg-[var(--surface-2)] px-1.5 text-[11px] text-[var(--muted)]">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold">{value}</div>
      {sub && <div className="text-[12px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

export function Meter({ value, max = 100, accent = false }: { value: number; max?: number; accent?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className={`bar ${accent ? "bar-accent" : ""}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ButtonLink({ href, children, variant = "default", className = "", external }: { href: string; children: ReactNode; variant?: "default" | "accent" | "primary" | "ghost"; className?: string; external?: boolean }) {
  const cls = `btn ${variant === "accent" ? "btn-accent" : variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : ""} ${className}`;
  if (external) return <a href={href} target="_blank" rel="noreferrer" className={cls}>{children}</a>;
  return <Link href={href} className={cls}>{children}</Link>;
}

export function Synthetic({ when }: { when: boolean }) {
  if (!when) return null;
  return (
    <span className="pill pill-warn" title="This environment runs on synthetic demo data. Figures are illustrative.">
      synthetic data
    </span>
  );
}

export function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  return iso.slice(0, 16).replace("T", " ");
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = (Date.now() - new Date(iso).getTime()) / 60000;
  if (d < 1) return "just now";
  if (d < 60) return `${Math.round(d)}m ago`;
  if (d < 1440) return `${Math.round(d / 60)}h ago`;
  return `${Math.round(d / 1440)}d ago`;
}
