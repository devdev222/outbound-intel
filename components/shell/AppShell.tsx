import type { ReactNode } from "react";
import { config } from "@/lib/config";
import type { User } from "@/lib/types";
import { NavRail, type NavSection } from "./NavRail";
import { UserMenu } from "./UserMenu";

/** Role-aware application shell: left rail with workspace sections, top bar with context. */
export function navFor(user: User): NavSection[] {
  const exec: NavSection = {
    label: "Executive",
    items: [
      { href: "/exec", label: "Command center" },
      { href: "/pipeline", label: "Pipeline" },
      { href: "/intelligence", label: "Intelligence" },
      { href: "/lab", label: "Experiments" },
      { href: "/capacity", label: "Capacity" },
      { href: "/gifting", label: "Gifting" },
    ],
  };
  const bdr: NavSection = {
    label: "BDR",
    items: [
      { href: "/work", label: "Today" },
      { href: "/accounts", label: "Accounts" },
      { href: "/proof", label: "Customer proof" },
    ],
  };
  const admin: NavSection = {
    label: "Revenue engineering",
    items: [
      { href: "/console", label: "Console" },
      { href: "/console/agents", label: "Agents" },
      { href: "/console/integrations", label: "Integrations" },
      { href: "/console/data", label: "Data sources" },
      { href: "/console/scoring", label: "Scoring model" },
      { href: "/console/automation", label: "Automation" },
      { href: "/console/logs", label: "Logs & errors" },
      { href: "/console/audit", label: "Audit" },
    ],
  };
  if (user.role === "bdr") return [bdr];
  if (user.role === "exec") return [exec, { label: "Team", items: [{ href: "/work", label: "BDR queue" }, { href: "/accounts", label: "Accounts" }, { href: "/proof", label: "Customer proof" }] }];
  return [exec, bdr, admin];
}

export function AppShell({ user, children, synthetic }: { user: User; children: ReactNode; synthetic: boolean }) {
  return (
    <div className="flex min-h-screen">
      <NavRail brand={config.brandName} sections={navFor(user)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)]/95 px-4 backdrop-blur">
          <div className="flex items-center gap-3 text-[13px]">
            <span className="font-semibold">{config.brandName}</span>
            <span className="text-[var(--muted)]">Revenue Operating System</span>
            {synthetic && (
              <span className="pill pill-warn" title="Synthetic demo dataset; no production records">
                synthetic data
              </span>
            )}
          </div>
          <UserMenu name={user.name} role={user.role} />
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
