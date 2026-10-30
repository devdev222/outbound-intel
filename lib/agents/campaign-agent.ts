import { config } from "@/lib/config";
import { markAgentRun } from "@/lib/engine/accounts";
import { attemptLaunch, launchCampaign } from "@/lib/engine/campaign";
import { proposeGifts } from "@/lib/engine/gifting";
import { processDueTouches } from "@/lib/engine/outreach";
import { retryPauseSyncs } from "@/lib/engine/pause";
import { getSettings, giftCampaigns } from "@/lib/store/collections";
import { nowIso } from "@/lib/util";
import { type AgentDefinition, mapLimit } from "./base";

/**
 * Campaign Agent: builds the personalized experience for every account that
 * crosses the qualification threshold, launches its sequence (live only after
 * the provider acknowledges), retries pending launches and external pause
 * syncs, and runs the task scheduler: due tasks are delivered through the
 * active provider, held while an account is paused, or become manual work
 * when the channel has no sending API (LinkedIn, InMail, gifts, calls).
 */
export const campaignAgent: AgentDefinition = {
  id: "campaign",
  name: "Campaign Agent",
  role: "personalization + experiments + sequencing",
  description: "Builds the /for/ page content, ROI defaults and 5-touch sequence for each qualified account; launches it (live only on acknowledgment); delivers due tasks or hands them to reps.",
  cadenceSeconds: 45,
  step: 4,
  async run(ctx) {
    const all = await ctx.store.listAccounts();
    const settings = await getSettings();
    const toLaunch = settings.automation.autoLaunchCampaigns ? all.filter((a) => a.status === "qualified" && !a.campaign).slice(0, ctx.batchSize) : [];
    let launchedLive = 0;
    let launchPending = 0;
    await mapLimit(toLaunch, config.agents.llmConcurrency, async (a) => {
      const launched = await launchCampaign(a, ctx);
      const touches = await ctx.store.listOutreach({ accountId: a.id });
      if (launched.campaign?.launchState === "live") launchedLive++;
      else launchPending++;
      ctx.activity(a.id, "campaign_built", `Campaign built: "${launched.campaign?.headline}" (${launched.campaign?.launchState === "live" ? "live" : `launch ${launched.campaign?.launchState}`})`, [
        `Arms: ${Object.entries(launched.campaign?.arms ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`,
        `Tasks: ${touches.length} (${touches.map((t) => t.channel).join(", ")})`,
        launched.campaign?.proofStoryId ? `Proof cited: ${launched.campaign.proofStoryId}` : "No approved proof matched; customer claims omitted",
        `Page: ${launched.campaign?.pageUrl}`,
      ]);
      await ctx.store.upsertAccount(markAgentRun(launched, "campaign"));
    });

    // Retry launches that are pending (transient failure) and due for another attempt.
    const retryable = all.filter((a) => a.campaign?.launchState === "pending" && !toLaunch.some((t) => t.id === a.id));
    let retried = 0;
    for (const a of retryable.slice(0, ctx.batchSize)) {
      const op = await ctx.store.getOperation(`launch:${a.id}`);
      if (op?.nextAttemptAt && op.nextAttemptAt > nowIso()) continue;
      const next = await attemptLaunch(ctx.store, ctx.providers, a, ctx.log);
      if (next.campaign?.launchState !== a.campaign?.launchState || next.status !== a.status) await ctx.store.upsertAccount(next);
      retried++;
    }

    const pauseSynced = await retryPauseSyncs(ctx.store, ctx.providers);
    const due = await processDueTouches(ctx.store, ctx.providers, { log: ctx.log, activity: ctx.activity });

    // Gifting: propose gifts for active campaigns when automation allows (approvals still apply).
    let proposed = 0;
    if (settings.automation.autoProposeGifts) {
      for (const gc of (await giftCampaigns.list()).filter((g) => g.status === "active")) {
        proposed += (await proposeGifts(ctx.store, gc, { limit: 5 })).length;
      }
    }

    const parts = [settings.automation.autoLaunchCampaigns ? `${toLaunch.length} campaigns built (${launchedLive} live, ${launchPending} launch pending)` : "campaign launch paused by automation settings"];
    if (retried) parts.push(`${retried} launch retries`);
    if (pauseSynced) parts.push(`${pauseSynced} pause syncs recovered`);
    if (proposed) parts.push(`${proposed} gifts proposed`);
    if (due.sent) parts.push(`${due.sent} tasks delivered via ${ctx.providers.outreach.name}`);
    if (due.retrying) parts.push(`${due.retrying} deliveries retrying`);
    if (due.manual) parts.push(`${due.manual} tasks handed to reps`);
    if (due.approvals) parts.push(`${due.approvals} awaiting approval`);
    if (due.held) parts.push(`${due.held} held (paused accounts)`);
    if (due.failed) parts.push(`${due.failed} failed`);
    if (due.skipped) parts.push(`${due.skipped} skipped`);
    return { processed: toLaunch.length + retried + due.sent + due.manual + due.failed + due.retrying, summary: parts.join(", ") };
  },
};
