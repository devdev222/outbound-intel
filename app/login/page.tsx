import { Inter } from "next/font/google";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { homeFor } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { LoginForm } from "./LoginForm";

const inter = Inter({ subsets: ["latin"], variable: "--font-ui", display: "swap" });

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getSession();
  const { next } = await searchParams;
  if (user) redirect(next && next.startsWith("/") ? next : homeFor(user.role));
  return (
    <div className={`${inter.variable} flex min-h-screen items-center justify-center bg-[var(--bg)] px-4`}>
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-[20px] font-semibold tracking-tight">{config.brandName}</div>
          <div className="text-[13px] text-[var(--muted)]">Revenue Operating System</div>
        </div>
        <LoginForm next={next ?? null} demo={config.demoBanner} />
      </div>
    </div>
  );
}
