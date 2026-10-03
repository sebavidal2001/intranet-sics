import { describe, expect, it } from "vitest";
import {
  SENZA_AGENTE,
  SENZA_CATEGORIA,
  appartieneAlPubblico,
  contaPubblico,
  famigliaCategoria,
  modoAgente,
  nomeFamiglia,
  raggruppaCategorie,
  raggruppaPerAgente,
  type ClientePubblico,
  type RegolaPubblico,
} from "@/lib/portali/campagne/regola";

const c = (codice: string, agente: string | null, comm: string | null, att: string | null, nome = `Cliente ${codice}`): ClientePubblico => ({
  codice_cliente: codice,
  ragione_sociale: nome,
  agente_nome: agente,
  cat_commerciale: comm,
  cat_attivita: att,
});

// Stesso insieme di dati e stessi risultati attesi del collaudo SQL della migration 133
// (scratchpad/pg/t133.mjs): se la regola in TypeScript e quella in SQL divergessero, la
// pagina mostrerebbe un numero e il database ne salverebbe un altro.
const CLIENTI = [
  c("1", "AIRFLUID", "Attivo", "COSTR. macch.automatiche"),
  c("2", "AIRFLUID", "Attivo", "IMP. impiantisti"),
  c("3", "AIRFLUID", "Attivo", "UT.FIN. tornerie/off.mecc."),
  c("4", "AIRFLUID", "Potenziale", "COSTR. macch.automatiche"),
  c("5", "DANIELE BONI", "Attivo", "COSTR. attrezzature"),
  c("6", "VALERIA BATTELANI", "Attivo", "UT.FIN. altre produzioni"),
  c("8", null, null, null),
];
const base: RegolaPubblico = { agenti: ["AIRFLUID"], categorie_commerciali: ["Attivo"], categorie_attivita: [], clienti_extra: [] };
const codici = (r: RegolaPubblico) => CLIENTI.filter((x) => appartieneAlPubblico(x, r)).map((x) => x.codice_cliente);

describe("la regola del pubblico standard (parità con la funzione SQL)", () => {
  it("agente + categoria commerciale, senza filtro per attività", () => {
    expect(codici(base)).toEqual(["1", "2", "3"]);
  });

  it("solo alcune categorie di attività", () => {
    expect(codici({ ...base, categorie_attivita: ["COSTR. macch.automatiche", "IMP. impiantisti"] })).toEqual(["1", "2"]);
  });

  it("maiuscole e spazi non contano", () => {
    expect(codici({ ...base, categorie_attivita: ["costr. MACCH.automatiche "] })).toEqual(["1"]);
    expect(codici({ ...base, agenti: ["airfluid "], categorie_commerciali: [" attivo"] })).toEqual(["1", "2", "3"]);
  });

  it("i clienti scelti a mano entrano a prescindere dal filtro per attività", () => {
    const r = { ...base, categorie_attivita: ["COSTR. macch.automatiche"], clienti_extra: ["5", "6"] };
    expect(codici(r)).toEqual(["1", "5", "6"]);
  });

  it("un extra non rivenditore entra anche se non è Attivo e il suo agente non è fra i «tutti»", () => {
    expect(codici({ ...base, agenti: [], clienti_extra: ["4"] })).toEqual(["4"]);
  });

  it("senza categorie commerciali o senza agenti non entra nessuno per agente", () => {
    expect(codici({ ...base, categorie_commerciali: [] })).toEqual([]);
    expect(codici({ ...base, agenti: [] })).toEqual([]);
  });

  it("un cliente senza categoria di attività entra solo se non si filtra per attività", () => {
    const senza = [c("9", "AIRFLUID", "Attivo", null)];
    expect(contaPubblico(senza, base)).toBe(1);
    expect(contaPubblico(senza, { ...base, categorie_attivita: ["IMP. impiantisti"] })).toBe(0);
  });

  it("contaPubblico conta quanto appartieneAlPubblico", () => {
    expect(contaPubblico(CLIENTI, base)).toBe(3);
  });
});

describe("agenti", () => {
  it("raggruppa per agente, i più numerosi per primi e «senza agente» in fondo", () => {
    const g = raggruppaPerAgente(CLIENTI);
    expect(g.map((x) => [x.agente, x.clienti.length])).toEqual([
      ["AIRFLUID", 4],
      ["DANIELE BONI", 1],
      ["VALERIA BATTELANI", 1],
      [SENZA_AGENTE, 1],
    ]);
  });

  it("i clienti di un agente sono in ordine alfabetico", () => {
    const g = raggruppaPerAgente([c("2", "A", null, null, "Zeta"), c("1", "A", null, null, "Alfa")]);
    expect(g[0].clienti.map((x) => x.ragione_sociale)).toEqual(["Alfa", "Zeta"]);
  });

  it("modoAgente: tutti, scelti a mano o nessuno", () => {
    const boni = CLIENTI.filter((x) => x.agente_nome === "DANIELE BONI");
    expect(modoAgente("AIRFLUID", base, [])).toBe("tutti");
    expect(modoAgente("airfluid", base, [])).toBe("tutti");
    expect(modoAgente("DANIELE BONI", { ...base, clienti_extra: ["5"] }, boni)).toBe("scelti");
    expect(modoAgente("DANIELE BONI", base, boni)).toBe("nessuno");
  });
});

describe("categorie di attività", () => {
  it("la famiglia è il testo prima del primo spazio o trattino", () => {
    expect(famigliaCategoria("COSTR. macch.automatiche")).toBe("COSTR.");
    expect(famigliaCategoria("UT.FIN. tornerie/off.mecc.")).toBe("UT.FIN.");
    expect(famigliaCategoria("UFSTAB-STAB.ALIMENTARI")).toBe("UFSTAB");
    expect(famigliaCategoria("VARIEE (enti-scuole-pers.fis.-edil.)")).toBe("VARIEE");
    expect(famigliaCategoria(null)).toBe(SENZA_CATEGORIA);
    expect(famigliaCategoria("-")).toBe(SENZA_CATEGORIA);
  });

  it("scioglie le abbreviazioni note e lascia il codice a quelle sconosciute", () => {
    expect(nomeFamiglia("COSTR.")).toBe("Costruttori");
    expect(nomeFamiglia("IMP.")).toBe("Impiantisti");
    expect(nomeFamiglia("RIP.")).toBe("Riparatori");
    expect(nomeFamiglia("UFSTAB")).toBe("UFSTAB");
  });

  it("raggruppa per famiglia con i conteggi, le più grandi prima e «senza categoria» in fondo", () => {
    const f = raggruppaCategorie(CLIENTI);
    expect(f.map((x) => [x.famiglia, x.clienti])).toEqual([
      ["COSTR.", 3],
      ["UT.FIN.", 2],
      ["IMP.", 1],
      [SENZA_CATEGORIA, 1],
    ]);
    const costr = f.find((x) => x.famiglia === "COSTR.")!;
    expect(costr.nome).toBe("Costruttori");
    expect(costr.categorie).toEqual([
      { categoria: "COSTR. macch.automatiche", clienti: 2 },
      { categoria: "COSTR. attrezzature", clienti: 1 },
    ]);
  });
});
