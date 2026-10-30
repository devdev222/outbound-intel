"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Recoverable page error: say what happened, offer a retry, never lose the session. */
export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="page">
      <div className="card mx-auto max-w-lg p-6 text-center" role="alert">
        <div className="text-[15px] font-semibold">This page could not load</div>
        <p className="mt-1 text-[13px] text-[var(--text-2)]">Something went wrong while loading the data. Nothing you saved was lost. Try again; if it keeps failing, an admin can check Logs &amp; errors{error.digest ? ` (reference ${error.digest})` : ""}.</p>
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <Link href="/" className="btn">
            Go to my workspace
          </Link>
        </div>
      </div>
    </div>
  );
}
