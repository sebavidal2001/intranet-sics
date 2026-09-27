import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCreateClient = vi.hoisted(() => vi.fn());
const mockAdmin = vi.hoisted(() => vi.fn());
const mockLivello = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockAdmin }));
vi.mock("@/lib/auth/portale", () => ({ getPortaleAccesso: mockLivello, hasMinLivello: () => true }));
vi.mock("@/lib/portali/preventivatore/chat/config-cache", () => ({ invalidateAiConfigCache: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { PATCH } from "@/app/api/portali/preventivatore/config/route";

const richiesta = (body: unknown) => new NextRequest("http://localhost/api", {
  method: "PATCH",
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

describe("PATCH configurazione preventivatore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "utente" } } }) } });
    mockLivello.mockResolvedValue("admin");
    mockUpsert.mockResolvedValue({ error: null });
    mockAdmin.mockReturnValue({ schema: () => ({ from: () => ({ upsert: mockUpsert }) }) });
  });

  it("salva le due impostazioni della ricerca simili", async () => {
    const res = await PATCH(richiesta({ soglia_similarity_simili: "0.4", match_count_simili: "8" }));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith([
      { chiave: "soglia_similarity_simili", valore: "0.4" },
      { chiave: "match_count_simili", valore: "8" },
    ], { onConflict: "chiave" });
  });

  it("rifiuta tutte le chiavi sconosciute e ne restituisce l'elenco", async () => {
    const res = await PATCH(richiesta({ company_knowledge: "ok", inventata: true, altra: 1 }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ chiavi_sconosciute: ["inventata", "altra"] });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
