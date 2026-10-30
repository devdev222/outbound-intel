"use client";

import { useState } from "react";
import { ConversationPanel, type PanelContext } from "./ConversationPanel";

/**
 * Primary action for a call-ready row: dial (when a verified phone exists) and
 * log the outcome. The conversation panel opens on its own full-width line of
 * the row, so the row stays compact until the rep starts.
 */
export function CallAction({ label, phone, ctx }: { label: string; phone: string | null; ctx: PanelContext }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5">
        {phone ? (
          <a className="btn btn-accent btn-sm no-underline" href={`tel:${phone.replace(/[^\d+]/g, "")}`} onClick={() => setOpen(true)}>
            {label}
          </a>
        ) : (
          <button className="btn btn-accent btn-sm" onClick={() => setOpen(true)}>
            {label}
          </button>
        )}
        {!open && (
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            Log outcome
          </button>
        )}
      </div>
      {open && (
        <div className="basis-full">
          <ConversationPanel ctx={ctx} autoOpen onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
