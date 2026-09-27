import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Cambio di stato dopo la rimozione del workflow (migration 111): solo
// aperta ↔ completato, uno storico si riapre solo come bozza, e due richieste
// concorrenti non si sovrascrivono.

const mockGuard = vi.hoisted(() => vi.fn());
const mockVisibile = vi.hoisted(() => vi.fn());
const mockAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portali/preventivatore/api-guard", () => ({ requirePreventivatore: mockGuard }));
vi.mock("@/lib/portali/preventivatore/documento-visibile", () => ({ requireDocumentoVisibile: mockVisibile }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockAdmin }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { PATCH } from "@/app/api/portali/preventivatore/documenti/[id]/stato/route";

const ID = "22222222-2222-4222-8222-222222222222";

/** `statoLetto` è lo stato letto; `righeAggiornate` simula l'esito dell'update condizionato. */
function admin(statoLetto: string, righeAggiornate: number) {
  const filtriUpdate: Array<[string, unknown]> = [];
  const lettura = { select: () => lettura, eq: () => lettura, maybeSingle: async () => ({ data: { stato: statoLetto }, error: null }) };
  const scrittura = {
    eq: (campo: string, valore: unknown) => { filtriUpdate.push([campo, valore]); return scrittura; },
    select: () => scrittura,
    maybeSingle: async () => ({ data: righeAggiornate > 0 ? { id: ID } : null, error: null }),
  };
  const from = () => ({ ...lettura, update: () => scrittura });
  mockAdmin.mockReturnValue({ schema: () => ({ from }) });
  return filtriUpdate;
}

const patch = (stato: string) =>
  PATCH(new NextRequest("http://localhost/api", { method: "PATCH", body: JSON.stringify({ stato }) }), { params: Promise.resolve({ id: ID }) });

describe("PATCH stato", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVisibile.mockResolvedValue({ ok: true, documento: { id: ID, cliente_master_id: null } });
  });

  it("gli stati del workflow rimosso non sono più un target valido", async () => {
    mockGuard.mockResolvedValue({ ok: true, user: { id: "u" }, ctx: { livello: "superadmin", ruoli: [] } });
    admin("storico", 1);
    for (const stato of ["inviata", "ordinata", "fallita", "presa_in_carico"]) {
      expect((await patch(stato)).status).toBe(400);
    }
  });

  it("uno storico si riapre solo come bozza aperta, e solo da superadmin", async () => {
    mockGuard.mockResolvedValue({ ok: true, user: { id: "u" }, ctx: { livello: "superadmin", ruoli: [] } });
    admin("storico", 1);
    expect((await patch("completato")).status).toBe(400);
    expect((await patch("aperta")).status).toBe(200);

    mockGuard.mockResolvedValue({ ok: true, user: { id: "u" }, ctx: { livello: "admin", ruoli: [] } });
    expect((await patch("aperta")).status).toBe(403);
  });

  it("l'update è condizionato allo stato letto: se nel frattempo è cambiato → 409", async () => {
    mockGuard.mockResolvedValue({ ok: true, user: { id: "u" }, ctx: { livello: "viewer", ruoli: ["preventivatore"] } });
    const filtri = admin("aperta", 0);
    expect((await patch("completato")).status).toBe(409);
    expect(filtri).toContainEqual(["stato", "aperta"]);
  });
});
