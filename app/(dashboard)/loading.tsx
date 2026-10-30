/** Shown while a workspace page loads its data. */
export default function Loading() {
  return (
    <div className="page" aria-busy="true" aria-live="polite">
      <div className="mb-6 space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-[var(--surface-2)]" />
        <div className="h-6 w-56 animate-pulse rounded bg-[var(--surface-2)]" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card h-16 animate-pulse bg-[var(--surface-2)]" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
