import { ScoringSettingsForm } from "@/components/console/SettingsForms";
import { RetrainButton } from "@/components/dashboard/RetrainButton";
import { Card, Meter, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { getSettings } from "@/lib/store/collections";
import type { Weights } from "@/lib/types";

export const dynamic = "force-dynamic";

const LABELS: Record<keyof Weights, string> = { signal: "Buying signals", icp: "ICP similarity", pain: "Operational pain", timing: "Timing / urgency", access: "Decision-maker access" };

export default async function ScoringSettingsPage() {
  await requireRole(["admin"]);
  const store = getStore();
  const [models, settings] = await Promise.all([store.listModels(), getSettings()]);
  const model = models[0] ?? null;
  return (
    <div className="page">
      <PageHeader eyebrow="Revenue engineering" title="Scoring model" description="Weights are learned from outcomes and cannot be hand-edited; thresholds and economics can." actions={<RetrainButton />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Learned weights" hint={model ? `v${model.version} · ${model.baseline.n} records · trained ${model.trainedAt.slice(0, 16).replace("T", " ")}` : "no model yet"}>
          {model ? (
            <div className="space-y-3">
              {(Object.keys(model.weights) as (keyof Weights)[]).map((k) => (
                <div key={k}>
                  <div className="flex justify-between text-sm">
                    <span>{LABELS[k]}</span>
                    <span className="mono">
                      {model.weights[k].toFixed(2)} <span className="text-[var(--muted)]">/ prior {model.priorWeights[k].toFixed(2)}</span>
                    </span>
                  </div>
                  <Meter value={model.weights[k]} max={0.5} />
                  <div className="text-[11px] text-[var(--muted)]">correlation with conversion {model.categoryCorrelations[k].toFixed(2)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--muted)]">Run Learn to train the first model.</div>
          )}
        </Card>
        <Card title="Thresholds and economics" hint="saved to platform settings; audited">
          <ScoringSettingsForm automation={settings.automation} economics={settings.economics} />
        </Card>
      </div>
      <Card className="mt-4" title="Model versions" hint={`${models.length} version${models.length === 1 ? "" : "s"}`} padded={false}>
        <table className="table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Trained</th>
              <th>Records</th>
              <th>Weights</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.version}>
                <td className="font-medium">v{m.version}</td>
                <td className="mono text-xs">{m.trainedAt.slice(0, 16).replace("T", " ")}</td>
                <td>{m.baseline.n}</td>
                <td className="mono text-xs">
                  {(Object.keys(m.weights) as (keyof Weights)[]).map((k) => `${k} ${m.weights[k].toFixed(2)}`).join(" · ")}
                </td>
                <td className="text-xs text-[var(--muted)]">{m.notes.slice(0, 2).join(" · ")}</td>
              </tr>
            ))}
            {!models.length && (
              <tr>
                <td colSpan={5} className="text-sm text-[var(--muted)]">
                  No models yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
