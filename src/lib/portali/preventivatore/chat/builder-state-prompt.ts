// ─── Formatter del builder state per system prompt AI ────────────────────────
// Trasforma lo snapshot del builder in una rappresentazione testuale compatta
// e leggibile dall'LLM, da iniettare in coda al system instruction.

import type { BuilderStateForChat } from "./types";

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
}

/**
 * Formatta lo stato corrente del preventivo (in costruzione) come testo
 * strutturato, da iniettare nel system prompt della chat builder-aware.
 */
export function formatBuilderStateForPrompt(state: BuilderStateForChat): string {
  if (!state) return "";

  const out: string[] = [];
  out.push("");
  out.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  out.push("STATO ATTUALE DEL PREVENTIVO IN COSTRUZIONE (LIVE)");
  out.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  out.push(`Titolo:        ${state.titolo ?? "(non impostato)"}`);
  if (state.cliente) {
    const c = state.cliente;
    const extra = [c.piva && `P.IVA ${c.piva}`, c.citta, c.provincia].filter(Boolean).join(" · ");
    out.push(`Cliente:       ${c.ragione_sociale}${extra ? "  (" + extra + ")" : ""}`);
  } else {
    out.push("Cliente:       (nessun cliente selezionato)");
  }
  out.push(`Data consegna: ${state.data_consegna ?? "(non impostata)"}`);
  out.push("");

  // Totali in evidenza
  const t = state.totali;
  out.push(`TOTALI: materiali ${eur(t.materiali)} · servizi ${eur(t.servizi)} · NETTO ${eur(t.netto_totale)}`);
  out.push(`        ${t.n_blocchi} blocchi · ${t.n_articoli} articoli · ${t.ore_totali.toFixed(1)} ore di lavorazione · coeff. ricarico medio ${t.coeff_ricarico_medio.toFixed(2)}`);
  out.push("");

  if (state.blocchi.length === 0) {
    out.push("(Nessun blocco creato — il preventivo è vuoto)");
    out.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    return out.join("\n");
  }

  for (const b of state.blocchi) {
    out.push(`──── BLOCCO B${b.numero} ──── "${b.nome || "(senza nome)"}"  [${b.tipo}]  netto ${eur(b.totale_blocco)}`);
    if (b.note) out.push(`  Note: ${b.note}`);
    if (b.articoli.length > 0) {
      out.push(`  Articoli (${b.articoli.length}) — totale materiali ${eur(b.totale_materiali)}:`);
      for (const a of b.articoli) {
        out.push(
          `    · ${a.codice}  ${a.descrizione.slice(0, 50)}  qty ${a.qty}  ult.costo ${eur(a.ult_costo)}  coeff ${a.coeff_ricarico.toFixed(2)}  netto ${eur(a.netto)}`
        );
      }
    } else {
      out.push("  Articoli: (nessuno)");
    }
    if (b.lavorazioni.length > 0) {
      out.push(`  Lavorazioni (${b.lavorazioni.length}) — totale servizi ${eur(b.totale_servizi)}:`);
      for (const l of b.lavorazioni) {
        const markup = l.markup_pct > 0 ? ` +${l.markup_pct}%` : "";
        out.push(`    · [${l.categoria}] ${l.nome}  ${l.ore}h × ${eur(l.tariffa_ora)}/h${markup} = ${eur(l.totale)}`);
      }
    }
    out.push("");
  }

  out.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  out.push("Usa SEMPRE questi dati come fonte primaria per rispondere o suggerire ottimizzazioni.");

  return out.join("\n");
}
