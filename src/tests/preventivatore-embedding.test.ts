import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadConfig = vi.hoisted(() => vi.fn());

vi.mock("@/lib/portali/preventivatore/chat/config-cache", () => ({
  loadAiConfig: mockLoadConfig,
}));

import {
  calcolaEmbedding,
  DIMENSIONE_EMBEDDING,
  modelloEmbeddingOpenRouter,
  validaVettoreEmbedding,
} from "@/lib/portali/preventivatore/embedding";
import { EmbeddingLruCache } from "@/lib/portali/preventivatore/chat/embedding-cache";

describe("validazione embedding", () => {
  it("accetta esattamente 3072 numeri finiti", () => {
    const vettore = Array.from({ length: DIMENSIONE_EMBEDDING }, (_, i) => i / 100);
    expect(validaVettoreEmbedding(vettore)).toBe(vettore);
  });

  it("rifiuta dimensione errata e valori non finiti", () => {
    expect(() => validaVettoreEmbedding([1, 2])).toThrow(/3072/);
    const vettore = Array(DIMENSIONE_EMBEDDING).fill(0) as number[];
    vettore[10] = Number.NaN;
    expect(() => validaVettoreEmbedding(vettore)).toThrow(/non valido/);
  });
});

describe("calcolaEmbedding (solo OpenRouter)", () => {
  const richieste: Array<{ model: string; input: string }> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    richieste.length = 0;
    process.env.OPENROUTER_API_KEY = "test-key";
    mockLoadConfig.mockResolvedValue({ modello_embedding: "gemini-embedding-2" });
  });

  const rispondi = (...stati: number[]) =>
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      richieste.push(JSON.parse(init.body) as { model: string; input: string });
      const stato = stati.shift() ?? 200;
      return new Response(
        JSON.stringify(stato === 200 ? { data: [{ embedding: Array(DIMENSIONE_EMBEDDING).fill(0.25) }] } : { error: {} }),
        { status: stato },
      );
    }));

  it("usa OpenRouter, traduce il vecchio ID Google e tronca a 30.000 caratteri", async () => {
    rispondi(200);
    const risultato = await calcolaEmbedding(`  ${"x".repeat(31_000)}  `);
    expect(risultato.modello).toBe("google/gemini-embedding-2-preview");
    expect(richieste[0]).toEqual({ model: "google/gemini-embedding-2-preview", input: "x".repeat(30_000) });
    expect(risultato.vettore).toHaveLength(DIMENSIONE_EMBEDDING);
  });

  it("ritenta su 429 e poi riesce", async () => {
    rispondi(429, 200);
    await expect(calcolaEmbedding("testo")).resolves.toMatchObject({ modello: "google/gemini-embedding-2-preview" });
    expect(richieste).toHaveLength(2);
  });

  it("senza OPENROUTER_API_KEY fallisce in modo esplicito", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(calcolaEmbedding("testo")).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});

describe("modelloEmbeddingOpenRouter", () => {
  it("accetta ID OpenRouter, prefisso openrouter: e vuoto", () => {
    expect(modelloEmbeddingOpenRouter("openrouter:openai/text-embedding-3-large")).toBe("openai/text-embedding-3-large");
    expect(modelloEmbeddingOpenRouter("")).toBe("google/gemini-embedding-2-preview");
  });
});

describe("EmbeddingLruCache", () => {
  it("elimina la voce meno recente oltre il limite", () => {
    const cache = new EmbeddingLruCache(2, 1_000);
    cache.set("a", [1], 0);
    cache.set("b", [2], 1);
    expect(cache.get("a", 2)).toEqual([1]);
    cache.set("c", [3], 3);
    expect(cache.get("b", 3)).toBeUndefined();
    expect(cache.get("a", 3)).toEqual([1]);
  });

  it("elimina le voci scadute", () => {
    const cache = new EmbeddingLruCache(5, 10);
    cache.set("a", [1], 100);
    expect(cache.get("a", 109)).toEqual([1]);
    expect(cache.get("a", 110)).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
