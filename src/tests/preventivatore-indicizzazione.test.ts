import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCalcolaEmbedding = vi.hoisted(() => vi.fn());
const mockCreateAdminClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/portali/preventivatore/embedding", () => ({
  calcolaEmbedding: mockCalcolaEmbedding,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { indicizzaDocumento } from "@/lib/portali/preventivatore/indicizzazione";

function clientFinto(chunks: Array<{ id: string; contenuto: string }>) {
  const aggiornamenti: Array<{ id: string; valori: Record<string, unknown> }> = [];
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: chunks, error: null }),
        })),
      })),
    })),
    update: vi.fn((valori: Record<string, unknown>) => ({
      eq: vi.fn((_campo: string, id: string) => ({
        is: vi.fn().mockImplementation(async () => {
          aggiornamenti.push({ id, valori });
          return { error: null };
        }),
      })),
    })),
  }));
  return {
    client: { schema: vi.fn(() => ({ from })) },
    aggiornamenti,
  };
}

describe("indicizzaDocumento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("indicizza tutti i chunk null e salva modello e data", async () => {
    const finto = clientFinto([
      { id: "chunk-1", contenuto: "primo" },
      { id: "chunk-2", contenuto: "secondo" },
    ]);
    mockCreateAdminClient.mockReturnValue(finto.client);
    mockCalcolaEmbedding.mockResolvedValue({ vettore: [0.1], modello: "modello-test" });

    await expect(indicizzaDocumento("doc-1", { timeoutMs: 1_000 })).resolves.toEqual({
      indicizzati: 2,
      errori: 0,
    });
    expect(finto.aggiornamenti).toHaveLength(2);
    expect(finto.aggiornamenti[0]).toMatchObject({
      id: "chunk-1",
      valori: { embedding: [0.1], embedding_modello: "modello-test" },
    });
    expect(finto.aggiornamenti[0].valori.embedded_at).toEqual(expect.any(String));
  });

  it("conta l'errore di un chunk e continua con il successivo", async () => {
    const finto = clientFinto([
      { id: "chunk-1", contenuto: "rotto" },
      { id: "chunk-2", contenuto: "valido" },
    ]);
    mockCreateAdminClient.mockReturnValue(finto.client);
    mockCalcolaEmbedding
      .mockRejectedValueOnce(new Error("provider non disponibile"))
      .mockResolvedValueOnce({ vettore: [0.2], modello: "modello-test" });

    await expect(indicizzaDocumento("doc-1", { timeoutMs: 1_000 })).resolves.toEqual({
      indicizzati: 1,
      errori: 1,
    });
    expect(finto.aggiornamenti).toHaveLength(1);
  });

  it("si ferma al timeout senza lanciare eccezioni", async () => {
    vi.useFakeTimers();
    const finto = clientFinto([{ id: "chunk-1", contenuto: "lento" }]);
    mockCreateAdminClient.mockReturnValue(finto.client);
    mockCalcolaEmbedding.mockReturnValue(new Promise(() => undefined));

    const promessa = indicizzaDocumento("doc-1", { timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(11);

    await expect(promessa).resolves.toEqual({ indicizzati: 0, errori: 0 });
    expect(finto.aggiornamenti).toHaveLength(0);
  });
});
