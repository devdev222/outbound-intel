"use client";

import { useEffect, useState } from "react";
import { dueLabel, formatInTz } from "@/lib/time";

/**
 * A deadline in the viewer's own timezone. The server renders it in the
 * rep/team timezone; the browser re-renders it in local time after mount and
 * keeps it fresh, with the exact time on hover.
 */
export function DueLabel({ iso, tz, className = "" }: { iso: string | null | undefined; tz: string; className?: string }) {
  const [zone, setZone] = useState(tz);
  const [, tick] = useState(0);
  useEffect(() => {
    try {
      setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || tz);
    } catch {
      /* keep the team timezone */
    }
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [tz]);
  if (!iso) return null;
  const d = dueLabel(iso, zone);
  return (
    <span className={`${d.overdue ? "text-[var(--bad)]" : "text-[var(--muted)]"} ${className}`} title={formatInTz(iso, zone)} suppressHydrationWarning>
      {d.text}
    </span>
  );
}
