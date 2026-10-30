import { describeEvent } from "@/lib/engine/engagement";
import type { ActivityEntry, EngagementEvent } from "@/lib/types";
import { fmtShortTime } from "./format";

type Lane = "team" | "prospect" | "rep";

interface Row {
  id: string;
  at: string;
  lane: Lane;
  actor: string;
  summary: string;
  details: string[];
  meta?: string;
}

const ACTOR_COLORS: Record<string, string> = {
  icp: "#38bdf8",
  hiring: "#a78bfa",
  expansion: "#f472b6",
  technology: "#60a5fa",
  pain_point: "#fb7185",
  research: "#34d399",
  scoring: "#fbbf24",
  campaign: "#f97316",
  video: "#e879f9",
  jerry: "#22c55e",
  learning: "#2dd4bf",
  system: "#8b9bb0",
  webhook: "#94a3b8",
  rep: "#eab308",
  prospect: "#fb923c",
};

function actorLabel(actor: string): string {
  return actor.replace(/_/g, " ");
}

/**
 * One chronological account history: what the team did (activity entries),
 * what reps did, and what the prospect did (engagement events).
 */
export function ActivityTimeline({ activity, events }: { activity: ActivityEntry[]; events: EngagementEvent[] }) {
  const rows: Row[] = [
    ...activity.map<Row>((a) => ({
      id: `a_${a.id}`,
      at: a.at,
      lane: a.actor === "rep" ? "rep" : "team",
      actor: a.actor,
      summary: a.summary,
      details: a.details ?? [],
      meta: a.action.replace(/_/g, " "),
    })),
    ...events.map<Row>((e) => ({
      id: `e_${e.id}`,
      at: e.createdAt,
      lane: "prospect",
      actor: "prospect",
      summary: describeEvent(e),
      details: [],
      meta: e.visitorId ? `visitor ${e.visitorId.slice(0, 12)}` : undefined,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const teamCount = rows.filter((r) => r.lane === "team").length;
  const prospectCount = rows.filter((r) => r.lane === "prospect").length;
  const repCount = rows.filter((r) => r.lane === "rep").length;

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Account history</h2>
        <div className="flex gap-1.5 text-xs">
          <span className="pill pill-info">team {teamCount}</span>
          <span className="pill pill-accent">prospect {prospectCount}</span>
          <span className="pill pill-warn">rep {repCount}</span>
        </div>
      </div>
      {rows.length ? (
        <ol className="mt-2 max-h-[520px] space-y-1 overflow-y-auto text-sm">
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-[84px_84px_1fr] items-start gap-2 border-t border-[var(--border)] py-1.5 first:border-t-0">
              <span className="mono text-xs text-[var(--muted)]">{fmtShortTime(r.at)}</span>
              <span className="flex items-center gap-1 text-[11px]">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: ACTOR_COLORS[r.actor] ?? "#8b9bb0" }} />
                <span className="truncate" title={`${r.lane} · ${actorLabel(r.actor)}`}>
                  {r.lane === "prospect" ? "prospect" : r.lane === "rep" ? "rep" : actorLabel(r.actor)}
                </span>
              </span>
              <span>
                {r.details.length ? (
                  <details>
                    <summary className="cursor-pointer list-none">
                      {r.summary}
                      {r.meta && <span className="ml-1 text-xs text-[var(--muted)]">· {r.meta}</span>}
                      <span className="ml-1 text-xs text-[var(--muted)]">▾</span>
                    </summary>
                    <ul className="mt-1 space-y-0.5 border-l border-[var(--border)] pl-2 text-xs text-[var(--muted)]">
                      {r.details.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <>
                    {r.summary}
                    {r.meta && <span className="ml-1 text-xs text-[var(--muted)]">· {r.meta}</span>}
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-2 text-sm text-[var(--muted)]">No history yet. Run the team or visit the personalized page.</div>
      )}
    </div>
  );
}
