import type { ProofMatch } from "@/lib/engine/proof";

/**
 * One customer proof story, chosen by rankProof. Shows verified outcomes only.
 * A placeholder story (demo mode) is labelled as illustrative and never shown
 * as a customer result. Renders nothing when there is no eligible story.
 */
export default function ProofStorySection({ match }: { match: ProofMatch | null }) {
  if (!match) return null;
  const { story, reasons } = match;
  const verified = story.outcomes.filter((o) => o.verified);
  const placeholder = story.placeholder || !story.approved;
  const shown = placeholder ? story.outcomes : verified;
  if (!placeholder && shown.length === 0 && !story.quote) return null;

  return (
    <section className="cp-proof cp-section" id="proof" aria-labelledby="proof-title" data-section="proof">
      <div className="cp-container">
        <p className="cp-label cp-reveal">{placeholder ? "Illustrative example" : "Customer proof"}</p>
        <h2 className="cp-statement cp-proof__title cp-reveal" id="proof-title">
          {placeholder ? "What a comparable team could look like." : "A team that already runs freight with Wilson."}{" "}
          <span className="cp-muted">{reasons.length ? `Chosen because: ${reasons.join(", ")}.` : ""}</span>
        </h2>
        <figure className="cp-story cp-story--single cp-reveal">
          <div className="cp-story__body">
            <p className="cp-story__customer">
              {story.customer}
              <span className="cp-story__meta">
                {" "}
                · {story.industry} · {story.sizeBand} employees
              </span>
            </p>
            {shown.length > 0 && (
              <dl className="cp-story__outcomes">
                {shown.slice(0, 3).map((o) => (
                  <div key={o.metric}>
                    <dt>{o.metric}</dt>
                    <dd>
                      {o.value}
                      {!o.verified && <span className="cp-story__flag">{placeholder ? "illustrative" : "unverified"}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {story.quote && (
              <blockquote className="cp-story__quote">
                <p>“{story.quote}”</p>
              </blockquote>
            )}
            {story.quoteBy && <figcaption className="cp-story__by">{story.quoteBy}</figcaption>}
            {placeholder && (
              <p className="cp-story__disclaimer">
                Illustrative placeholder shown in the demo environment. Not a verified customer result; approved customer stories replace this before anything goes to a prospect.
              </p>
            )}
          </div>
        </figure>
      </div>
    </section>
  );
}
