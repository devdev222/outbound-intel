"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { MessageTemplate, TemplateChannel } from "@/lib/types";

interface Variable {
  key: string;
  description: string;
  example: string;
}

const CHANNEL_LABEL: Record<TemplateChannel, string> = { email: "Email", linkedin: "LinkedIn", inmail: "InMail", call: "Call script" };
const STATUS_TONE: Record<MessageTemplate["status"], string> = { approved: "pill pill-good", draft: "pill pill-warn", archived: "pill" };
const ACCEPT = ".txt,.md,.html,.htm,.eml,.csv,.json";

async function api(url: string, method: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

type Draft = { id?: string; name: string; channel: TemplateChannel; subject: string; body: string; tags: string };
const blank: Draft = { name: "", channel: "email", subject: "", body: "", tags: "" };

export function TemplateLibrary({ templates, variables, canEdit, sampleAccounts, live }: { templates: MessageTemplate[]; variables: Variable[]; canEdit: boolean; sampleAccounts: { slug: string; company: string }[]; live: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | TemplateChannel>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [upload, setUpload] = useState<{ created: number; rejected: { file: string; name?: string; problem: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = templates.filter((t) => (showArchived ? true : t.status !== "archived") && (filter === "all" || t.channel === filter));

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setErr(null);
    setUpload(null);
    try {
      const files = await Promise.all([...list].slice(0, 20).map(async (f) => ({ name: f.name, content: f.size > 200_000 ? "" : await f.text(), tooBig: f.size > 200_000 })));
      const big = files.filter((f) => f.tooBig).map((f) => ({ file: f.name, problem: "larger than 200 KB" }));
      const ok = files.filter((f) => !f.tooBig).map(({ name, content }) => ({ name, content }));
      const r = ok.length ? await api("/api/templates", "POST", { files: ok }) : { ok: false, data: { created: [], rejected: [] } };
      setUpload({ created: ((r.data.created as unknown[]) ?? []).length, rejected: [...big, ...(((r.data.rejected as { file: string; problem: string }[]) ?? []) as { file: string; problem: string }[])] });
      if (!r.ok && r.data.error) setErr(String(r.data.error));
      router.refresh();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function setStatus(t: MessageTemplate, status: MessageTemplate["status"]) {
    setErr(null);
    const r = await api(`/api/templates/${t.id}`, "PATCH", { status });
    if (!r.ok) setErr(String(r.data.error ?? "failed"));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <section className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="card-title">Add templates</div>
              <div className="card-hint mt-0.5">
                Upload .txt or .md (a first line “Subject: …” becomes the subject), .html, .eml, or .csv / .json with columns name, subject, body, channel, tags. Uploads arrive as drafts{live ? "; only approved templates reach prospects" : ""}.
              </div>
            </div>
            <div className="flex gap-2">
              <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => onFiles(e.target.files)} aria-label="Upload template files" />
              <button className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? "Uploading…" : "Upload files"}
              </button>
              <button className="btn btn-sm" onClick={() => setEditing({ ...blank })}>
                New template
              </button>
            </div>
          </div>
          {upload && (
            <div className="mt-3 text-[13px]">
              {upload.created > 0 && <div className="text-[var(--good)]">Added {upload.created} template{upload.created === 1 ? "" : "s"} as drafts. Review and approve them below.</div>}
              {upload.rejected.map((r) => (
                <div key={`${r.file}-${r.name ?? ""}-${r.problem}`} className="text-[var(--bad)]">
                  {r.file}
                  {r.name ? ` (${r.name})` : ""}: {r.problem}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {editing && <TemplateEditor draft={editing} variables={variables} sampleAccounts={sampleAccounts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}

      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        {(["all", "email", "linkedin", "inmail", "call"] as const).map((c) => (
          <button key={c} className={`pill ${filter === c ? "pill-accent" : ""}`} onClick={() => setFilter(c)}>
            {c === "all" ? "All channels" : CHANNEL_LABEL[c]}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1 text-[var(--muted)]">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>
      {err && <div className="text-[13px] text-[var(--bad)]">{err}</div>}

      {rows.length === 0 ? (
        <div className="card px-4 py-8 text-center text-[13px] text-[var(--muted)]">No templates yet. Upload your email templates or write one; sequences can then use them step by step.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((t) => (
            <article key={t.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold">{t.name}</span>
                    <span className="pill">{CHANNEL_LABEL[t.channel]}</span>
                    <span className={STATUS_TONE[t.status]}>{t.status}</span>
                    {t.tags.map((g) => (
                      <span key={g} className="pill pill-info">
                        {g}
                      </span>
                    ))}
                  </div>
                  {t.subject && <div className="mt-1 text-[13px] font-medium">{t.subject}</div>}
                  <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12.5px] text-[var(--text-2)]">{t.body}</div>
                  <div className="mt-1 text-[11.5px] text-[var(--muted)]">
                    {t.source === "upload" ? `uploaded from ${t.fileName}` : "written here"} · updated by {t.updatedBy}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {t.status !== "archived" && (
                      <button className="btn btn-sm" onClick={() => setEditing({ id: t.id, name: t.name, channel: t.channel, subject: t.subject ?? "", body: t.body, tags: t.tags.join(", ") })}>
                        Edit
                      </button>
                    )}
                    {t.status === "draft" && (
                      <button className="btn btn-accent btn-sm" onClick={() => setStatus(t, "approved")}>
                        Approve
                      </button>
                    )}
                    {t.status === "approved" && (
                      <button className="btn btn-sm" onClick={() => setStatus(t, "draft")}>
                        Back to draft
                      </button>
                    )}
                    {t.status !== "archived" ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => setStatus(t, "archived")}>
                        Archive
                      </button>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => setStatus(t, "draft")}>
                        Restore
                      </button>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateEditor({ draft, variables, sampleAccounts, onClose, onSaved }: { draft: Draft; variables: Variable[]; sampleAccounts: { slug: string; company: string }[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(draft);
  const [slug, setSlug] = useState(sampleAccounts[0]?.slug ?? "");
  const [preview, setPreview] = useState<{ subject: string | null; body: string } | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const h = setTimeout(async () => {
      if (!d.body.trim()) return setPreview(null);
      const r = await api("/api/templates/preview", "POST", { subject: d.channel === "email" ? d.subject : null, body: d.body, slug: slug || undefined });
      if (r.ok) {
        setPreview(r.data.rendered as { subject: string | null; body: string });
        setUnknown((r.data.unknown as string[]) ?? []);
      }
    }, 350);
    return () => clearTimeout(h);
  }, [d.body, d.subject, d.channel, slug]);

  function insert(key: string) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return setD({ ...d, body: d.body + token });
    const start = el.selectionStart ?? d.body.length;
    const end = el.selectionEnd ?? d.body.length;
    setD({ ...d, body: d.body.slice(0, start) + token + d.body.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    const payload = { name: d.name.trim(), channel: d.channel, subject: d.channel === "email" ? d.subject : null, body: d.body, tags: d.tags.split(",").map((x) => x.trim()).filter(Boolean) };
    const r = d.id ? await api(`/api/templates/${d.id}`, "PATCH", payload) : await api("/api/templates", "POST", { template: payload });
    setBusy(false);
    if (!r.ok) return setErr(String(r.data.error ?? "could not save"));
    onSaved();
  }

  return (
    <section className="card border-[var(--border-strong)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="card-title">{d.id ? "Edit template" : "New template"}</div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
            <input className="field" placeholder="Template name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
            <select className="field" value={d.channel} onChange={(e) => setD({ ...d, channel: e.target.value as TemplateChannel })}>
              {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          {d.channel === "email" && <input className="field" placeholder="Subject" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} />}
          <textarea ref={bodyRef} className="field min-h-56 font-mono text-[12.5px]" placeholder="Message body. Use {{first_name}}, {{signal}}, {{page_url}}…" value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} />
          <input className="field" placeholder="Tags, comma separated (optional)" value={d.tags} onChange={(e) => setD({ ...d, tags: e.target.value })} />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Insert a variable</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {variables.map((v) => (
                <button key={v.key} type="button" className="pill mono" title={`${v.description} (e.g. ${v.example})`} onClick={() => insert(v.key)}>
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[11.5px] text-[var(--muted)]">A line whose variables are all empty is left out (for example a proof line when no approved story matches).</div>
          </div>
          {unknown.length > 0 && <div className="text-[12.5px] text-[var(--bad)]">Unknown variable{unknown.length > 1 ? "s" : ""}: {unknown.map((u) => `{{${u}}}`).join(", ")}</div>}
          {err && <div className="text-[12.5px] text-[var(--bad)]">{err}</div>}
          <div className="flex items-center gap-2">
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy || !d.name.trim() || !d.body.trim()}>
              {busy ? "Saving…" : "Save as draft"}
            </button>
            <span className="text-[11.5px] text-[var(--muted)]">Approve it in the list once it reads right.</span>
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Preview</span>
            <select className="field max-w-[240px] text-[12px]" value={slug} onChange={(e) => setSlug(e.target.value)} aria-label="Preview account">
              <option value="">Example values</option>
              {sampleAccounts.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.company}
                </option>
              ))}
            </select>
          </div>
          <div className="min-h-56 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[13px]">
            {preview ? (
              <>
                {preview.subject && <div className="mb-2 font-semibold">{preview.subject}</div>}
                <div className="whitespace-pre-wrap">{preview.body}</div>
              </>
            ) : (
              <span className="text-[var(--muted)]">Start typing to see it filled in for an account.</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
