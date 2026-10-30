import { config } from "@/lib/config";
import { ConsoleAlertProvider, SlackAlertProvider } from "./alerts";
import { NoopAnalyticsProvider, PostHogAnalyticsProvider } from "./analytics";
import { HttpCrmProvider, MockCrmProvider } from "./crm";
import { ClayDiscoveryProvider, ClaySignalCollector } from "./discovery/clay";
import { MockDiscoveryProvider, MockSignalCollector } from "./discovery/mock";
import { NativeSignalCollector } from "./discovery/native";
import { ClayEnrichmentProvider, HttpEnrichmentProvider, MockEnrichmentProvider } from "./enrichment";
import { CartageDialerProvider, CartageSequencerProvider, MockDialerProvider, MockOutreachProvider, ResendOutreachProvider } from "./outreach";
import { TestAlertProvider, TestDialerProvider, TestEnrichmentProvider, TestOutreachProvider } from "./testing";
import type { Providers, SignalCollector } from "./types";
import { MockVideoProvider, TavusVideoProvider } from "./video";

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
    enrichment:
      config.providers.enrichment === "clay"
        ? new ClayEnrichmentProvider()
        : config.providers.enrichment === "http"
          ? new HttpEnrichmentProvider()
          : config.providers.enrichment === "test"
            ? new TestEnrichmentProvider()
            : new MockEnrichmentProvider(),
    video: config.providers.video === "tavus" ? new TavusVideoProvider() : new MockVideoProvider(),
    outreach:
      config.providers.outreach === "sequencer"
        ? new CartageSequencerProvider()
        : config.providers.outreach === "resend"
          ? new ResendOutreachProvider()
          : config.providers.outreach === "test"
            ? new TestOutreachProvider()
            : new MockOutreachProvider(),
    dialer: config.providers.dialer === "cartage" ? new CartageDialerProvider() : config.providers.dialer === "test" ? new TestDialerProvider() : new MockDialerProvider(),
    analytics: config.providers.analytics === "posthog" ? new PostHogAnalyticsProvider() : new NoopAnalyticsProvider(),
    alerts: config.providers.alerts === "slack" ? new SlackAlertProvider() : config.providers.alerts === "test" ? new TestAlertProvider() : new ConsoleAlertProvider(),
    crm: config.providers.crm === "http" ? new HttpCrmProvider() : new MockCrmProvider(),
  };

  globalThis.__outboundIntelProviders = providers;
  return providers;
}

/** Drop the cached bundle (tests switch providers between cases). */
export function resetProviders(): void {
  globalThis.__outboundIntelProviders = undefined;
}
