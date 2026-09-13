/** Verifica il contratto batch e la retrocompatibilità delle analisi composite. */

import { describe, expect, it, vi } from "vitest";
import {
  eseguiAnalisiComposita,
  validaSerieAnalisi,
  ammetteConfrontoBudget,
  motivoBudgetNonDisponibile,
} from "@/lib/prototipo-bi/analisi-composita";
import type { RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

function risultato(spec: SpecQuery): RisultatoQuery {
  return {
    spec,
    metrica: spec.metrica,
    unita: "euro",
    righe: [{ etichetta: "Totale", chiavi: {}, valore: 100, conteggio: 1 }],
    totale: 100,
    certificata: true,
    avvisi: [],
  };
}

function fetcherBatch() {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body)) as {
      specs: Array<{ id: string; spec: SpecQuery }>;
    };
    return new Response(JSON.stringify({
      risultati: corpo.specs.map((voce) => ({ id: voce.id, risultato: risultato(voce.spec) })),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

describe("analisi composita", () => {
  it("esegue principale e confronto con una sola chiamata batch", async () => {
    const fetcher = fetcherBatch();
    const esito = await eseguiAnalisiComposita(
      {
        spec: { metrica: "ordinato" },
        serie: [
          { ruolo: "principale", nome: "2026", spec: { metrica: "ordinato" } },
          { ruolo: "confronto", nome: "2025", spec: { metrica: "ordinato", modificatore: "anno_precedente" } },
        ],
      },
      {},
      { fetcher }
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    const richiesta = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { specs: unknown[] };
    expect(richiesta.specs).toHaveLength(2);
    expect(esito.risultati.principale?.["2026"]?.totale).toBe(100);
    expect(esito.risultati.confronto?.["2025"]?.totale).toBe(100);
  });

  it("applica i filtri di pagina a tutte le serie", async () => {
    const fetcher = fetcherBatch();
    await eseguiAnalisiComposita(
      {
        spec: { metrica: "ordinato" },
        serie: [
          { ruolo: "principale", nome: "Ordinato", spec: { metrica: "ordinato" } },
          { ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget" } },
        ],
      },
      { periodo: { anno: 2026 }, bu: "COMPONENTI" },
      { fetcher }
    );

    const richiesta = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      specs: Array<{ spec: SpecQuery }>;
    };
    expect(richiesta.specs).toHaveLength(2);
    for (const voce of richiesta.specs) {
      expect(voce.spec.periodo).toEqual({ anno: 2026 });
      expect(voce.spec.filtri).toContainEqual({ campo: "bu", op: "eq", valore: "COMPONENTI" });
    }
  });

  it("rifiuta un'analisi senza serie principale", () => {
    expect(() => validaSerieAnalisi([
      { ruolo: "confronto", nome: "2025", spec: { metrica: "ordinato" } },
    ])).toThrow(/serie principale/u);
  });

  it("continua a eseguire serie null come analisi semplice", async () => {
    const fetcher = fetcherBatch();
    const esito = await eseguiAnalisiComposita(
      { spec: { metrica: "fatturato" }, serie: null },
      {},
      { fetcher }
    );

    expect(esito.serie).toHaveLength(1);
    expect(esito.serie[0]).toMatchObject({ ruolo: "principale", nome: "fatturato" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Budget e BEP solo dove il budget esiste davvero", () => {
  it("ammette il confronto su business unit e agente", () => {
    expect(ammetteConfrontoBudget({ metrica: "ordinato" })).toBe(true);
    expect(ammetteConfrontoBudget({ metrica: "ordinato", raggruppa: ["bu"] })).toBe(true);
    expect(ammetteConfrontoBudget({ metrica: "ordinato", raggruppa: ["agente"] })).toBe(true);
  });

  it("lo nega per cliente, articolo e le altre dimensioni", () => {
    // La serie budget viene dagli Excel e contiene solo area e agente.
    // `budget-fonte.ts` ignora in silenzio gli altri raggruppamenti: il
    // risultato non e' un errore, e' il budget TOTALE su una riga sola.
    // Affiancato a "ordinato per cliente" darebbe venti barre contro una.
    for (const d of ["cliente", "articolo", "categoria", "creatore"] as const) {
      expect(ammetteConfrontoBudget({ metrica: "ordinato", raggruppa: [d] })).toBe(false);
      expect(motivoBudgetNonDisponibile({ metrica: "ordinato", raggruppa: [d] })).toContain(d);
    }
  });

  it("quando e' ammesso non c'e' nessun motivo da mostrare", () => {
    expect(motivoBudgetNonDisponibile({ metrica: "ordinato", raggruppa: ["bu"] })).toBeNull();
  });
});
