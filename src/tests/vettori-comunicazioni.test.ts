import { describe, expect, it } from "vitest";
import {
  compila,
  costruisciBozza,
  tabellaAnomalie,
} from "@/lib/portali/vettori/comunicazioni";
import type { AnomaliaElenco } from "@/lib/portali/vettori/letture";

/**
 * Le bozze di contestazione ai vettori.
 *
 * Il file `.eml` prodotto qui finisce in Outlook e poi in mano a un fornitore:
 * un accento rotto o un importo sbagliato si vedono. I test coprono le tre
 * cose che si possono rompere in silenzio — sostituzione dei segnaposto,
 * codifica delle intestazioni e somma degli importi contestati.
 */

function anomalia(p: Partial<AnomaliaElenco> = {}): AnomaliaElenco {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tipo: "importo_oltre_soglia",
    gravita: "anomalia",
    stato: "aperta",
    descrizione: "Fatturato 22,4% sopra il costo atteso di 74,93 €.",
    importo_contestato: 16.8,
    motivazione: null,
    creata_il: "2026-08-01T10:00:00Z",
    decisa_il: null,
    vettore_codice: "gls",
    vettore_nome: "GLS",
    fattura_numero: "PC/12345",
    fattura_data: "2026-07-31",
    anno: 2026,
    mese: 7,
    riga_numero: 3,
    riferimento: "2026/004512",
    controparte: "ROSSI SPA",
    direzione: "uscita",
    data_spedizione: "2026-07-12",
    colli: 2,
    peso: 148,
    peso_tassato: 288,
    fatturato: 91.73,
    atteso: 74.93,
    scostamento: 0.224,
    listino: "Tariffe nazionali 2026",
    zona: "IT",
    abbinamento: "numero",
    ...p,
  };
}

describe("compila", () => {
  it("sostituisce i segnaposto noti", () => {
    expect(compila("Spett.le {vettore}, mese {mese}", { vettore: "GLS", mese: "luglio" })).toBe(
      "Spett.le GLS, mese luglio"
    );
  });

  it("lascia intatto un segnaposto che non conosce", () => {
    // Un modello scritto da un utente con una graffa di troppo deve produrre un
    // testo con una graffa di troppo, non un errore né una stringa vuota.
    expect(compila("Totale {sconosciuto} euro", { vettore: "GLS" })).toBe(
      "Totale {sconosciuto} euro"
    );
  });

  it("non tocca il testo senza segnaposto", () => {
    expect(compila("Cordiali saluti", {})).toBe("Cordiali saluti");
  });
});

describe("tabellaAnomalie", () => {
  it("dice esplicitamente quando non c'è niente da segnalare", () => {
    expect(tabellaAnomalie([])).toBe("(nessuna spedizione da segnalare)");
  });

  it("mette in riga i dati che il vettore può ritrovare nei suoi sistemi", () => {
    const t = tabellaAnomalie([anomalia()]);
    expect(t).toContain("2026-07-12");
    expect(t).toContain("2026/004512");
    expect(t).toContain("ROSSI SPA");
    expect(t).toContain("91,73");
    expect(t).toContain("74,93");
  });

  it("regge una riga senza riferimento invece di scrivere null", () => {
    const t = tabellaAnomalie([anomalia({ riferimento: null, controparte: null })]);
    expect(t).toContain("senza riferimento");
    expect(t).not.toContain("null");
  });
});

describe("costruisciBozza", () => {
  const base = {
    vettoreNome: "GLS",
    mese: 7,
    anno: 2026,
    destinatari: ["fatturazione@esempio.it"],
    cc: [] as string[],
    oggettoModello: "Richiesta di verifica addebiti — {vettore} {mese}/{anno}",
    corpoModello:
      "Spett.le {vettore},\nrisultano {n_anomalie} spedizioni per {totale_contestato}.\n{tabella}",
  };

  it("compila oggetto e corpo con i dati veri", () => {
    const b = costruisciBozza({ ...base, anomalie: [anomalia()] });
    expect(b.oggetto).toBe("Richiesta di verifica addebiti — GLS luglio/2026");
    expect(b.corpo).toContain("risultano 1 spedizioni");
    expect(b.corpo).toContain("2026/004512");
  });

  it("somma gli importi contestati", () => {
    const b = costruisciBozza({
      ...base,
      anomalie: [
        anomalia({ importo_contestato: 16.8 }),
        anomalia({ id: "b", importo_contestato: 4.2 }),
        // Una senza importo non deve far diventare NaN il totale.
        anomalia({ id: "c", importo_contestato: null }),
      ],
    });
    expect(b.corpo).toContain("21,00");
    expect(b.corpo).not.toContain("NaN");
  });

  it("codifica l'oggetto con gli accenti secondo RFC 2047", () => {
    // La lineetta lunga del modello predefinito, spedita come ASCII, arriva
    // rotta: deve uscire codificata in base64.
    const b = costruisciBozza({ ...base, anomalie: [anomalia()] });
    expect(b.eml).toContain("Subject: =?UTF-8?B?");
    expect(b.eml).not.toContain("Subject: Richiesta");
  });

  it("lascia in chiaro un oggetto di soli caratteri ASCII", () => {
    const b = costruisciBozza({
      ...base,
      oggettoModello: "Verifica addebiti {vettore}",
      anomalie: [anomalia()],
    });
    expect(b.eml).toContain("Subject: Verifica addebiti GLS");
  });

  it("marca il messaggio come non inviato, così Outlook lo apre come bozza", () => {
    const b = costruisciBozza({ ...base, anomalie: [anomalia()] });
    expect(b.eml).toContain("X-Unsent: 1");
    expect(b.eml).toContain("To: fatturazione@esempio.it");
  });

  it("il corpo sopravvive al viaggio in base64", () => {
    const b = costruisciBozza({ ...base, anomalie: [anomalia()] });
    const corpoEncoded = b.eml.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(corpoEncoded, "base64").toString("utf-8")).toContain(
      "Spett.le GLS"
    );
  });

  it("omette il Cc quando non ce n'è", () => {
    const b = costruisciBozza({ ...base, anomalie: [anomalia()] });
    expect(b.eml).not.toContain("Cc:");
  });

  it("costruisce un nome file riconoscibile e senza caratteri strani", () => {
    const b = costruisciBozza({
      ...base,
      vettoreNome: "Trading Post",
      mese: 7,
      anomalie: [anomalia()],
    });
    expect(b.nomeFile).toBe("contestazione-trading-post-07-2026.eml");
  });

  it("produce comunque una bozza quando non c'è niente da contestare", () => {
    // Serve: capita di voler mandare un riepilogo «tutto in ordine», e capita
    // che l'operatore prema il pulsante con i filtri sbagliati. Meglio un testo
    // che lo dice di un file vuoto.
    const b = costruisciBozza({ ...base, anomalie: [] });
    expect(b.corpo).toContain("nessuna spedizione da segnalare");
    expect(b.corpo).toContain("risultano 0 spedizioni");
  });
});
