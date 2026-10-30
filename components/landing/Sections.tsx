import type { ReactNode } from "react";
import type { PageWorkflowCard } from "@/lib/engine/page-record";
import { WilsonGlyph } from "./VideoPlayer";

/**
 * Static sections of the prospect page, ported from cartage-pages:
 * Nav, Logo, Hero, WorkflowCards, Closing (with footer) and the GenericPage
 * shown for unknown or retired links. Server components; no client state.
 */

export const IMAGES = {
  hero: "https://framerusercontent.com/images/0bA28PV6hWj69zKoi8qfN5wMOs.png",
  closing: "https://framerusercontent.com/images/nyKl5uEDp3TrGtdF7I2WTQ0pLo.png",
} as const;

export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 121.901 26.908" width="122" height="27" role="img" aria-label="Cartage">
      <path
        fill="currentColor"
        d="M 18.351 14.542 C 17.915 16.836 16.903 18.62 15.323 19.867 C 13.735 21.123 11.776 21.751 9.447 21.751 C 6.509 21.751 4.197 20.754 2.518 18.753 C 0.839 16.753 0 14.115 0 10.833 C 0 7.552 0.872 4.898 2.609 2.939 C 4.345 0.98 6.69 0 9.653 0 C 11.891 0 13.784 0.636 15.331 1.9 C 16.878 3.165 17.858 4.94 18.277 7.217 L 15.142 7.217 C 14.821 5.827 14.171 4.739 13.192 3.943 C 12.212 3.148 10.986 2.754 9.505 2.754 C 7.703 2.754 6.221 3.466 5.061 4.881 C 3.901 6.304 3.325 8.28 3.325 10.833 C 3.325 13.387 3.901 15.354 5.045 16.811 C 6.197 18.268 7.686 18.996 9.53 18.996 C 11.027 18.996 12.27 18.603 13.257 17.824 C 14.245 17.046 14.895 15.949 15.224 14.534 L 18.36 14.534 Z M 27.511 5.425 C 25.725 5.425 24.244 5.902 23.059 6.857 C 21.874 7.811 21.215 9.1 21.084 10.725 L 24.071 10.725 C 24.128 9.762 24.441 9.017 25.009 8.506 C 25.577 7.995 26.375 7.736 27.404 7.736 C 29.601 7.736 30.704 8.958 30.704 11.411 L 30.704 11.729 C 29.626 11.847 28.671 11.964 27.856 12.089 C 27.042 12.215 26.219 12.374 25.396 12.567 C 24.573 12.759 23.873 12.993 23.305 13.261 C 22.738 13.529 22.219 13.847 21.75 14.216 C 21.281 14.584 20.935 15.011 20.713 15.505 C 20.491 15.999 20.368 16.552 20.368 17.171 C 20.368 18.561 20.878 19.674 21.907 20.503 C 22.935 21.332 24.244 21.751 25.832 21.751 C 28.301 21.751 30.004 20.939 30.959 19.314 C 31 19.967 31.082 20.654 31.214 21.374 L 33.674 21.374 C 33.683 18.151 33.691 12.098 33.691 12.022 C 33.749 7.619 31.691 5.417 27.511 5.417 Z M 30.844 15.095 C 30.844 16.56 30.449 17.657 29.65 18.368 C 28.852 19.08 27.799 19.44 26.49 19.44 C 25.601 19.44 24.894 19.231 24.367 18.82 C 23.849 18.402 23.585 17.841 23.585 17.129 C 23.585 16.167 24.153 15.463 25.297 15.011 C 26.433 14.567 28.284 14.216 30.852 13.965 L 30.852 15.095 Z M 45.303 8.9 C 44.768 8.841 44.257 8.816 43.764 8.816 C 42.587 8.816 41.715 9.151 41.147 9.829 C 40.579 10.507 40.291 11.637 40.291 13.22 L 40.291 21.382 L 37.328 21.382 L 37.328 5.793 L 40.233 5.793 L 40.233 8.548 C 41.064 6.714 42.48 5.777 44.471 5.735 C 44.85 5.735 45.13 5.743 45.294 5.768 L 45.294 8.9 Z M 47.417 1.8 L 50.38 1.8 L 50.38 5.793 L 53.4 5.793 L 53.4 8.079 L 50.38 8.079 L 50.38 16.97 C 50.38 17.782 50.487 18.318 50.709 18.578 C 50.923 18.837 51.4 18.971 52.116 18.971 L 53.367 18.971 L 53.367 21.374 L 51.203 21.374 C 49.664 21.374 48.652 21.114 48.158 20.595 C 47.664 20.076 47.417 19.005 47.417 17.38 Z M 62.502 5.425 C 60.716 5.425 59.235 5.902 58.05 6.857 C 56.865 7.811 56.206 9.1 56.075 10.725 L 59.062 10.725 C 59.12 9.762 59.432 9.017 60 8.506 C 60.568 7.995 61.366 7.736 62.395 7.736 C 64.592 7.736 65.695 8.958 65.695 11.411 L 65.695 11.729 C 64.617 11.847 63.662 11.964 62.847 12.089 C 62.033 12.215 61.21 12.374 60.387 12.567 C 59.564 12.759 58.864 12.993 58.297 13.261 C 57.729 13.529 57.21 13.847 56.741 14.216 C 56.272 14.584 55.927 15.011 55.704 15.505 C 55.482 15.999 55.359 16.552 55.359 17.171 C 55.359 18.561 55.869 19.674 56.898 20.503 C 57.926 21.332 59.235 21.751 60.823 21.751 C 63.292 21.751 64.995 20.939 65.95 19.314 C 65.991 19.967 66.073 20.654 66.205 21.374 L 68.666 21.374 C 68.682 18.427 68.682 12.098 68.682 12.022 C 68.74 7.619 66.682 5.417 62.502 5.417 Z M 65.835 15.095 C 65.835 16.56 65.44 17.657 64.641 18.368 C 63.843 19.08 62.79 19.44 61.481 19.44 C 60.593 19.44 59.885 19.231 59.358 18.82 C 58.84 18.402 58.576 17.841 58.576 17.129 C 58.576 16.167 59.144 15.463 60.288 15.011 C 61.424 14.567 63.275 14.216 65.843 13.965 L 65.843 15.095 Z M 82.516 5.793 L 85.478 5.793 L 85.478 19.549 C 85.478 22.077 84.927 23.902 83.824 25.024 C 82.647 26.28 80.862 26.908 78.475 26.908 C 76.714 26.908 75.257 26.506 74.122 25.702 C 72.986 24.899 72.303 23.71 72.073 22.127 L 75.117 22.127 C 75.29 22.881 75.636 23.442 76.154 23.819 C 76.673 24.195 77.471 24.38 78.533 24.38 C 79.94 24.38 80.96 24.003 81.61 23.249 C 82.219 22.571 82.524 21.55 82.524 20.177 L 82.524 18.527 C 81.52 20.244 79.94 21.106 77.8 21.106 C 75.957 21.106 74.41 20.403 73.159 18.988 C 71.908 17.581 71.283 15.681 71.283 13.287 C 71.283 10.892 71.908 9 73.159 7.593 C 74.41 6.195 75.957 5.492 77.8 5.492 C 79.948 5.492 81.52 6.354 82.524 8.071 L 82.524 5.785 Z M 78.467 7.995 C 77.232 7.995 76.253 8.464 75.521 9.402 C 74.788 10.34 74.426 11.637 74.426 13.295 C 74.426 14.953 74.788 16.292 75.521 17.238 C 76.253 18.184 77.232 18.653 78.467 18.653 C 79.701 18.653 80.68 18.201 81.454 17.305 C 82.236 16.409 82.623 15.07 82.623 13.295 C 82.623 11.52 82.236 10.214 81.454 9.327 C 80.672 8.439 79.676 7.995 78.467 7.995 Z M 101.361 8.079 C 100.052 6.371 98.234 5.517 95.921 5.517 C 93.609 5.517 91.914 6.254 90.498 7.744 C 89.083 9.226 88.375 11.21 88.375 13.563 C 88.375 15.915 89.05 17.866 90.399 19.423 C 91.741 20.972 93.609 21.751 96.004 21.751 C 97.847 21.751 99.361 21.282 100.546 20.336 C 101.731 19.39 102.513 18.209 102.891 16.803 L 99.912 16.803 C 99.246 18.385 97.904 19.18 95.897 19.18 C 94.703 19.18 93.691 18.762 92.868 17.925 C 92.037 17.087 91.56 15.957 91.428 14.526 L 103.097 14.526 C 103.245 11.939 102.669 9.787 101.361 8.079 Z M 91.486 12.14 C 91.864 9.36 93.337 7.97 95.897 7.97 C 97.09 7.97 98.069 8.364 98.826 9.159 C 99.583 9.946 99.978 10.942 100.019 12.14 Z M 114.814 15.011 C 112.355 15.011 109.973 14.538 107.728 13.609 L 108.236 12.43 C 110.318 13.295 112.532 13.732 114.814 13.732 C 117.095 13.732 119.309 13.295 121.391 12.43 L 121.899 13.609 C 119.655 14.538 117.272 15.011 114.814 15.011 Z M 115.412 1.8 L 116.76 1.8 L 113.915 10.396 L 112.567 10.396 Z M 120.821 1.8 L 119.517 1.8 L 119.517 6.419 L 120.821 6.419 Z M 110.115 1.8 L 108.81 1.8 L 108.81 6.419 L 110.115 6.419 Z"
      />
    </svg>
  );
}

