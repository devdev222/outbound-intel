import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BookingCTA from "@/components/landing/BookingCTA";
import CaseStudySection from "@/components/landing/CaseStudySection";
import ROICalculator from "@/components/landing/ROICalculator";
import Tracker from "@/components/landing/Tracker";
import VideoPlayer from "@/components/landing/VideoPlayer";
import { getOrBootstrapModel } from "@/lib/agents/runtime";
import { config } from "@/lib/config";
import { caseStudyById, caseStudyFor } from "@/lib/content/case-studies";
import { assignArms, angleFor, roiDefaultsFor, templateCopy } from "@/lib/engine/campaign";
import { getStore } from "@/lib/store";
import type { Account, Campaign, Signal } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const account = await getStore().getAccountBySlug(slug);
  if (!account) return { title: "Not found" };
  const title = account.campaign?.headline ?? `${config.brandName} for ${account.companyName}`;
  return {
    title: `${title} | ${config.brandName}`,
    description: account.campaign?.subheadline ?? `A page prepared for ${account.companyName}.`,
    robots: { index: false, follow: false },
  };
}

/** Build a campaign-shaped object for accounts that have not launched yet, so the page can preview. */
async function previewCampaign(account: Account): Promise<Campaign> {
  const model = await getOrBootstrapModel(getStore());
  const arms = assignArms(account.id);
  const copy = templateCopy(account, model, arms);
  return {
    headline: copy.headline,
    subheadline: copy.subheadline,
    angle: account.messagingAngle ?? angleFor(account, model, arms.angleVariant),
    persona: account.recommendedPersona ?? account.contact?.title ?? "VP of Transportation",
    videoScript: copy.videoScript,
    videoStatus: "ready",
    roiDefaults: roiDefaultsFor(account),
    caseStudyId: caseStudyFor(account.industry).id,
    pageUrl: `${config.appUrl}/for/${account.slug}`,
    arms,
    launchedAt: new Date().toISOString(),
  };
}

