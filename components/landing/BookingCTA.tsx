"use client";

import { useState } from "react";
import { useCalcState } from "./CalcState";
import { roundOutputs } from "./calc";
import { track } from "./Tracker";

/**
 * Conversion block inside the closing panel (cartage-pages Conversion.astro):
 * the booking call to action and the "Send me my estimate" form.
 *
 * - With a scheduler link (Calendly), the primary button opens it in a new tab
 *   with prefill + UTM tags; the click is tracked by Tracker via data-booking.
 * - Without one, the primary button reveals the built-in request form, which
 *   records a meeting request through the engine's outcomes endpoint.
 * - The estimate form posts `estimate_submitted` to /api/track with the
 *   visitor's email and the current calculator inputs/results, then shows the
 *   Astro template's success copy.
 */
export interface BookingCTAProps {
  slug: string;
  repName: string;
  bookingHref: string | null;
  contactName?: string;
  contactEmail?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function BookingCTA({ slug, repName, bookingHref, contactName, contactEmail }: BookingCTAProps) {
  const who = repName || "us";
  return (
    <div className="cp-convert">
      <h2 className="cp-convert__title cp-reveal">Validate this estimate with {who}.</h2>
      <p className="cp-convert__lede cp-reveal">
        Bring your real numbers. We&apos;ll go through which parts of your workflow Wilson could take on first, and what that would look like in your inbox.
      </p>
      {bookingHref ? (
        <a className="cp-btn cp-btn--primary cp-reveal" href={bookingHref} target="_blank" rel="noopener noreferrer" data-booking data-cta-location="conversion">
          Validate this estimate with us <span className="cp-arrow" aria-hidden="true">→</span>
        </a>
      ) : (
        <RequestForm slug={slug} contactName={contactName} contactEmail={contactEmail} />
      )}
      <EstimateForm slug={slug} repName={repName} contactEmail={contactEmail} />
    </div>
  );
}

function RequestForm({ slug, contactName, contactEmail }: { slug: string; contactName?: string; contactEmail?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(contactName ?? "");
  const [email, setEmail] = useState(contactEmail ?? "");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  const reveal = () => {
    setOpen(true);
    track(slug, "booking_clicked", { cta_location: "conversion", source: "request-form" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "sending" || state === "done") return;
    if (!EMAIL.test(email.trim())) {
      setState("error");
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/outcomes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, outcomeType: "meeting_booked", notes: `Requested via personalized page by ${name || "visitor"} <${email}>`, source: "landing-page" }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  };

  if (!open) {
    return (
      <button type="button" className="cp-btn cp-btn--primary cp-reveal" onClick={reveal}>
        Validate this estimate with us <span className="cp-arrow" aria-hidden="true">→</span>
      </button>
    );
  }

  return (
    <div className="cp-send" data-request>
      {state !== "done" ? (
        <form className="cp-send__form" onSubmit={submit} noValidate>
          <label className="cp-send__label" htmlFor="request-email">
            Pick a time with the team
          </label>
          <p className="cp-send__hint">Leave your work email and we&apos;ll send a few 15-minute slots. No deck.</p>
          <div className="cp-send__row">
            <input className="cp-send__input" type="text" name="name" autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <input
              id="request-email"
              className="cp-send__input"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="cp-btn cp-btn--light cp-send__submit" type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Send me times"}
            </button>
          </div>
          {state === "error" && (
            <p className="cp-send__error" role="alert">
              Enter a work email address, like you@company.com, and try again.
            </p>
          )}
        </form>
      ) : (
        <div className="cp-send__success" role="status">
          <p className="cp-send__success-title">Request received.</p>
          <p className="cp-send__success-text">
            We&apos;ll send a few times to {email} shortly{name ? `, ${name.split(" ")[0]}` : ""}.
          </p>
        </div>
      )}
    </div>
  );
}

function EstimateForm({ slug, repName, contactEmail }: { slug: string; repName: string; contactEmail?: string }) {
  const { inputs, outputs } = useCalcState();
  const [email, setEmail] = useState(contactEmail ?? "");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = email.trim();
    if (!EMAIL.test(value) || value.length > 254) {
      setError("Enter a work email address, like you@company.com.");
      return;
    }
    if (honeypot.trim()) {
      // Bots fill the hidden field; pretend it worked and drop it.
      setSent(value);
      return;
    }
    setSending(true);
    try {
      track(slug, "estimate_submitted", {
        name: "",
        email: value.toLowerCase(),
        inputs,
        results: roundOutputs(outputs),
        alias: "estimate_submitted",
      });
      setSent(value);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="cp-send cp-reveal" data-estimate>
      {sent === null ? (
        <form className="cp-send__form" onSubmit={submit} noValidate>
          <label className="cp-send__label" htmlFor="estimate-email">
            Send me my estimate
          </label>
          <p className="cp-send__hint" id="estimate-hint">
            We&apos;ll email you the numbers from the calculator above. No other signup.
          </p>
          <div className="cp-send__row">
            <input
              id="estimate-email"
              className="cp-send__input"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@company.com"
              aria-describedby="estimate-hint estimate-error"
              aria-invalid={error ? true : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input className="cp-sr-only" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
            <button className="cp-btn cp-btn--light cp-send__submit" type="submit" disabled={sending}>
              {sending ? "Sending…" : "Send me my estimate"}
            </button>
          </div>
          {error && (
            <p className="cp-send__error" id="estimate-error" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <div className="cp-send__success" role="status" tabIndex={-1}>
          <p className="cp-send__success-title">Estimate saved.</p>
          <p className="cp-send__success-text">
            {repName || "Your Cartage contact"} will email your estimate to {sent} shortly.
          </p>
        </div>
      )}
    </div>
  );
}
