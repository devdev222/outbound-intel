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
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!demo);

  async function signIn(asEmail: string, asPassword: string) {
    if (!asEmail.trim()) {
      setError("Enter your email, or pick one of the demo accounts.");
      return;
    }
    setBusy(asEmail);
    setError(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: asEmail.trim(), password: asPassword || "demo" }) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(data.error ?? "Sign-in failed");
      return;
    }
    router.push(next && next.startsWith("/") ? next : data.home);
    router.refresh();
  }

  return (
    <div className="card p-5">
      {demo && (
        <div className="mb-4">
          <div className="mb-2 text-[12px] font-medium text-[var(--text-2)]">Demo environment. Choose a role to sign in:</div>
          <div className="flex flex-col gap-2">
            {DEMO.map((d) => (
              <button key={d.email} type="button" className="btn justify-between text-left" disabled={busy !== null} onClick={() => signIn(d.email, "demo")}>
                <span>
                  <span className="font-semibold">{busy === d.email ? "Signing in…" : d.label}</span>
                  <span className="ml-2 text-[12px] text-[var(--muted)]">{d.blurb}</span>
                </span>
                <span className="mono hidden text-[11px] text-[var(--muted)] sm:inline">{d.email}</span>
              </button>
            ))}
          </div>
          {error && <div className="mt-2 text-[12px] text-[var(--bad)]">{error}</div>}
          <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Hide email sign-in" : "Sign in with email instead"}
          </button>
        </div>
      )}
      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void signIn(email, password);
          }}
          className={`flex flex-col gap-3 ${demo ? "border-t border-[var(--border)] pt-4" : ""}`}
          noValidate
        >
          <label className="text-[12px] font-medium text-[var(--text-2)]">
            Email
            <input className="field mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder={demo ? "exec@cartage.demo" : ""} />
          </label>
          <label className="text-[12px] font-medium text-[var(--text-2)]">
            Password
            <input className="field mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder={demo ? "demo" : ""} />
          </label>
          {!demo && error && <div className="text-[12px] text-[var(--bad)]">{error}</div>}
          <button className="btn btn-primary justify-center" type="submit" disabled={busy !== null}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {demo && <div className="text-[11.5px] text-[var(--muted)]">Password is “demo” unless DEMO_PASSWORD is set. Replace this provider with SSO before production.</div>}
        </form>
      )}
    </div>
  );
}
