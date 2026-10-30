import { DEMO_REPS, ensureDemoIdentities } from "@/lib/auth/users";
import type { Store } from "@/lib/store";
import { conversations as convCol, experiments as expCol, giftCampaigns as campCol, gifts as giftCol, getSettings } from "@/lib/store/collections";
import type { Conversation, ConversationOutcome, Outcome } from "@/lib/types";
import { makeRng, nowIso, pickOne, uuid } from "@/lib/util";
import { EXPERIMENT_TEMPLATES, newExperiment } from "./experiments";
import { newCampaign, proposeGifts } from "./gifting";
import { ensureProofSeeded } from "./proof";
import { logActivity } from "./activity";

/**
 * Demo history for the platform: reps, 30 days of conversations and outcomes
 * so the executive views have numbers, one running and one draft experiment,
 * and an active gifting campaign. Only runs on an otherwise empty platform.
 * Everything created here is synthetic and marked as such on the dashboards.
 */
export async function seedPlatformDemo(store: Store, seed = 11): Promise<{ conversations: number; outcomes: number; experiments: number }> {
  await ensureDemoIdentities();
  await ensureProofSeeded();
  const settings = await getSettings();
  if ((await convCol.list()).length > 0) return { conversations: 0, outcomes: 0, experiments: 0 };

  const rng = makeRng(seed);
  const accounts = (await store.listAccounts()).filter((a) => a.scores && a.scores.total >= 55 && !["disqualified"].includes(a.status));
  const reps = DEMO_REPS;

  // Assign owners to scored accounts without one.
  for (const [i, a] of accounts.entries()) if (!a.ownerRepId) await store.upsertAccount({ ...a, ownerRepId: reps[i % reps.length].id });

  const outcomesByType: ConversationOutcome[] = ["no_answer", "no_answer", "voicemail", "voicemail", "connected", "connected", "connected", "replied", "not_now", "not_interested", "meeting_booked", "meeting_booked", "meeting_booked"];
  let convCount = 0;
  let outcomeCount = 0;
  const pool = accounts.slice(0, Math.min(accounts.length, 45));
  for (const a of pool) {
    const n = 2 + Math.floor(rng() * 3);
    let booked = false;
    for (let k = 0; k < n; k++) {
      const daysAgo = Math.floor(rng() * 28) + 1;
      const at = new Date(Date.now() - daysAgo * 86_400_000 - Math.floor(rng() * 8) * 3_600_000).toISOString();
      let outcome = pickOne(rng, outcomesByType);
      if (booked) outcome = "connected";
      if (outcome === "meeting_booked") booked = true;
      const conv: Conversation = {
        id: uuid(),
        accountId: a.id,
        repId: a.ownerRepId ?? reps[0].id,
        channel: rng() < 0.75 ? "call" : "email",
        outcome,
        notes: outcome === "connected" ? "Talked through the coordinator hiring plan; they run tendering in a spreadsheet; wants numbers for the new site." : outcome === "not_interested" ? "Already under contract with a broker through next year." : outcome === "not_now" ? "Budget cycle starts next quarter; revisit then." : outcome === "replied" ? "Asked for the case study and pricing ranges." : "",
        summary: outcome === "meeting_booked" ? "Meeting booked to review the assessment." : outcome === "connected" ? "Live conversation; spreadsheet tendering confirmed; new site is the trigger." : `${outcome.replace(/_/g, " ")} (seeded history)`,
        objections: outcome === "not_interested" ? ["Already has a provider / system"] : outcome === "not_now" ? ["Timing"] : [],
        signalsExtracted: outcome === "connected" ? ["technology:spreadsheet_ops"] : [],
        followUpDraft: null,
        followUpTouchId: null,
        nextAction: null,
        approved: true,
        generatedBy: "template",
        at,
      };
      await convCol.put(conv);
      convCount++;
      if (outcome === "meeting_booked") {
        const o: Outcome = { id: uuid(), accountId: a.id, outcomeType: "meeting_booked", value: null, notes: "seeded history", source: "seed", createdAt: at };
        await store.insertOutcome(o);
        outcomeCount++;
        if (rng() < 0.6) {
          const later = new Date(new Date(at).getTime() + (3 + Math.floor(rng() * 10)) * 86_400_000).toISOString();
          const value = Math.round((a.pipelineValue ?? settings.economics.avgOpportunityValue) * (0.7 + rng() * 0.6));
          await store.insertOutcome({ id: uuid(), accountId: a.id, outcomeType: "opportunity_created", value, notes: "seeded history", source: "seed", createdAt: later < nowIso() ? later : nowIso() });
          outcomeCount++;
          await store.upsertAccount({ ...(await store.getAccountById(a.id))!, status: "meeting_booked" });
        } else {
          await store.upsertAccount({ ...(await store.getAccountById(a.id))!, status: "meeting_booked" });
        }
      } else if (outcome === "not_interested") {
        await store.insertOutcome({ id: uuid(), accountId: a.id, outcomeType: "deal_lost", value: null, notes: "not interested (seeded)", source: "seed", createdAt: at });
        outcomeCount++;
      }
    }
    await logActivity(store, a.id, "system", "history_seeded", `${n} seeded conversation${n === 1 ? "" : "s"} for the demo`);
  }

  // Experiments: one running angle test (assigns on next campaign launches), one draft.
  const angle = EXPERIMENT_TEMPLATES[0];
  const running = newExperiment({ name: angle.name, hypothesis: angle.hypothesis, type: angle.type, segment: { industries: [], sizeBands: [], signalKeys: [], minScore: 60 }, arms: angle.arms, primaryMetric: angle.primaryMetric, createdBy: "seed", status: "running" });
  await expCol.put(running);
  const assess = EXPERIMENT_TEMPLATES[3];
  await expCol.put(newExperiment({ name: assess.name, hypothesis: assess.hypothesis, type: assess.type, segment: { industries: [], sizeBands: [], signalKeys: [], minScore: 65 }, arms: assess.arms, primaryMetric: assess.primaryMetric, createdBy: "seed" }));
  // Back-assign running experiment arms to accounts with campaigns so results have samples.
  for (const a of await store.listAccounts()) {
    if (!a.campaign) continue;
    const arm = running.arms[Math.floor(rng() * running.arms.length)];
    await store.upsertAccount({ ...a, experiments: { ...(a.experiments ?? {}), [running.id]: arm.key } });
  }

  // Gifting campaign with a few proposals awaiting approval.
  const gc = newCampaign({ name: "Q4 engaged-account gifting", status: "active", budgetTotal: 2500, perGiftLimit: 50, eligibility: { minScore: 70, statuses: ["engaged", "hot", "campaign_live", "meeting_booked"], requireEngagement: false }, approvalRequired: true });
  await campCol.put(gc);
  await proposeGifts(store, gc, { limit: 4 });

  void giftCol;
  return { conversations: convCount, outcomes: outcomeCount, experiments: 2 };
}