export interface NavCta {
  href: string;
  label: string;
  booking?: boolean;
}

export function Nav({ links = [], cta = null }: { links?: { href: string; label: string }[]; cta?: NavCta | null }) {
  return (
    <header className="cp-nav">
      <div className="cp-container cp-nav__inner">
        <a className="cp-nav__logo" href="https://www.cartage.ai/" aria-label="Cartage home">
          <Logo />
        </a>
        {links.length > 0 && (
          <nav className="cp-nav__links" aria-label="On this page">
            {links.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
        )}
        {cta && (
          <a
            className="cp-btn cp-btn--light cp-btn--compact cp-nav__cta"
            href={cta.href}
            {...(cta.booking ? { target: "_blank", rel: "noopener noreferrer", "data-booking": "", "data-cta-location": "nav" } : {})}
          >
            {cta.label}
          </a>
        )}
      </div>
    </header>
  );
}

export function Hero({
  eyebrow,
  headline,
  lede,
  primary,
  secondary = null,
}: {
  eyebrow: string;
  headline: string;
  lede: string;
  primary: { href: string; label: string };
  secondary?: NavCta | null;
}) {
  return (
    <section className="cp-hero" data-section="hero">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="cp-hero__bg" src={IMAGES.hero} alt="" loading="eager" fetchPriority="high" />
      <div className="cp-hero__shade" aria-hidden="true" />
      <div className="cp-container cp-hero__content">
        <p className="cp-hero__eyebrow">{eyebrow}</p>
        <h1 className="cp-hero__title">{headline}</h1>
        <p className="cp-hero__lede">{lede}</p>
        <div className="cp-hero__ctas">
          <a className="cp-btn cp-btn--light" href={primary.href}>
            {primary.label}
          </a>
          {secondary && (
            <a
              className="cp-btn cp-btn--outline-dark"
              href={secondary.href}
              {...(secondary.booking ? { target: "_blank", rel: "noopener noreferrer", "data-booking": "", "data-cta-location": "hero" } : {})}
            >
              {secondary.label} <span className="cp-arrow" aria-hidden="true">→</span>
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

export function WorkflowCards({ company, cards }: { company: string; cards: PageWorkflowCard[] }) {
  const shown = cards.slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <section className="cp-section" id="workflow" aria-labelledby="why-title" data-section="workflow">
      <div className="cp-container">
        <span className="cp-mark cp-reveal" aria-hidden="true">
          <WilsonGlyph size={34} />
        </span>
        <h2 className="cp-statement cp-reveal" id="why-title">
          Why this could matter for your team.{" "}
          <span className="cp-muted">
            {shown.length === 1 ? "One place" : shown.length === 2 ? "Two places" : "Three places"} Wilson could take work off {company}&apos;s plate, starting with the busiest part of the day.
          </span>
        </h2>
        <hr className="cp-rule cp-why__rule" />
        <ol className={`cp-why__cards cp-why__cards--${shown.length}`}>
          {shown.map((c, i) => (
            <li className="cp-card cp-reveal" style={{ transitionDelay: `${i * 80}ms` }} key={i}>
              <p className="cp-card__index">0{i + 1}</p>
              <h3 className="cp-card__today">{c.work_today}</h3>
              <dl className="cp-card__rows">
                <div>
                  <dt className="cp-label">What Cartage could handle</dt>
                  <dd>{c.cartage_handles}</dd>
                </div>
                <div>
                  <dt className="cp-label">Why it helps</dt>
                  <dd>{c.why_it_helps}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Closing({ id, preparedFor, children }: { id?: string; preparedFor?: string; children: ReactNode }) {
  const year = new Date().getFullYear();
  return (
    <section className="cp-closing" id={id} data-section="talk">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="cp-closing__bg" src={IMAGES.closing} alt="" loading="lazy" />
      <div className="cp-closing__shade" aria-hidden="true" />
      <div className="cp-container cp-closing__cta">{children}</div>
      <footer className="cp-container cp-footer">
        <div className="cp-footer__brand">
          <WilsonGlyph size={36} />
          <p>
            You&apos;ve got the vision.
            <br />
            Wilson handles the freight.
          </p>
        </div>
        <nav className="cp-footer__links" aria-label="Cartage">
          <div>
            <p className="cp-footer__head">Cartage</p>
            <a href="https://www.cartage.ai/">Meet Wilson</a>
            <a href="https://www.cartage.ai/about">About</a>
          </div>
          <div>
            <p className="cp-footer__head">Resources</p>
            <a href="https://www.cartage.ai/cases">Case studies</a>
            <a href="https://www.cartage.ai/blog">Newsroom</a>
          </div>
          <div>
            <p className="cp-footer__head">Legal</p>
            <a href="https://www.cartage.ai/policies/privacy">Privacy Policy</a>
            <a href="https://www.cartage.ai/policies/terms-and-conditions">Terms of Usage</a>
          </div>
        </nav>
        <p className="cp-footer__meta">
          <span>Copyright © Cartage. {year}</span>
          {preparedFor && <span>Prepared for {preparedFor}</span>}
        </p>
      </footer>
    </section>
  );
}

const DEMO = "https://www.cartage.ai/contact";
const CAPABILITIES = [
  { title: "Works where you work", body: "Email, Slack, Teams, spreadsheets and your ERP. No new software for your team to learn." },
  { title: "Watches every shipment", body: "Quotes, bookings, tracking updates and carrier follow-ups, handled before anyone has to ask." },
  { title: "Backed by humans", body: "If something goes wrong, the Cartage team steps in. Software speed with service reliability." },
];

/** The fallback for unknown, draft-less or retired links. Takes no account data, so it cannot leak another prospect's page. */
export function GenericPage() {
  return (
    <>
      <Nav cta={{ href: DEMO, label: "Book a Demo" }} />
      <main>
        <Hero
          eyebrow="Cartage"
          headline="Your AI logistics coordinator, backed by humans."
          lede="Wilson handles quoting, booking, tracking and carrier follow-ups for manufacturers and distributors, working from an inbox like the rest of your team."
          primary={{ href: DEMO, label: "Book a demo" }}
          secondary={{ href: "https://www.cartage.ai/", label: "Meet Wilson" }}
        />
        <section className="cp-section">
          <div className="cp-container">
            <span className="cp-mark cp-reveal" aria-hidden="true">
              <WilsonGlyph size={34} />
            </span>
            <h2 className="cp-statement cp-reveal">
              Give me an email and a playbook. <span className="cp-muted">I&apos;ll handle the quoting, booking, tracking and follow-ups that eat your team&apos;s day.</span>
            </h2>
            <hr className="cp-rule cp-why__rule" />
            <ul className="cp-caps">
              {CAPABILITIES.map((c) => (
                <li className="cp-reveal" key={c.title}>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <Closing>
          <div className="cp-end">
            <h2 className="cp-end__title cp-reveal">See what Wilson could take off your plate.</h2>
            <p className="cp-end__lede cp-reveal">Someone from Cartage sent you a link that didn&apos;t open? Reply to their email and they&apos;ll send a fresh one.</p>
            <a className="cp-btn cp-btn--primary cp-reveal" href={DEMO}>
              Book a demo <span className="cp-arrow" aria-hidden="true">→</span>
            </a>
          </div>
        </Closing>
      </main>
    </>
  );
}
