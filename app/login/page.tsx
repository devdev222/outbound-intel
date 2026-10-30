import { Inter } from "next/font/google";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { homeFor } from "@/lib/auth/session";
import { authProblems, authProvider } from "@/lib/auth/oidc";
import { config } from "@/lib/config";
import { LoginForm } from "./LoginForm";

const inter = Inter({ subsets: ["latin"], variable: "--font-ui", display: "swap" });

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const user = await getSession();
  const { next, error } = await searchParams;
  const sso = authProvider() === "oidc";
  const problems = authProblems();
  if (user) redirect(next && next.startsWith("/") ? next : homeFor(user.role));
  return (
    <div className={`${inter.variable} flex min-h-screen items-center justify-center bg-[var(--bg)] px-4`}>
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-[20px] font-semibold tracking-tight">{config.brandName}</div>
          <div className="text-[13px] text-[var(--muted)]">Revenue Operating System</div>
        </div>
        {error && <div className="mb-3 rounded-md bg-[var(--warn-soft)] p-3 text-[13px]">{error}</div>}
        {problems.length > 0 ? (
          <div className="card p-5 text-[13px]">
            <div className="font-semibold">Sign-in is not configured</div>
            <p className="mt-1 text-[var(--text-2)]">An administrator must finish single sign-on setup before anyone can sign in: {problems.join("; ")}.</p>
          </div>
        ) : sso ? (
          <div className="card p-5">
            <a className="btn btn-primary w-full justify-center no-underline" href={`/api/auth/oidc/start${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
              Sign in with single sign-on
            </a>
          </div>
        ) : (
          <LoginForm next={next ?? null} demo={config.demoBanner} />
        )}
      </div>
    </div>
  );
}
