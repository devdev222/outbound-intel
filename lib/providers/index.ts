import { config } from "@/lib/config";
import { create } from "@/lib/capabilities";
import { ClayDiscoveryProvider, ClaySignalCollector } from "./discovery/clay";
import { MockDiscoveryProvider, MockSignalCollector } from "./discovery/mock";
import { NativeSignalCollector } from "./discovery/native";
import type { Providers, SignalCollector } from "./types";

export type * from "./types";

declare global {
  // eslint-disable-next-line no-var
  var __outboundIntelProviders: Providers | undefined;
}

/**
 * Builds the provider bundle from configuration. This is the only place that
 * knows which concrete adapter is active; swap an env var, restart, and the
 * engine runs against the real system.
 */
export function getProviders(): Providers {
  if (globalThis.__outboundIntelProviders) return globalThis.__outboundIntelProviders;

  const clay = new ClayDiscoveryProvider();
  const discovery = config.providers.discovery === "clay" ? clay : new MockDiscoveryProvider();

  const mockCollector = new MockSignalCollector();
  const clayCollector = new ClaySignalCollector(clay);
  const nativeCollector = new NativeSignalCollector();
  const pickCollector = (source: "discovery" | "clay" | "native"): SignalCollector | null => {
    if (source === "native") return nativeCollector;
    if (source === "clay") return clayCollector;
    // "discovery": whatever the discovery provider already collected (mock facts or Clay rows)
    return config.providers.discovery === "clay" ? null : mockCollector;
  };

  const providers: Providers = {
    discovery,
    collectors: {
      hiring: pickCollector(config.signalSources.hiring),
      expansion: pickCollector(config.signalSources.expansion),
      technology: pickCollector(config.signalSources.technology),
      pain: pickCollector(config.signalSources.pain),
    },
    // Every adapter comes from the capability registry (lib/capabilities.ts).
    enrichment: create("enrichment"),
    video: create("video"),
    outreach: create("outreach"),
    dialer: create("dialer"),
    analytics: create("analytics"),
    alerts: create("alerts"),
    crm: create("crm"),
  };

  globalThis.__outboundIntelProviders = providers;
  return providers;
}

/** Drop the cached bundle (tests switch providers between cases). */
export function resetProviders(): void {
  globalThis.__outboundIntelProviders = undefined;
}
