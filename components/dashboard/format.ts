import type { AccountStatus, AgentRun } from "@/lib/types";

/** Pure formatting helpers usable from both server and client components. */

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return `${iso.slice(0, 16).replace("T", " ")}Z`;
}

export function fmtShortTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return `${iso.slice(5, 16).replace("T", " ")}Z`;
}

export function fmtPct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined ? "-" : n.toLocaleString("en-US");
}

export const STATUS_ORDER: AccountStatus[] = [
  "discovered",
  "scored",
  "qualified",
  "campaign_live",
  "engaged",
  "hot",
  "meeting_booked",
  "won",
  "lost",
  "disqualified",
];

export function statusPillClass(status: AccountStatus | string): string {
  switch (status) {
    case "won":
    case "meeting_booked":
      return "pill pill-good";
    case "hot":
    case "engaged":
      return "pill pill-accent";
    case "lost":
    case "disqualified":
      return "pill pill-bad";
    case "scored":
    case "qualified":
    case "campaign_live":
      return "pill pill-info";
    default:
      return "pill";
  }
}

export function runPillClass(status: AgentRun["status"] | null | undefined): string {
  switch (status) {
    case "ok":
      return "pill pill-good";
    case "error":
      return "pill pill-bad";
    case "running":
      return "pill pill-info";
    case "skipped":
      return "pill pill-warn";
    default:
      return "pill";
  }
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function scoreColor(total: number): string {
  if (total >= 85) return "var(--good)";
  if (total >= 70) return "var(--accent)";
  if (total >= 50) return "var(--warn)";
  return "var(--muted)";
}

export function outreachPillClass(status: string): string {
  switch (status) {
    case "sent":
      return "pill pill-good";
    case "scheduled":
      return "pill pill-info";
    case "awaiting_rep":
      return "pill pill-warn";
    case "failed":
      return "pill pill-bad";
    default:
      return "pill";
  }
}
