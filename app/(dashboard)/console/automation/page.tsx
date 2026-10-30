import { AutomationToggles, RepsManager, SuppressionManager } from "@/components/console/SettingsForms";
import { Card, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { ensureDemoIdentities } from "@/lib/auth/users";
import { getSettings, reps, suppressions } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  await requireRole(["admin"]);
  await ensureDemoIdentities();
  const [settings, sups, repList] = await Promise.all([getSettings(), suppressions.list(), reps.list()]);
  return (
    <div className="page">
      <PageHeader eyebrow="Revenue engineering" title="Automation permissions" description={`What the agents may do without a human. Last changed by ${settings.updatedBy} ${settings.updatedAt.startsWith("1970") ? "(defaults)" : settings.updatedAt.slice(0, 16).replace("T", " ")}.`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Agent permissions" hint="changes apply on the next tick and are audited">
          <AutomationToggles automation={settings.automation} />
        </Card>
        <Card title="Reps and capacity" hint="owners for the BDR queue; capacity drives utilization">
          <RepsManager reps={repList} />
        </Card>
      </div>
      <Card className="mt-4" title="Suppression list" hint="emails and domains the engine will never contact; checked before every send and in readiness">
        <SuppressionManager suppressions={sups.sort((a, b) => b.at.localeCompare(a.at))} />
      </Card>
    </div>
  );
}
