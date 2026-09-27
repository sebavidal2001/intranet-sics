import { z } from "zod";

// Lo schema limita le DIMENSIONI dello stato del builder; sulla forma è tollerante:
// il builder manda `coeff_ricarico` sulle lavorazioni (non `markup_pct`) e totali
// calcolati che possono valere NaN. Con uno schema rigido la chat del
// configuratore rispondeva 400 appena c'era una lavorazione (27/09/2026).
const num = z.number().catch(0);
const testoBreve = (max: number) => z.string().max(max).catch("");
export const builderStateSchema = z.object({
  titolo: z.string().max(2_000).nullable().catch(null),
  cliente: z.object({
    id: z.string().uuid().nullable().optional().catch(null),
    ragione_sociale: testoBreve(2_000),
    piva: z.string().max(100).nullable().catch(null),
    citta: z.string().max(200).nullable().catch(null),
    provincia: z.string().max(20).nullable().catch(null),
  }).nullable(),
  data_consegna: z.string().max(100).nullable().catch(null),
  blocchi: z.array(z.object({
    numero: num, tipo: testoBreve(500), nome: testoBreve(2_000), note: testoBreve(20_000),
    articoli: z.array(z.object({
      codice: testoBreve(500), descrizione: testoBreve(5_000), qty: num, ult_costo: num, coeff_ricarico: num, netto: num,
    })).max(2_000),
    lavorazioni: z.array(z.object({
      nome: testoBreve(2_000), categoria: testoBreve(500), ore: num, tariffa_ora: num,
      markup_pct: z.number().optional().catch(undefined), coeff_ricarico: z.number().optional().catch(undefined), totale: num,
    })).max(1_000),
    totale_materiali: num, totale_servizi: num, totale_blocco: num,
  })).max(500),
  totali: z.object({
    materiali: num, servizi: num, netto_totale: num, n_blocchi: num, n_articoli: num, ore_totali: num, coeff_ricarico_medio: num,
  }),
});
