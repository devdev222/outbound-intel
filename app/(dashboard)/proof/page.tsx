import Link from "next/link";
import { ProofEditor } from "@/components/proof/ProofEditor";
import { Badge, Card, EmptyState, PageHeader, fmtDate } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { ensureProofSeeded } from "@/lib/engine/proof";
import { INDUSTRIES } from "@/lib/engine/signal-catalog";

export const dynamic = "force-dynamic";

export default async function ProofPage({ searchParams }: { searchParams: Promise<{ industry?: string; challenge?: string }> }) {
  const user = await requireRole(["bdr", "exec", "admin"]);
  const canEdit = user.role !== "bdr";
  const { industry, challenge } = await searchParams;
  const stories = await ensureProofSeeded();
  const industries = [...new Set([...INDUSTRIES, ...stories.map((s) => s.industry)])];
  const challenges = [...new Set(stories.flatMap((s) => s.challenges))].sort();
  const shown = stories
    .filter((s) => !industry || s.industry === industry)
    .filter((s) => !challenge || s.challenges.includes(challenge))
    .sort((a, b) => Number(b.approved) - Number(a.approved) || a.customer.localeCompare(b.customer));
  const approved = stories.filter((s) => s.approved).length;
  const href = (p: { industry?: string; challenge?: string }) => {
    const q = new URLSearchParams();
    const i = p.industry ?? industry;
    const c = p.challenge ?? challenge;
    if (i) q.set("industry", i);
    if (c) q.set("challenge", c);
    const qs = q.toString();
    return `/proof${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Customer proof"
        title="Customer Proof Library"
        description={`${approved} approved of ${stories.length} stories. The engine recommends the closest match for each account and page by industry, size and operational challenge.`}
        actions={canEdit ? <ProofEditor industries={industries} /> : undefined}
      />
      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12.5px] text-[var(--text-2)]">
        Unapproved stories and synthetic placeholders never reach prospects. Placeholders show only in the demo environment and are always labelled. Verified outcomes require a source.
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-[var(--muted)]">Industry:</span>
        <Link href={href({ industry: "" })} className={`pill ${!industry ? "pill-accent" : ""}`}>
          all
        </Link>
        {industries.map((i) => (
          <Link key={i} href={href({ industry: i })} className={`pill ${industry === i ? "pill-accent" : ""}`}>
            {i}
          </Link>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-[var(--muted)]">Challenge:</span>
        <Link href={href({ challenge: "" })} className={`pill ${!challenge ? "pill-accent" : ""}`}>
          all
        </Link>
        {challenges.map((c) => (
          <Link key={c} href={href({ challenge: c })} className={`pill ${challenge === c ? "pill-accent" : ""}`}>
            {c}
          </Link>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState title="No stories match" body="Clear a filter or add a story." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {shown.map((s) => (
            <Card
              key={s.id}
              title={s.customer}
              hint={`${s.industry} · ${s.sizeBand} employees · updated ${fmtDate(s.updatedAt)}`}
              actions={
                <div className="flex flex-wrap items-center gap-1">
                  {s.approved ? <Badge tone="good">approved</Badge> : <Badge tone="warn">not approved</Badge>}
                  {s.placeholder && <Badge tone="bad" title="Synthetic placeholder for the demo; not a real customer">placeholder</Badge>}
                </div>
              }
            >
              <div className="mb-2 flex flex-wrap gap-1">
                {s.challenges.map((c) => (
                  <span key={c} className="pill">
                    {c}
                  </span>
                ))}
              </div>
              <ul className="mb-2 flex flex-col gap-1 text-[13px]">
                {s.outcomes.map((o, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold">{o.value}</span> {o.metric.toLowerCase()}
                    </span>
                    {o.verified ? <Badge tone="good" title={o.source}>verified</Badge> : <Badge tone="neutral" title={o.source || "no source"}>unverified</Badge>}
                  </li>
                ))}
              </ul>
              {s.quote && (
                <blockquote className="border-l-2 border-[var(--border-strong)] pl-3 text-[13px] text-[var(--text-2)]">
                  “{s.quote}”{s.quoteBy && <div className="mt-1 text-[12px] text-[var(--muted)]">{s.quoteBy}</div>}
                </blockquote>
              )}
              {s.capabilities.length > 0 && <div className="mt-2 text-[12px] text-[var(--muted)]">Capabilities: {s.capabilities.join(", ")}</div>}
              {canEdit && (
                <div className="mt-3">
                  <ProofEditor industries={industries} initial={{ ...s }} label="Edit" />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
