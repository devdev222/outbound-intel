import { Badge, Card } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/engine/buying-group";
import type { BuyingGroupModel, SegmentBuyingGroup } from "@/lib/types";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const segLabel = (s: string) => (s === "all" ? "All deals" : s.replace(/\|\*/g, "").replace(/^\*\|/, "").replace(/\|/g, " · ") + (s.startsWith("*|") ? " employees" : ""));

function SegmentRow({ s }: { s: SegmentBuyingGroup }) {
  return (
    <li className="py-2 text-[13px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{segLabel(s.segment)}</span>
        <span className="mono text-[12px] text-[var(--text-2)]">
          n={s.n} · {s.wins} won
        </span>
      </div>
      <div className="text-[12.5px] text-[var(--text-2)]">
        Recommended {s.recommended.size} people: {s.recommended.roles.map((r) => ROLE_LABEL[r].toLowerCase()).join(" → ")}
      </div>
      <div className="card-hint">
        People reached before: first reply {s.contactsBefore.reply ?? "–"}, meeting {s.contactsBefore.meeting ?? "–"}, win {s.contactsBefore.win ?? "–"}
      </div>
    </li>
  );
}

/** Buying-group analyst output: what past deals say about roles, group size and order (associations only). */
export function BuyingGroupPatterns({ model }: { model: BuyingGroupModel | undefined }) {
  if (!model) {
    return (
      <Card title="Buying groups" hint="Roles, group size and order from past deals">
        <div className="card-hint">No historical deals recorded their buying group yet. Outreach uses the default four roles until they do.</div>
      </Card>
    );
  }
  const o = model.overall;
  return (
    <Card title="Buying groups" hint={`From ${o.n} deals that recorded who was contacted and who took part`} className="lg:col-span-2">
      <div className="mb-3 rounded-md bg-[var(--warn-soft)] p-2 text-[12px]">{model.caveat}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Roles in wins</div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] text-[var(--muted)]">
                <th className="py-1 font-medium">Role</th>
                <th className="font-medium">Contacted</th>
                <th className="font-medium">Reply rate</th>
                <th className="font-medium">Took part in wins</th>
              </tr>
            </thead>
            <tbody>
              {o.roleStats.map((r) => (
                <tr key={r.role} className="border-t border-[var(--border)]">
                  <td className="py-1.5">{ROLE_LABEL[r.role]}</td>
                  <td className="mono">{r.contacted}</td>
                  <td className="mono">{pct(r.replyRate)}</td>
                  <td className="mono">{pct(r.winPresence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Win rate by people contacted</div>
          <div className="flex flex-wrap gap-1.5">
            {o.bySize.map((b) => (
              <Badge key={b.size} tone={b.size === o.recommended.size ? "good" : "neutral"} title={`n=${b.n}`}>{`${b.size}: ${pct(b.winRate)}`}</Badge>
            ))}
          </div>
          {o.combos.length > 0 && (
            <>
              <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Role combinations that took part</div>
              <ul className="text-[12.5px]">
                {o.combos.slice(0, 4).map((c) => (
                  <li key={c.roles.join("+")} className="flex justify-between py-0.5">
                    <span>{c.roles.map((r) => ROLE_LABEL[r].toLowerCase()).join(" + ")}</span>
                    <span className="mono text-[var(--text-2)]">
                      {pct(c.winRate)} · n={c.n}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Recommended group by segment</div>
          <ul className="divide-y divide-[var(--border)]">
            <SegmentRow s={o} />
            {model.segments.slice(0, 6).map((s) => (
              <SegmentRow key={s.segment} s={s} />
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
