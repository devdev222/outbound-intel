import { z } from "zod";
import { isPhoneVerified } from "@/lib/engine/contact";
import { config } from "@/lib/config";
import type { HotLeadAlert } from "@/lib/types";
import { httpJson } from "./http";
import type { AlertProvider } from "./types";

/** Renders the spec's Hot Lead Alert as plain text (used by console + Slack fallback text). */
export function renderAlertText(a: HotLeadAlert): string {
  const lines = [
    `🔥 Hot Lead Alert`,
    ``,
    `Account: ${a.companyName}`,
    a.contact ? `Contact: ${a.contact.name}, ${a.contact.title}` : `Contact: (not yet identified)`,
    a.contact?.phone ? `Phone: ${a.contact.phone}${isPhoneVerified(a.contact) ? " (verified)" : ""}` : null,
    ``,
    `Original Signals:`,
    ...a.originalSignals.map((s) => `• ${s}`),
    ``,
    `Engagement (triggered alert):`,
    ...a.engagement.map((s) => `• ${s}`),
    ``,
    `Updated Priority: ${a.priorityAfter}/100 (${a.priorityAfter >= a.priorityBefore ? "↑" : "↓"}${Math.abs(a.priorityAfter - a.priorityBefore)} from initial)`,
    ``,
    `Jerry Enrichment (real-time):`,
    ...a.enrichment.map((s) => `• ${s}`),
    ``,
    `Recommended Talk Track:`,
    `"${a.talkTrack}"`,
    ``,
    `Action: ${a.action}`,
    `Page: ${a.pageUrl}`,
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

export class ConsoleAlertProvider implements AlertProvider {
  readonly name = "console";
  async sendHotLead(alert: HotLeadAlert) {
    console.log("\n" + renderAlertText(alert) + "\n");
    return { delivered: true, via: "console" };
  }
}

/**
 * Slack adapter. Verified against the official docs on 2026-10-29:
 *  - Incoming webhook: POST https://hooks.slack.com/services/T.../B.../XXX with
 *    { text, blocks } ; 200 "ok" on success; plain-text error codes on 4xx.
 *    Docs: https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks
 *  - chat.postMessage (when SLACK_BOT_TOKEN + SLACK_CHANNEL are set instead):
 *    POST https://slack.com/api/chat.postMessage, Authorization: Bearer xoxb-...,
 *    { channel, text, blocks } -> { ok, ts } ; scope chat:write.
 *    Docs: https://docs.slack.dev/reference/methods/chat.postMessage
 *  Block limits honoured: header plain_text <= 150, section text <= 3000,
 *  section fields <= 10 x 2000, button text <= 75, url <= 3000, <= 50 blocks.
 */
function buildBlocks(a: HotLeadAlert) {
  const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const list = (items: string[]) => items.map((s) => `• ${s}`).join("\n") || "• (none)";
  return [
    { type: "header", text: { type: "plain_text", text: trunc(`🔥 Hot Lead: ${a.companyName}`, 150) } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: trunc(`*Contact*\n${a.contact ? `${a.contact.name}, ${a.contact.title}` : "not identified"}`, 2000) },
        { type: "mrkdwn", text: trunc(`*Phone*\n${a.contact?.phone ?? "n/a"}${isPhoneVerified(a.contact) ? " ✅" : ""}`, 2000) },
        { type: "mrkdwn", text: trunc(`*Priority*\n${a.priorityAfter}/100 (${a.priorityAfter >= a.priorityBefore ? "↑" : "↓"}${Math.abs(a.priorityAfter - a.priorityBefore)})`, 2000) },
        { type: "mrkdwn", text: trunc(`*Triggered by*\n${a.triggeredBy}`, 2000) },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: trunc(`*Original signals*\n${list(a.originalSignals)}`, 3000) } },
    { type: "section", text: { type: "mrkdwn", text: trunc(`*Engagement*\n${list(a.engagement)}`, 3000) } },
    { type: "section", text: { type: "mrkdwn", text: trunc(`*Jerry enrichment*\n${list(a.enrichment)}`, 3000) } },
    { type: "section", text: { type: "mrkdwn", text: trunc(`*Recommended talk track*\n>${a.talkTrack}`, 3000) } },
    {
      type: "actions",
      block_id: `hot_lead_${a.slug}`.slice(0, 255),
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open account brief" },
          url: `${config.appUrl}/accounts/${a.slug}`.slice(0, 3000),
          action_id: "open_brief",
          style: "primary",
        },
        { type: "button", text: { type: "plain_text", text: "View their page" }, url: a.pageUrl.slice(0, 3000), action_id: "open_page" },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: trunc(`Action: ${a.action}`, 2000) }] },
  ];
}

const SlackPostResponse = z.object({ ok: z.boolean(), ts: z.string().optional(), error: z.string().optional() });

export class SlackAlertProvider implements AlertProvider {
  readonly name = "slack";

  async sendHotLead(alert: HotLeadAlert) {
    const text = renderAlertText(alert);
    const blocks = buildBlocks(alert);

    if (config.slack.webhookUrl) {
      const { text: body } = await httpJson(config.slack.webhookUrl, { method: "POST", body: { text, blocks } });
      return { delivered: body.trim() === "ok" || body === "", via: "slack:webhook", note: body.slice(0, 100) };
    }
    if (config.slack.botToken && config.slack.channel) {
      const { data } = await httpJson<{ ok: boolean; ts?: string; error?: string }>("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { authorization: `Bearer ${config.slack.botToken}`, "content-type": "application/json; charset=utf-8" },
        body: { channel: config.slack.channel, text, blocks },
      });
      const parsed = SlackPostResponse.safeParse(data);
      if (!parsed.success) return { delivered: false, via: "slack:chat.postMessage", note: "unexpected response shape from Slack" };
      return { delivered: parsed.data.ok, via: "slack:chat.postMessage", note: parsed.data.ok ? parsed.data.ts : parsed.data.error, remoteId: parsed.data.ts };
    }
    return { delivered: false, via: "slack", note: "SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN+SLACK_CHANNEL not set" };
  }
}
