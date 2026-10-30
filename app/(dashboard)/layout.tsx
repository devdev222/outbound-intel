import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireRole } from "@/lib/auth";
import { getStore } from "@/lib/store";

const inter = Inter({ subsets: ["latin"], variable: "--font-ui", display: "swap" });

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireRole(["exec", "bdr", "admin"]);
  const accounts = await getStore().listAccounts();
  const synthetic = accounts.some((a) => a.facts.source === "synthetic");
  return (
    <div className={inter.variable}>
      <AppShell user={user} synthetic={synthetic}>
        {children}
      </AppShell>
    </div>
  );
}
