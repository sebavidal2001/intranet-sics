import { describe, expect, it } from "vitest";
import { calcolaCostoAtteso } from "@/lib/portali/vettori/calcolo";
import { calcolaRiaddebito, addebitoCliente, type RigaScaglione } from "@/lib/portali/vettori/riaddebito";
import { CorpoConfermaSimulazione } from "@/lib/portali/vettori/simulazione-conferma";
import { pianificaFusioneCampi, protocolloDaDocumenti } from "@/lib/portali/vettori/bolle";
import type {
  AccordoRiaddebitoCliente,
  EsitoSimulazione,
  ListinoRisolto,
  RigaStorico,
} from "@/lib/portali/vettori/tipi";
import listiniDalDb from "./fixtures/vettori-listini-dal-db.json";

/**
 * Le segnalazioni dell'amministrazione dopo il primo giro di prove
 * (Francesca Odorici, 24/09/2026), una per blocco.
 */

const GLS_ID = "00000000-0000-4000-8000-00000000a001";

interface RigaListinoDb {
  codice: string;
  nome: string;
  zonaCodice: string;
  divisoreVolumetrico: number;
  pesoMinimoTassabile: number;
  arrotondamentoKg: number;
  arrotondamentoDaKg: number;
  adeguamento: number | null;
  carburante: number | null;
  fasce: ListinoRisolto["fasce"];
  supplementi: ListinoRisolto["supplementi"];
}

function listinoGls(): ListinoRisolto {
  const r = (listiniDalDb as unknown as RigaListinoDb[]).find(
    (x) => x.codice === "gls" && x.zonaCodice === "IT"
  );
  if (!r) throw new Error("GLS/IT assente dalla fixture");
  return {
    vettore: {
      id: GLS_ID,
      codice: r.codice,
      nome: r.nome,
      modelloTariffa: "scaglioni",
      divisoreVolumetrico: r.divisoreVolumetrico,
      pesoMinimoTassabile: r.pesoMinimoTassabile,
      arrotondamentoKg: r.arrotondamentoKg,
      arrotondamentoDaKg: r.arrotondamentoDaKg,
    },
    zonaCodice: r.zonaCodice,
    fasce: r.fasce,
    supplementi: r.supplementi,
    adeguamento: r.adeguamento,
    carburante: r.carburante,
  };
}

const SCAGLIONI_2026: RigaScaglione[] = [
  { valido_dal: "2026-01-01", valido_al: null, base_peso: "tassabile", peso_da: "0", peso_a: "10", importo: "16.5", nota: null },
  { valido_dal: "2026-01-01", valido_al: null, base_peso: "tassabile", peso_da: "10", peso_a: "30", importo: "22.5", nota: null },
  { valido_dal: "2026-01-01", valido_al: null, base_peso: "tassabile", peso_da: "30", peso_a: "50", importo: "31", nota: null },
  { valido_dal: "2026-01-01", valido_al: null, base_peso: "tassabile", peso_da: "50", peso_a: "100", importo: "49", nota: null },
  { valido_dal: "2026-01-01", valido_al: null, base_peso: "tassabile", peso_da: "100", peso_a: null, importo: null, nota: "Oltre i 100 kg chiedere offerta." },
];

describe("simulazione: la conferma non risponde piu' «Dati non validi»", () => {
  it("accetta l'esito cosi' come lo restituisce /simula, compreso l'id del listino", () => {
    const calcolo = calcolaCostoAtteso(
      { colli: 1, pesoReale: 12, misureColli: [{ quantita: 1, lunghezzaCm: 40, larghezzaCm: 30, altezzaCm: 20 }] },
      listinoGls()
    );
    const versione = {
      validoDal: "2026-01-01",
      validoAl: null,
      basePeso: "tassabile" as const,
      scaglioni: [{ pesoDa: 10, pesoA: 30, importo: 22.5, nota: null }],
    };
    const riaddebito = calcolaRiaddebito({ data: "2026-09-24", pesoReale: 12, pesoTassabile: calcolo.pesoTassabile, versione });
    // Forma identica a quella costruita in `api/portali/vettori/simula/route.ts`:
    // `listino` arriva da `descriviListino`, che include l'id.
    const esito: EsitoSimulazione = {
      vettoreId: GLS_ID,
      vettoreCodice: "gls",
      vettoreNome: "GLS",
      disponibile: true,
      listino: { id: "00000000-0000-4000-8000-00000000b001", etichetta: "GLS 2026", validoDal: "2026-01-19", validoAl: null },
      calcolo,
      riaddebito,
      margine: 3.1,
      differenzaDalMigliore: 0,
    };
    const corpo = {
      simulazione: {
        direzione: "uscita",
        cap: "40023",
        provincia: "BO",
        controparteCodice: null,
        colli: 1,
        pesoKg: 12,
        gruppi: [{ quantita: 1, lunghezzaCm: 40, larghezzaCm: 30, altezzaCm: 20 }],
        lunghezzaCm: null,
        larghezzaCm: null,
        altezzaCm: null,
        data: "2026-09-24",
        condizioni: [],
        vettoreSceltoId: GLS_ID,
        costoPrevisto: calcolo.totale,
        riaddebitoPrevisto: riaddebito.importo,
        esiti: [JSON.parse(JSON.stringify(esito))],
      },
      bolla: { numeroRiferimento: "2631", dataDocumento: "2026-09-24", controparteNome: "Cliente Alfa", controparteCodice: null },
    };
    const parsed = CorpoConfermaSimulazione.safeParse(corpo);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });
});

