import { describe, expect, it } from "vitest";
import {
  COLONNE_TRASPORTI,
  calcolaFinestraDal,
  convertiRigaTrasporti,
  creaBlocchi,
  parseArgomentiTrasporti,
  parseCsv,
  parseDataGestionale,
  parseTimestampGestionale,
  validaIntestazioneTrasporti,
  validaProfiloTrasporti,
} from "../../scripts/lib/trasporti-parser.mjs";

function rigaValida(): string[] {
  const valori = Object.fromEntries(COLONNE_TRASPORTI.map((colonna) => [colonna, ""]));
  return COLONNE_TRASPORTI.map((colonna) => {
    const specifici: Record<string, string> = {
      id_documento: "574271",
      direzione: "USCITA",
      tipo_registro: "DV",
      numero_documento: "  DDT-001  ",
      data_documento: "2026-09-12",
      data_registrazione: "2026-09-12",
      data_creazione: "2026-09-12 08:45:31",
      num_colli: "2.000",
      peso_netto: "12.345",
      data_modifica: "2026-09-12 09:01:02",
    };
    return specifici[colonna] ?? valori[colonna];
  });
}

describe("parser trasporti_documenti", () => {
  it("fissa le 68 colonne nel loro ordine contrattuale", () => {
    expect(COLONNE_TRASPORTI).toHaveLength(68);
    expect(COLONNE_TRASPORTI.slice(0, 5)).toEqual([
      "id_documento",
      "direzione",
      "tipo_registro",
      "codice_profilo",
      "descrizione_profilo",
    ]);
    expect(COLONNE_TRASPORTI.slice(-6)).toEqual([
      "id_utente_crea",
      "codice_utente_creatore",
      "utente_creatore",
      "id_utente_modifica",
      "data_modifica",
      "generato_da",
    ]);
  });

  it("rifiuta intestazioni con colonne corrette ma scambiate", () => {
    const scambiate = [...COLONNE_TRASPORTI];
    [scambiate[1], scambiate[2]] = [scambiate[2], scambiate[1]];

    expect(validaIntestazioneTrasporti(COLONNE_TRASPORTI)).toMatchObject({
      ok: true,
      ordineDiverso: false,
      nColonne: 68,
    });
    expect(validaIntestazioneTrasporti(scambiate)).toMatchObject({
      ok: false,
      ordineDiverso: true,
    });
  });

  it("parsa BOM, separatori nei campi e virgolette raddoppiate", () => {
    const csv = '\ufeff"id_documento";"note_spedizione"\r\n"1";"pallet; nota ""urgente"""\r\n';
    expect(parseCsv(csv, ";")).toEqual([
      ["id_documento", "note_spedizione"],
      ["1", 'pallet; nota "urgente"'],
    ]);
  });

  it("converte tipi, NULL e timestamp locali senza aggiungere un fuso", () => {
    const record = convertiRigaTrasporti(
      COLONNE_TRASPORTI,
      rigaValida(),
      "RUN-1",
      1,
    );

    expect(record).toMatchObject({
      run_id: "RUN-1",
      riga_num: 1,
      id_documento: 574271,
      numero_documento: "DDT-001",
      data_documento: "2026-09-12",
      data_creazione: "2026-09-12 08:45:31",
      num_colli: 2,
      peso_netto: 12.345,
      data_modifica: "2026-09-12 09:01:02",
      volume: null,
    });
  });

  it("rifiuta valori che PostgreSQL non dovrebbe interpretare implicitamente", () => {
    const indiceData = COLONNE_TRASPORTI.indexOf("data_documento");
    const indicePeso = COLONNE_TRASPORTI.indexOf("peso_lordo");
    const dataErrata = rigaValida();
    const pesoErrato = rigaValida();
    dataErrata[indiceData] = "2026-02-30";
    pesoErrato[indicePeso] = "dodici";

    expect(() => convertiRigaTrasporti(COLONNE_TRASPORTI, dataErrata, "RUN", 7))
      .toThrow(/riga 7: data_documento non valida/);
    expect(() => convertiRigaTrasporti(COLONNE_TRASPORTI, pesoErrato, "RUN", 8))
      .toThrow(/riga 8: peso_lordo non numerico/);
    expect(parseDataGestionale("2026-02-30")).toBeUndefined();
    expect(parseTimestampGestionale("2026-09-12T25:00:00")).toBeUndefined();
  });
});

describe("profili e blocchi dell'ingest Trasporti", () => {
  it.each(["live", "riconciliazione"])("accetta il profilo %s", (profilo) => {
    expect(validaProfiloTrasporti(profilo)).toBe(profilo);
  });

  it("non sceglie implicitamente un profilo", () => {
    expect(() => parseArgomentiTrasporti(["/run/20260912_120000"]))
      .toThrow(/Profilo non valido/);
    expect(() => validaProfiloTrasporti("notturno")).toThrow(/Profilo non valido/);
  });

  it("legge directory, profilo e opzioni della convenzione Linux", () => {
    expect(parseArgomentiTrasporti([
      "/var/lib/impresa-bi/ready-trasporti-live/20260912_120000",
      "--profilo=live",
      "--batch=500",
      "--run-id=RUN-LIVE-1",
      "--dry-run",
    ])).toEqual({
      runDirectory: "/var/lib/impresa-bi/ready-trasporti-live/20260912_120000",
      profilo: "live",
      runId: "RUN-LIVE-1",
      capturedAt: null,
      batch: 500,
      dryRun: true,
    });
  });

  it("costruisce blocchi senza perdere o duplicare righe", () => {
    expect(creaBlocchi([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(creaBlocchi([], 2)).toEqual([]);
    expect(() => creaBlocchi([1], 0)).toThrow(/intero positivo/);
  });

  it("calcola i 90 giorni per calendario senza conversioni di timezone", () => {
    expect(calcolaFinestraDal("2026-09-12T04:15:00", 90)).toBe("2026-06-14");
    expect(calcolaFinestraDal("2024-03-01T00:30:00+01:00", 1)).toBe("2024-02-29");
  });
});
