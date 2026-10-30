import Link from "next/link";
import { RepTaskActions } from "@/components/dashboard/RepTaskActions";
import { Badge, fmtAgo } from "@/components/ui";
import type { QueueItem } from "@/lib/engine/workqueue";
import type { OutreachTouch } from "@/lib/types";
import { CloseAccount } from "./CloseAccount";
import { ConversationPanel } from "./ConversationPanel";

export function QueueCard({ item, variant = "default", task }: { item: QueueItem; variant?: "default" | "exception" | "meeting"; task?: OutreachTouch | null }) {
  const c = item.contact;
  return (
    <article className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/accounts/${item.slug}`} className="text-[15px] font-semibold hover:underline">
              {item.company}
            </Link>
            <span className="text-[12px] text-[var(--muted)]">{item.industry}</span>
            <Badge title="Priority 0-100">P{item.priority}</Badge>
            {item.status === "hot" && <Badge tone="accent">hot</Badge>}
          </div>
          <div className="mt-1 text-[13px]">
            <span className="font-medium">Why now:</span> <span className="text-[var(--text-2)]">{item.whyNow}</span>
          </div>
        </div>
        <div className="shrink-0 text-right text-[12px]">
          {item.nextAction && (
            <>
              <div className="font-semibold">{item.nextAction.label}</div>
              <div className="text-[var(--muted)]">{item.nextAction.reason}</div>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-2 text-[13px]">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Contact</span>
            {c ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">
                  {c.name}, {c.title}
                </span>
                {c.phone && (
                  <span className="mono">
                    {c.phone} {c.phoneVerified ? <Badge tone="good">verified</Badge> : <Badge>unverified</Badge>}
                  </span>
                )}
                {c.email && <span className="mono text-[var(--text-2)]">{c.email}</span>}
                {c.linkedin && (
                  <a href={c.linkedin} target="_blank" rel="noreferrer" className="text-[var(--info)] hover:underline">
                    LinkedIn
                  </a>
                )}
              </div>
            ) : (
              <div className="mt-0.5 text-[var(--muted)]">No decision-maker yet</div>
            )}
          </div>
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Suggested opener</span>
            <p className="mt-0.5 italic text-[var(--text-2)]">“{item.opener}”</p>
          </div>
          {item.painHypothesis && (
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Problem we think they have</span>
              <div className="mt-0.5">{item.painHypothesis}</div>
            </div>
          )}
        </div>
        <div className="space-y-2 text-[13px]">
          {item.proof && (
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Proof to cite</span>
              <div className="mt-0.5">
                {item.proof.customer}: {item.proof.line} {item.proof.placeholder && <Badge tone="warn">placeholder</Badge>}
              </div>
            </div>
          )}
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Last interaction</span>
            <div className="mt-0.5 text-[var(--text-2)]">{item.lastInteraction ? `${fmtAgo(item.lastInteraction.at)} · ${item.lastInteraction.summary}` : "None yet"}</div>
          </div>
          {item.signals.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.signals.slice(0, 4).map((s) => (
                <Badge key={s} tone="info">
                  {s}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {variant === "exception" && item.readinessBlockers.length > 0 && (
        <div className="mt-3 rounded-md bg-[var(--warn-soft)] p-3 text-[12.5px]">
          <div className="font-semibold text-[var(--warn)]">Blocked from the queue</div>
          <ul className="mt-1 list-disc pl-4 text-[var(--text-2)]">
            {item.readinessBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {task && (
        <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12.5px]">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone="warn">{task.channel} task</Badge>
            {task.note && <span className="text-[var(--muted)]">{task.note}</span>}
          </div>
          <div className="whitespace-pre-wrap text-[var(--text-2)]">{task.body}</div>
          <div className="mt-2">
            <RepTaskActions touch={task} />
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ConversationPanel
          ctx={{
            slug: item.slug,
            company: item.company,
            opener: item.opener,
            painHypothesis: item.painHypothesis,
            proofLine: item.proof ? `${item.proof.customer}: ${item.proof.line}` : null,
            proofPlaceholder: item.proof?.placeholder,
            contact: c,
            preparedFollowUp: item.preparedFollowUp,
          }}
        />
        <a href={item.pageUrl} target="_blank" rel="noreferrer" className="btn btn-sm">
          Their page
        </a>
        {variant === "exception" && <CloseAccount slug={item.slug} />}
      </div>
    </article>
  );
}
