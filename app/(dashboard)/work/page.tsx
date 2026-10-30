import Link from "next/link";
import { QueueCard } from "@/components/bdr/QueueCard";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { buildWorkQueue, type QueueItem } from "@/lib/engine/workqueue";
import { getStore } from "@/lib/store";
import { reps as repCol } from "@/lib/store/collections";
import type { OutreachTouch } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function WorkPage({ searchParams }: { searchParams: Promise<{ rep?: string }> }) {
  const user = await requireRole(["bdr", "exec", "admin"]);
  const { rep } = await searchParams;
  const store = getStore();
  const reps = await repCol.list();
  const manager = user.role !== "bdr";
  const repId = manager ? (rep === "all" ? null : rep ?? reps[0]?.id ?? null) : (user.repId ?? null);
  const [queue, tasks] = await Promise.all([buildWorkQueue(store, repId), store.listOutreach({ status: "awaiting_rep", limit: 500 })]);
  const taskByAccount = new Map<string, OutreachTouch>();
  for (const t of tasks) if (!taskByAccount.has(t.accountId)) taskByAccount.set(t.accountId, t);
  const repName = repId ? (reps.find((r) => r.id === repId)?.name ?? repId) : "the whole team";
  const total = Object.values(queue.counts).reduce((a, b) => a + b, 0);

  const sections: { key: keyof typeof queue.counts; title: string; blurb: string; items: QueueItem[]; variant?: "default" | "exception" | "meeting"; empty: string }[] = [
    { key: "highIntent", title: "High-intent engagement", blurb: "Prospects who just engaged with their page. Call while it is warm.", items: queue.highIntent, empty: "No one is engaging right now." },
    { key: "callsReady", title: "Calls ready", blurb: "Fully prepared accounts: verified contact, live signal, opener and proof.", items: queue.callsReady, empty: "Nothing waiting. The team is preparing the next accounts." },
    { key: "followUps", title: "Follow-ups requiring attention", blurb: "Drafts to approve, LinkedIn or InMail touches to send, waits that are due.", items: queue.followUps, empty: "No follow-ups due." },
    { key: "meetings", title: "Meetings requiring action", blurb: "Booked meetings to prepare for.", items: queue.meetings, variant: "meeting", empty: "No meetings on the books yet." },
    { key: "exceptions", title: "Exceptions requiring review", blurb: "Accounts the engine could not finish preparing, or that need a human call.", items: queue.exceptions, variant: "exception", empty: "No exceptions. Everything in the queue passed readiness." },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="BDR workspace"
        title="Today"
        description={`${total} items prepared for ${repName}. Every card has the contact, the reason, the opener and the proof; start with the top of each list.`}
        actions={
          manager ? (
            <form className="flex items-center gap-2" action="/work">
              <label className="text-[12px] text-[var(--muted)]" htmlFor="rep">
                Rep
              </label>
              <select id="rep" name="rep" className="field max-w-[200px]" defaultValue={repId ?? "all"}>
                <option value="all">Whole team</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" type="submit">
                View
              </button>
            </form>
          ) : undefined
        }
      />

      <nav className="mb-5 flex flex-wrap gap-2 text-[12.5px]">
        {sections.map((s) => (
          <a key={s.key} href={`#${s.key}`} className="pill">
            {s.title} <span className="font-semibold">{queue.counts[s.key]}</span>
          </a>
        ))}
      </nav>

      {total === 0 && (
        <EmptyState
          title="Nothing to work yet"
          body="The agent team has not produced rep-ready accounts for this queue. Check the Accounts page for what is in enrichment, or seed demo data from the console."
          action={
            <Link href="/accounts?view=enrichment" className="btn">
              See accounts in enrichment
            </Link>
          }
        />
      )}

      <div className="space-y-8">
        {sections.map((s) => (
          <section key={s.key} id={s.key}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="section-title mb-0">
                {s.title} <span className="ml-1 text-[13px] font-normal text-[var(--muted)]">{s.items.length}</span>
              </h2>
              <span className="hidden text-[12px] text-[var(--muted)] sm:inline">{s.blurb}</span>
            </div>
            {s.items.length === 0 ? (
              <div className="card px-4 py-5 text-[13px] text-[var(--muted)]">{s.empty}</div>
            ) : (
              <div className="space-y-3">
                {s.items.map((item) => (
                  <QueueCard key={`${s.key}-${item.accountId}`} item={item} variant={s.variant} task={s.key === "followUps" ? taskByAccount.get(item.accountId) ?? null : null} />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
