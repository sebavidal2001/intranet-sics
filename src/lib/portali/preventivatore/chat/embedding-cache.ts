import { calcolaEmbedding } from "../embedding";

// ─── Embedding cache (persists across requests in same Node.js process) ───────

export const EMBED_CACHE_MAX = 500;
const EMBED_TTL_MS = 10 * 60 * 1000;

export class EmbeddingLruCache {
  private readonly cache = new Map<string, { vector: number[]; ts: number }>();

  constructor(
    private readonly maxVoci = EMBED_CACHE_MAX,
    private readonly ttlMs = EMBED_TTL_MS
  ) {}

  get(key: string, ora = Date.now()): number[] | undefined {
    for (const [chiave, voce] of this.cache) {
      if (ora - voce.ts >= this.ttlMs) this.cache.delete(chiave);
    }
    const voce = this.cache.get(key);
    if (!voce) return undefined;
    this.cache.delete(key);
    this.cache.set(key, voce);
    return voce.vector;
  }

  set(key: string, vector: number[], ora = Date.now()): void {
    this.cache.delete(key);
    this.cache.set(key, { vector, ts: ora });
    while (this.cache.size > this.maxVoci) {
      const menoRecente = this.cache.keys().next().value as string | undefined;
      if (menoRecente === undefined) break;
      this.cache.delete(menoRecente);
    }
  }

  get size(): number {
    return this.cache.size;
  }
}

const embeddingCache = new EmbeddingLruCache();

export async function getCachedEmbedding(text: string): Promise<number[]> {
  const key = text.trim();
  const cached = embeddingCache.get(key);
  if (cached) return cached;
  const { vettore } = await calcolaEmbedding(key);
  embeddingCache.set(key, vettore);
  return vettore;
}
