import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCreateAdminClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "superadmin-1" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { GET } from "@/app/api/superadmin/preventivatore/permessi-utente/[utenteId]/route";

const UTENTE_ID = "11111111-1111-4111-8111-111111111111";
type Esito = { data: unknown; error: { message: string } | null };

function preparaAdmin(ruoliRes: Esito, utenteRes: Esito) {
  mockCreateAdminClient.mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn((colonne: string) => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue(
            colonne === "ruolo"
              ? { data: { ruolo: "superadmin" }, error: null }
              : utenteRes,
          ),
        })),
      })),
    })),
    schema: vi.fn(() => ({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue(ruoliRes),
        })),
      })),
    })),
  });
}

function richiesta() {
  return GET(new NextRequest("http://localhost/api"), { params: Promise.resolve({ utenteId: UTENTE_ID }) });
}

describe("GET permessi preventivatore utente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fallisce se la query dei ruoli fallisce", async () => {
    preparaAdmin(
      { data: null, error: { message: "ruoli non disponibili" } },
      { data: { preventivatore_agente_codice: "AG1" }, error: null },
    );

    const res = await richiesta();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "Errore recupero permessi utente" });
  });

  it("fallisce se la query dell'utente fallisce", async () => {
    preparaAdmin(
      { data: [{ ruolo: { slug: "commerciale" } }], error: null },
      { data: null, error: { message: "utente non disponibile" } },
    );

    const res = await richiesta();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "Errore recupero permessi utente" });
  });

  it("restituisce ruoli e codice agente solo quando entrambe le query riescono", async () => {
    preparaAdmin(
      { data: [{ ruolo: { slug: "commerciale" } }, { ruolo: { slug: "preventivatore" } }], error: null },
      { data: { preventivatore_agente_codice: "AG010035" }, error: null },
    );

    const res = await richiesta();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ruoli_slug: ["commerciale", "preventivatore"],
      agente_codice: "AG010035",
    });
  });
});
