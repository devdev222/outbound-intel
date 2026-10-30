import type { Metadata } from "next";
import BookingCTA from "@/components/landing/BookingCTA";
import { CalcStateProvider } from "@/components/landing/CalcState";
import CaseStudySection from "@/components/landing/CaseStudySection";
import ROICalculator from "@/components/landing/ROICalculator";
import { Closing, GenericPage, Hero, Nav, WorkflowCards } from "@/components/landing/Sections";
import Tracker from "@/components/landing/Tracker";
import VideoPlayer, { WilsonGlyph } from "@/components/landing/VideoPlayer";
import { config } from "@/lib/config";
import { selectTestimonials } from "@/lib/content/case-studies";
import { bookingHrefFor, pageRecordFor, type PageRecord } from "@/lib/engine/page-record";
import { getStore } from "@/lib/store";
import type { Account } from "@/lib/types";
import { pageTokenFor, parsePageParam } from "@/lib/util";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * Resolves /for/{slug} or /for/{slug}-{token}. A token must match the account's
 * derived token; a mismatch, an unknown slug or a retired account all resolve
 * to null, which renders the generic Cartage page with no account data.
 */
async function resolveAccount(param: string): Promise<Account | null> {
  const store = getStore();
  const { slug, token } = parsePageParam(param);
  let account = await store.getAccountBySlug(slug);
  // A slug that happens to end in 8 alphanumerics would be split; fall back to the raw param.
  if (!account && token) account = await store.getAccountBySlug(param);
  if (!account) return null;
  if (token && account.slug === slug && token !== pageTokenFor(account.id)) return null;
  if (account.status === "disqualified" || account.status === "lost") return null;
  return account;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const account = await resolveAccount(slug);
  const title = account ? `Wilson for ${account.companyName} · ${config.brandName}` : `Wilson · ${config.brandName}`;
  const canonical = account ? `${config.appUrl}/for/${account.slug}-${pageTokenFor(account.id)}` : undefined;
  return {
    title,
    description: account ? `Prepared for ${account.companyName} by ${config.brandName}.` : "Wilson is Cartage's AI logistics coordinator for manufacturers and distributors.",
    robots: { index: false, follow: false, noarchive: true },
    referrer: "strict-origin",
    alternates: canonical ? { canonical } : undefined,
    other: { "theme-color": "#25211C" },
  };
}

export default async function PersonalizedPage({ params }: Params) {
  const { slug } = await params;
  const account = await resolveAccount(slug);
  if (!account) return <GenericPage />;

  const record: PageRecord = await pageRecordFor(account);
  const isPreview = record.status !== "published";
  const testimonials = selectTestimonials({ industry: record.industry, testimonial_ids: record.testimonial_ids, workflow_tags: record.workflow_tags }, { allowUnapproved: config.demoBanner });

  // Booking: a real scheduler link opens in a new tab (tracked by data-booking); otherwise CTAs lead to the request form in the closing panel.
  const schedulerHref = config.calendly.url ? withPrefill(bookingHrefFor(config.calendly.url, record.campaign_id, record.account_id), account) : null;
  const talkHref = schedulerHref ?? "#talk";
  const bookingCta = { href: talkHref, label: record.rep_name ? `Talk to ${record.rep_name}` : "Book a call", booking: Boolean(schedulerHref) };

  const links = [
    record.workflow_cards.length > 0 && { href: "#workflow", label: "Your workflow" },
    testimonials.length > 0 && { href: "#proof", label: "Customer proof" },
    { href: "#estimate", label: "Your estimate" },
  ].filter(Boolean) as { href: string; label: string }[];

  const firstName = account.contact?.name.split(" ")[0] ?? "there";
  const campaign = account.campaign;
  const repLabel = record.rep_name || "your Cartage team";

  return (
    <>
      <Tracker slug={account.slug} accountId={record.account_id} campaignId={record.campaign_id} isPreview={isPreview} />

      {config.demoBanner && (
        <a className={`cp-flag${isPreview ? "" : " cp-flag--muted"}`} href="/" role="note" title="Demo environment: company data on this page is synthetic">
          {isPreview ? "Preview. This is how the page will look once published." : "Demo · synthetic data"}
        </a>
      )}

      <Nav links={links} cta={bookingCta} />
      <main>
        <Hero
          eyebrow={`Prepared for ${record.company_name}`}
          headline={record.headline}
          lede={record.value_proposition}
          primary={{ href: "#estimate", label: "See your potential savings" }}
          secondary={{ href: talkHref, label: "Talk through your workflow", booking: Boolean(schedulerHref) }}
        />

        {/* Opening: rep note + video */}
        <section className="cp-opening cp-section" id="video" aria-label={`A note from ${repLabel}`} data-section="opening">
          <div className="cp-container cp-opening__grid cp-opening__grid--both">
            <figure className="cp-note cp-reveal">
              <span className="cp-note__magnet" aria-hidden="true">
                <WilsonGlyph size={30} />
              </span>
              <p className="cp-note__label">A note from {repLabel}</p>
              <blockquote className="cp-note__body">{record.rep_message}</blockquote>
              {record.rep_name && <figcaption className="cp-note__sign">{record.rep_name}, Cartage</figcaption>}
            </figure>
            <div className="cp-reveal">
              <VideoPlayer
                slug={account.slug}
                script={record.rep_message}
                videoUrl={campaign?.videoUrl}
                status={campaign?.videoStatus ?? "pending"}
                thumbnailUrl={campaign?.videoThumbnailUrl}
                contactFirstName={firstName}
                companyName={account.companyName}
                repName={record.rep_name}
              />
            </div>
          </div>
        </section>

        <WorkflowCards company={record.company_name} cards={record.workflow_cards} />

        <CaseStudySection slug={account.slug} testimonials={testimonials} />

        <CalcStateProvider defaults={record.calculator_defaults}>
          <section className="cp-calc cp-section" id="estimate" aria-labelledby="calc-title" data-section="estimate">
            <div className="cp-container">
              <p className="cp-label cp-reveal">Your estimate</p>
              <h2 className="cp-statement cp-calc__title cp-reveal" id="calc-title">
                What could your team get back? <span className="cp-muted">Illustrative assumptions. Adjust to your operation.</span>
              </h2>
              <ROICalculator slug={account.slug} workflowTags={record.workflow_tags} />
              <p className="cp-calc__disclaimer">
                Directional estimate based on your inputs. Recovered capacity is not guaranteed cash savings. Subscription and implementation costs are excluded.
              </p>
            </div>
          </section>

          <Closing id="talk" preparedFor={record.company_name}>
            <BookingCTA slug={account.slug} repName={record.rep_name} bookingHref={schedulerHref} contactName={account.contact?.name} contactEmail={account.contact?.email} />
          </Closing>
        </CalcStateProvider>
      </main>
    </>
  );
}

/** Calendly prefill (name/email) on top of the UTM-tagged scheduler link. */
function withPrefill(href: string, account: Account): string {
  try {
    const url = new URL(href);
    if (account.contact?.name) url.searchParams.set("name", account.contact.name);
    if (account.contact?.email) url.searchParams.set("email", account.contact.email);
    url.searchParams.set("hide_event_type_details", "1");
    url.searchParams.set("hide_gdpr_banner", "1");
    return url.toString();
  } catch {
    return href;
  }
}
