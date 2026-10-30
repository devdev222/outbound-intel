import { PlaybookTabs } from "@/components/playbook/PlaybookTabs";
import { SequenceBuilder } from "@/components/playbook/SequenceBuilder";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { allSequences } from "@/lib/engine/sequences";
import { INDUSTRIES, SIGNAL_CATALOG } from "@/lib/engine/signal-catalog";
import { getStore } from "@/lib/store";
import { messageTemplates } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export default async function SequencesPage() {
  const user = await requireRole(["bdr", "exec", "admin"]);
  const [seqs, templates, accounts] = await Promise.all([allSequences(), messageTemplates.list(), getStore().listAccounts()]);
  const sample = accounts
    .filter((a) => a.contact && a.signals.length)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 12)
    .map((a) => ({ slug: a.slug, company: a.companyName }));
  return (
    <div className="page">
      <PageHeader eyebrow="Your content" title="Playbook & sequences" description="Your cadences: which channel on which day, and which of your templates each step uses." />
      <PlaybookTabs current="/playbook/sequences" counts={{ "/playbook/sequences": seqs.filter((s) => s.status !== "archived").length, "/playbook/templates": templates.filter((t) => t.status !== "archived").length }} />
      <SequenceBuilder
        sequences={seqs}
        templates={templates.map((t) => ({ id: t.id, name: t.name, channel: t.channel, status: t.status }))}
        canEdit={user.role !== "bdr"}
        industries={[...INDUSTRIES]}
        signals={SIGNAL_CATALOG.filter((s) => s.type !== "intent").map((s) => ({ key: s.key, label: s.label }))}
        sampleAccounts={sample}
      />
    </div>
  );
}
