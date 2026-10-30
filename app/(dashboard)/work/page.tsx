import Link from "next/link";
import { QueueRow } from "@/components/bdr/QueueRow";
import { LoadDemoWorkspace } from "@/components/bdr/LoadDemoWorkspace";
import { EmptyState, PageHeader, Tabs } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { config } from "@/lib/config";
import { buildWorkQueue, CATEGORY_LABEL, CATEGORY_ORDER, type QueueCategory } from "@/lib/engine/workqueue";
import { getProviders } from "@/lib/providers";
import { getStore } from "@/lib/store";
import { reps as repCol } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

type View = QueueCategory | "all";
const VIEWS: View[] = ["all", ...CATEGORY_ORDER];

const EMPTY: Record<View, string> = {
  all: "Nothing needs you right now.",
  now: "No one is ready to call right now.",
  meetings: "No meetings to prepare or schedule.",
  follow_ups: "No follow-ups due today.",
  needs_attention: "Nothing needs attention. Deliveries, enrichment and launches are healthy.",
};

export default async function WorkPage({ searchParams }: { searchParams: Promise<{ rep?: string; view?: string }> }) {
  const user = await requireRole(["bdr", "exec", "admin"]);
  const sp = await searchParams;
  const view: View = VIEWS.includes(sp.view as View) ? (sp.view as View) : "all";
  const store = getStore();
  const reps = await repCol.list();
  const manager = user.role !== "bdr";
  const repId = manager ? (sp.rep === "all" ? null : (sp.rep ?? reps[0]?.id ?? null)) : (user.repId ?? null);
  const queue = await buildWorkQueue(store, getProviders(), repId);
  const items = view === "all" ? queue.items : queue.items.filter((i) => i.category === view);
  const repName = repId ? (reps.find((r) => r.id === repId)?.name ?? repId) : "the whole team";
  const repParam = manager ? (repId ?? "all") : undefined;
  const accountsTotal = (await store.listAccounts()).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="BDR workspace"
        title="Today"
        description={`${queue.counts.all} account${queue.counts.all === 1 ? "" : "s"} need${queue.counts.all === 1 ? "s" : ""} ${repName === "the whole team" ? "the team" : repName} today, most important first.${queue.paused ? ` ${queue.paused} paused account${queue.paused === 1 ? " is" : "s are"} hidden until their pause ends.` : ""}`}
        actions={
          manager ? (
            <form className="flex items-center gap-2" action="/work">
              <input type="hidden" name="view" value={view} />
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

      <Tabs
        base="/work"
        param="view"
        current={view}
        keep={{ rep: repParam }}
        tabs={VIEWS.map((v) => ({ key: v, label: v === "all" ? "All" : CATEGORY_LABEL[v], count: v === "all" ? queue.counts.all : queue.counts[v] }))}
      />

      {accountsTotal === 0 ? (
        <EmptyState
          title="No accounts yet"
          body={
            user.role === "admin"
              ? config.mode === "live"
                ? "Connect an account source (Clay or the CRM) under Integrations; the agent team prepares accounts from there."
                : "This workspace is empty. Load the demo workspace to see the agent team prepare accounts, or connect an account source."
              : user.role === "exec"
                ? "No accounts have been imported yet. An admin connects the account source; meanwhile you can set up the playbook and sequences reps will use."
                : "No accounts have been imported yet. Your admin connects the account source; accounts appear here once they are prepared. Meanwhile, review the playbook you will call from."
          }
          action={
            user.role === "admin" ? (
              config.mode !== "live" ? <LoadDemoWorkspace /> : <Link href="/console/integrations" className="btn">Open Integrations</Link>
            ) : (
              <Link href="/playbook" className="btn">
                {user.role === "exec" ? "Set up the playbook" : "Review the playbook"}
              </Link>
            )
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={EMPTY[view]}
          body={view === "all" ? "The agent team is preparing the next accounts. Accounts still missing information are on the Accounts page." : undefined}
          action={
            view !== "all" ? (
              <Link href={`/work?${new URLSearchParams({ view: "all", ...(repParam ? { rep: repParam } : {}) }).toString()}`} className="btn">
                Show all of today&apos;s work
              </Link>
            ) : (
              <Link href={`/accounts?${new URLSearchParams({ view: "enrichment", ...(repParam && repParam !== "all" ? { rep: repParam } : {}) }).toString()}`} className="btn">
                See accounts in enrichment
              </Link>
            )
          }
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <QueueRow key={item.accountId} item={item} tz={queue.timezone} />
          ))}
        </div>
      )}
    </div>
  );
}
