import { Inter_Tight, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import "@/components/landing/landing.css";

/**
 * Prospect-facing pages carry the cartage-pages brand: light paper surface,
 * Inter Tight / Newsreader standing in for the licensed Suisse Int'l, and the
 * token set from src/theme/tokens.json (see landing.css). The root body is the
 * dark dashboard, so this layout paints its own full-height surface.
 */
const interTight = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap", style: ["normal", "italic"] });

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <div className={`cp ${interTight.variable} ${newsreader.variable}`}>{children}</div>;
}
