"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const DEMO = [
  { label: "Executive", email: "exec@cartage.demo", blurb: "Command center, pipeline, experiments, capacity" },
  { label: "BDR", email: "bdr@cartage.demo", blurb: "Today's queue, conversations, follow-ups" },
  { label: "Admin", email: "admin@cartage.demo", blurb: "Agents, integrations, automation, audit" },
];

export function LoginForm({ next, demo }: { next: string | null; demo: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e?: React.FormEvent, overrideEmail?: string) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: overrideEmail ?? email, password: password || "demo" }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Sign-in failed");
      return;
    }
    router.push(next && next.startsWith("/") ? next : data.home);
    router.refresh();
  }

  return (
    <div className="card p-5">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-[12px] font-medium text-[var(--text-2)]">
          Email
          <input className="field mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="text-[12px] font-medium text-[var(--text-2)]">
          Password
          <input className="field mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder={demo ? "demo" : ""} />
        </label>
        {error && <div className="text-[12px] text-[var(--bad)]">{error}</div>}
        <button className="btn btn-primary justify-center" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {demo && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <div className="mb-2 text-[12px] text-[var(--muted)]">Demo environment. Sign in as:</div>
          <div className="flex flex-col gap-2">
            {DEMO.map((d) => (
              <button key={d.email} type="button" className="btn justify-between text-left" disabled={busy} onClick={() => submit(undefined, d.email)}>
                <span>
                  <span className="font-semibold">{d.label}</span>
                  <span className="ml-2 text-[12px] text-[var(--muted)]">{d.blurb}</span>
                </span>
                <span className="mono text-[11px] text-[var(--muted)]">{d.email}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 text-[11.5px] text-[var(--muted)]">Password is “demo” unless DEMO_PASSWORD is set. Replace this provider with SSO before production.</div>
        </div>
      )}
    </div>
  );
}
