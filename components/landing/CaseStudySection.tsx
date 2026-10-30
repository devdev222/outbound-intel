"use client";

import { useRef } from "react";
import type { Testimonial } from "@/lib/content/case-studies";
import { track } from "./Tracker";

/**
 * Customer proof (cartage-pages Proof.astro). Renders nothing when no
 * testimonial is eligible, exactly like the Astro template. Clicking through
 * to a story fires case_study_viewed { caseStudyId, title } once per story.
 */
export default function CaseStudySection({ slug, testimonials }: { slug: string; testimonials: Testimonial[] }) {
  const firedRef = useRef<Set<string>>(new Set());
  const count = testimonials.length;
  if (count === 0) return null;

  const onStory = (t: Testimonial) => {
    if (firedRef.current.has(t.testimonial_id)) return;
    firedRef.current.add(t.testimonial_id);
    track(slug, "case_study_viewed", { caseStudyId: t.testimonial_id, title: t.customer, source_url: t.source_url });
  };

  return (
    <section className="cp-proof cp-section" id="proof" aria-labelledby="proof-title" data-section="proof">
      <div className="cp-container">
        <p className="cp-label cp-reveal">Customer proof</p>
        <h2 className="cp-statement cp-proof__title cp-reveal" id="proof-title">
          {count === 1 ? "A team that already runs freight with Wilson." : "Teams that already run freight with Wilson."}{" "}
          <span className="cp-muted">In their words, with the full story one click away.</span>
        </h2>
        <div className={`cp-proof__list cp-proof__list--${count}`}>
          {testimonials.map((t) => (
            <figure className="cp-story cp-reveal" key={t.testimonial_id}>
              <div className="cp-story__media">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.screenshot} alt={t.screenshot_alt} loading="lazy" width={1080} height={900} />
              </div>
              <div className="cp-story__body">
                <p className="cp-story__customer">{t.customer}</p>
                <blockquote className="cp-story__quote">
                  <p>“{t.quote}”</p>
                </blockquote>
                <figcaption className="cp-story__by">{t.attribution}</figcaption>
                <a className="cp-btn cp-btn--outline cp-btn--compact cp-story__link" href={t.source_url} target="_blank" rel="noopener noreferrer" onClick={() => onStory(t)}>
                  Read the customer story <span className="cp-arrow" aria-hidden="true">→</span>
                  <span className="cp-sr-only">: {t.customer} (opens cartage.ai)</span>
                </a>
              </div>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
