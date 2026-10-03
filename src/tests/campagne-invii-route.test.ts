import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireCampagne = vi.fn();
const elencoInvii = vi.fn();

vi.mock("@/lib/portali/campagne/api-guard", () => ({ requireCampagne: (...a: unknown[]) => requireCampagne(...a) }));
vi.mock("@/lib/portali/campagne/dati", async (importOriginal) => {
  const reale = await importOriginal<typeof import("@/lib/portali/campagne/dati")>();
  return { ...reale, elencoInvii: (...a: unknown[]) => elencoInvii(...a), creaInvio: vi.fn() };
});
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { GET } from "@/app/api/portali/campagne/invii/route";

const A = "3f2b8c1e-5d4a-4e6b-9a7c-1d2e3f4a5b6c";
const B = "4a3c9d2f-6e5b-4f7c-8b8d-2e3f4a5b6c7d";
const chiama = (query: string) => GET(new NextRequest(`http://localhost/api/portali/campagne/invii${query}`));

describe("GET /api/portali/campagne/invii con più campagne", () => {
  beforeEach(() => {
    requireCampagne.mockReset();
    elencoInvii.mockReset();
    requireCampagne.mockResolvedValue({ ok: true, user: { id: "u" }, ctx: { livello: "viewer", ruoli: ["backoffice"] } });
    elencoInvii.mockResolvedValue({ invii: [], totale: 0 });
  });

  it("le campagne ripetute nell'indirizzo arrivano tutte alla query, non solo l'ultima", async () => {
    const r = await chiama(`?campagna_id=${A}&campagna_id=${B}&stato=consegnata`);
    expect(r.status).toBe(200);
    expect(elencoInvii.mock.calls[0][0]).toMatchObject({ campagna_id: [A, B], stato: "consegnata" });
  });

  it("una sola campagna funziona come prima, nessuna = nessun filtro", async () => {
    await chiama(`?campagna_id=${A}`);
    expect(elencoInvii.mock.calls[0][0].campagna_id).toEqual([A]);
    await chiama("");
    expect(elencoInvii.mock.calls[1][0].campagna_id ?? []).toEqual([]);
  });

  it("una campagna che non è un uuid dà 400 e non interroga il database", async () => {
    const r = await chiama("?campagna_id=C_01_26");
    expect(r.status).toBe(400);
    expect(elencoInvii).not.toHaveBeenCalled();
  });

  it("senza ruolo la guard ferma la richiesta prima di tutto", async () => {
    const { NextResponse } = await import("next/server");
    requireCampagne.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "no" }, { status: 403 }) });
    expect((await chiama(`?campagna_id=${A}`)).status).toBe(403);
    expect(elencoInvii).not.toHaveBeenCalled();
  });
});
