import Link from "next/link";
import { getSession } from "@/lib/auth";
import { homeFor } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ForbiddenPage() {
  const user = await getSession();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <div className="card max-w-md p-6 text-center">
        <div className="text-[16px] font-semibold">That workspace is not available to your role</div>
        <p className="mt-2 text-[13px] text-[var(--muted)]">{user ? `You are signed in as ${user.name} (${user.role}).` : "You are not signed in."}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Link className="btn btn-primary" href={user ? homeFor(user.role) : "/login"}>
            {user ? "Go to my workspace" : "Sign in"}
          </Link>
        </div>
      </div>
    </div>
  );
}
