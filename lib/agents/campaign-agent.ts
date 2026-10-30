import { config } from "@/lib/config";
import { markAgentRun } from "@/lib/engine/accounts";
import { launchCampaign } from "@/lib/engine/campaign";
import { type AgentDefinition, mapLimit } from "./base";

/**
 * Campaign Agent: launches the personalized experience for every account that
 * crosses the qualification threshold (landing page content, video, outreach
 * sequence, experiment arms) and keeps video status current for async
 * providers such as Tavus.
 */
export const campaignAgent: AgentDefinition = {
  id: "campaign",
  name: "Campaign Agent",
  role: "personalization + experiments",
  description: "Builds the /for/[company] page content, video script, ROI defaults and 5-touch sequence for each qualified account; assigns A/B arms; polls video rendering.",
  cadenceSeconds: 45,
  step: 4,
  async run(ctx) {
    const all = await ctx.store.listAccounts();
    const toLaunch = all.filter((a) => a.status === "qualified" && !a.campaign).slice(0, ctx.batchSize);
    await mapLimit(toLaunch, config.agents.llmConcurrency, async (a) => {
      const launched = await launchCampaign(a, ctx);
      await ctx.store.upsertAccount(markAgentRun(launched, "campaign"));
    });

    // Poll pending videos (no-op for the mock provider, which returns ready immediately).
    const rendering = all.filter((a) => a.campaign && a.campaign.videoId && (a.campaign.videoStatus === "pending" || a.campaign.videoStatus === "rendering"));
    let updatedVideos = 0;
    for (const a of rendering.slice(0, 20)) {
      try {
        const v = await ctx.providers.video.getVideo(a.campaign!.videoId!);
        if (v.status !== a.campaign!.videoStatus) {
          await ctx.store.upsertAccount({
            ...a,
            campaign: { ...a.campaign!, videoStatus: v.status, videoUrl: v.hostedUrl ?? a.campaign!.videoUrl, videoThumbnailUrl: v.thumbnailUrl ?? a.campaign!.videoThumbnailUrl },
          });
          updatedVideos++;
        }
      } catch (err) {
        ctx.log(`campaign: video poll failed for ${a.slug}: ${(err as Error).message}`);
      }
    }

    return {
      processed: toLaunch.length + updatedVideos,
      summary: `${toLaunch.length} campaigns launched${updatedVideos ? `, ${updatedVideos} videos updated` : ""}${rendering.length ? `, ${rendering.length} videos rendering` : ""}`,
    };
  },
};
