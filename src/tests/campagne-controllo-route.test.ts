import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const requireCampagne = vi.fn();
const eseguiControlloCompleto = vi.fn();
const leggiUltimiControlli = vi.fn();

vi.mock("@/lib/portali/campagne/api-guard", () => ({ requireCampagne: (...a: unknown[]) => requireCampagne(...a) }));
vi.mock("@/lib/portali/campagne/controllo-dati", () => ({
  eseguiControlloCompleto: (...a: unknown[]) => eseguiControlloCompleto(...a),
  leggiUltimiControlli: (...a: unknown[]) => leggiUltimiControlli(...a),
  applicaScambio: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { GET, POST } from "@/app/api/portali/campagne/controllo/route";

const TOKEN = "un-token-lungo-abbastanza-per-il-controllo-notturno";
const richiesta = (intestazioni: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/portali/campagne/controllo", { method: "POST", headers: intestazioni });

describe("POST /api/portali/campagne/controllo", () => {
  beforeEach(() => {
    requireCampagne.mockReset();
    eseguiControlloCompleto.mockReset();
    eseguiControlloCompleto.mockResolvedValue({ controllo_id: "c1", invii_controllati: 3 });
    delete process.env.CAMPAGNE_CONTROLLO_TOKEN;
  });

  it("con il token giusto parte come controllo notturno, senza utente e senza guardare la sessione", async () => {
    process.env.CAMPAGNE_CONTROLLO_TOKEN = TOKEN;
    const r = await POST(richiesta({ authorization: `Bearer ${TOKEN}` }));
    expect(r.status).toBe(200);
    expect(eseguiControlloCompleto).toHaveBeenCalledWith({ origine: "notturno", utenteId: null });
    expect(requireCampagne).not.toHaveBeenCalled();
  });

  it("con un token sbagliato: 401 e non parte niente", async () => {
    process.env.CAMPAGNE_CONTROLLO_TOKEN = TOKEN;
    const r = await POST(richiesta({ authorization: "Bearer sbagliato-sbagliato-sbagliato-sbagliato" }));
    expect(r.status).toBe(401);
    expect(eseguiControlloCompleto).not.toHaveBeenCalled();
  });

  it("se il token non è configurato sul server: 503, mai un'apertura", async () => {
    const r = await POST(richiesta({ authorization: `Bearer ${TOKEN}` }));
    expect(r.status).toBe(503);
    expect(eseguiControlloCompleto).not.toHaveBeenCalled();
  });

  it("un token configurato ma troppo corto non autorizza nemmeno chi lo conosce", async () => {
    process.env.CAMPAGNE_CONTROLLO_TOKEN = "corto";
    const r = await POST(richiesta({ authorization: "Bearer corto" }));
    expect(r.status).toBe(401);
    expect(eseguiControlloCompleto).not.toHaveBeenCalled();
  });

  it("senza intestazione si passa dalla guard: un viewer senza ruolo prende 403", async () => {
    requireCampagne.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "no" }, { status: 403 }) });
    const r = await POST(richiesta());
    expect(r.status).toBe(403);
    expect(requireCampagne).toHaveBeenCalledWith({ chi: "operatore" });
    expect(eseguiControlloCompleto).not.toHaveBeenCalled();
  });

  it("un back office parte come controllo manuale, con il suo utente", async () => {
    requireCampagne.mockResolvedValue({ ok: true, user: { id: "u7" }, ctx: { livello: "viewer", ruoli: ["backoffice"] } });
    const r = await POST(richiesta());
    expect(r.status).toBe(200);
    expect(eseguiControlloCompleto).toHaveBeenCalledWith({ origine: "manuale", utenteId: "u7" });
  });

  it("l'errore di dominio (controllo già in corso) esce con il suo stato e messaggio", async () => {
    const { ErroreCampagne } = await import("@/lib/portali/campagne/dati");
    requireCampagne.mockResolvedValue({ ok: true, user: { id: "u7" }, ctx: { livello: "admin", ruoli: [] } });
    eseguiControlloCompleto.mockRejectedValue(new ErroreCampagne(409, "Un controllo è già in corso"));
    const r = await POST(richiesta());
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("già in corso");
  });

  it("un errore imprevisto è un 500 generico che non rivela il dettaglio", async () => {
    requireCampagne.mockResolvedValue({ ok: true, user: { id: "u7" }, ctx: { livello: "admin", ruoli: [] } });
    eseguiControlloCompleto.mockRejectedValue(new Error('relation "public.bi_runs" does not exist'));
    const r = await POST(richiesta());
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("bi_runs");
  });
});

describe("GET /api/portali/campagne/controllo", () => {
  it("elenca gli ultimi controlli a chi può operare", async () => {
    requireCampagne.mockResolvedValue({ ok: true, user: { id: "u" }, ctx: { livello: "viewer", ruoli: ["backoffice"] } });
    leggiUltimiControlli.mockResolvedValue([{ id: "c1" }]);
    const r = await GET();
    expect((await r.json()).controlli).toEqual([{ id: "c1" }]);
  });
});