describe("spedizioni: quanto addebitiamo al cliente", () => {
  const base: Pick<RigaStorico, "direzione" | "porto_codice" | "riaddebito_previsto" | "data_spedizione" | "peso" | "peso_tassato" | "controparte_codice"> = {
    direzione: "uscita",
    porto_codice: "03",
    riaddebito_previsto: null,
    data_spedizione: "2026-07-12",
    peso: 20,
    peso_tassato: null,
    controparte_codice: "C001",
  };

  it("franco con addebito in fattura: lo scaglione del peso", () => {
    expect(addebitoCliente(base, SCAGLIONI_2026, [])).toMatchObject({ fonte: "scaglioni", importo: 22.5 });
    // Il peso tassato, se c'e', decide lo scaglione.
    expect(addebitoCliente({ ...base, peso_tassato: 35 }, SCAGLIONI_2026, [])).toMatchObject({ importo: 31 });
  });

  it("franco puro, assegnato e arrivi non hanno addebito", () => {
    expect(addebitoCliente({ ...base, porto_codice: "01" }, SCAGLIONI_2026, [])).toBeNull();
    expect(addebitoCliente({ ...base, porto_codice: "02" }, SCAGLIONI_2026, [])).toBeNull();
    expect(addebitoCliente({ ...base, direzione: "entrata", porto_codice: "02" }, SCAGLIONI_2026, [])).toBeNull();
  });

  it("l'importo fissato in simulazione vince su tutto, anche sul porto", () => {
    expect(addebitoCliente({ ...base, porto_codice: null, riaddebito_previsto: 18 }, SCAGLIONI_2026, [])).toMatchObject({
      fonte: "simulazione",
      importo: 18,
    });
  });

  it("senza peso o oltre i 100 kg non inventa un importo", () => {
    expect(addebitoCliente({ ...base, peso: null }, SCAGLIONI_2026, [])).toMatchObject({ importo: null, regola: "peso mancante" });
    expect(addebitoCliente({ ...base, peso: 150 }, SCAGLIONI_2026, [])).toMatchObject({ importo: null });
  });

  it("l'accordo col cliente e' rispettato", () => {
    const accordo: AccordoRiaddebitoCliente = {
      id: "a1",
      codiceCliente: "C001",
      ragioneSociale: "Cliente Alfa",
      validoDal: "2026-01-01",
      validoAl: null,
      modalita: "nessun_addebito",
      importo: null,
      nota: null,
    };
    expect(addebitoCliente(base, SCAGLIONI_2026, [accordo])).toMatchObject({ importo: 0 });
    expect(addebitoCliente({ ...base, controparte_codice: "C999" }, SCAGLIONI_2026, [accordo])).toMatchObject({ importo: 22.5 });
  });
});

describe("gestionale: chi non sa non cancella chi sa", () => {
  const attuali = {
    direzione: "uscita",
    numero_riferimento: "2631",
    data_documento: "2026-09-24",
    controparte_nome: "Cliente Alfa",
    vettore_id: GLS_ID,
    colli_bolla: 2,
    peso_bolla: 12,
  };

  it("il vettore scelto in simulazione resta se il gestionale non lo indica", () => {
    const piano = pianificaFusioneCampi(attuali, { ...attuali, vettore_id: null, colli_bolla: 0, peso_bolla: null }, {}, false);
    expect("vettore_id" in piano.aggiornamenti).toBe(false);
    expect("colli_bolla" in piano.aggiornamenti).toBe(false);
    expect("peso_bolla" in piano.aggiornamenti).toBe(false);
  });

  it("un dato vero del gestionale invece vince", () => {
    const altro = "00000000-0000-4000-8000-00000000a002";
    const piano = pianificaFusioneCampi(attuali, { ...attuali, vettore_id: altro, colli_bolla: 3 }, {}, false);
    expect(piano.aggiornamenti.vettore_id).toBe(altro);
    expect(piano.aggiornamenti.colli_bolla).toBe(3);
  });

  it("dove non c'era nulla, il vuoto del gestionale passa (niente da proteggere)", () => {
    const piano = pianificaFusioneCampi({ ...attuali, vettore_id: null }, { ...attuali, vettore_id: null }, {}, false);
    expect(piano.aggiornamenti.vettore_id).toBeNull();
  });
});

describe("arrivi: il nostro protocollo accanto al DDT del fornitore", () => {
  const dettagli = new Map([
    [1, { numeroProgressivo: "1616" }],
    [2, { numeroProgressivo: "1617" }],
    [3, { numeroProgressivo: "1616" }],
  ]);

  it("raccoglie i progressivi dei documenti, senza doppioni", () => {
    expect(protocolloDaDocumenti({ direzione: "entrata", idDocumenti: [3, 1, 2] }, dettagli)).toBe("1616, 1617");
  });

  it("sulle partenze non serve", () => {
    expect(protocolloDaDocumenti({ direzione: "uscita", idDocumenti: [1] }, dettagli)).toBeNull();
  });
});
