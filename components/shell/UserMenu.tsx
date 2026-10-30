"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UserMenu({ name, role }: { name: string; role: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <span className="hidden sm:inline">{name}</span>
      <span className="pill">{role}</span>
      <button className="btn btn-ghost btn-sm" onClick={signOut} disabled={busy}>
        Sign out
      </button>
    </div>
  );
}
