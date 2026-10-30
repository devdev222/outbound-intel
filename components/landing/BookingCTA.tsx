"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "./Tracker";

const CALENDLY_WIDGET_SRC = "https://assets.calendly.com/assets/external/widget.js";

interface BookingCTAProps {
  slug: string;
  contactName?: string;
  contactEmail?: string;
  calendlyUrl?: string;
}

async function postOutcome(slug: string, notes: string, source: string): Promise<boolean> {
  try {
    const res = await fetch("/api/outcomes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, outcomeType: "meeting_booked", notes, source }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Booking call to action. With NEXT_PUBLIC_CALENDLY_URL set, renders Calendly's
 * inline embed (per https://developer.calendly.com/api-docs/overview/embedding/getting-started)
 * with prefill + UTM query params and listens for the parent-window events
 * `calendly.date_and_time_selected` and `calendly.event_scheduled`. Without it,
 * a lightweight in-page request form records the booking.
 */
export default function BookingCTA({ slug, contactName, contactEmail, calendlyUrl }: BookingCTAProps) {
  if (calendlyUrl) {
    return <CalendlyEmbed slug={slug} url={calendlyUrl} contactName={contactName} contactEmail={contactEmail} />;
  }
  return <InlineRequest slug={slug} contactName={contactName} contactEmail={contactEmail} />;
}

function buildCalendlyUrl(base: string, slug: string, name?: string, email?: string): string {
  const url = new URL(base);
  url.searchParams.set("hide_event_type_details", "1");
  url.searchParams.set("hide_gdpr_banner", "1");
  if (name) url.searchParams.set("name", name);
  if (email) url.searchParams.set("email", email);
  url.searchParams.set("utm_source", "outbound-intel");
  url.searchParams.set("utm_medium", "personalized-page");
  url.searchParams.set("utm_campaign", slug);
  return url.toString();
}

function CalendlyEmbed({ slug, url, contactName, contactEmail }: { slug: string; url: string; contactName?: string; contactEmail?: string }) {
  const dataUrl = buildCalendlyUrl(url, slug, contactName, contactEmail);
  const bookedRef = useRef(false);
  const clickedRef = useRef(false);
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    if (!document.querySelector(`script[src="${CALENDLY_WIDGET_SRC}"]`)) {
      const s = document.createElement("script");
      s.src = CALENDLY_WIDGET_SRC;
      s.async = true;
      document.body.appendChild(s);
    }
    const onMessage = (e: MessageEvent) => {
      const ev = (e.data as { event?: string } | undefined)?.event;
      if (!ev || typeof ev !== "string" || !ev.startsWith("calendly.")) return;
      if (ev === "calendly.date_and_time_selected" && !clickedRef.current) {
        clickedRef.current = true;
        track(slug, "booking_clicked", { source: "calendly" });
      }
      if (ev === "calendly.event_scheduled" && !bookedRef.current) {
        bookedRef.current = true;
        setBooked(true);
        void postOutcome(slug, "Calendly embed", "calendly-embed");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [slug]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      {booked && <div className="m-4 rounded-lg bg-green-50 p-4 text-sm text-green-800">Booked. A calendar invite is on its way.</div>}
      <div className="calendly-inline-widget" data-url={dataUrl} style={{ minWidth: 320, height: 630 }} />
    </div>
  );
}

function InlineRequest({ slug, contactName, contactEmail }: { slug: string; contactName?: string; contactEmail?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(contactName ?? "");
  const [email, setEmail] = useState(contactEmail ?? "");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const clickedRef = useRef(false);

  const reveal = () => {
    setOpen(true);
    if (!clickedRef.current) {
      clickedRef.current = true;
      track(slug, "booking_clicked", { source: "inline" });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "sending" || state === "done") return;
    setState("sending");
    const ok = await postOutcome(slug, "Requested via personalized page", "landing-page");
    setState(ok ? "done" : "error");
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-slate-900">Walk through your numbers in 15 minutes</h3>
          <p className="mt-1 text-sm text-slate-600">No deck. We look at your lanes, your volume and whether this is worth a pilot.</p>
        </div>
        {!open && (
          <button type="button" onClick={reveal} className="inline-flex items-center justify-center rounded-lg bg-orange-500 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-orange-600">
            Book 15 minutes
          </button>
        )}
      </div>

      {open && state !== "done" && (
        <form onSubmit={submit} className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          />
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Work email"
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          />
          <button type="submit" disabled={state === "sending"} className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60">
            {state === "sending" ? "Sending…" : "Pick a time"}
          </button>
          {state === "error" && <div className="text-sm text-red-600 sm:col-span-3">Something went wrong. Please try again.</div>}
        </form>
      )}

      {state === "done" && (
        <div className="mt-6 rounded-lg bg-green-50 p-4 text-sm text-green-800">
          Thanks{name ? `, ${name.split(" ")[0]}` : ""}. We&apos;ll send a few times to {email || "your inbox"} shortly.
        </div>
      )}
    </div>
  );
}
