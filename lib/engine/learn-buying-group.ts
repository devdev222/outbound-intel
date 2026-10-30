import type { BuyingGroupModel, BuyingRole, HistoricalRecord, RoleStat, SegmentBuyingGroup } from "@/lib/types";
import { SIGNAL_BY_KEY, sizeBandFor } from "./signal-catalog";

/**
 * Buying-group analyst. From deals that recorded their buying group, learn
 * per segment (industry, company size, use case): which roles took part in
 * wins, in what order they were reached, how many people were contacted
 * before a reply, a meeting and a win, and which group size went with the
 * best win rate. Everything here is an association in past data, not a
 * cause; the plan uses it only with enough deals, and the Lab confirms it.
 */

const ROLES: BuyingRole[] = ["economic_buyer", "operational_owner", "champion", "supporting"];
export const MIN_GROUP_SEGMENT = 25;
const CAVEAT = "Associations in past deals, not proven causes. Larger groups may simply reflect deals that were already progressing. Confirm a change with a Lab experiment before rolling it out.";

const r2 = (x: number) => Math.round(x * 100) / 100;
const laplace = (wins: number, n: number) => (wins + 1) / (n + 2);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function useCaseOf(r: Pick<HistoricalRecord, "signalKeys">): string {
  const k = r.signalKeys.find((x) => SIGNAL_BY_KEY[x]?.type && SIGNAL_BY_KEY[x].type !== "intent");
  return k ? SIGNAL_BY_KEY[k].type : "general";
}

export function analyzeSegment(segment: string, deals: HistoricalRecord[]): SegmentBuyingGroup {
  const withGroup = deals.filter((d) => d.contacts?.length);
  const won = withGroup.filter((d) => d.outcome === "won");
  const roleStats: RoleStat[] = ROLES.map((role) => {
    const has = (d: HistoricalRecord, f: (c: NonNullable<HistoricalRecord["contacts"]>[number]) => boolean) => d.contacts!.some((c) => c.role === role && f(c));
    const contacted = withGroup.filter((d) => has(d, (c) => c.contactedOrder !== null)).length;
    const replied = withGroup.filter((d) => has(d, (c) => c.replied)).length;
    const influenced = withGroup.filter((d) => has(d, (c) => c.influenced)).length;
    const inWin = won.filter((d) => has(d, (c) => c.inWin)).length;
    return { role, contacted, replied, influenced, inWin, replyRate: contacted ? r2(replied / contacted) : 0, winPresence: won.length ? r2(inWin / won.length) : 0 };
  });

  const comboMap = new Map<string, { roles: BuyingRole[]; n: number; wins: number }>();
  for (const d of withGroup) {
    const roles = [...new Set(d.contacts!.filter((c) => c.influenced).map((c) => c.role))].sort();
    if (!roles.length) continue;
    const k = roles.join("+");
    const e = comboMap.get(k) ?? { roles, n: 0, wins: 0 };
    e.n++;
    if (d.outcome === "won") e.wins++;
    comboMap.set(k, e);
  }
  const combos = [...comboMap.values()].filter((c) => c.n >= 3).map((c) => ({ roles: c.roles, n: c.n, winRate: r2(c.wins / c.n) })).sort((a, b) => b.winRate - a.winRate || b.n - a.n).slice(0, 6);

  const firstOrder = (d: HistoricalRecord, f: (c: NonNullable<HistoricalRecord["contacts"]>[number]) => boolean) => {
    const xs = d.contacts!.filter((c) => f(c) && c.contactedOrder !== null).map((c) => c.contactedOrder!);
    return xs.length ? Math.min(...xs) : null;
  };
  const contactedCount = (d: HistoricalRecord) => d.contacts!.filter((c) => c.contactedOrder !== null).length;
  const contactsBefore = {
    reply: median(withGroup.map((d) => firstOrder(d, (c) => c.replied)).filter((x): x is number => x !== null)),
    meeting: median(withGroup.map((d) => firstOrder(d, (c) => c.bookedMeeting)).filter((x): x is number => x !== null)),
    win: median(won.map(contactedCount)),
  };

  const sizeMap = new Map<number, { n: number; wins: number }>();
  for (const d of withGroup) {
    const s = Math.min(7, contactedCount(d));
    const e = sizeMap.get(s) ?? { n: 0, wins: 0 };
    e.n++;
    if (d.outcome === "won") e.wins++;
    sizeMap.set(s, e);
  }
  const bySize = [...sizeMap.entries()].map(([size, e]) => ({ size, n: e.n, winRate: r2(e.wins / e.n) })).sort((a, b) => a.size - b.size);

  return { segment, n: withGroup.length, wins: won.length, roleStats, combos, contactsBefore, bySize, recommended: recommend(withGroup, won, roleStats, bySize) };
}

