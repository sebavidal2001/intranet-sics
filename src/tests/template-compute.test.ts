import { describe, it, expect } from "vitest";
import { calcolaArticoli, calcolaServizi, type TemplateProdotto } from "@/lib/portali/preventivatore/template/types";

function tpl(p: Partial<TemplateProdotto>): TemplateProdotto {
  return {
    nome: "T", slug: "t", attivo: true, ordine: 1,
    imballaggio_pct: 1, tempi_accessori_pct: 2.8, spese_generali_pct: 24.2,
    margine_default_pct: 5, ricarico_materiale_default: 0.5, ricarico_manodopera_default: 0.7,
    parametri: [], righe_materiale: [], righe_manodopera: [], ...p,
  };
}

describe("template compute — calcolaArticoli", () => {
  const t = tpl({
    parametri: [
      { slug: "larghezza", label: "Larghezza", tipo: "number", valore_default: "0" },
      { slug: "n_gradini", label: "N gradini", tipo: "number", valore_default: "0" },
    ],
    righe_materiale: [
      { slug: "fiancate", descrizione: "FIANCATE", ricarico_default: 0.65, qta_manuale: 3, costo_corrente: 24.2 },
      { slug: "gradino", descrizione: "GRADINO", ricarico_default: 0.65, qta_formula: "(larghezza/1000)*n_gradini", qta_manuale: 0, costo_corrente: 37.5 },
      { slug: "tubo", descrizione: "TUBO", ricarico_default: 0.65, qta_formula: "fiancate*2", qta_manuale: 0, costo_manuale: 5.4 },
      { slug: "listino_row", descrizione: "DA LISTINO", ricarico_default: 0.65, qta_manuale: 1, usa_listino: true, costo_manuale: 99 },
    ],
  });

  it("risolve quantità da parametri e da altre righe", () => {
    const a = calcolaArticoli(t, { larghezza: 2000, n_gradini: 5 });
    const byDesc = Object.fromEntries(a.map((r) => [r.descrizione, r]));
    expect(byDesc["GRADINO"].qty).toBe(10);      // (2000/1000)*5
    expect(byDesc["TUBO"].qty).toBe(6);           // fiancate(3)*2
    expect(byDesc["FIANCATE"].qty).toBe(3);
  });

  it("costo: corrente da anagrafica > manuale; usa_listino = placeholder 0", () => {
    const a = calcolaArticoli(t, {});
    const byDesc = Object.fromEntries(a.map((r) => [r.descrizione, r]));
    expect(byDesc["FIANCATE"].ult_costo).toBe(24.2);   // costo_corrente
    expect(byDesc["TUBO"].ult_costo).toBe(5.4);         // fallback manuale
    expect(byDesc["DA LISTINO"].ult_costo).toBe(0);     // listino non disponibile
  });
});

describe("template compute — calcolaServizi", () => {
  const t = tpl({
    righe_manodopera: [
      { label: "PROGETTAZIONE", tariffa_default: 33.61, unita_tempo: "h", tempo_default: 8, modalita: "una_tantum", ricarico_default: 0.7 },
      { label: "TAGLIO", tariffa_default: 27.98, unita_tempo: "min", tempo_default: 120, modalita: "per_pezzo", ricarico_default: 0.7 },
    ],
  });

  it("ore dirette per unita_tempo=h; minuti convertiti in ore", () => {
    const s = calcolaServizi(t, {});
    const byNome = Object.fromEntries(s.map((r) => [r.nome, r]));
    expect(byNome["PROGETTAZIONE"].ore).toBe(8);
    expect(byNome["TAGLIO"].ore).toBe(2);           // 120 min → 2 h
    expect(byNome["PROGETTAZIONE"].scala_con_quantita).toBe(false); // una_tantum
    expect(byNome["TAGLIO"].scala_con_quantita).toBe(true);          // per_pezzo
  });
});
