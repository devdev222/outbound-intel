import { config } from "@/lib/config";
import type { Account, OutreachTouch } from "@/lib/types";
import { optOutUrl } from "./optout";

/**
 * Renders an outreach touch as a simple, deliverable HTML email: plain
 * paragraphs, the video thumbnail linking to the personalized page, and a
 * text alternative. Deliberately boring; personalization is in the words.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function linkify(text: string): string {
  return escapeHtml(text).replace(/(https?:\/\/[^\s)]+)/g, (url) => `<a href="${url}" style="color:#c2410c">${url}</a>`);
}

export async function renderTouchEmail(account: Account, touch: OutreachTouch): Promise<{ html: string; text: string; listUnsubscribe: string | null }> {
  const pageUrl = account.campaign?.pageUrl ?? `${config.appUrl}/for/${account.slug}`;
  const thumb = account.campaign?.videoThumbnailUrl ?? `${config.appUrl}/api/thumb/${account.slug}`;
  const showThumb = touch.step === 1 && account.campaign?.arms.contentFormat !== "direct_link";
  const body = touch.body.replace(/\n\n\[video thumbnail -> [^\]]+\]/, "");
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px 0;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">${linkify(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const thumbBlock = showThumb
    ? `<p style="margin:6px 0 16px 0"><a href="${pageUrl}#video" style="text-decoration:none"><img src="${thumb}" alt="20-second note for ${escapeHtml(account.companyName)}" width="480" style="display:block;max-width:100%;border-radius:10px;border:1px solid #e5e7eb"></a></p>`
    : "";
  // Signed, recipient-bound unsubscribe link (see lib/engine/optout.ts).
  const optOut = account.contact?.email ? await optOutUrl(account.id, account.contact.email) : null;
  const footerLink = optOut ? ` · <a href="${escapeHtml(optOut)}" style="color:#6b7280">unsubscribe</a>` : "";
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff"><div style="max-width:560px;margin:0 auto">${paragraphs.replace(
    "</p>",
    `</p>${thumbBlock}`,
  )}<p style="margin:24px 0 0 0;font:12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7280">${escapeHtml(config.brandName)} · ${escapeHtml(pageUrl)}${footerLink}</p></div></body></html>`;
  const text = `${body}\n\n${config.brandName} · ${pageUrl}${optOut ? `\nUnsubscribe: ${optOut}` : ""}`;
  return { html, text, listUnsubscribe: optOut };
}
