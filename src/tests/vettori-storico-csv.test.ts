import { describe, expect, it } from "vitest";
import { versoCsv } from "@/lib/portali/vettori/storico";
import type { RigaStorico } from "@/lib/portali/vettori/tipi";

/**
 * L'esportazione dello storico.
 *
 * Il file finisce aperto in Excel italiano con un doppio clic, quindi le tre
 * cose che si rompono in silenzio sono il separatore, la virgola decimale e la
 * codifica degli accenti. Sono esattamente quelle che i test coprono.
 */

function riga(p: Partial<RigaStorico> = {}): RigaStorico {
  return {
    id: "1",
    fattura_id: "f1",
    direzione: "uscita",
    vettore_codice: "gls",
    vettore_nome: "GLS",
    fattura_numero: "PC/12345",
    data_fattura: "2026-07-31",
    anno: 2026,
    mese: 7,
    stato_fattura: "confermata",
    stato_fatturazione: "fatturata",
    origine: "gestionale",
    riga_numero: 1,
    data_spedizione: "2026-07-12",
    numero_spedizione: "SP1",
    riferimento: "2026/004512",
    controparte: "ROSSI SPA",
    controparte_codice: "CP1",
    provincia: "MI",
    cap: "20100",
    porto_descrizione: "F.CO ADDEB.FT",
    a_nostro_carico: true,
    colli: 2,
    peso: 148,
    peso_volumetrico: 288,
    peso_tassato: 288,
    nolo: 99.02,
    supplementi: 9.9,
    adeguamento: 7.14,
    carburante: 14.86,
    fatturato: 123.78,
    atteso: 101.1,
    scostamento: 0.224,
    esito: "anomalia",
    abbinamento: "numero",
    listino: "Tariffe nazionali 2026",
    zona: "IT",
    peso_applicato: "volumetrico",
    avvertenze: [],
    anomalie: 1,
    anomalie_aperte: 1,
    ...p,
  };
}

describe("versoCsv", () => {
  it("usa il punto e virgola, che è quello che Excel italiano apre in colonne", () => {
    const csv = versoCsv([riga()]);
    const intestazione = csv.split("\n")[0];
    expect(intestazione.split(";").length).toBeGreaterThan(25);
    expect(intestazione).toContain("Direzione;Data spedizione;Vettore");
  });

  it("apre con il BOM, altrimenti gli accenti si rompono", () => {
    expect(versoCsv([riga()]).charCodeAt(0)).toBe(0xfeff);
  });

  it("scrive i decimali con la virgola", () => {
    const dati = versoCsv([riga()]).split("\n")[1];
    expect(dati).toContain("123,78");
    expect(dati).toContain("101,10");
    expect(dati).not.toContain("123.78");
  });

  it("traduce la direzione in parole, non in slug", () => {
    expect(versoCsv([riga({ direzione: "uscita" })]).split("\n")[1]).toMatch(/^Partenza;/);
    expect(versoCsv([riga({ direzione: "entrata" })]).split("\n")[1]).toMatch(/^Arrivo;/);
  });

  it("calcola la differenza fatturato meno atteso", () => {
    const dati = versoCsv([riga()]).split("\n")[1].split(";");
    // 123,78 − 101,10 = 22,68
    expect(dati).toContain("22,68");
  });

  it("lascia vuota la differenza quando l'atteso non c'è", () => {
    const dati = versoCsv([riga({ atteso: null, scostamento: null })]).split("\n")[1];
    expect(dati).not.toContain("NaN");
    expect(dati).toContain(";;");
  });

  it("porta lo scostamento in percentuale leggibile", () => {
    expect(versoCsv([riga()]).split("\n")[1]).toContain("22,4");
  });

  it("protegge i campi che contengono il separatore", () => {
    const dati = versoCsv([riga({ controparte: "ROSSI; BIANCHI SNC" })]).split("\n")[1];
    expect(dati).toContain('"ROSSI; BIANCHI SNC"');
  });

  it("raddoppia le virgolette dentro un campo", () => {
    const dati = versoCsv([riga({ controparte: 'DITTA "LA VELOCE"' })]).split("\n")[1];
    expect(dati).toContain('"DITTA ""LA VELOCE"""');
  });

  it("non lascia mai la parola null nel file", () => {
    const vuota = versoCsv([
      riga({
        riferimento: null,
        controparte: null,
        provincia: null,
        cap: null,
        porto_descrizione: null,
        colli: null,
        peso: null,
        listino: null,
        zona: null,
        peso_applicato: null,
      }),
    ]);
    expect(vuota).not.toContain("null");
    expect(vuota).not.toContain("undefined");
  });

  it("produce solo l'intestazione quando non c'è niente da esportare", () => {
    const csv = versoCsv([]);
    expect(csv.split("\n").filter((r) => r.trim() !== "")).toHaveLength(1);
  });

  it("scrive una riga per spedizione", () => {
    const csv = versoCsv([riga({ id: "1" }), riga({ id: "2" }), riga({ id: "3" })]);
    expect(csv.split("\n").filter((r) => r.trim() !== "")).toHaveLength(4);
  });

  it("esporta una spedizione non fatturata senza trasformare gli importi in zero", () => {
    const csv = versoCsv([
      riga({
        fattura_id: null,
        fattura_numero: null,
        data_fattura: null,
        anno: null,
        mese: null,
        stato_fattura: null,
        stato_fatturazione: "non_fatturata",
        origine: "excel_storico",
        riga_numero: null,
        nolo: null,
        supplementi: null,
        adeguamento: null,
        carburante: null,
        fatturato: null,
        atteso: null,
        scostamento: null,
        esito: null,
        abbinamento: null,
        listino: null,
        zona: null,
      }),
    ]);
    const intestazioni = csv.slice(1).split("\n")[0].split(";");
    const dati = csv.split("\n")[1].split(";");
    const valore = (nome: string) => dati[intestazioni.indexOf(nome)];

    expect(valore("Origine")).toBe("Excel storico");
    expect(valore("Fatturato")).toBe("");
    expect(valore("Atteso")).toBe("");
    expect(valore("Differenza")).toBe("");
    expect(valore("Scostamento %")).toBe("");
    expect(valore("Stato fatturazione")).toBe("Non ancora fatturata");
    expect(valore("Stato fattura")).toBe("");
  });
});
