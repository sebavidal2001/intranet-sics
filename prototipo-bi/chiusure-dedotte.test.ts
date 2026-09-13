/**
 * Chiusure dedotte dai dati.
 *
 * La prova che conta: agosto 2026, due settimane senza un documento, non deve
 * essere letto come un crollo del 100%.
 */
import { describe, expect, it } from "vitest";
import { deduciChiusure, chiusureEffettive } from "@/lib/prototipo-bi/chiusure-dedotte";
import type { RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

function riga(data: string): RigaFatto {
  return {
    data,
    importo: 1000,
    bu: "COMPONENTI",
    categoria: "",
    agente: "Valeria",
    codiceAgente: "VA",
    cliente: "Cliente",
    codiceCliente: "C1",
    documento: `D-${data}`,
    articolo: "A1",
    descrizioneArticolo: "Articolo",
    quantita: 1,
  };
}

/** Giorni feriali dal `dal` al `al`, saltando il buco indicato. */
function snapshotConBuco(dal: string, al: string, buco: { dal: string; al: string }): Snapshot {
  const righe: RigaFatto[] = [];
  for (let g = new Date(`${dal}T00:00:00Z`); g <= new Date(`${al}T00:00:00Z`); g.setUTCDate(g.getUTCDate() + 1)) {
    const giorno = g.toISOString().slice(0, 10);
    const feriale = g.getUTCDay() !== 0 && g.getUTCDay() !== 6;
    const dentroIlBuco = giorno >= buco.dal && giorno <= buco.al;
    if (feriale && !dentroIlBuco) righe.push(riga(giorno));
  }
  return {
    generatoIl: new Date().toISOString(),
    runCorrente: "run-1",
    runRicevutoIl: null,
    dataMassima: al,
    dataMinima: dal,
    dataset: {
      ordinato: righe,
      fatturato: [],
      consegnato: [],
      portafoglio: [],
      preventivi_aperti: [],
      controllo_banco: [],
      consegnato_futuro_per_mese: [],
    },
    conteggi: { ordinato: righe.length },
  };
}

describe("Le chiusure si deducono dall'assenza totale di documenti", () => {
  it("riconosce la chiusura estiva di agosto", () => {
    const s = snapshotConBuco("2026-07-01", "2026-09-30", { dal: "2026-08-10", al: "2026-08-23" });
    const chiusure = deduciChiusure(s, 2026);

    expect(chiusure).toHaveLength(1);
    expect(chiusure[0].dal).toBe("2026-08-10");
    expect(chiusure[0].giorniFeriali).toBeGreaterThanOrEqual(10);
    // Deve dichiarare di essere una deduzione, non spacciarsi per un dato.
    expect(chiusure[0].dedotta).toBe(true);
    expect(chiusure[0].descrizione).toMatch(/probabile/i);
  });

  it("un ponte di tre giorni non è una chiusura", () => {
    // Sotto la soglia di una settimana lavorativa: il calo di un ponte è
    // un'informazione vera e non va nascosto dietro una chiusura inventata.
    const s = snapshotConBuco("2026-04-01", "2026-05-31", { dal: "2026-04-29", al: "2026-05-01" });
    expect(deduciChiusure(s, 2026)).toHaveLength(0);
  });

  it("il futuro non è una chiusura", () => {
    // Il vuoto dopo l'ultimo giorno caricato è il domani, non ferie: senza
    // questo controllo comparirebbe una chiusura lunga mesi ogni volta che si
    // guarda l'anno in corso.
    const s = snapshotConBuco("2026-01-01", "2026-03-31", { dal: "2026-12-01", al: "2026-12-31" });
    const chiusure = deduciChiusure(s, 2026);
    expect(chiusure.every((c) => c.dal <= "2026-03-31")).toBe(true);
  });
});

describe("Le date inserite a mano vincono sempre", () => {
  it("con il calendario configurato non si deduce niente", () => {
    const s = snapshotConBuco("2026-07-01", "2026-09-30", { dal: "2026-08-10", al: "2026-08-23" });
    const configurate = [
      { id: "x", dal: "2026-08-01", al: "2026-08-31", descrizione: "Ferie" },
    ];

    const esito = chiusureEffettive(configurate, s, 2026);
    expect(esito.dedotte).toBe(false);
    expect(esito.chiusure).toEqual(configurate);
  });

  it("senza calendario si usano le dedotte, dichiarandolo", () => {
    const s = snapshotConBuco("2026-07-01", "2026-09-30", { dal: "2026-08-10", al: "2026-08-23" });
    const esito = chiusureEffettive([], s, 2026);
    expect(esito.dedotte).toBe(true);
    expect(esito.chiusure.length).toBeGreaterThan(0);
  });
});
