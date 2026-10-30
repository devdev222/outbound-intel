/**
 * Timezone-aware deadline helpers (no dependencies; Intl only).
 * "Due today" means before midnight in the rep's timezone (or the team's),
 * not in the server's timezone (UTC on most hosts).
 */

function parts(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), s: Number(p.second) };
}

/** Offset (ms) of `tz` from UTC at `date`. */
function offsetMs(date: Date, tz: string): number {
  const p = parts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

export function validTimezone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** The instant of 23:59:59.999 today in `tz`, as an ISO string. */
export function endOfDayIso(tz: string, now = new Date()): string {
  const p = parts(now, tz);
  const localEnd = Date.UTC(p.y, p.m - 1, p.d, 23, 59, 59, 999);
  // Convert local wall time to UTC using the offset at that moment (DST-safe for end of day).
  const guess = new Date(localEnd - offsetMs(now, tz));
  return new Date(localEnd - offsetMs(guess, tz)).toISOString();
}

/** Calendar-day difference between two instants as seen in `tz`. */
export function dayDiff(iso: string, tz: string, now = new Date()): number {
  const a = parts(new Date(iso), tz);
  const b = parts(now, tz);
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86_400_000);
}

/** "due now", "due 3:30 PM", "due tomorrow 9:00 AM", "due Thu, Nov 6", "2 days overdue", in `tz`. */
export function dueLabel(iso: string | null | undefined, tz: string, now = new Date()): { text: string; overdue: boolean } {
  if (!iso) return { text: "", overdue: false };
  const t = new Date(iso).getTime();
  const ms = t - now.getTime();
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const days = dayDiff(iso, tz, now);
  if (Math.abs(ms) < 15 * 60_000) return { text: "due now", overdue: false };
  if (ms < 0) {
    if (days <= -1) return { text: `${-days} day${days === -1 ? "" : "s"} overdue`, overdue: true };
    return { text: `was due ${time}`, overdue: ms < -60 * 60_000 };
  }
  if (days === 0) return { text: `due ${time}`, overdue: false };
  if (days === 1) return { text: `due tomorrow ${time}`, overdue: false };
  if (days < 7) return { text: `due ${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(iso))} ${time}`, overdue: false };
  return { text: `due ${new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(iso))}`, overdue: false };
}

export function formatInTz(iso: string, tz: string): string {
  // dateStyle/timeStyle cannot be combined with timeZoneName, so spell the fields out.
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}
