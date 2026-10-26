import { describe, expect, it } from "vitest";
import { PostBodySchema } from "@/lib/portali/preventivatore/documenti-schema";

const base = (servizi: unknown[], articoli: unknown[] = []) => ({
  codice: "G_TEST",
  cliente_text: "TEST",
  blocchi: [{ nome: "B1", tipo: "Altro", quantita_pezzi: 3, articoli, servizi }],
});

const articolo = { codice: "AFD.00.2.00019.0", descrizione: "rullo", qty: 2, ult_costo: 16.93, coeff_ricarico: 0.5 };
const distinta = { nome: "Manodopera da distinta", categoria: "Da distinta", ore: 1, tariffa_ora: 4321.5, coeff_ricarico: 0.5, scala_con_quantita: true, split_componente: "manodopera" };
const manuale = { nome: "Saldatura", categoria: "x", ore: 2, tariffa_ora: 40, coeff_ricarico: 0.5 };

describe("schema del builder con lo split (migration 158)", () => {
  it("accetta l'articolo con le componenti spostate e conserva il campo split", () => {
    const r = PostBodySchema.safeParse(base([], [{ ...articolo, split: { manodopera: 19.77, lavorazione: 0, lav_esterna: 0.75, altro: 0 } }]));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.blocchi[0].articoli[0].split?.lav_esterna).toBe(0.75);
  });

  it("accetta una riga da distinta oltre il tetto orario e ne conserva la componente", () => {
    const r = PostBodySchema.safeParse(base([distinta, manuale], [articolo]));
    expect(r.success).toBe(true);
    if (r.success) {
      const s = r.data.blocchi[0].servizi as Array<{ split_componente?: string; tariffa_ora: number }>;
      expect(s[0].split_componente).toBe("manodopera");
      expect(s[0].tariffa_ora).toBe(4321.5);
      expect(s[1].split_componente).toBeUndefined();
    }
  });

  it("il tetto orario resta per le lavorazioni scelte a mano", () => {
    expect(PostBodySchema.safeParse(base([{ ...manuale, tariffa_ora: 4321.5 }], [articolo])).success).toBe(false);
  });

  it("rifiuta una componente che non esiste", () => {
    expect(PostBodySchema.safeParse(base([{ ...distinta, split_componente: "sconto" }], [articolo])).success).toBe(false);
  });
});
