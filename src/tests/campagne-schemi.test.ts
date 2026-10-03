import { describe, expect, it } from "vitest";
import {
  AggiornaCampagnaBody,
  AggiornaInvioBody,
  AssegnaInvioBody,
  CreaCampagnaBody,
  DestinatariBody,
  FiltroInvii,
  PubblicoBody,
} from "@/lib/portali/campagne/schemi";
import { azioniConsentite, etichettaOrdine, oggiRoma } from "@/lib/portali/campagne/stati";

const UUID = "3f2b8c1e-5d4a-4e6b-9a7c-1d2e3f4a5b6c";

describe("AssegnaInvioBody", () => {
  const ordine = {
    tipo: "ordine",
    codice_cliente: "05000002",
    campagna_id: UUID,
    referente: "Mario Rossi",
    ordine_numero: "1117",
    ordine_anno: 2026,
  };

  it("accetta una busta con referente e ordine", () => {
    expect(AssegnaInvioBody.safeParse(ordine).success).toBe(true);
  });

  it("referente e numero d'ordine sono obbligatori", () => {
    expect(AssegnaInvioBody.safeParse({ ...ordine, referente: "  " }).success).toBe(false);
    expect(AssegnaInvioBody.safeParse({ ...ordine, referente: "A" }).success).toBe(false);
    expect(AssegnaInvioBody.safeParse({ ...ordine, ordine_numero: "" }).success).toBe(false);
    const { ordine_numero, ...senza } = ordine;
    void ordine_numero;
    expect(AssegnaInvioBody.safeParse(senza).success).toBe(false);
  });

  it("toglie gli spazi e rifiuta caratteri strani nel numero d'ordine", () => {
    const ok = AssegnaInvioBody.parse({ ...ordine, referente: "  Mario Rossi ", ordine_numero: " 1117 " });
    expect(ok).toMatchObject({ referente: "Mario Rossi", ordine_numero: "1117" });
    expect(AssegnaInvioBody.safeParse({ ...ordine, ordine_numero: "11 17" }).success).toBe(false);
    expect(AssegnaInvioBody.safeParse({ ...ordine, ordine_numero: "1117'; --" }).success).toBe(false);
  });

  it("il banco non richiede ordine né referente", () => {
    const r = AssegnaInvioBody.safeParse({ tipo: "banco", codice_cliente: "05000002", campagna_id: UUID });
    expect(r.success).toBe(true);
  });

  it("rifiuta una campagna che non è un uuid e un tipo sconosciuto", () => {
    expect(AssegnaInvioBody.safeParse({ ...ordine, campagna_id: "C_01_26" }).success).toBe(false);
    expect(AssegnaInvioBody.safeParse({ ...ordine, tipo: "altro" }).success).toBe(false);
  });

  it("l'anno dell'ordine ha un intervallo sensato", () => {
    expect(AssegnaInvioBody.safeParse({ ...ordine, ordine_anno: 26 }).success).toBe(false);
    expect(AssegnaInvioBody.safeParse({ ...ordine, ordine_anno: 2026.5 }).success).toBe(false);
  });
});

describe("AggiornaInvioBody", () => {
  it("accetta le quattro azioni", () => {
    expect(AggiornaInvioBody.safeParse({ azione: "modifica", referente: "Anna Bianchi" }).success).toBe(true);
    expect(AggiornaInvioBody.safeParse({ azione: "consegna", data_consegna: "2026-10-01" }).success).toBe(true);
    expect(AggiornaInvioBody.safeParse({ azione: "banco" }).success).toBe(true);
    expect(AggiornaInvioBody.safeParse({ azione: "annulla", motivo: "Assegnata per errore" }).success).toBe(true);
  });

  it("la consegna vuole una data ISO, l'annullamento un motivo", () => {
    expect(AggiornaInvioBody.safeParse({ azione: "consegna" }).success).toBe(false);
    expect(AggiornaInvioBody.safeParse({ azione: "consegna", data_consegna: "01/10/2026" }).success).toBe(false);
    expect(AggiornaInvioBody.safeParse({ azione: "annulla", motivo: "  " }).success).toBe(false);
  });

  it("non si può cambiare lo stato scrivendolo a mano", () => {
    expect(AggiornaInvioBody.safeParse({ azione: "modifica", stato: "consegnata" }).success).toBe(true);
    const r = AggiornaInvioBody.parse({ azione: "modifica", stato: "consegnata", referente: "Anna" });
    expect(r).not.toHaveProperty("stato");
  });
});

describe("FiltroInvii", () => {
  it("ha valori di default e li limita", () => {
    expect(FiltroInvii.parse({})).toMatchObject({ limit: 50, offset: 0 });
    expect(FiltroInvii.safeParse({ limit: "500" }).success).toBe(false);
    expect(FiltroInvii.parse({ limit: "20", offset: "40" })).toMatchObject({ limit: 20, offset: 40 });
  });
  it("rifiuta uno stato inesistente", () => {
    expect(FiltroInvii.safeParse({ stato: "da_preparare" }).success).toBe(false);
  });
});

