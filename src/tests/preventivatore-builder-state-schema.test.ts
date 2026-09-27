import { describe, expect, it } from "vitest";
import { builderStateSchema } from "@/lib/portali/preventivatore/chat/builder-state-schema";
import {
  buildBuilderState,
  creaBlocco,
  type ArticoloBlocco,
  type Cliente,
  type ServizioBlocco,
} from "@/components/portali/preventivatore/nuovo-view-types";

// Lo stato che il builder manda davvero a chat e scheda tecnica deve passare lo
// schema della route: con lo schema rigido del 27/09 una sola lavorazione
// (`coeff_ricarico`, niente `markup_pct`) faceva rispondere 400 alla chat.

function statoReale() {
  const blocco = creaBlocco();
  blocco.nome = "Nastro FS65";
  blocco.tipo = "nastro";
  blocco.articoli = [
    { ...({} as ArticoloBlocco), _key: "a1", prodotto_id: "p1", codice: "FSIE-A65", descrizione: "TESTATA FOLLE", ult_costo: 180, qty: 1, coeff_ricarico: 0.7 },
    // Coefficiente a zero: il netto calcolato vale Infinity/NaN.
    { ...({} as ArticoloBlocco), _key: "a2", prodotto_id: "p2", codice: "X", descrizione: "voce senza ricarico", ult_costo: 10, qty: 1, coeff_ricarico: 0 },
  ];
  blocco.servizi = [
    { ...({} as ServizioBlocco), _key: "s1", servizio_id: "s1", nome: "Montaggio", categoria: "officina", tariffa_ora: 38, ore: 6, coeff_ricarico: 0.7, scala_con_quantita: true },
  ];
  const cliente: Cliente = { id: "11111111-1111-4111-8111-111111111111", ragione_sociale: "Cliente", piva: null, citta: null, provincia: null };
  return buildBuilderState({ titolo: "Prova", cliente, dataConsegna: "", blocchi: [blocco] });
}

describe("builderStateSchema", () => {
  it("accetta lo stato prodotto da buildBuilderState, anche con lavorazioni e totali non finiti", () => {
    const esito = builderStateSchema.safeParse(statoReale());
    expect(esito.success).toBe(true);
    if (esito.success) {
      expect(esito.data.blocchi[0].lavorazioni[0]).toMatchObject({ nome: "Montaggio", coeff_ricarico: 0.7 });
      expect(esito.data.cliente?.id).toBe("11111111-1111-4111-8111-111111111111");
    }
  });

  it("taglia i testi fuori misura invece di rifiutare la richiesta", () => {
    const stato = statoReale();
    stato.blocchi[0].note = "x".repeat(25_000);
    const esito = builderStateSchema.safeParse(stato);
    expect(esito.success).toBe(true);
    if (esito.success) expect(esito.data.blocchi[0].note).toBe("");
  });

  it("rifiuta troppi blocchi (il limite di dimensione resta)", () => {
    const stato = statoReale();
    stato.blocchi = Array.from({ length: 501 }, () => stato.blocchi[0]);
    expect(builderStateSchema.safeParse(stato).success).toBe(false);
  });
});
