import { retryCrmSyncs } from "@/lib/engine/crm-sync";
import { learn } from "@/lib/engine/learn";
import { type AgentDefinition } from "./base";

/**
 * Learning Agent: closes the loop. Whenever new outcomes have arrived since the
 * current model was trained (or no model exists), it retrains the scoring model
 * from the full history, including the engine's own fed-back records, and
 * bumps the model version so the Scoring Agent re-scores every account.
 */
export const learningAgent: AgentDefinition = {
  id: "learning",
  name: "Learning Agent",
  role: "model retraining",
  description: "Re-derives signal lifts, ICP buckets and category weights from history plus every new outcome; writes the playbook; versions the model so all accounts are re-scored.",
  cadenceSeconds: 120,
  step: 8,
  async run(ctx) {
    // Durable CRM write-back: retry outcome syncs whose backoff elapsed.
    const crm = await retryCrmSyncs(ctx.store, ctx.providers);
    const crmNote = crm.synced || crm.failed ? `; CRM sync retries: ${crm.synced} synced, ${crm.failed} still failing` : "";
    const latest = await ctx.store.getLatestModel();
    const outcomes = await ctx.store.listOutcomes({ limit: 500 });
    const relevant = outcomes.filter((o) => ["meeting_booked", "opportunity_created", "deal_won", "deal_lost", "no_response"].includes(o.outcomeType));
    const newSince = latest ? relevant.filter((o) => o.createdAt > latest.trainedAt).length : relevant.length;
    const history = await ctx.store.listHistorical();
    const untrained = latest ? history.length !== latest.baseline.n : history.length > 0;

    if (latest && newSince === 0 && !untrained) {
      return { processed: 0, summary: `model v${latest.version} current (no new outcomes since ${latest.trainedAt.slice(0, 16).replace("T", " ")})${crmNote}` };
    }

    const model = await learn(ctx.store);
    ctx.log(`learning: trained v${model.version}: ${model.notes.join(" | ")}`);
    return {
      processed: newSince || history.length,
      summary: `trained model v${model.version} on ${model.baseline.n} records (${newSince} new outcomes); weights ${Object.entries(model.weights)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}${crmNote}`,
    };
  },
};
