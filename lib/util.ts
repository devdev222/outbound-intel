import { randomUUID } from "node:crypto";

export function uuid(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function daysBetween(aIso: string, bIso: string): number {
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) / 86_400_000;
}

export function daysAgoIso(days: number, from = new Date()): string {
  return new Date(from.getTime() - days * 86_400_000).toISOString();
}

/** Deterministic 32-bit hash (FNV-1a) used for stable experiment assignment. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Small seeded PRNG (mulberry32) so synthetic data is reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickOne<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function pickMany<T>(rng: () => number, arr: readonly T[], count: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < count && copy.length) {
    out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  }
  return out;
}

export function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

export function mean(ns: number[]): number {
  return ns.length ? sum(ns) / ns.length : 0;
}

/** Point-biserial correlation between a continuous x and binary y (0/1). Returns 0 when undefined. */
export function pointBiserial(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 3) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return 0;
  return cov / Math.sqrt(vx * vy);
}

export function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatPct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}
