import type { Metadata } from "next";
import { Inter_Tight, Newsreader } from "next/font/google";
import AssessmentForm from "@/components/assessment/AssessmentForm";
import { Closing, GenericPage, Nav } from "@/components/landing/Sections";
import Tracker from "@/components/landing/Tracker";
import "@/components/landing/landing.css";
import { config } from "@/lib/config";
import { campaignIdFor } from "@/lib/engine/page-record";
import { getStore } from "@/lib/store";
import type { Account } from "@/lib/types";
import { pageTokenFor, parsePageParam } from "@/lib/util";

const interTight = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap", style: ["normal", "italic"] });

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

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
  return {
    title: account ? `Freight operations assessment for ${account.companyName} · ${config.brandName}` : `Freight operations assessment · ${config.brandName}`,
    robots: { index: false, follow: false, noarchive: true },
    referrer: "strict-origin",
  };
}

/** Freight Operations Efficiency Assessment: a 3-minute, assumption-based estimate of manual coordination load. */
export default async function AssessPage({ params }: Params) {
  const { slug } = await params;
  const account = await resolveAccount(slug);
  const wrap = `cp ${interTight.variable} ${newsreader.variable}`;
  if (!account) return <div className={wrap}><GenericPage /></div>;
  const token = pageTokenFor(account.id);

  return (
    <div className={wrap}>
      <Tracker slug={account.slug} accountId={account.id} campaignId={campaignIdFor(account)} isPreview={!account.campaign} />
      {config.demoBanner && (
        <a className="cp-flag cp-flag--muted" href="/" role="note" title="Demo environment: company data on this page is synthetic">
          Demo · synthetic data
        </a>
      )}
      <Nav links={[{ href: `/for/${account.slug}-${token}`, label: "Your page" }]} cta={{ href: `/for/${account.slug}-${token}#talk`, label: "Book a call" }} />
      <main>
        <section className="cp-section cp-assess__intro" data-section="assessment">
          <div className="cp-container">
            <p className="cp-label cp-reveal">Prepared for {account.companyName}</p>
            <h1 className="cp-statement cp-reveal">
              Freight operations efficiency assessment. <span className="cp-muted">Five questions about how coordination runs today; an estimate of what could be automated.</span>
            </h1>
            <AssessmentForm slug={account.slug} token={token} companyName={account.companyName} contactEmail={account.contact?.email} />
          </div>
        </section>
        <Closing preparedFor={account.companyName}>
          <div className="cp-end">
            <h2 className="cp-end__title cp-reveal">Validate the estimate with real numbers.</h2>
            <p className="cp-end__lede cp-reveal">Fifteen minutes with your Cartage contact turns these assumptions into a plan for {account.companyName}.</p>
            <a className="cp-btn cp-btn--primary cp-reveal" href={`/for/${account.slug}-${token}#talk`}>
              Book 15 minutes <span className="cp-arrow" aria-hidden="true">→</span>
            </a>
          </div>
        </Closing>
      </main>
    </div>
  );
}
