import type { ReactNode } from "react";

/**
 * Prospect-facing pages are light-themed. The root body is dark (engine
 * dashboard), so this layout paints its own full-height light surface.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-white text-slate-900 antialiased" style={{ colorScheme: "light" }}>
      {children}
    </div>
  );
}
