import { PlaybookTabs } from "@/components/playbook/PlaybookTabs";
import { TemplateLibrary } from "@/components/playbook/TemplateLibrary";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { config } from "@/lib/config";
import { allSequences } from "@/lib/engine/sequences";
import { TEMPLATE_VARIABLES } from "@/lib/engine/templates";
import { getStore } from "@/lib/store";
import { messageTemplates } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const user = await requireRole(["bdr", "exec", "admin"]);
  const [templates, seqs, accounts] = await Promise.all([messageTemplates.list(), allSequences(), getStore().listAccounts()]);
  const sample = accounts
    .filter((a) => a.contact && a.signals.length)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 12)
    .map((a) => ({ slug: a.slug, company: a.companyName }));
  return (
    <div className="page">
      <PageHeader eyebrow="Your content" title="Playbook & sequences" description="Email, LinkedIn, InMail and call templates with variables filled per account. Sequences use them step by step." />
      <PlaybookTabs current="/playbook/templates" counts={{ "/playbook/sequences": seqs.filter((s) => s.status !== "archived").length, "/playbook/templates": templates.filter((t) => t.status !== "archived").length }} />
      <TemplateLibrary templates={templates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))} variables={TEMPLATE_VARIABLES} canEdit={user.role !== "bdr"} sampleAccounts={sample} live={config.mode === "live"} />
    </div>
  );
}
