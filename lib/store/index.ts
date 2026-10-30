import path from "node:path";
import { config, isSupabaseConfigured } from "@/lib/config";
import { FileStore } from "./file-store";
import { MemoryStore } from "./memory-store";
import { SupabaseStore } from "./supabase-store";
import type { Store } from "./types";

export type { Store } from "./types";

declare global {
  // eslint-disable-next-line no-var
  var __outboundIntelStore: Store | undefined;
}

/**
 * Returns the configured store. Cached on globalThis so Next.js hot reloads and
 * the MCP server share one instance per process.
 */
export function getStore(): Store {
  if (globalThis.__outboundIntelStore) return globalThis.__outboundIntelStore;

  let store: Store;
  if (config.store === "supabase") {
    if (!isSupabaseConfigured()) {
      throw new Error(
        "STORE_PROVIDER=supabase but NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY are not set. " +
          "Set them, or use STORE_PROVIDER=file for the zero-config demo.",
      );
    }
    store = new SupabaseStore(config.supabase.url, config.supabase.secretKey);
  } else if (config.store === "memory") {
    store = new MemoryStore();
  } else {
    store = new FileStore(path.resolve(process.cwd(), config.dataDir));
  }
  globalThis.__outboundIntelStore = store;
  return store;
}
