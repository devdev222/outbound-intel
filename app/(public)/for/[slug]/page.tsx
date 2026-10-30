import type { Metadata } from "next";
import BookingCTA from "@/components/landing/BookingCTA";
import { CalcStateProvider } from "@/components/landing/CalcState";
import ProofStorySection from "@/components/landing/ProofStorySection";
import ROICalculator from "@/components/landing/ROICalculator";
import { Closing, GenericPage, Hero, Nav, WorkflowCards } from "@/components/landing/Sections";
import Tracker from "@/components/landing/Tracker";
import VideoPlayer from "@/components/landing/VideoPlayer";
import { config } from "@/lib/config";
import { bookingHrefFor, pageRecordFor, type PageRecord } from "@/lib/engine/page-record";
import { rankProof } from "@/lib/engine/proof";
import { getStore } from "@/lib/store";
import { proofStories } from "@/lib/store/collections";
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

/**
 * The personalized page, kept to five things: the value proposition, three
 * operational opportunities, the savings calculator, one proof story, one ask.
 */
export default async function PersonalizedPage({ params }: Params) {
  const { slug } = await params;
  const account = await resolveAccount(slug);
  if (!account) return <GenericPage />;

  const record: PageRecord = await pageRecordFor(account);
  const isPreview = record.status !== "published";
  const proof = rankProof(account, await proofStories.list(), { allowPlaceholders: config.demoBanner })[0] ?? null;

  const schedulerHref = config.calendly.url ? withPrefill(bookingHrefFor(config.calendly.url, record.campaign_id, record.account_id), account) : null;
  const talkHref = schedulerHref ?? "#talk";
  const bookingCta = { href: talkHref, label: record.rep_name ? `Talk to ${record.rep_name}` : "Book a call", booking: Boolean(schedulerHref) };
  const token = pageTokenFor(account.id);
  const firstName = account.contact?.name.split(" ")[0] ?? "there";
  const campaign = account.campaign;

  return (
    <>
      <Tracker slug={account.slug} accountId={record.account_id} campaignId={record.campaign_id} isPreview={isPreview} />

      {config.demoBanner && (
        <a className={`cp-flag${isPreview ? "" : " cp-flag--muted"}`} href="/" role="note" title="Demo environment: company data on this page is synthetic">
          {isPreview ? "Preview. This is how the page will look once published." : "Demo · synthetic data"}
        </a>
      )}

      <Nav links={[{ href: "#estimate", label: "Your estimate" }]} cta={bookingCta} />
      <main>
        {/* 1. Personalized value proposition */}
        <Hero eyebrow={`Prepared for ${record.company_name}`} headline={record.headline} lede={record.value_proposition} primary={bookingCta} secondary={{ href: "#estimate", label: "See your potential savings" }} />

        {/* Compact rep note: the video carries the script as captions, so it is not repeated as text. */}
        <section className="cp-opening cp-section" id="video" aria-label="A short note from your Cartage team" data-section="opening">
          <div className="cp-container cp-opening__grid cp-opening__grid--note">
            <div className="cp-reveal cp-opening__video">
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

        {/* 2. Three operational opportunities */}
        <WorkflowCards company={record.company_name} cards={record.workflow_cards.slice(0, 3)} />

        <CalcStateProvider defaults={record.calculator_defaults}>
          {/* 3. Interactive savings calculator */}
          <section className="cp-calc cp-section" id="estimate" aria-labelledby="calc-title" data-section="estimate">
            <div className="cp-container">
              <p className="cp-label cp-reveal">Your estimate</p>
              <h2 className="cp-statement cp-calc__title cp-reveal" id="calc-title">
                What could your team get back? <span className="cp-muted">Illustrative assumptions. Adjust to your operation.</span>
              </h2>
              <ROICalculator slug={account.slug} workflowTags={record.workflow_tags} />
              <p className="cp-calc__disclaimer">
                Directional estimate based on your inputs. Recovered capacity is not guaranteed cash savings. Subscription and implementation costs are excluded.{" "}
                <a className="cp-quiet-link" href={`/assess/${account.slug}-${token}`}>
                  Take the 3-minute freight operations assessment
                </a>
              </p>
            </div>
          </section>

          {/* 4. One proof story */}
          <ProofStorySection match={proof} />

          {/* 5. One ask */}
          <Closing id="talk" preparedFor={record.company_name}>
            <BookingCTA slug={account.slug} token={token} repName={record.rep_name} bookingHref={schedulerHref} contactName={account.contact?.name} contactEmail={account.contact?.email} />
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
