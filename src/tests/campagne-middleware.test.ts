import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUser = vi.fn();
const createServerClient = vi.fn(() => ({ auth: { getUser } }));
vi.mock("@supabase/ssr", () => ({ createServerClient: (...a: unknown[]) => (createServerClient as (...x: unknown[]) => unknown)(...a) }));

import { middleware } from "@/middleware";

const ROTTA = "/api/portali/campagne/controllo";
const chiama = (percorso: string, metodo: string, intestazioni: Record<string, string> = {}) =>
  middleware(new NextRequest(`http://localhost${percorso}`, { method: metodo, headers: intestazioni }));

describe("middleware: l'eccezione del controllo notturno delle campagne", () => {
  beforeEach(() => {
    getUser.mockReset();
    createServerClient.mockClear();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });

  it("POST con Bearer passa senza sessione (la route verifica il token da sola)", async () => {
    const r = await chiama(ROTTA, "POST", { authorization: "Bearer qualcosa" });
    expect(r.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("POST senza Bearer e senza sessione: 401", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const r = await chiama(ROTTA, "POST");
    expect(r.status).toBe(401);
  });

  it("GET con Bearer NON passa: l'eccezione vale solo per il POST", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const r = await chiama(ROTTA, "GET", { authorization: "Bearer qualcosa" });
    expect(r.status).toBe(401);
  });

  it("un Authorization che non è Bearer non passa", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const r = await chiama(ROTTA, "POST", { authorization: "Basic abc" });
    expect(r.status).toBe(401);
  });

  it("le altre route delle campagne restano protette anche con Bearer", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    for (const percorso of ["/api/portali/campagne/invii", "/api/portali/campagne/anomalie", "/api/portali/campagne/controllo/altro"]) {
      const r = await chiama(percorso, "POST", { authorization: "Bearer qualcosa" });
      expect(r.status, percorso).toBe(401);
    }
  });
});
