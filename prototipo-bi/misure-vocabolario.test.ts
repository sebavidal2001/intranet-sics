/**
 * Le misure personalizzate dentro il vocabolario del builder e dentro i filtri
 * della pagina: chiavi, dimensioni ammesse, spec per chiave, e il principio che
 * la domanda del riquadro vince su quella della pagina anche quando il filtro
 * e' incorporato nella misura.
 */
import { describe, expect, it } from "vitest";
import {
  chiaveDellaSpec,
  chiaveMisura,
  eChiaveMisura,
  estendiVocabolario,
  misureNelleSpec,
  specPerChiave,
} from "@/lib/prototipo-bi/misure-vocabolario";
import { dimensioniDellaMisura, validaMisura } from "@/lib/prototipo-bi/misure";
import { applicaFiltriIncrociati, fondiFiltriPaginaConEsito } from "@/lib/prototipo-bi/filtri-pagina";
import { eseguiAnalisiComposita, serieEffettiveAnalisi } from "@/lib/prototipo-bi/analisi-composita";
import { validaSpec } from "@/lib/prototipo-bi/semantico";
import type { ChiaveMetrica, Dimensione, MisuraDefinita, SpecQuery } from "@/lib/prototipo-bi/tipi";

const MARGINE_COMPONENTI: MisuraDefinita = validaMisura({
  id: "11111111-1111-4111-8111-111111111111",
  versione: 2,
  nome: "Margine componenti sul fatturato",
  espressione: {
    tipo: "rapporto",
    numeratore: { metrica: "margine", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
    denominatore: { metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
  },
});

const QUOTA: MisuraDefinita = validaMisura({
  nome: "Quota componenti",
  espressione: { tipo: "quota", metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
});

const VOCABOLARIO = {
  tipologie: [{ chiave: "fatturato" as const, etichetta: "Fatturato", descrizione: "Fatture.", metriche: ["fatturato", "margine"] as ChiaveMetrica[] }],
  metriche: [
    { chiave: "fatturato" as const, etichetta: "Valore fatturato", descrizione: "", unita: "euro" },
    { chiave: "margine" as const, etichetta: "Margine", descrizione: "", unita: "euro" },
  ],
  dimensioni: [{ chiave: "bu" as Dimensione, etichetta: "Business unit" }],
  dimensioniPerMetrica: { fatturato: ["bu", "agente"], margine: ["bu", "agente"] } as Record<ChiaveMetrica, Dimensione[]>,
};

describe("chiavi delle misure", () => {
  it("una misura salvata ha per chiave l'id, una al volo il nome", () => {
    expect(chiaveMisura(MARGINE_COMPONENTI)).toBe("misura:11111111-1111-4111-8111-111111111111");
    expect(chiaveMisura(QUOTA)).toBe("misura:Quota componenti");
    expect(eChiaveMisura("misura:x")).toBe(true);
    expect(eChiaveMisura("fatturato")).toBe(false);
  });

  it("la chiave di una spec e' quella della misura se c'e', altrimenti la metrica", () => {
    expect(chiaveDellaSpec({ metrica: "fatturato" })).toBe("fatturato");
    expect(chiaveDellaSpec({ metrica: "margine", misura: MARGINE_COMPONENTI })).toBe(chiaveMisura(MARGINE_COMPONENTI));
  });
});

describe("specPerChiave", () => {
  const definizioni = { [chiaveMisura(MARGINE_COMPONENTI)]: MARGINE_COMPONENTI };

  it("per una metrica toglie la misura rimasta dalla spec di partenza", () => {
    const base: SpecQuery = { metrica: "margine", misura: MARGINE_COMPONENTI, raggruppa: ["bu"] };
    const spec = specPerChiave(base, "fatturato", definizioni);
    expect(spec?.metrica).toBe("fatturato");
    expect(spec).not.toHaveProperty("misura");
    expect(spec?.raggruppa).toEqual(["bu"]);
    // E la base non e' stata toccata.
    expect(base.misura).toBeDefined();
  });

  it("per una misura mette la definizione, che il validatore poi riconduce alla sua metrica", () => {
    const spec = specPerChiave({ metrica: "ordinato", raggruppa: ["bu"] }, chiaveMisura(MARGINE_COMPONENTI), definizioni);
    expect(spec?.misura?.nome).toBe("Margine componenti sul fatturato");
    expect(validaSpec(spec).metrica).toBe("margine");
  });

  it("senza definizione non c'e' domanda: restituisce null, non un'altra metrica", () => {
    expect(specPerChiave({ metrica: "ordinato" }, "misura:sconosciuta", definizioni)).toBeNull();
  });
});

describe("estendiVocabolario", () => {
  it("aggiunge un gruppo, le voci e le dimensioni ammesse da tutti gli operandi", () => {
    const { vocabolario, definizioni } = estendiVocabolario(VOCABOLARIO, [MARGINE_COMPONENTI, QUOTA]);
    const gruppo = vocabolario.tipologie.at(-1);
    expect(gruppo?.chiave).toBe("misure");
    expect(gruppo?.etichetta).toBe("Misure personalizzate");
    expect(gruppo?.metriche).toEqual([chiaveMisura(MARGINE_COMPONENTI), chiaveMisura(QUOTA)]);

    const voce = vocabolario.metriche.find((m) => m.chiave === chiaveMisura(MARGINE_COMPONENTI));
    expect(voce?.etichetta).toBe("Margine componenti sul fatturato");
    expect(voce?.unita).toBe("percentuale");
    expect(voce?.descrizione).toContain("diviso");

    expect(vocabolario.dimensioniPerMetrica[chiaveMisura(MARGINE_COMPONENTI)]).toEqual(
      dimensioniDellaMisura(MARGINE_COMPONENTI)
    );
    expect(Object.keys(definizioni)).toHaveLength(2);
    // Il vocabolario di partenza non e' stato modificato.
    expect(VOCABOLARIO.tipologie).toHaveLength(1);
  });

  it("senza misure non aggiunge niente", () => {
    const { vocabolario } = estendiVocabolario(VOCABOLARIO, []);
    expect(vocabolario.tipologie).toHaveLength(1);
    expect(vocabolario.metriche).toHaveLength(2);
  });

  it("una stessa misura arrivata due volte (catalogo e spec) conta una volta, vince la prima", () => {
    const copia: MisuraDefinita = { ...MARGINE_COMPONENTI, versione: 1 };
    const { vocabolario, definizioni } = estendiVocabolario(VOCABOLARIO, [MARGINE_COMPONENTI, copia]);
    expect(vocabolario.tipologie.at(-1)?.metriche).toHaveLength(1);
    expect(definizioni[chiaveMisura(MARGINE_COMPONENTI)].versione).toBe(2);
  });

  it("raccoglie le misure che le spec gia' portano", () => {
    expect(
      misureNelleSpec([{ metrica: "margine", misura: QUOTA }, { metrica: "fatturato" }, null, undefined])
    ).toEqual([QUOTA]);
  });
});

describe("filtri di pagina e filtro incrociato su una misura", () => {
  const spec: SpecQuery = { metrica: "margine", misura: MARGINE_COMPONENTI };

  it("un filtro di pagina sulla business unit NON svuota una misura «solo COMPONENTI»: si ignora e si dichiara", () => {
    const esito = fondiFiltriPaginaConEsito(spec, { bu: "IMPIANTI", agente: "ROSSI" });
    expect(esito.filtriPaginaIgnorati).toEqual(["bu"]);
    expect(esito.spec.filtri).toEqual([{ campo: "agente", op: "eq", valore: "ROSSI" }]);
  });

  it("la quota di COMPONENTI sul totale non si calcola dentro una sola business unit", () => {
    const esito = fondiFiltriPaginaConEsito({ metrica: "fatturato", misura: QUOTA }, { bu: ["IMPIANTI", "STRUTTURE"] });
    expect(esito.filtriPaginaIgnorati).toEqual(["bu"]);
    expect(esito.spec.filtri).toBeUndefined();
  });

  it("una dimensione che un operando non ammette si ignora invece di far fallire il riquadro", () => {
    const preventiviSuOrdinato = validaMisura({
      nome: "Convertito sull'ordinato",
      espressione: { tipo: "rapporto", numeratore: { metrica: "preventivi_convertito" }, denominatore: { metrica: "ordinato" } },
    });
    const risolta = applicaFiltriIncrociati(
      { metrica: "preventivi_convertito", misura: preventiviSuOrdinato },
      [{ campo: "esito", op: "eq", valore: "Aperto" }]
    );
    expect(risolta.ignorati).toEqual(["esito"]);
    expect(risolta.spec.filtri).toBeUndefined();
  });

  it("il filtro incrociato sulla stessa famiglia della misura e' ignorato, quello su un'altra dimensione si applica", () => {
    const risolta = applicaFiltriIncrociati(spec, [
      { campo: "bu", op: "eq", valore: "IMPIANTI" },
      { campo: "cliente", op: "eq", valore: "Alfa" },
    ]);
    expect(risolta.ignorati).toEqual(["bu"]);
    expect(risolta.spec.filtri).toEqual([{ campo: "cliente", op: "eq", valore: "Alfa" }]);
  });

  it("una spec senza misura si comporta come prima", () => {
    const esito = fondiFiltriPaginaConEsito({ metrica: "fatturato" }, { bu: "IMPIANTI" });
    expect(esito.filtriPaginaIgnorati).toEqual([]);
    expect(esito.spec.filtri).toEqual([{ campo: "bu", op: "eq", valore: "IMPIANTI" }]);
  });
});

describe("analisi composita con misura", () => {
  it("una spec senza serie prende il nome dalla misura, non dalla chiave della metrica", () => {
    const serie = serieEffettiveAnalisi({ spec: { metrica: "margine", misura: MARGINE_COMPONENTI } });
    expect(serie[0].nome).toBe("Margine componenti sul fatturato");
    expect(serieEffettiveAnalisi({ spec: { metrica: "fatturato" } })[0].nome).toBe("fatturato");
  });

  it("la misura viaggia nella POST batch verso /api/bi/query", async () => {
    let corpoInviato: { specs: Array<{ spec: SpecQuery }> } | null = null;
    const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => {
      corpoInviato = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => ({
          risultati: corpoInviato!.specs.map((s) => ({
            id: (s as unknown as { id: string }).id,
            risultato: { spec: s.spec, metrica: s.spec.metrica, unita: "percentuale", righe: [], totale: 0, certificata: true, avvisi: [] },
          })),
        }),
      } as Response;
    };
    await eseguiAnalisiComposita({ spec: { metrica: "margine", misura: MARGINE_COMPONENTI } }, {}, { fetcher });
    expect(corpoInviato!.specs[0].spec.misura?.nome).toBe("Margine componenti sul fatturato");
  });
});