/**
 * Group size: the size (2..6, at least 5 deals) with the best smoothed win
 * rate, preferring the smaller of two that are within 2 points. Roles: those
 * present in at least 30% of wins, as many people per role as wins typically
 * had, in the order wins first reached them; topped up from the default mix.
 */
function recommend(deals: HistoricalRecord[], won: HistoricalRecord[], roleStats: RoleStat[], bySize: SegmentBuyingGroup["bySize"]): SegmentBuyingGroup["recommended"] {
  const rationale: string[] = [];
  const candidates = bySize.filter((s) => s.size >= 2 && s.size <= 6 && s.n >= 5).map((s) => ({ ...s, score: laplace(Math.round(s.winRate * s.n), s.n) }));
  let size = 4;
  if (candidates.length && won.length >= 5) {
    const best = candidates.reduce((a, b) => (b.score > a.score + 0.02 || (Math.abs(b.score - a.score) <= 0.02 && b.size < a.size) ? b : a));
    size = best.size;
    rationale.push(`Deals that reached ${size} people won ${Math.round(best.winRate * 100)}% of the time (n=${best.n}), the best of the sizes with enough data.`);
  } else rationale.push("Not enough deals per group size; keeping four people.");

  const present = roleStats.filter((r) => r.winPresence >= 0.3).sort((a, b) => b.winPresence - a.winPresence);
  const avgOrder = (role: BuyingRole) => {
    const xs = won.flatMap((d) => d.contacts!.filter((c) => c.role === role && c.inWin && c.contactedOrder !== null).map((c) => c.contactedOrder!));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 99;
  };
  const perRole = (role: BuyingRole) => Math.max(1, Math.round(median(won.map((d) => d.contacts!.filter((c) => c.role === role && c.inWin).length).filter((x) => x > 0)) ?? 1));
  let roles: BuyingRole[] = present.flatMap((r) => Array.from({ length: perRole(r.role) }, () => r.role)).sort((a, b) => avgOrder(a) - avgOrder(b));
  for (const r of ["operational_owner", "champion", "economic_buyer", "supporting"] as BuyingRole[]) if (roles.length < size && !roles.includes(r)) roles.push(r);
  // Extra seats go to the roles wins had most people in, in proportion (e.g. a second champion before a third owner).
  const meanPerWin = (role: BuyingRole) => (won.length ? won.reduce((n, d) => n + d.contacts!.filter((c) => c.role === role && c.contactedOrder !== null).length, 0) / won.length : 0);
  while (roles.length < size) {
    const next = ROLES.map((r) => ({ r, room: meanPerWin(r) - roles.filter((x) => x === r).length })).sort((a, b) => b.room - a.room)[0];
    roles.push(next.room > 0 ? next.r : "champion");
  }
  roles = roles.slice(0, size);
  for (const r of present.slice(0, 3)) rationale.push(`${r.role.replace("_", " ")} took part in ${Math.round(r.winPresence * 100)}% of wins (reply rate ${Math.round(r.replyRate * 100)}%).`);
  if (deals.length && !won.length) rationale.push("No wins recorded with a buying group yet.");
  return { size, roles, rationale };
}

export function learnBuyingGroups(history: HistoricalRecord[]): BuyingGroupModel | undefined {
  const deals = history.filter((d) => d.contacts?.length);
  if (!deals.length) return undefined;
  const groups = new Map<string, HistoricalRecord[]>();
  const add = (k: string, d: HistoricalRecord) => groups.set(k, [...(groups.get(k) ?? []), d]);
  for (const d of deals) {
    const band = sizeBandFor(d.employeeCount);
    add(`${d.industry}|${band}|${useCaseOf(d)}`, d);
    add(`${d.industry}|*|*`, d);
    add(`*|${band}|*`, d);
  }
  const segments = [...groups.entries()].filter(([, ds]) => ds.length >= MIN_GROUP_SEGMENT).map(([k, ds]) => analyzeSegment(k, ds)).sort((a, b) => b.n - a.n);
  return { generatedAt: new Date().toISOString(), overall: analyzeSegment("all", deals), segments, caveat: CAVEAT };
}