describe("campagne", () => {
  const nuova = { codice: "C_04_26", nome: "Nuova", articolo_codice: "ART-04" };

  it("crea con i default: sospesa, pubblico standard (nessuno indicato) con i destinatari aggiunti subito", () => {
    expect(CreaCampagnaBody.parse(nuova)).toMatchObject({
      stato: "sospesa",
      applica_pubblico: true,
      testo_riconoscimento: [],
      articoli_promossi: [],
    });
  });

  it("il codice ha una forma sola e l'articolo è obbligatorio", () => {
    expect(CreaCampagnaBody.safeParse({ ...nuova, codice: "C 04" }).success).toBe(false);
    expect(CreaCampagnaBody.safeParse({ ...nuova, articolo_codice: " " }).success).toBe(false);
    expect(CreaCampagnaBody.safeParse({ ...nuova, nome: "" }).success).toBe(false);
  });

  it("non si crea già terminata", () => {
    expect(CreaCampagnaBody.safeParse({ ...nuova, stato: "terminata" }).success).toBe(false);
  });

  it("la modifica non cambia il codice e non può essere vuota", () => {
    expect(AggiornaCampagnaBody.safeParse({}).success).toBe(false);
    const r = AggiornaCampagnaBody.parse({ nome: "Nuovo titolo", codice: "ALTRO" });
    expect(r).toEqual({ nome: "Nuovo titolo" });
    expect(AggiornaCampagnaBody.safeParse({ stato: "terminata" }).success).toBe(true);
    expect(AggiornaCampagnaBody.safeParse({ stato: "cancellata" }).success).toBe(false);
  });
});

describe("destinatari e pubblico standard", () => {
  it("accetta le cinque azioni e rifiuta elenchi vuoti", () => {
    expect(DestinatariBody.safeParse({ azione: "applica_pubblico" }).success).toBe(true);
    // Il vecchio nome non esiste piu': il pubblico e' quello della campagna, non «lo standard».
    expect(DestinatariBody.safeParse({ azione: "applica_standard" }).success).toBe(false);
    expect(DestinatariBody.safeParse({ azione: "aggiungi", codici: ["1", "2"] }).success).toBe(true);
    expect(DestinatariBody.safeParse({ azione: "rimuovi_categorie", categorie: ["UFSTAB"] }).success).toBe(true);
    expect(DestinatariBody.safeParse({ azione: "aggiungi", codici: [] }).success).toBe(false);
    expect(DestinatariBody.safeParse({ azione: "azzera" }).success).toBe(false);
  });

  it("limita la dimensione degli elenchi", () => {
    const tanti = Array.from({ length: 5001 }, (_, i) => String(i + 1));
    expect(DestinatariBody.safeParse({ azione: "aggiungi", codici: tanti }).success).toBe(false);
  });

  it("il pubblico accetta elenchi vuoti di extra, ma non una regola incompleta", () => {
    const regola = { nome: "Standard", agenti: ["AIRFLUID"], categorie_commerciali: ["Attivo"], categorie_attivita: [], clienti_extra: [] };
    expect(PubblicoBody.safeParse(regola).success).toBe(true);
    expect(PubblicoBody.safeParse({ nome: "Standard", agenti: ["AIRFLUID"] }).success).toBe(false);
  });
});

describe("azioniConsentite", () => {
  it("una busta in lavorazione si modifica, si consegna, si ritira al banco, si annulla", () => {
    for (const stato of ["preparata", "da_spedire"] as const) {
      expect(azioniConsentite({ stato, fonte_consegna: null })).toEqual(["modifica", "consegna", "banco", "annulla"]);
    }
  });

  it("una consegna rilevata dal DDT non si tocca a mano", () => {
    expect(azioniConsentite({ stato: "consegnata", fonte_consegna: "ddt" })).toEqual([]);
  });

  it("una consegna manuale o importata si può solo annullare", () => {
    expect(azioniConsentite({ stato: "consegnata", fonte_consegna: "manuale" })).toEqual(["annulla"]);
    expect(azioniConsentite({ stato: "consegnata", fonte_consegna: "import_excel" })).toEqual(["annulla"]);
    expect(azioniConsentite({ stato: "consegnata_banco", fonte_consegna: "banco" })).toEqual(["annulla"]);
  });

  it("un invio annullato è chiuso", () => {
    expect(azioniConsentite({ stato: "annullata", fonte_consegna: null })).toEqual([]);
  });
});

describe("date e ordine", () => {
  it("oggiRoma usa il fuso di Roma, non UTC", () => {
    // 23:30 UTC del 31/12 sono già l'1/1 a Roma.
    expect(oggiRoma(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(oggiRoma(new Date("2026-07-14T12:00:00Z"))).toBe("2026-07-14");
  });

  it("etichettaOrdine", () => {
    expect(etichettaOrdine({ ordine_numero: "1117", ordine_anno: 2026 })).toBe("1117/2026");
    expect(etichettaOrdine({ ordine_numero: "1117", ordine_anno: null })).toBe("1117");
    expect(etichettaOrdine({ ordine_numero: null, ordine_anno: null })).toBeNull();
  });
});
