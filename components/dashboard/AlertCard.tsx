import Link from "next/link";
import type { Alert } from "@/lib/types";
import { fmtTime } from "./format";

export function AlertCard({ alert, showCompanyLink = false }: { alert: Alert; showCompanyLink?: boolean }) {
  const p = alert.payload;
  const delta = p.priorityAfter - p.priorityBefore;
  return (
    <article className="panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--panel-2)] px-4 py-2">
        <div className="font-semibold">🔥 Hot Lead Alert</div>
        <div className="flex items-center gap-1.5 text-xs">
          {alert.deliveredVia.length ? (
            alert.deliveredVia.map((v) => (
              <span key={v} className="pill pill-good">
                {v}
              </span>
            ))
          ) : (
            <span className="pill pill-warn">not delivered</span>
          )}
          <span className="pill">{fmtTime(alert.createdAt)}</span>
        </div>
      </header>
      <div className="grid gap-4 p-4 text-sm md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Account</div>
            <div className="font-medium">
              {showCompanyLink ? (
                <Link href={`/accounts/${p.slug}`} className="no-underline hover:underline">
                  {p.companyName}
                </Link>
              ) : (
                p.companyName
              )}
            </div>
            <div className="text-[var(--muted)]">{p.contact ? `${p.contact.name}, ${p.contact.title}` : "contact not identified"}</div>
            {p.contact?.phone && (
              <div className="mono">
                {p.contact.phone} {p.contact.phoneVerified ? <span className="pill pill-good">verified</span> : <span className="pill pill-warn">unverified</span>}
              </div>
            )}
          </div>
          <Section title="Original signals" items={p.originalSignals} />
          <Section title="Engagement (triggered alert)" items={p.engagement} />
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Updated priority</div>
            <div className="mono">
              {p.priorityAfter}/100{" "}
              <span className={delta >= 0 ? "text-[var(--good)]" : "text-[var(--bad)]"}>
                ({delta >= 0 ? "↑" : "↓"}
                {Math.abs(delta)} from initial)
              </span>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <Section title="Jerry enrichment (real-time)" items={p.enrichment} />
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Recommended talk track</div>
            <blockquote className="mt-1 border-l-2 border-[var(--accent)] pl-3 italic leading-relaxed">“{p.talkTrack}”</blockquote>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Action</div>
            <div>{p.action}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="pill">trigger: {p.triggeredBy}</span>
            <a href={p.pageUrl} target="_blank" rel="noreferrer" className="pill pill-info no-underline">
              open their page
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[var(--muted)]">{title}</div>
      {items.length ? (
        <ul className="mt-1 space-y-0.5">
          {items.map((it, i) => (
            <li key={i}>• {it}</li>
          ))}
        </ul>
      ) : (
        <div className="text-[var(--muted)]">none</div>
      )}
    </div>
  );
}
