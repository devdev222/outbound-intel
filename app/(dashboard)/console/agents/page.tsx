import { AgentTeam } from "@/components/dashboard/AgentTeam";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { buildAgentsPayload } from "./payload";

export const dynamic = "force-dynamic";

export default async function ConsoleAgentsPage() {
  await requireRole(["admin"]);
  const initial = await buildAgentsPayload();
  const errors = initial.agents.filter((a) => a.state?.lastStatus === "error").length;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Revenue engineering"
        title="Agent orchestration"
        description={`${initial.agents.length} agents in four groups. ${initial.summary.accounts.toLocaleString("en-US")} accounts in the system, model v${initial.summary.modelVersion ?? "–"}, ${errors ? `${errors} agent${errors === 1 ? "" : "s"} erroring.` : "no agent errors."}`}
      />
      <AgentTeam initial={initial} grouped />
    </div>
  );
}
