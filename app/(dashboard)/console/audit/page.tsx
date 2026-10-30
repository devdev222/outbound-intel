import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { auditLog } from "@/lib/store/collections";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requireRole(["admin"]);
  const rows = (await auditLog.list()).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 500);
  return (
    <div className="page">
      <PageHeader eyebrow="Revenue engineering" title="Audit log" description="Every sensitive action with who did it: sign-ins, approvals, suppressions, settings, experiments, gifts, closures." />
      {rows.length ? (
        <Card padded={false}>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono text-xs text-[var(--muted)]">{r.at.slice(0, 16).replace("T", " ")}</td>
                  <td>{r.userName}</td>
                  <td>
                    <span className="pill">{r.role}</span>
                  </td>
                  <td className="mono text-xs">{r.action}</td>
                  <td className="mono text-xs">{r.target}</td>
                  <td className="max-w-md truncate text-xs text-[var(--muted)]" title={r.detail}>
                    {r.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No audited actions yet" body="Sign-ins, approvals and settings changes appear here as they happen." />
      )}
    </div>
  );
}
