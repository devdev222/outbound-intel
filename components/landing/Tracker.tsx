"use client";

import { useEffect } from "react";

/**
 * First-party engagement tracking for the prospect page.
 *
 * - One visitor id per browser (localStorage `oi_visitor`) so return visits can
 *   be detected server-side.
 * - `track(slug, event, properties)` posts to /api/track with keepalive. Every
 *   event carries `account_id` and `campaign_id` (and `is_preview`), matching
 *   the cartage-pages analytics contract.
 * - Section views (>= 50% visible, once per `[data-section]`), scroll depth
 *   (25/50/75/100, once each), booking clicks on `a[data-booking]`
 *   (`booking_clicked { cta_location }`), a dwell-based `pricing_viewed` on the
 *   estimate section, and the scroll-reveal animation hook (`.cp-reveal`).
 */

const VISITOR_KEY = "oi_visitor";
let visitorId: string | null = null;
let context: Record<string, unknown> = {};

export function setTrackingContext(ctx: Record<string, unknown>): void {
  context = { ...ctx };
}

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
      body: JSON.stringify({ slug, event, properties: { ...context, ...properties, $current_url: window.location.href }, visitorId: getVisitorId() }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // tracking must never break the page
  }
}

export interface TrackerProps {
  slug: string;
  accountId: string;
  campaignId: string;
  isPreview: boolean;
}

export default function Tracker({ slug, accountId, campaignId, isPreview }: TrackerProps) {
  useEffect(() => {
    setTrackingContext({ account_id: accountId, campaign_id: campaignId, is_preview: isPreview });
    getVisitorId();
    track(slug, "page_view", {
      referrer: typeof document !== "undefined" && document.referrer ? document.referrer : null,
      path: window.location.pathname,
    });

    const root = document.querySelector<HTMLElement>(".cp");
    root?.classList.add("js");

    // Scroll reveal, like cartage.ai.
    const reveals = Array.from(document.querySelectorAll<HTMLElement>(".cp-reveal"));
    let revealObserver: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      revealObserver = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add("is-visible");
              revealObserver?.unobserve(e.target);
            }
          }
        },
        { rootMargin: "0px 0px -8% 0px" },
      );
      reveals.forEach((el) => revealObserver!.observe(el));
    } else {
      reveals.forEach((el) => el.classList.add("is-visible"));
    }

    // Section views
    const seenSections = new Set<string>();
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-section]"));
    let sectionObserver: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window && sections.length) {
      sectionObserver = new IntersectionObserver(
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
      for (const el of sections) sectionObserver.observe(el);
    }

    // Dwell on the estimate section => pricing_viewed (once).
    let dwellTimer: number | null = null;
    let pricingFired = false;
    const estimate = document.getElementById("estimate");
    let dwellObserver: IntersectionObserver | null = null;
    if (estimate && "IntersectionObserver" in window) {
      dwellObserver = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting && e.intersectionRatio >= 0.4 && !pricingFired) {
              if (dwellTimer === null) {
                dwellTimer = window.setTimeout(() => {
                  pricingFired = true;
                  track(slug, "pricing_viewed", { dwell_seconds: 4 });
                  dwellObserver?.disconnect();
                }, 4000);
              }
            } else if (dwellTimer !== null) {
              window.clearTimeout(dwellTimer);
              dwellTimer = null;
            }
          }
        },
        { threshold: [0.4] },
      );
      dwellObserver.observe(estimate);
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
    const t = window.setTimeout(onScroll, 1500);

    // Booking clicks: a click is only a click; meetings are confirmed from the scheduler.
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest<HTMLAnchorElement>("a[data-booking]");
      if (link) track(slug, "booking_clicked", { cta_location: link.dataset.ctaLocation ?? "unknown" });
    };
    document.addEventListener("click", onClick);

    return () => {
      revealObserver?.disconnect();
      sectionObserver?.disconnect();
      dwellObserver?.disconnect();
      if (dwellTimer !== null) window.clearTimeout(dwellTimer);
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(t);
      document.removeEventListener("click", onClick);
    };
  }, [slug, accountId, campaignId, isPreview]);

  return null;
}
