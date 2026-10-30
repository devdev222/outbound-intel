import { config } from "@/lib/config";
import type { Account, MessageTemplate, TemplateChannel } from "@/lib/types";
import { pageTokenFor } from "@/lib/util";

/**
 * Message templates: the team's own email, LinkedIn, InMail and call scripts,
 * written by hand or uploaded, with {{variables}} filled per account.
 *
 * Rendering is line-aware: a line whose variables ALL came out empty (for
 * example "Relevant: {{proof}}" when no approved customer story matches) is
 * dropped, so a template never sends a dangling sentence. Put optional
 * variables on their own line.
 */

export const TEMPLATE_VARIABLES: { key: string; description: string; example: string }[] = [
  { key: "first_name", description: "Contact's first name", example: "Nina" },
  { key: "full_name", description: "Contact's full name", example: "Nina Park" },
  { key: "title", description: "Contact's job title", example: "VP Logistics" },
  { key: "company", description: "Company name", example: "Evergreen Foods" },
  { key: "industry", description: "Industry", example: "Food & beverage" },
  { key: "city", description: "Headquarters city", example: "Chicago" },
  { key: "signal", description: "Top buying signal, in words", example: "the transportation coordinator roles you're hiring for" },
  { key: "angle", description: "Messaging angle (your playbook first, then learned)", example: "Scale shipping without adding coordinators" },
  { key: "pain", description: "Pain hypothesis from research", example: "manual carrier coordination at growing volume" },
  { key: "proof", description: "One approved customer result; empty when none matches", example: "A food & beverage customer got 63% fewer tender rejections with us." },
  { key: "page_url", description: "Personalized page (or booking link in a direct-link test)", example: "https://example.com/for/evergreen-foods-ab12cd34" },
  { key: "booking_url", description: "Booking link (Calendly) or the page's booking section", example: "https://calendly.com/cartage/15min" },
  { key: "assessment_url", description: "Freight operations assessment for this account", example: "https://example.com/assess/evergreen-foods-ab12cd34" },
  { key: "shipments_per_month", description: "Estimated shipments per month", example: "1,200" },
  { key: "rep_name", description: "Owning rep's name", example: "Sam Rivera" },
  { key: "brand", description: "Your company name", example: "Cartage" },
];

const KNOWN = new Set(TEMPLATE_VARIABLES.map((v) => v.key));
const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export type TemplateContext = Record<string, string>;

/** Variables used in a template that the engine does not know (typos). */
export function unknownVariables(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) if (!KNOWN.has(m[1])) out.add(m[1]);
  return [...out];
}

export function renderText(text: string, ctx: TemplateContext): string {
  const lines = text.split(/\r?\n/).map((line) => {
    const vars = [...line.matchAll(VAR_RE)].map((m) => m[1]);
    const rendered = line.replace(VAR_RE, (_m, key: string) => ctx[key] ?? "");
    // A line whose variables ALL came out empty is dropped (e.g. "Relevant: {{proof}}" with no approved proof).
    if (vars.length && vars.every((k) => !ctx[k])) return null;
    return rendered;
  });
  return lines
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderTemplate(t: Pick<MessageTemplate, "subject" | "body">, ctx: TemplateContext): { subject: string | null; body: string } {
  return { subject: t.subject ? renderText(t.subject, ctx).replace(/\s+/g, " ").trim() : null, body: renderText(t.body, ctx) };
}

export interface TemplateContextInput {
  account: Account;
  signal: string;
  angle: string;
  proof: string;
  pageUrl: string;
  repName?: string | null;
  shipmentsPerMonth?: number;
}

export function bookingUrlFor(account: Pick<Account, "id" | "slug">): string {
  return config.calendly.url || `${config.appUrl}/for/${account.slug}-${pageTokenFor(account.id)}#talk`;
}

export function assessmentUrlFor(account: Pick<Account, "id" | "slug">): string {
  return `${config.appUrl}/assess/${account.slug}-${pageTokenFor(account.id)}`;
}

const lowerFirst = (s: string) => (s && !/^[A-Z]{2}/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

export function templateContext(i: TemplateContextInput): TemplateContext {
  const c = i.account.contact;
  return {
    first_name: c?.name.split(" ")[0] ?? "there",
    full_name: c?.name ?? "",
    title: c?.title ?? "",
    company: i.account.companyName,
    industry: i.account.industry,
    city: i.account.hqCity,
    signal: i.signal,
    angle: i.angle,
    // Used mid-sentence ("one more thought on {{pain}}"), so lower-case the first letter unless it is an acronym.
    pain: lowerFirst(i.account.painHypothesis ?? ""),
    proof: i.proof,
    page_url: i.pageUrl,
    booking_url: bookingUrlFor(i.account),
    assessment_url: assessmentUrlFor(i.account),
    shipments_per_month: i.shipmentsPerMonth ? i.shipmentsPerMonth.toLocaleString("en-US") : "",
    rep_name: i.repName ?? "",
    brand: config.brandName,
  };
}

/** Context with the documented example values, for previews without an account. */
export function exampleContext(): TemplateContext {
  return Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v.key, v.example]));
}

// --- Upload parsing ---------------------------------------------------------------

export interface ParsedTemplate {
  name: string;
  channel: TemplateChannel;
  subject: string | null;
  body: string;
  tags: string[];
  fileName: string;
}

const CHANNELS: TemplateChannel[] = ["email", "linkedin", "inmail", "call"];
const asChannel = (v: unknown): TemplateChannel => (CHANNELS.includes(String(v ?? "").toLowerCase() as TemplateChannel) ? (String(v).toLowerCase() as TemplateChannel) : "email");
const baseName = (file: string) => file.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled template";

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)));
}

