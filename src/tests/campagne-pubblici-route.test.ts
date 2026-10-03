import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { ErroreCampagne } from "@/lib/portali/campagne/dati";

const requireCampagne = vi.fn();
const elencoPubblici = vi.fn();
const creaPubblico = vi.fn();
const leggiPubblico = vi.fn();
const salvaPubblico = vi.fn();
const eliminaPubblico = vi.fn();
const elencoInvii = vi.fn();
const aggiornaCampagna = vi.fn();
const pubblicoMancanti = vi.fn();

vi.mock("@/lib/portali/campagne/api-guard", () => ({ requireCampagne: (...a: unknown[]) => requireCampagne(...a) }));
vi.mock("@/lib/portali/campagne/dati", async (importOriginal) => {
  const reale = await importOriginal<typeof import("@/lib/portali/campagne/dati")>();
  return {
    ...reale,
    elencoPubblici: (...a: unknown[]) => elencoPubblici(...a),
    creaPubblico: (...a: unknown[]) => creaPubblico(...a),
    leggiPubblico: (...a: unknown[]) => leggiPubblico(...a),
    salvaPubblico: (...a: unknown[]) => salvaPubblico(...a),
    eliminaPubblico: (...a: unknown[]) => eliminaPubblico(...a),
    elencoInvii: (...a: unknown[]) => elencoInvii(...a),
    aggiornaCampagna: (...a: unknown[]) => aggiornaCampagna(...a),
    pubblicoMancanti: (...a: unknown[]) => pubblicoMancanti(...a),
  };
});
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { GET as invii } from "@/app/api/portali/campagne/invii/route";
import { PATCH as patchCampagna } from "@/app/api/portali/campagne/campagne/[id]/route";
import { DELETE, GET as leggi, PUT } from "@/app/api/portali/campagne/pubblici/[id]/route";
import { GET as elenco, POST } from "@/app/api/portali/campagne/pubblici/route";

const ID = "5b4d0e3a-7f6c-4a8d-9c9e-3f4a5b6c7d8e";
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const ctx = { params: Promise.resolve({ id: ID }) };
const req = (metodo: string, corpo?: unknown, url = "http://localhost/api/portali/campagne/pubblici") =>
  new NextRequest(url, { method: metodo, ...(corpo === undefined ? {} : { body: JSON.stringify(corpo), headers: { "Content-Type": "application/json" } }) });

const regola = { nome: "Standard", agenti: ["AIRFLUID"], categorie_commerciali: ["Attivo"], categorie_attivita: [], clienti_extra: [] };

beforeEach(() => {
  vi.clearAllMocks();
  requireCampagne.mockResolvedValue({ ok: true, user: { id: "admin1" }, ctx: { livello: "admin", ruoli: [] } });
});

describe("route dei pubblici: solo admin", () => {
  const negato = () => requireCampagne.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "no" }, { status: 403 }) });

  it("il back office non vede, non crea, non modifica e non elimina", async () => {
    negato();
    expect((await elenco()).status).toBe(403);
    expect((await POST(req("POST", { nome: "X" }))).status).toBe(403);
    expect((await leggi(req("GET"), ctx)).status).toBe(403);
    expect((await PUT(req("PUT", { ...regola }), ctx)).status).toBe(403);
    expect((await DELETE(req("DELETE"), ctx)).status).toBe(403);
    for (const f of [elencoPubblici, creaPubblico, leggiPubblico, salvaPubblico, eliminaPubblico]) expect(f).not.toHaveBeenCalled();
  });

  it("chiedono il livello admin alla guard", async () => {
    elencoPubblici.mockResolvedValue([]);
    await elenco();
    expect(requireCampagne).toHaveBeenCalledWith({ chi: "admin" });
  });
});

