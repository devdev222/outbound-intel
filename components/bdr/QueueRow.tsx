import { isPhoneVerified } from "@/lib/engine/contact-fields";
import Link from "next/link";
import { TaskActions } from "@/components/dashboard/TaskActions";
import { Badge, fmtAgo } from "@/components/ui";
import { DueLabel } from "@/components/ui/DueLabel";
import { CATEGORY_LABEL, type QueueItem } from "@/lib/engine/workqueue";
import { CallAction } from "./CallAction";
import { CloseAccount } from "./CloseAccount";
import { ConversationPanel, type PanelContext } from "./ConversationPanel";


const TONE: Record<QueueItem["category"], "accent" | "info" | "warn" | "bad"> = { now: "accent", meetings: "info", follow_ups: "warn", needs_attention: "bad" };

/** One compact row per account: who, why now, next action + due, one primary action; everything else on expand. */
export function QueueRow({ item, tz }: { item: QueueItem; tz: string }) {
  const c = item.contact;
  const ctx: PanelContext = {
    slug: item.slug,
    company: item.company,
    opener: item.opener,
    painHypothesis: item.painHypothesis,
    proofLine: item.proof ? `${item.proof.customer}: ${item.proof.line}` : null,
    proofPlaceholder: item.proof?.placeholder,
    contact: c,
    preparedFollowUp: item.preparedFollowUp,
    whyNow: item.whyNow,
    nextAction: item.next.label,
  };
  const p = item.primary;

  return (
    <article className="card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/accounts/${item.slug}`} className="text-[14.5px] font-semibold hover:underline">
              {item.company}
            </Link>
            <Badge tone={TONE[item.category]}>{CATEGORY_LABEL[item.category]}</Badge>
            {item.status === "hot" && <Badge tone="accent">hot</Badge>}
          </div>
          <div className="text-[12.5px] text-[var(--text-2)]">{item.taskContact ? `${item.taskContact.name}, ${item.taskContact.title} (${item.taskContact.role})` : c ? `${c.name}, ${c.title}` : "No contact yet"}</div>
          {item.coverage && <div className="text-[11.5px] text-[var(--muted)]">Buying group: {item.coverage}</div>}
        </div>
        <div className="min-w-[200px] flex-[1.4] text-[12.5px]">
          <div className="line-clamp-2">
            <span className="text-[var(--muted)]">Why now:</span> {item.whyNow}
          </div>
        </div>
        <div className="min-w-[160px] flex-1 text-[12.5px]">
          <div className="font-medium">
            {p.kind === "task" && <span className="mr-1 text-[var(--muted)]">{p.item.channelLabel}:</span>}
            {item.next.label}
          </div>
          <div>
            <DueLabel iso={item.next.dueAt} tz={tz} />
          </div>
        </div>
        {p.kind === "task" && (
          <div className="shrink-0">
            <TaskActions task={p.item.task} action={p.item.action} compact minimal />
          </div>
        )}
        {p.kind === "open" && (
          <Link href={p.href} className="btn btn-accent btn-sm shrink-0 no-underline">
            {p.label}
          </Link>
        )}
        {p.kind === "call" && <CallAction label={p.label} phone={p.phone} ctx={ctx} />}
      </div>

      <details className="mt-2 text-[12.5px]">
        <summary className="cursor-pointer select-none text-[var(--muted)] hover:text-[var(--text)]">
          Details{item.moreTasks > 0 ? ` · ${item.moreTasks} more task${item.moreTasks === 1 ? "" : "s"}` : ""}
          {item.attention.length > 0 && item.category !== "needs_attention" ? ` · ${item.attention.length} issue${item.attention.length === 1 ? "" : "s"}` : ""}
        </summary>
        <div className="mt-3 grid gap-4 md:grid-cols-[1.2fr_1fr]">
          <div className="space-y-2">
            {c && (
              <Field label="Contact">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {c.phone && (
                    <span className="mono">
                      {c.phone} {isPhoneVerified(c) ? <Badge tone="good">verified</Badge> : <Badge>unverified</Badge>}
                    </span>
                  )}
                  {c.email && <span className="mono text-[var(--text-2)]">{c.email}</span>}
                  {c.linkedin && (
                    <a href={c.linkedin} target="_blank" rel="noreferrer" className="text-[var(--info)] hover:underline">
                      LinkedIn
                    </a>
                  )}
                  {c.verifiedBy === "synthetic" && <Badge tone="warn">synthetic data</Badge>}
                </span>
              </Field>
            )}
            <Field label="Suggested opener">
              <span className="italic text-[var(--text-2)]">“{item.opener}”</span>
            </Field>
            {item.painHypothesis && <Field label="Problem we think they have">{item.painHypothesis}</Field>}
            {item.proof && (
              <Field label="Proof to cite">
                {item.proof.customer}: {item.proof.line} {item.proof.placeholder && <Badge tone="warn">placeholder</Badge>}
              </Field>
            )}
            {item.objections.length > 0 && (
              <Field label="If they say…">
                <ul className="space-y-1">
                  {item.objections.map((o) => (
                    <li key={o.objection}>
                      <span className="font-medium">“{o.objection}”</span> <span className="text-[var(--text-2)]">{o.response}</span>
                    </li>
                  ))}
                </ul>
              </Field>
            )}
            <Field label="Last interaction">{item.lastInteraction ? `${fmtAgo(item.lastInteraction.at)} · ${item.lastInteraction.summary}` : "None yet"}</Field>
          </div>
          <div className="space-y-2">
            {item.attention.length > 0 && (
              <div className="rounded-md bg-[var(--warn-soft)] p-2.5">
                <div className="font-semibold text-[var(--warn)]">Needs attention</div>
                <ul className="mt-1 list-disc pl-4 text-[var(--text-2)]">
                  {item.attentionItems.map((b) => (
                    <li key={b.text}>
                      {b.text}{" "}
                      <Link href={b.href} className="text-[var(--info)] hover:underline">
                        {b.action}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {item.tasks.length > 0 && (
              <Field label={`Tasks due (${item.tasks.length})`}>
                <ul className="space-y-2">
                  {item.tasks.map((q) => (
                    <li key={q.task.id} className="rounded-md border border-[var(--border)] p-2">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone="info">{q.channelLabel}</Badge>
                        <span className="font-medium">{q.task.title ?? q.task.subject ?? q.channelLabel}</span>
                        <span className="text-[var(--muted)]">{q.task.status.replace(/_/g, " ")}</span>
                      </div>
                      {q.task.subject && <div className="font-medium">{q.task.subject}</div>}
                      <div className="line-clamp-4 whitespace-pre-wrap text-[var(--text-2)]">{q.task.body}</div>
                      <div className="mt-1.5">
                        <TaskActions task={q.task} action={q.action} compact />
                      </div>
                    </li>
                  ))}
                </ul>
              </Field>
            )}
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {p.kind !== "call" && <ConversationPanel ctx={ctx} />}
          <a href={item.pageUrl} target="_blank" rel="noreferrer" className="btn btn-sm">
            Their page
          </a>
          <Link href={`/accounts/${item.slug}`} className="btn btn-sm no-underline">
            Account
          </Link>
          {item.category === "needs_attention" && <CloseAccount slug={item.slug} />}
        </div>
      </details>
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