/** HTML email to plain text: keeps paragraphs and line breaks, link targets in parentheses. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
        const t = text.replace(/<[^>]+>/g, "").trim();
        return t && t !== href ? `${t} (${href})` : href;
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSubject(text: string): { subject: string | null; body: string } {
  const m = text.match(/^\s*subject\s*:\s*(.+)\r?\n/i);
  if (!m) return { subject: null, body: text.trim() };
  return { subject: m[1].trim(), body: text.slice(m[0].length).replace(/^\s*\n/, "").trim() };
}

function parseEml(raw: string): { subject: string | null; body: string } {
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  const headers = head.replace(/\r?\n[ \t]+/g, " ");
  const subject = headers.match(/^subject:\s*(.+)$/im)?.[1]?.trim() ?? null;
  let body = rest.join("\n\n");
  const boundary = headers.match(/boundary="?([^";\r\n]+)"?/i)?.[1];
  if (boundary) {
    const parts = body.split(`--${boundary}`).map((p) => p.trim());
    const pick = (type: string) => parts.find((p) => new RegExp(`content-type:\\s*${type}`, "i").test(p));
    const part = pick("text/plain") ?? pick("text/html");
    if (part) {
      const [, ...b] = part.split(/\r?\n\r?\n/);
      const content = b.join("\n\n");
      body = /content-type:\s*text\/html/i.test(part) ? htmlToText(content) : content;
    }
  } else if (/content-type:\s*text\/html/i.test(headers)) {
    body = htmlToText(body);
  }
  return { subject, body: body.trim() };
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export class TemplateParseError extends Error {}

/**
 * Turn an uploaded file into one or more templates.
 * Supported: .txt / .md (optional "Subject:" first line), .html, .eml,
 * .csv (columns name, subject, body, optional channel and tags), .json (array of the same).
 */
export function parseTemplateFile(fileName: string, content: string): ParsedTemplate[] {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (content.length > 200_000) throw new TemplateParseError(`${fileName}: larger than 200 KB`);
  const one = (subject: string | null, body: string): ParsedTemplate[] => {
    if (!body.trim()) throw new TemplateParseError(`${fileName}: no message body found`);
    return [{ name: baseName(fileName), channel: "email", subject, body: body.trim(), tags: [], fileName }];
  };
  switch (ext) {
    case "txt":
    case "md": {
      const { subject, body } = splitSubject(content);
      return one(subject, body);
    }
    case "html":
    case "htm": {
      const title = content.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
      const text = htmlToText(content);
      const split = splitSubject(text);
      return one(split.subject ?? (title ? decodeEntities(title.trim()) : null), split.body);
    }
    case "eml": {
      const { subject, body } = parseEml(content);
      return one(subject, body);
    }
    case "csv": {
      const rows = parseCsv(content);
      if (rows.length < 2) throw new TemplateParseError(`${fileName}: needs a header row and at least one template`);
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const col = (name: string) => header.indexOf(name);
      if (col("body") < 0) throw new TemplateParseError(`${fileName}: missing a "body" column (expected name, subject, body, channel, tags)`);
      return rows.slice(1).map((r, i) => {
        const body = (r[col("body")] ?? "").trim();
        if (!body) throw new TemplateParseError(`${fileName}: row ${i + 2} has an empty body`);
        return {
          name: (col("name") >= 0 ? r[col("name")] : "")?.trim() || `${baseName(fileName)} ${i + 1}`,
          channel: asChannel(col("channel") >= 0 ? r[col("channel")] : "email"),
          subject: (col("subject") >= 0 ? r[col("subject")]?.trim() : "") || null,
          body,
          tags: col("tags") >= 0 ? (r[col("tags")] ?? "").split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [],
          fileName,
        };
      });
    }
    case "json": {
      let data: unknown;
      try {
        data = JSON.parse(content);
      } catch {
        throw new TemplateParseError(`${fileName}: not valid JSON`);
      }
      const list = Array.isArray(data) ? data : [data];
      return list.map((d, i) => {
        const o = (d ?? {}) as Record<string, unknown>;
        const body = String(o.body ?? "").trim();
        if (!body) throw new TemplateParseError(`${fileName}: item ${i + 1} has no body`);
        return {
          name: String(o.name ?? "").trim() || `${baseName(fileName)} ${i + 1}`,
          channel: asChannel(o.channel),
          subject: o.subject ? String(o.subject).trim() : null,
          body,
          tags: Array.isArray(o.tags) ? o.tags.map(String) : [],
          fileName,
        };
      });
    }
    default:
      throw new TemplateParseError(`${fileName}: unsupported file type .${ext} (use .txt, .md, .html, .eml, .csv or .json)`);
  }
}

/** Problems that block saving a template. */
export function validateTemplate(t: { channel: TemplateChannel; subject: string | null; body: string }): string[] {
  const problems: string[] = [];
  if (!t.body.trim()) problems.push("the body is empty");
  if (t.channel === "email" && !t.subject?.trim()) problems.push("an email template needs a subject");
  const unknown = unknownVariables(`${t.subject ?? ""}\n${t.body}`);
  if (unknown.length) problems.push(`unknown variable${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `{{${u}}}`).join(", ")}`);
  if (t.channel === "linkedin" && t.body.length > 300) problems.push("LinkedIn connection notes are limited to 300 characters");
  return problems;
}
