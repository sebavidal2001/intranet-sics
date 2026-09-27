import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGuard = vi.hoisted(() => vi.fn());
const mockAdmin = vi.hoisted(() => vi.fn());
const mockChiama = vi.hoisted(() => vi.fn());

vi.mock("@/lib/portali/preventivatore/api-guard", () => ({ requirePreventivatore: mockGuard }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockAdmin }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ ok: true }), tooManyRequests: vi.fn() }));
vi.mock("@/lib/portali/preventivatore/chat/config-cache", () => ({ loadAiConfig: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/portali/preventivatore/ruoli", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/portali/preventivatore/ruoli")>()),
  getPreventivatoreScope: vi.fn().mockResolvedValue({ restricted: false, clienteIds: null }),
}));
vi.mock("@/lib/portali/preventivatore/scheda-tecnica/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/portali/preventivatore/scheda-tecnica/ai")>()),
  chiamaOpenRouterChat: mockChiama,
  recuperaEsempi: vi.fn().mockResolvedValue([]),
  registraUsage: vi.fn().mockResolvedValue(undefined),
}));

import { POST as genera } from "@/app/api/portali/preventivatore/scheda-tecnica/route";
import { MAX_CARATTERI_SCHEDA } from "@/lib/portali/preventivatore/scheda-tecnica/ai";

const builderState = {
  titolo: "Nastro", cliente: null, data_consegna: null, blocchi: [],
  totali: { materiali: 0, servizi: 0, netto_totale: 0, n_blocchi: 0, n_articoli: 0, ore_totali: 0, coeff_ricarico_medio: 0 },
};

const richiesta = () => new NextRequest("http://localhost/api", {
  method: "POST",
  body: JSON.stringify({ builder_state: builderState, forza_generazione: true }),
  headers: { "Content-Type": "application/json" },
});

describe("limiti e persistenza scheda tecnica", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGuard.mockResolvedValue({ ok: true, user: { id: "utente" }, ctx: { livello: "viewer" } });
    mockChiama.mockResolvedValue({ content: "Scheda valida", usage: null, finishReason: "stop" });
  });

  it("usa il limite condiviso di 60.000 caratteri", () => {
    expect(MAX_CARATTERI_SCHEDA).toBe(60_000);
  });

  it("se l'insert della scheda fallisce risponde 500 e non restituisce un falso successo", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "insert fallito" } });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    mockAdmin.mockReturnValue({ schema: () => ({ from: () => ({ insert }) }) });

    const res = await genera(richiesta());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("non è stato possibile salvarla") });
  });
});
