import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Greedy word wrap for SVG text lines. */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  }
  return lines;
}

/**
 * Email thumbnail for the personalized video: a 1200x675 SVG with a play
 * button, the company name and the headline. Linked from outreach emails to
 * /for/[slug]#video.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const account = await getStore().getAccountBySlug(slug);
  if (!account) return new NextResponse("Not found", { status: 404 });

  const headline = account.campaign?.headline ?? `A short note for ${account.companyName}`;
  const lines = wrap(headline, 38, 3);
  const brand = escapeXml(config.brandName);
  const company = escapeXml(account.companyName);
  const lineHeight = 58;
  const startY = 395 - ((lines.length - 1) * lineHeight) / 2;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-label="${escapeXml(headline)}">
  <defs>
    <radialGradient id="bg" cx="20%" cy="10%" r="110%">
      <stop offset="0%" stop-color="#1f2937"/>
      <stop offset="55%" stop-color="#0b0f14"/>
      <stop offset="100%" stop-color="#000000"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)"/>
  <rect x="48" y="48" width="18" height="18" rx="4" fill="#f97316"/>
  <text x="78" y="64" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="24" font-weight="700" fill="#e6edf3">${brand}</text>
  <text x="1152" y="64" text-anchor="end" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="22" fill="#8b9bb0">Prepared for ${company}</text>
  <g transform="translate(600 300)">
    <circle r="78" fill="#ffffff" fill-opacity="0.96"/>
    <path d="M -22 -40 L 44 0 L -22 40 Z" fill="#0b0f14"/>
  </g>
  ${lines
    .map((line, i) => `<text x="600" y="${startY + 130 + i * lineHeight}" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="44" font-weight="600" fill="#ffffff">${escapeXml(line)}</text>`)
    .join("\n  ")}
  <text x="600" y="632" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="22" fill="#8b9bb0">20-second personal note · click to watch</text>
</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
