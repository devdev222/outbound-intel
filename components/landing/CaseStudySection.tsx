"use client";

import { useRef, useState } from "react";
import type { CaseStudy } from "@/lib/content/case-studies";
import { track } from "./Tracker";

export default function CaseStudySection({ slug, study }: { slug: string; study: CaseStudy }) {
  const [open, setOpen] = useState(false);
  const firedRef = useRef(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !firedRef.current) {
      firedRef.current = true;
      track(slug, "case_study_viewed", { caseStudyId: study.id, title: study.title });
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
      <div className="text-xs font-semibold uppercase tracking-wider text-orange-600">{study.industry === "General" ? "Customer story" : study.industry}</div>
      <h3 className="mt-2 text-2xl font-semibold text-slate-900">{study.title}</h3>
      <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{study.summary}</p>

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        {study.metrics.map((m) => (
          <div key={m.label} className="rounded-lg bg-slate-50 p-4">
            <dd className="text-2xl font-bold text-slate-900">{m.value}</dd>
            <dt className="mt-1 text-sm text-slate-600">{m.label}</dt>
          </div>
        ))}
      </dl>

      {open && (
        <blockquote className="mt-6 border-l-4 border-orange-500 pl-4">
          <p className="text-lg leading-8 text-slate-800">&ldquo;{study.quote}&rdquo;</p>
          <footer className="mt-2 text-sm text-slate-500">{study.quoteBy}</footer>
        </blockquote>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="mt-6 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:border-slate-400 hover:bg-slate-50"
      >
        {open ? "Show less" : "Read the full story"}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={open ? "rotate-180 transition" : "transition"}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
