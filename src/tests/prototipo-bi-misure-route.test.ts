/**
 * Le route delle misure personalizzate: chi puo' fare cosa, e cosa succede
 * quando il corpo non e' valido, il nome e' gia' preso o l'assistente non c'e'.
 *
 * Il catalogo e il modello sono finti; il validatore e' quello vero, perche' e'
 * lui che deve rifiutare cio' che arriva dal browser anche se l'ha proposto
 * l'AI.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { validaMisura } from "@/lib/prototipo-bi/misure";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";

const preliminari = vi.fn();
const elencaMisure = vi.fn();
const leggiMisura = vi.fn();
const salvaMisura = vi.fn();
const archiviaMisura = vi.fn();
const proponiMisura = vi.fn();

// Hoisted: la factory di vi.mock gira prima del resto del file.
const { NomeGiaUsatoFinto } = vi.hoisted(() => ({ NomeGiaUsatoFinto: class extends Error {} }));

vi.mock("@/app/api/bi/_comune", () => ({
  preliminari: (...a: unknown[]) => preliminari(...a),
  snapshotPerimetrato: async () => SNAPSHOT,
  errore: (messaggio: string, status = 400) => NextResponse.json({ error: messaggio }, { status }),
  negato: (messaggio: string) => NextResponse.json({ error: messaggio }, { status: 403 }),
}));
vi.mock("@/lib/prototipo-bi/misure-catalogo", () => ({
  NomeGiaUsato: NomeGiaUsatoFinto,
  elencaMisure: (...a: unknown[]) => elencaMisure(...a),
  leggiMisura: (...a: unknown[]) => leggiMisura(...a),
  salvaMisura: (...a: unknown[]) => salvaMisura(...a),
  archiviaMisura: (...a: unknown[]) => archiviaMisura(...a),
}));
vi.mock("@/lib/prototipo-bi/registro", () => ({ registraAccesso: vi.fn(async () => undefined) }));
vi.mock("@/lib/prototipo-bi/analista", () => ({ chiamaModello: vi.fn() }));
vi.mock("@/lib/prototipo-bi/proposta-misura", async (originale) => {
  const reale = await originale<typeof import("@/lib/prototipo-bi/proposta-misura")>();
  return { ...reale, proponiMisura: (...a: unknown[]) => proponiMisura(...a) };
});

import { GET, POST } from "@/app/api/bi/misure/route";
import { DELETE } from "@/app/api/bi/misure/[id]/route";
import { POST as PROPONI } from "@/app/api/bi/misure/proponi/route";
import { PropostaFallita } from "@/lib/prototipo-bi/proposta-misura";
import { SpecNonValida } from "@/lib/prototipo-bi/semantico";

const SNAPSHOT: Snapshot = {
  generatoIl: "2026-10-09T08:00:00.000Z",
  runCorrente: "run-test",
  runRicevutoIl: "2026-10-09T07:00:00.000Z",
  dataMinima: "2025-01-01",
  dataMassima: "2026-09-30",
  dataset: {
    ordinato: [],
    fatturato: [
      {
        data: "2026-03-10",
        importo: 1000,
        bu: "COMPONENTI",
        categoria: "",
        agente: "Anna",
        codiceAgente: "AA",
        cliente: "Alfa",
        codiceCliente: "alfa",
        documento: "F1",
        articolo: "A1",
        descrizioneArticolo: "Articolo",
        quantita: 1,
        costoUnitario: 600,
      },
    ],
    consegnato: [],
    portafoglio: [],
    preventivi_aperti: [],
    controllo_banco: [],
    consegnato_futuro_per_mese: [],
  },
  conteggi: { fatturato: 1 },
};

const ID = "11111111-1111-4111-8111-111111111111";
const ID_ALTRO = "22222222-2222-4222-8222-222222222222";

function accesso(over: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    livello: "responsabile",
    perimetro: { tipo: "tutto" },
    soloAssegnate: false,
    gestisceDashboard: false,
    ...over,
  };
}

function comeUtente(over: Record<string, unknown> = {}) {
  preliminari.mockResolvedValue({ ok: true, accesso: accesso(over) });
}

const MISURA = {
  nome: "Margine componenti sul fatturato",
  espressione: {
    tipo: "rapporto",
    numeratore: { metrica: "margine", filtri: [{ campo: "bu", op: "eq", valore: "componenti" }] },
    denominatore: { metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "componenti" }] },
  },
};

const richiesta = (corpo: unknown, metodo = "POST", url = "http://localhost/api/bi/misure") =>
  new NextRequest(url, {
    method: metodo,
    headers: { "content-type": "application/json" },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });

const contesto = (id: string) => ({ params: Promise.resolve({ id }) });

function salvataFinta(autoreId = "u1") {
  return {
    id: ID,
    nome: MISURA.nome,
    descrizione: "…",
    versione: 1,
    sostituisceId: null,
    autoreId,
    autoreNome: "Anna Rossi",
    creatoIl: "2026-10-09T08:00:00.000Z",
    archiviata: false,
    misura: validaMisura({ id: ID, versione: 1, nome: MISURA.nome, espressione: MISURA.espressione }),
  };
}

beforeEach(() => {
  for (const f of [preliminari, elencaMisure, leggiMisura, salvaMisura, archiviaMisura, proponiMisura]) f.mockReset();
  comeUtente();
});

describe("GET /api/bi/misure", () => {
  it("un operativo non vede il catalogo: 403", async () => {
    comeUtente({ soloAssegnate: true, livello: "operativo" });
    const r = await GET();
    expect(r.status).toBe(403);
    expect(elencaMisure).not.toHaveBeenCalled();
  });

  it("restituisce le misure e dice a chi appartiene la sessione e se puo' gestirle tutte", async () => {
    comeUtente({ gestisceDashboard: true });
    elencaMisure.mockResolvedValue([salvataFinta()]);
    const r = await GET();
    const corpo = await r.json();
    expect(r.status).toBe(200);
    expect(corpo.misure).toHaveLength(1);
    expect(corpo.utenteId).toBe("u1");
    expect(corpo.puoGestireTutte).toBe(true);
  });

  it("se il database non risponde: 500 con un messaggio, non lo stack", async () => {
    elencaMisure.mockRejectedValue(new Error("connessione rifiutata a 10.0.0.5"));
    const r = await GET();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("10.0.0.5");
  });
});

describe("POST /api/bi/misure", () => {
  it("un operativo non crea misure: 403, e non si tocca il catalogo", async () => {
    comeUtente({ soloAssegnate: true, livello: "operativo" });
    const r = await POST(richiesta({ misura: MISURA }));
    expect(r.status).toBe(403);
    expect(salvaMisura).not.toHaveBeenCalled();
  });

  it("salva una misura valida, con la grafia dei filtri riportata a quella del dato", async () => {
    salvaMisura.mockImplementation(async ({ misura }) => ({ ...salvataFinta(), misura }));
    const r = await POST(richiesta({ misura: MISURA }));
    expect(r.status).toBe(201);
    const chiamata = salvaMisura.mock.calls[0][0] as { misura: { espressione: { numeratore: { filtri: Array<{ valore: string }> } } }; autoreId: string; sostituisce?: unknown };
    // «componenti» minuscolo -> «COMPONENTI» come sta nel dato.
    expect(chiamata.misura.espressione.numeratore.filtri[0].valore).toBe("COMPONENTI");
    expect(chiamata.autoreId).toBe("u1");
    expect(chiamata.sostituisce).toBeUndefined();
  });

  it("rifiuta con 422 una definizione non valida, col motivo, anche se «viene dall'AI»", async () => {
    const r = await POST(richiesta({ misura: { nome: "Misura finta", espressione: { tipo: "formula", testo: "fatturato*2" } } }));
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain("non ammesso");
    expect(salvaMisura).not.toHaveBeenCalled();
  });

  it("rifiuta un valore di filtro che non esiste nei dati", async () => {
    const r = await POST(
      richiesta({
        misura: { nome: "Fatturato astronavi", espressione: { tipo: "metrica", metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "ASTRONAVI" }] } },
      })
    );
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain("non esiste nella dimensione");
  });

  it("corpo non JSON: 400; misura mancante: 400", async () => {
    expect((await POST(richiesta("{non json"))).status).toBe(400);
    expect((await POST(richiesta({}))).status).toBe(400);
    expect((await POST(richiesta({ misura: "una stringa" }))).status).toBe(400);
  });

  it("un nome gia' usato fra le misure attive e' un 409", async () => {
    salvaMisura.mockRejectedValue(new NomeGiaUsatoFinto("Esiste già una misura con questo nome."));
    const r = await POST(richiesta({ misura: MISURA }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("Esiste già");
  });

  it("sostituire una misura altrui senza essere direzione: 403, e non si archivia niente", async () => {
    leggiMisura.mockResolvedValue({ ...salvataFinta("altro-utente"), id: ID_ALTRO });
    const r = await POST(richiesta({ misura: MISURA, sostituisceId: ID_ALTRO }));
    expect(r.status).toBe(403);
    expect(salvaMisura).not.toHaveBeenCalled();
  });

  it("la direzione puo' sostituire anche una misura altrui, e la nuova e' la versione successiva", async () => {
    comeUtente({ gestisceDashboard: true });
    leggiMisura.mockResolvedValue({ ...salvataFinta("altro-utente"), versione: 3 });
    salvaMisura.mockImplementation(async ({ misura }) => ({ ...salvataFinta(), versione: 4, misura }));
    const r = await POST(richiesta({ misura: MISURA, sostituisceId: ID }));
    expect(r.status).toBe(201);
    expect((salvaMisura.mock.calls[0][0] as { sostituisce: unknown }).sostituisce).toEqual({ id: ID, versione: 3 });
  });

  it("sostituire una misura inesistente o gia' archiviata: 404; un id malformato: 400", async () => {
    leggiMisura.mockResolvedValue(null);
    expect((await POST(richiesta({ misura: MISURA, sostituisceId: ID }))).status).toBe(404);
    leggiMisura.mockResolvedValue({ ...salvataFinta(), archiviata: true });
    expect((await POST(richiesta({ misura: MISURA, sostituisceId: ID }))).status).toBe(404);
    expect((await POST(richiesta({ misura: MISURA, sostituisceId: "non-un-uuid" }))).status).toBe(400);
  });
});

describe("DELETE /api/bi/misure/[id]", () => {
  it("l'autore archivia la propria misura", async () => {
    leggiMisura.mockResolvedValue(salvataFinta("u1"));
    const r = await DELETE(richiesta(null, "DELETE"), contesto(ID));
    expect(r.status).toBe(200);
    expect(archiviaMisura).toHaveBeenCalledWith(ID);
  });

  it("un altro responsabile no: 403; la direzione si'", async () => {
    leggiMisura.mockResolvedValue(salvataFinta("altro-utente"));
    expect((await DELETE(richiesta(null, "DELETE"), contesto(ID))).status).toBe(403);
    expect(archiviaMisura).not.toHaveBeenCalled();

    comeUtente({ gestisceDashboard: true });
    expect((await DELETE(richiesta(null, "DELETE"), contesto(ID))).status).toBe(200);
    expect(archiviaMisura).toHaveBeenCalledTimes(1);
  });

  it("un operativo: 403; id malformato: 400; misura inesistente o gia' archiviata: 404", async () => {
    comeUtente({ soloAssegnate: true });
    expect((await DELETE(richiesta(null, "DELETE"), contesto(ID))).status).toBe(403);

    comeUtente();
    expect((await DELETE(richiesta(null, "DELETE"), contesto("1; drop table misure"))).status).toBe(400);

    leggiMisura.mockResolvedValue(null);
    expect((await DELETE(richiesta(null, "DELETE"), contesto(ID))).status).toBe(404);
    leggiMisura.mockResolvedValue({ ...salvataFinta(), archiviata: true });
    expect((await DELETE(richiesta(null, "DELETE"), contesto(ID))).status).toBe(404);
  });
});

describe("POST /api/bi/misure/proponi", () => {
  const url = "http://localhost/api/bi/misure/proponi";

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "chiave-di-prova";
  });

  it("un operativo: 403, e il modello non viene chiamato", async () => {
    comeUtente({ soloAssegnate: true });
    const r = await PROPONI(richiesta({ testo: "margine dei componenti" }, "POST", url));
    expect(r.status).toBe(403);
    expect(proponiMisura).not.toHaveBeenCalled();
  });

  it("senza chiave dell'AI: 503 con una spiegazione, non un errore generico", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const r = await PROPONI(richiesta({ testo: "margine dei componenti" }, "POST", url));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain("non è disponibile");
  });

  it("passa il testo, lo snapshot perimetrato e la chiave del perimetro; restituisce la proposta", async () => {
    comeUtente({ userId: "u-proposta-ok", perimetro: { tipo: "agente", codici: ["AA"] } });
    proponiMisura.mockResolvedValue({ tipo: "misura", modelli: ["Haiku 5.5"] });
    const r = await PROPONI(richiesta({ testo: "margine dei componenti" }, "POST", url));
    expect(r.status).toBe(200);
    expect((await r.json()).tipo).toBe("misura");
    const arg = proponiMisura.mock.calls[0][0] as { testo: string; snapshot: Snapshot; chiavePerimetro: string };
    expect(arg.testo).toBe("margine dei componenti");
    expect(arg.snapshot).toBe(SNAPSHOT);
    // Il perimetro entra nella chiave: due perimetri non condividono la proposta.
    expect(arg.chiavePerimetro).toContain("AA");
  });

  it("una richiesta troppo breve (SpecNonValida) e' un 422 col messaggio", async () => {
    comeUtente({ userId: "u-breve" });
    proponiMisura.mockRejectedValue(new SpecNonValida("Descrivi la misura con qualche parola in più."));
    const r = await PROPONI(richiesta({ testo: "x" }, "POST", url));
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain("qualche parola in più");
  });

  it("se l'assistente non riesce: 422 col consumo gia' speso, per saperlo", async () => {
    comeUtente({ userId: "u-fallita" });
    proponiMisura.mockRejectedValue(
      new PropostaFallita("Non sono riuscito a tradurre la richiesta.", { tokenIngresso: 6000, tokenUscita: 600, costoUsd: 0.002 }, ["Haiku 5.5", "GPT-6 Sol"])
    );
    const r = await PROPONI(richiesta({ testo: "qualcosa di impossibile" }, "POST", url));
    const corpo = await r.json();
    expect(r.status).toBe(422);
    expect(corpo.consumo.tokenIngresso).toBe(6000);
    expect(corpo.modelli).toEqual(["Haiku 5.5", "GPT-6 Sol"]);
  });

  it("un guasto del modello e' un 502 senza dettagli interni", async () => {
    comeUtente({ userId: "u-guasto" });
    proponiMisura.mockRejectedValue(new Error("OpenRouter 500: {segreto}"));
    const r = await PROPONI(richiesta({ testo: "margine dei componenti" }, "POST", url));
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain("segreto");
  });

  it("dopo venti proposte in un'ora la ventunesima e' un 429, e non costa una chiamata", async () => {
    comeUtente({ userId: "u-molte-proposte" });
    proponiMisura.mockResolvedValue({ tipo: "misura", modelli: [] });
    for (let i = 0; i < 20; i += 1) {
      expect((await PROPONI(richiesta({ testo: "margine dei componenti" }, "POST", url))).status).toBe(200);
    }
    const r = await PROPONI(richiesta({ testo: "margine dei componenti" }, "POST", url));
    expect(r.status).toBe(429);
    expect(proponiMisura).toHaveBeenCalledTimes(20);
  });

  it("il limite e' per persona: un altro utente non e' bloccato", async () => {
    proponiMisura.mockResolvedValue({ tipo: "misura", modelli: [] });
    comeUtente({ userId: "u-molte-proposte" });
    expect((await PROPONI(richiesta({ testo: "margine dei componenti" }, "POST", url))).status).toBe(429);
    comeUtente({ userId: "u-un-altro" });
    expect((await PROPONI(richiesta({ testo: "margine dei componenti" }, "POST", url))).status).toBe(200);
  });
});
