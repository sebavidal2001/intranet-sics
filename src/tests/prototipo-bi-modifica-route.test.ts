/**
 * POST /api/bi/riquadro/modifica: lo stato arriva dal browser e non e' fidato,
 * il modello e' finto, il catalogo puo' mancare. Si prova chi puo', cosa si
 * rifiuta e che nulla di interno esca negli errori.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { validaMisura } from "@/lib/prototipo-bi/misure";
import { chiaveMisura } from "@/lib/prototipo-bi/misure-vocabolario";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";

const preliminari = vi.fn();
const elencaMisure = vi.fn();
const proponiModifica = vi.fn();

vi.mock("@/app/api/bi/_comune", () => ({
  preliminari: (...a: unknown[]) => preliminari(...a),
  snapshotPerimetrato: async () => SNAPSHOT,
  errore: (messaggio: string, status = 400) => NextResponse.json({ error: messaggio }, { status }),
  negato: (messaggio: string) => NextResponse.json({ error: messaggio }, { status: 403 }),
}));
vi.mock("@/lib/prototipo-bi/misure-catalogo", () => ({ elencaMisure: (...a: unknown[]) => elencaMisure(...a) }));
vi.mock("@/lib/prototipo-bi/registro", () => ({ registraAccesso: vi.fn(async () => undefined) }));
vi.mock("@/lib/prototipo-bi/analista", () => ({ chiamaModello: vi.fn() }));
vi.mock("@/lib/prototipo-bi/modifica-riquadro-ai", async (originale) => {
  const reale = await originale<typeof import("@/lib/prototipo-bi/modifica-riquadro-ai")>();
  return { ...reale, proponiModifica: (...a: unknown[]) => proponiModifica(...a) };
});

import { POST } from "@/app/api/bi/riquadro/modifica/route";
import { ModificaFallita } from "@/lib/prototipo-bi/modifica-riquadro-ai";
import { SpecNonValida } from "@/lib/prototipo-bi/semantico";

const SNAPSHOT = {
  generatoIl: "2026-10-09T08:00:00.000Z",
  runCorrente: "run-test",
  runRicevutoIl: "2026-10-09T07:00:00.000Z",
  dataset: { ordinato: [], fatturato: [], consegnato: [], portafoglio: [], preventivi_aperti: [], controllo_banco: [], consegnato_futuro_per_mese: [] },
  conteggi: {},
} as unknown as Snapshot;

const URL_ROUTE = "http://localhost/api/bi/riquadro/modifica";

const STATO = {
  titolo: "Ordinato per business unit",
  serie: [
    { ruolo: "principale", nome: "Ordinato", spec: { metrica: "ordinato", raggruppa: ["bu"] } },
    { ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget", raggruppa: ["bu"] } },
  ],
};

function comeUtente(over: Record<string, unknown> = {}) {
  preliminari.mockResolvedValue({
    ok: true,
    accesso: { userId: "u1", livello: "responsabile", perimetro: { tipo: "tutto" }, soloAssegnate: false, gestisceDashboard: false, ...over },
  });
}

const richiesta = (corpo: unknown) =>
  new NextRequest(URL_ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) });

beforeEach(() => {
  for (const f of [preliminari, elencaMisure, proponiModifica]) f.mockReset();
  process.env.OPENROUTER_API_KEY = "chiave-di-prova";
  elencaMisure.mockResolvedValue([]);
  proponiModifica.mockResolvedValue({ tipo: "modifica", modelli: ["Haiku 5.5"] });
  comeUtente({ userId: "u-base" });
});

describe("POST /api/bi/riquadro/modifica", () => {
  it("un operativo: 403, e il modello non viene chiamato", async () => {
    comeUtente({ soloAssegnate: true });
    const r = await POST(richiesta({ testo: "togli il budget", stato: STATO }));
    expect(r.status).toBe(403);
    expect(proponiModifica).not.toHaveBeenCalled();
  });

  it("senza chiave dell'AI: 503 con una spiegazione", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const r = await POST(richiesta({ testo: "togli il budget", stato: STATO }));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain("non è disponibile");
  });

  it("passa il testo, lo stato rivalidato e lo snapshot perimetrato; restituisce l'esito", async () => {
    const r = await POST(richiesta({ testo: "togli il budget", stato: STATO }));
    expect(r.status).toBe(200);
    expect((await r.json()).tipo).toBe("modifica");
    const arg = proponiModifica.mock.calls[0][0] as { testo: string; stato: { serie: Array<{ spec: { metrica: string; modificatore?: string } }> }; snapshot: Snapshot };
    expect(arg.testo).toBe("togli il budget");
    expect(arg.snapshot).toBe(SNAPSHOT);
    // Lo stato e' stato passato dal validatore: la spec e' la forma canonica.
    expect(arg.stato.serie[0].spec.modificatore).toBe("corrente");
  });

  it("corpo non JSON, stato mancante, stato non oggetto: 400", async () => {
    expect((await POST(richiesta("{non json"))).status).toBe(400);
    expect((await POST(richiesta({ testo: "togli il budget" }))).status).toBe(400);
    expect((await POST(richiesta({ testo: "togli il budget", stato: "una stringa" }))).status).toBe(400);
  });

  it("uno stato troppo grande: 413, senza nemmeno interpretarlo", async () => {
    const enorme = { testo: "togli il budget", stato: { ...STATO, titolo: "x".repeat(70_000) } };
    const r = await POST(richiesta(enorme));
    expect(r.status).toBe(413);
    expect(proponiModifica).not.toHaveBeenCalled();
  });

  it("una serie con una metrica inesistente o senza principale: 422 col motivo", async () => {
    const inesistente = await POST(
      richiesta({ testo: "togli il budget", stato: { titolo: "x", serie: [{ ruolo: "principale", nome: "X", spec: { metrica: "utile_netto" } }] } })
    );
    expect(inesistente.status).toBe(422);
    expect((await inesistente.json()).error).toContain("non esiste");

    const senzaPrincipale = await POST(
      richiesta({ testo: "togli il budget", stato: { titolo: "x", serie: [{ ruolo: "confronto", nome: "X", spec: { metrica: "ordinato" } }] } })
    );
    expect(senzaPrincipale.status).toBe(422);
    expect(proponiModifica).not.toHaveBeenCalled();
  });

  it("un tipo di grafico inventato: 400", async () => {
    const r = await POST(richiesta({ testo: "togli il budget", stato: { ...STATO, grafico: "cartoon" } }));
    expect(r.status).toBe(400);
  });

  it("un tipo di grafico valido passa", async () => {
    const r = await POST(richiesta({ testo: "togli il budget", stato: { ...STATO, grafico: "barre" } }));
    expect(r.status).toBe(200);
    expect((proponiModifica.mock.calls[0][0] as { stato: { grafico?: string } }).stato.grafico).toBe("barre");
  });

  it("le misure nominabili sono quelle del catalogo e quelle che il riquadro gia' porta", async () => {
    const dalCatalogo = validaMisura({ id: "11111111-1111-4111-8111-111111111111", nome: "Dal catalogo", espressione: { tipo: "metrica", metrica: "fatturato" } });
    const nelRiquadro = validaMisura({ nome: "Gia' nel riquadro", espressione: { tipo: "metrica", metrica: "margine" } });
    elencaMisure.mockResolvedValue([{ misura: dalCatalogo }, { nonValida: "rotta" }]);
    await POST(
      richiesta({
        testo: "togli il budget",
        stato: { titolo: "x", serie: [{ ruolo: "principale", nome: "Margine", spec: { metrica: "margine", misura: nelRiquadro } }] },
      })
    );
    const definizioni = (proponiModifica.mock.calls[0][0] as { definizioni: Record<string, { nome: string }> }).definizioni;
    expect(Object.keys(definizioni).sort()).toEqual([chiaveMisura(dalCatalogo), chiaveMisura(nelRiquadro)].sort());
  });

  it("se il catalogo non c'e' (migration non applicata) si va avanti senza", async () => {
    elencaMisure.mockRejectedValue(new Error('relation "bi_direzionale.misure" does not exist'));
    const r = await POST(richiesta({ testo: "togli il budget", stato: STATO }));
    expect(r.status).toBe(200);
    expect((proponiModifica.mock.calls[0][0] as { definizioni: object }).definizioni).toEqual({});
  });

  it("una richiesta troppo breve (SpecNonValida) e' un 422 col messaggio", async () => {
    proponiModifica.mockRejectedValue(new SpecNonValida("Descrivi la modifica con qualche parola in più."));
    const r = await POST(richiesta({ testo: "ok", stato: STATO }));
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain("qualche parola in più");
  });

  it("se l'assistente non riesce: 422 col consumo gia' speso", async () => {
    proponiModifica.mockRejectedValue(new ModificaFallita("Non sono riuscito a tradurre la richiesta.", { tokenIngresso: 6000, tokenUscita: 600, costoUsd: 0.002 }, ["Haiku 5.5", "GPT-6 Sol"]));
    const r = await POST(richiesta({ testo: "qualcosa di impossibile", stato: STATO }));
    const corpo = await r.json();
    expect(r.status).toBe(422);
    expect(corpo.consumo.tokenIngresso).toBe(6000);
    expect(corpo.modelli).toEqual(["Haiku 5.5", "GPT-6 Sol"]);
  });

  it("un guasto del modello e' un 502 senza dettagli interni", async () => {
    proponiModifica.mockRejectedValue(new Error("OpenRouter 500: {segreto}"));
    const r = await POST(richiesta({ testo: "togli il budget", stato: STATO }));
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain("segreto");
  });

  it("dopo trenta richieste in un'ora la trentunesima e' un 429, e il limite e' per persona", async () => {
    comeUtente({ userId: "u-molte" });
    for (let i = 0; i < 30; i += 1) {
      expect((await POST(richiesta({ testo: "togli il budget", stato: STATO }))).status).toBe(200);
    }
    expect((await POST(richiesta({ testo: "togli il budget", stato: STATO }))).status).toBe(429);
    expect(proponiModifica).toHaveBeenCalledTimes(30);

    comeUtente({ userId: "u-un-altro" });
    expect((await POST(richiesta({ testo: "togli il budget", stato: STATO }))).status).toBe(200);
  });
});
