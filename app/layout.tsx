import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outbound Intelligence Engine",
  description: "Self-improving outbound engine: learn from conversions, discover and score accounts, personalize, track, activate reps, learn again.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
