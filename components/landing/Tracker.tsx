"use client";

import { useEffect } from "react";

/**
 * First-party engagement tracking for the personalized page.
 *
 * - One visitor id per browser (localStorage `oi_visitor`) so return visits can be detected server-side.
 * - `track()` posts to /api/track with keepalive so events survive navigation.
 * - Section views (>= 50% visible, once per section) and scroll depth (25/50/75/100, once each).
 */

const VISITOR_KEY = "oi_visitor";
let visitorId: string | null = null;

export function getVisitorId(): string {
  if (visitorId) return visitorId;
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) {
      visitorId = existing;
      return existing;
    }
    const fresh = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(VISITOR_KEY, fresh);
    visitorId = fresh;
    return fresh;
  } catch {
    visitorId = visitorId ?? `v_${Math.random().toString(36).slice(2)}`;
    return visitorId;
  }
}

export function track(slug: string, event: string, properties: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, event, properties, visitorId: getVisitorId() }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // tracking must never break the page
  }
}

export default function Tracker({ slug }: { slug: string }) {
  useEffect(() => {
    getVisitorId();
    track(slug, "page_view", {
      referrer: typeof document !== "undefined" && document.referrer ? document.referrer : undefined,
      path: window.location.pathname,
    });

    // Section views
    const seenSections = new Set<string>();
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-section]"));
    let observer: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window && sections.length) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const name = (entry.target as HTMLElement).dataset.section;
            if (!name || seenSections.has(name)) continue;
            if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
              seenSections.add(name);
              track(slug, "section_view", { section: name });
            }
          }
        },
        { threshold: [0.5] },
      );
      for (const el of sections) observer.observe(el);
    }

    // Scroll depth
    const firedDepths = new Set<number>();
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      const percent = scrollable <= 0 ? 100 : Math.min(100, Math.round(((window.scrollY || doc.scrollTop) / scrollable) * 100));
      for (const mark of [25, 50, 75, 100]) {
        if (percent >= mark && !firedDepths.has(mark)) {
          firedDepths.add(mark);
          track(slug, "scroll_depth", { percent: mark });
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // In case the page is short enough that no scroll ever happens.
    const t = window.setTimeout(onScroll, 1500);

    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(t);
    };
  }, [slug]);

  return null;
}
