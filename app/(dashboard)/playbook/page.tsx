import { CampaignDefaultsEditor, PlaybookEditor } from "@/components/playbook/PlaybookEditor";
import { PlaybookTabs } from "@/components/playbook/PlaybookTabs";
import { Badge, PageHeader } from "@/components/ui";
import { getOrBootstrapModel } from "@/lib/agents/runtime";
import { requireRole } from "@/lib/auth";
import { config } from "@/lib/config";
import { getPlaybook, isPlaybookEmpty } from "@/lib/engine/playbook";
import { allSequences } from "@/lib/engine/sequences";
import { SIGNAL_CATALOG } from "@/lib/engine/signal-catalog";
import { getStore } from "@/lib/store";
import { getSettings, messageTemplates } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export default async function PlaybookPage() {
  const user = await requireRole(["bdr", "exec", "admin"]);
  const canEdit = user.role !== "bdr";
  const [playbook, model, settings, seqs, templates] = await Promise.all([getPlaybook(), getOrBootstrapModel(getStore()), getSettings(), allSequences(), messageTemplates.list()]);
  const signals = SIGNAL_CATALOG.filter((s) => s.type !== "intent").map((s) => ({ key: s.key, label: s.label }));

  return (
    <div className="page">
      <PageHeader
        eyebrow="Your content"
        title="Playbook & sequences"
        description="Your positioning, angles, objection handling, cadences and templates. The agents use these first and fall back to what they learned from history."
        actions={isPlaybookEmpty(playbook) ? <Badge tone="warn">playbook empty: using the learned playbook</Badge> : <Badge>updated by {playbook.updatedBy}</Badge>}
      />
      <PlaybookTabs current="/playbook" counts={{ "/playbook/sequences": seqs.filter((s) => s.status !== "archived").length, "/playbook/templates": templates.filter((t) => t.status !== "archived").length }} />
      <div className="space-y-4">
        <PlaybookEditor initial={playbook} signals={signals} learned={model.playbook.angles} canEdit={canEdit} />
        <CampaignDefaultsEditor initial={settings.defaults} canEdit={canEdit} calendly={Boolean(config.calendly.url)} />
        <section className="card p-4">
          <div className="card-title">Learned playbook (model v{model.version})</div>
          <div className="card-hint mb-2 mt-0.5">Written from won and lost history. Your playbook above overrides it wherever both have an answer.</div>
          <p className="text-[13px] text-[var(--text-2)]">{model.playbook.summary}</p>
          {model.playbook.personaNotes.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-[13px] text-[var(--text-2)]">
              {model.playbook.personaNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