function topVerified(account: Account): Signal | null {
  const nonIntent = account.signals.filter((s) => s.type !== "intent");
  return nonIntent.find((s) => s.status === "verified") ?? nonIntent[0] ?? null;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export default async function PersonalizedPage({ params }: Params) {
  const { slug } = await params;
  const account = await getStore().getAccountBySlug(slug);
  if (!account) notFound();

  const isPreview = !account.campaign;
  const campaign = account.campaign ?? (await previewCampaign(account));
  const study = caseStudyById(campaign.caseStudyId);
  const verified = account.signals.filter((s) => s.type !== "intent" && s.status === "verified");
  const hypotheses = account.signals.filter((s) => s.type !== "intent" && s.status === "hypothesis");
  const lead = topVerified(account);
  const firstName = account.contact?.name.split(" ")[0] ?? "there";
  const brand = config.brandName;

  return (
    <>
      <Tracker slug={account.slug} />

      {config.demoBanner && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
          Demo environment. Company data on this page is synthetic.
          {isPreview && <span className="ml-2 rounded bg-amber-200/70 px-1.5 py-0.5 font-medium">Preview: campaign not launched yet</span>}
        </div>
      )}

      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-[1040px] items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900">
            <span className="inline-block h-6 w-6 rounded-md bg-orange-500" aria-hidden="true" />
            {brand}
          </div>
          <div className="text-sm text-slate-500">
            Prepared for <span className="font-medium text-slate-800">{account.companyName}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1040px] px-4 pb-20 sm:px-6">
        {/* Hero */}
        <section className="py-12 sm:py-16" data-section="hero">
          <div className="max-w-3xl">
            <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl">{campaign.headline}</h1>
            <p className="mt-5 text-pretty text-lg leading-8 text-slate-600 sm:text-xl">{campaign.subheadline}</p>
            {lead && (
              <p className="mt-6 inline-flex max-w-full items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
                <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-orange-500" aria-hidden="true" />
                <span>
                  <span className="font-semibold">Why you&apos;re seeing this:</span> {lead.label.toLowerCase()}
                  {lead.status === "hypothesis" ? " (our best guess)" : ""}.
                </span>
              </p>
            )}
          </div>
        </section>

        {/* Video */}
        <section id="video" className="scroll-mt-6" data-section="video">
          <SectionHeading kicker="20 seconds" title={`A short note for ${firstName}`} />
          <VideoPlayer
            slug={account.slug}
            script={campaign.videoScript}
            videoUrl={campaign.videoUrl}
            status={campaign.videoStatus}
            thumbnailUrl={campaign.videoThumbnailUrl}
            contactFirstName={firstName}
            companyName={account.companyName}
          />
        </section>

        {/* Why now */}
        <section id="why-now" className="mt-16 scroll-mt-6" data-section="why-now">
          <SectionHeading kicker="Why now" title="What we noticed" />
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">What we found</h3>
              {verified.length ? (
                <ul className="mt-4 space-y-4">
                  {verified.map((s) => (
                    <li key={s.key} className="flex gap-3">
                      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                      <div>
                        <div className="font-medium text-slate-900">
                          {s.label}
                          {s.value ? <span className="ml-1 text-slate-500">({s.value})</span> : null}
                        </div>
                        {s.evidence[0] && (
                          <div className="mt-0.5 text-sm text-slate-500">
                            {s.evidence[0].url ? (
                              <a href={s.evidence[0].url} target="_blank" rel="noreferrer" className="underline decoration-slate-300 underline-offset-2 hover:text-slate-800">
                                {s.evidence[0].title}
                              </a>
                            ) : (
                              s.evidence[0].title
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-slate-600">Nothing public yet beyond your industry and size. Tell us what is going on.</p>
              )}
            </div>

            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">What we&apos;re guessing</h3>
              <p className="mt-1 text-xs text-slate-500">Tell us if we&apos;re wrong.</p>
              {hypotheses.length ? (
                <ul className="mt-4 space-y-3">
                  {hypotheses.map((s) => (
                    <li key={s.key} className="flex gap-3">
                      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full border-2 border-amber-400" aria-hidden="true" />
                      <div>
                        <div className="font-medium text-slate-800">{s.label}</div>
                        {s.evidence[0] && <div className="mt-0.5 text-sm text-slate-500">{s.evidence[0].title}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-slate-600">No guesses. Everything above is sourced.</p>
              )}
            </div>
          </div>

          {(account.painHypothesis || campaign.angle) && (
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {account.painHypothesis && (
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">The problem we think you have</h3>
                  <p className="mt-3 text-lg leading-8 text-slate-800">{account.painHypothesis}</p>
                </div>
              )}
              <blockquote className="rounded-xl border-l-4 border-orange-500 bg-orange-50 p-6">
                <p className="text-xl font-medium leading-8 text-slate-900">&ldquo;{campaign.angle}&rdquo;</p>
                <footer className="mt-3 text-sm text-slate-600">How we&apos;d approach it with {account.companyName}</footer>
              </blockquote>
            </div>
          )}
        </section>

        {/* ROI */}
        <section id="roi" className="mt-16 scroll-mt-6" data-section="roi">
          <SectionHeading kicker="Your numbers" title="What coordination costs you today" description="Prefilled from what we could see publicly. Change anything; the estimate updates live." />
          <ROICalculator slug={account.slug} defaults={campaign.roiDefaults} />
        </section>

        {/* Case study */}
        <section id="case-study" className="mt-16 scroll-mt-6" data-section="case-study">
          <SectionHeading kicker="Proof" title={`How a ${study.industry === "General" ? "manufacturer" : study.industry.toLowerCase() + " company"} handled the same moment`} />
          <CaseStudySection slug={account.slug} study={study} />
        </section>

        {/* Book */}
        <section id="book" className="mt-16 scroll-mt-6" data-section="book">
          <SectionHeading kicker="Next step" title="Talk it through" />
          <BookingCTA slug={account.slug} contactName={account.contact?.name} contactEmail={account.contact?.email} calendlyUrl={config.calendly.url || undefined} />
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-[1040px] flex-col gap-2 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="font-semibold text-slate-700">{brand}</div>
          <div>
            This page was generated for {account.companyName} on {formatDate(campaign.launchedAt)}.
          </div>
          {config.demoBanner && (
            <Link href="/" className="underline decoration-slate-300 underline-offset-2 hover:text-slate-800">
              Engine dashboard
            </Link>
          )}
        </div>
      </footer>
    </>
  );
}

function SectionHeading({ kicker, title, description }: { kicker: string; title: string; description?: string }) {
  return (
    <div className="mb-6">
      <div className="text-xs font-semibold uppercase tracking-wider text-orange-600">{kicker}</div>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{title}</h2>
      {description && <p className="mt-2 max-w-2xl text-base text-slate-600">{description}</p>}
    </div>
  );
}