describe("route dei pubblici: richieste", () => {
  it("l'elenco restituisce i pubblici", async () => {
    elencoPubblici.mockResolvedValue([{ id: ID }]);
    expect(await (await elenco()).json()).toEqual({ pubblici: [{ id: ID }] });
  });

  it("crea: risponde 201 e passa l'utente che l'ha creato", async () => {
    creaPubblico.mockResolvedValue({ id: ID });
    const r = await POST(req("POST", { nome: "Mirata", copia_da: ID }));
    expect(r.status).toBe(201);
    expect(creaPubblico).toHaveBeenCalledWith({ nome: "Mirata", copia_da: ID }, "admin1");
  });

  it("crea senza nome: 400 e non scrive", async () => {
    expect((await POST(req("POST", { nome: " " }))).status).toBe(400);
    expect(creaPubblico).not.toHaveBeenCalled();
  });

  it("un id che non è un uuid è un 404, senza toccare il database", async () => {
    const storto = { params: Promise.resolve({ id: "non-un-uuid" }) };
    expect((await leggi(req("GET"), storto)).status).toBe(404);
    expect((await PUT(req("PUT", regola), storto)).status).toBe(404);
    expect((await DELETE(req("DELETE"), storto)).status).toBe(404);
    expect(leggiPubblico).not.toHaveBeenCalled();
  });

  it("salva una regola completa", async () => {
    salvaPubblico.mockResolvedValue({ config: { id: ID } });
    const r = await PUT(req("PUT", regola), ctx);
    expect(r.status).toBe(200);
    expect(salvaPubblico).toHaveBeenCalledWith(ID, regola, "admin1");
  });

  it("una regola senza le categorie di attività viene rifiutata: «non toccare» non esiste piu'", async () => {
    const { categorie_attivita: _c, ...incompleta } = regola;
    expect((await PUT(req("PUT", incompleta), ctx)).status).toBe(400);
    expect(salvaPubblico).not.toHaveBeenCalled();
  });

  it("l'eliminazione rifiutata (standard, o usato da una campagna) arriva come 409 col suo messaggio", async () => {
    eliminaPubblico.mockRejectedValue(new ErroreCampagne(409, "Il pubblico standard non si può eliminare."));
    const r = await DELETE(req("DELETE"), ctx);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/standard/);
  });
});

describe("filtro «seguita da» sugli invii", () => {
  beforeEach(() => elencoInvii.mockResolvedValue({ invii: [], totale: 0 }));

  it("l'utente scelto arriva alla query", async () => {
    await invii(new NextRequest(`http://localhost/api/portali/campagne/invii?utente_id=${U}`));
    expect(elencoInvii.mock.calls[0][0]).toMatchObject({ utente_id: U });
  });

  it("un utente che non è un uuid dà 400", async () => {
    expect((await invii(new NextRequest("http://localhost/api/portali/campagne/invii?utente_id=mario"))).status).toBe(400);
    expect(elencoInvii).not.toHaveBeenCalled();
  });
});

describe("la scheda di una campagna: cambio di pubblico", () => {
  it("il PATCH con il nuovo pubblico risponde anche con quanti clienti mancano", async () => {
    aggiornaCampagna.mockResolvedValue({ id: ID });
    pubblicoMancanti.mockResolvedValue(42);
    const r = await patchCampagna(req("PATCH", { pubblico_id: U }, `http://localhost/api/portali/campagne/campagne/${ID}`), ctx);
    expect(r.status).toBe(200);
    expect(aggiornaCampagna).toHaveBeenCalledWith(ID, { pubblico_id: U }, "admin1");
    expect(await r.json()).toEqual({ campagna: { id: ID }, mancanti: 42 });
  });

  it("un pubblico che non è un uuid è rifiutato", async () => {
    const r = await patchCampagna(req("PATCH", { pubblico_id: "standard" }, `http://localhost/api/portali/campagne/campagne/${ID}`), ctx);
    expect(r.status).toBe(400);
    expect(aggiornaCampagna).not.toHaveBeenCalled();
  });
});
