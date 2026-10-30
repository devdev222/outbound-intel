import { config } from "@/lib/config";
import { markAgentRun } from "@/lib/engine/accounts";
import { launchCampaign } from "@/lib/engine/campaign";
import { processDueTouches } from "@/lib/engine/outreach";
import { type AgentDefinition, mapLimit } from "./base";

/**
 * Campaign Agent: launches the personalized experience for every account that
 * crosses the qualification threshold (page content, ROI defaults, case study,
 * outreach sequence, experiment arms) and then runs the outreach scheduler:
 * every due touch is sent through the active provider, or handed to a rep as a
 * task when the channel has no sending API here (LinkedIn, InMail, gifts).
 * The Video Agent owns the video from the moment a campaign exists.
 */
export const campaignAgent: AgentDefinition = {
  id: "campaign",
  name: "Campaign Agent",
  role: "personalization + experiments + sequencing",
  description: "Builds the /for/ page content, ROI defaults and 5-touch sequence for each qualified account; assigns A/B arms; sends due touches or hands them to reps as tasks.",
  cadenceSeconds: 45,
  step: 4,
  async run(ctx) {
    const all = await ctx.store.listAccounts();
    const toLaunch = all.filter((a) => a.status === "qualified" && !a.campaign).slice(0, ctx.batchSize);
    await mapLimit(toLaunch, config.agents.llmConcurrency, async (a) => {
      const launched = await launchCampaign(a, ctx);
      const touches = await ctx.store.listOutreach({ accountId: a.id });
      ctx.activity(a.id, "campaign_launched", `Campaign launched: "${launched.campaign?.headline}"`, [
        `Arms: ${Object.entries(launched.campaign?.arms ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`,
        `Sequence: ${touches.length} touches (${touches.map((t) => t.channel).join(", ")})`,
        `Page: ${launched.campaign?.pageUrl}`,
      ]);
      await ctx.store.upsertAccount(markAgentRun(launched, "campaign"));
    });

    const due = await processDueTouches(ctx.store, ctx.providers, { log: ctx.log, activity: ctx.activity });

    const parts = [`${toLaunch.length} campaigns launched`];
    if (due.sent) parts.push(`${due.sent} touches sent via ${ctx.providers.outreach.name}`);
    if (due.repTasks) parts.push(`${due.repTasks} rep tasks created`);
    if (due.failed) parts.push(`${due.failed} failed`);
    if (due.skipped) parts.push(`${due.skipped} skipped (account closed)`);
    return { processed: toLaunch.length + due.sent + due.repTasks + due.failed, summary: parts.join(", ") };
  },
};
