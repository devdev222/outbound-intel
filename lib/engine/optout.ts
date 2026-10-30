import { config } from "@/lib/config";
import { hmac } from "@/lib/auth/session";

/**
 * Signed, recipient-bound unsubscribe links. The token binds the account id and
 * the exact recipient address, so a link can only suppress the person it was
 * sent to; arbitrary targets cannot be injected through the query string.
 */
export async function optOutToken(accountId: string, email: string): Promise<string> {
  return hmac(`optout:${accountId}:${email.trim().toLowerCase()}`);
}

export async function optOutUrl(accountId: string, email: string): Promise<string> {
  const t = await optOutToken(accountId, email);
  return `${config.appUrl}/api/optout?a=${encodeURIComponent(accountId)}&e=${encodeURIComponent(email.trim().toLowerCase())}&t=${t}`;
}

export async function verifyOptOut(accountId: string, email: string, token: string): Promise<boolean> {
  if (!accountId || !email || !token) return false;
  let expected: string;
  try {
    expected = await optOutToken(accountId, email);
  } catch {
    return false;
  }
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
