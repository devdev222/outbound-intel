import { type Collection, FileStore } from "./file-store";

/**
 * In-memory store for ephemeral hosting (Vercel preview / serverless demos)
 * where the filesystem does not persist between cold starts. Same semantics as
 * FileStore, minus the disk. Pair with AUTO_SEED=true so every fresh instance
 * boots with the deterministic synthetic dataset already scored.
 */
export class MemoryStore extends FileStore {
  override readonly kind = "memory" as const;
  private readonly data = new Map<Collection, unknown[]>();

  constructor() {
    super("");
  }

  protected override async read<T>(c: Collection): Promise<T[]> {
    return (this.data.get(c) as T[] | undefined) ?? [];
  }

  protected override async write<T>(c: Collection, rows: T[]): Promise<void> {
    this.data.set(c, rows);
  }
}
