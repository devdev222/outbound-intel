import { AgentTeam } from "@/components/dashboard/AgentTeam";
import { buildAgentsPayload } from "./payload";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const initial = await buildAgentsPayload();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Agent team</h1>
        <p className="text-sm text-[var(--muted)]">
          Ten workers, each with a cadence, pulling their own queue from the store. {initial.summary.accounts.toLocaleString("en-US")} accounts · {initial.summary.events.toLocaleString("en-US")} events ·{" "}
          {initial.summary.alerts} alerts · model v{initial.summary.modelVersion ?? "-"}
        </p>
      </div>
      <AgentTeam initial={initial} />
    </div>
  );
}
