/**
 * La semina del Cruscotto vive accanto alle API che ne possiedono la struttura:
 * una chiave stabile per livello consente di ripeterla dopo ogni rilascio senza
 * moltiplicare dashboard, pagine, analisi o riquadri.
 */

import { verificaAccesso } from "@/lib/prototipo-bi/accesso";
import { CRUSCOTTO_PREDEFINITO } from "@/lib/prototipo-bi/cruscotto-predefinito";
import { createAdminClient } from "@/lib/supabase/admin";

const CHIAVE_CRUSCOTTO = "cruscotto";

function interrompi(messaggio: string, dettaglio?: string): never {
  throw new Error(dettaglio ? `${messaggio}: ${dettaglio}` : messaggio);
}

export async function assicuraCruscottoDiSistema(): Promise<string> {
  const accesso = await verificaAccesso();
  const database = createAdminClient().schema("bi_direzionale");

  const { error: erroreInserimento } = await database.from("dashboard").upsert(
    {
      chiave: CHIAVE_CRUSCOTTO,
      titolo: "Cruscotto",
      descrizione: "La lettura direzionale condivisa: vendite, margine, back office e acquisti.",
      autore_id: accesso.userId,
      visibilita: "condivisa",
      di_sistema: true,
    },
    { onConflict: "chiave", ignoreDuplicates: true }
  );
  if (erroreInserimento) interrompi("Impossibile creare il Cruscotto", erroreInserimento.message);

  const { data: dashboard, error: erroreDashboard } = await database
    .from("dashboard")
    .select("id")
    .eq("chiave", CHIAVE_CRUSCOTTO)
    .single();
  if (erroreDashboard || !dashboard) {
    interrompi("Impossibile recuperare il Cruscotto", erroreDashboard?.message);
  }

  const { error: erroreAggiornamento } = await database
    .from("dashboard")
    .update({
      titolo: "Cruscotto",
      descrizione: "La lettura direzionale condivisa: vendite, margine, back office e acquisti.",
      visibilita: "condivisa",
      di_sistema: true,
      aggiornato_il: new Date().toISOString(),
    })
    .eq("id", dashboard.id);
  if (erroreAggiornamento) interrompi("Impossibile aggiornare il Cruscotto", erroreAggiornamento.message);

  for (const paginaPredefinita of CRUSCOTTO_PREDEFINITO) {
    const { error: erroreInserimentoPagina } = await database.from("dashboard_pagine").upsert(
      {
        dashboard_id: dashboard.id,
        chiave: paginaPredefinita.chiave,
        titolo: paginaPredefinita.titolo,
        ordine: paginaPredefinita.ordine,
        filtri: { periodo: { anno: new Date().getFullYear() } },
      },
      { onConflict: "dashboard_id,chiave", ignoreDuplicates: true }
    );
    if (erroreInserimentoPagina) {
      interrompi("Impossibile creare una pagina del Cruscotto", erroreInserimentoPagina.message);
    }

    const { data: pagina, error: errorePagina } = await database
      .from("dashboard_pagine")
      .select("id")
      .eq("dashboard_id", dashboard.id)
      .eq("chiave", paginaPredefinita.chiave)
      .single();
    if (errorePagina || !pagina) {
      interrompi("Impossibile recuperare una pagina del Cruscotto", errorePagina?.message);
    }

    const { error: erroreAggiornamentoPagina } = await database
      .from("dashboard_pagine")
      .update({
        titolo: paginaPredefinita.titolo,
        ordine: paginaPredefinita.ordine,
        filtri: { periodo: { anno: new Date().getFullYear() } },
      })
      .eq("id", pagina.id);
    if (erroreAggiornamentoPagina) {
      interrompi("Impossibile aggiornare una pagina del Cruscotto", erroreAggiornamentoPagina.message);
    }

    for (const [posizione, analisiPredefinita] of paginaPredefinita.analisi.entries()) {
      const { error: erroreInserimentoAnalisi } = await database.from("analisi").upsert(
        {
          chiave: analisiPredefinita.chiave,
          titolo: analisiPredefinita.titolo,
          descrizione: analisiPredefinita.descrizione ?? null,
          spec: analisiPredefinita.spec,
          serie: analisiPredefinita.serie ?? null,
          grafico: analisiPredefinita.grafico ?? null,
          autore_id: accesso.userId,
          visibilita: "condivisa",
        },
        { onConflict: "chiave", ignoreDuplicates: true }
      );
      if (erroreInserimentoAnalisi) {
        interrompi("Impossibile creare un'analisi del Cruscotto", erroreInserimentoAnalisi.message);
      }

      const { data: analisi, error: erroreAnalisi } = await database
        .from("analisi")
        .select("id")
        .eq("chiave", analisiPredefinita.chiave)
        .single();
      if (erroreAnalisi || !analisi) {
        interrompi("Impossibile recuperare un'analisi del Cruscotto", erroreAnalisi?.message);
      }

      const { error: erroreAggiornamentoAnalisi } = await database
        .from("analisi")
        .update({
          titolo: analisiPredefinita.titolo,
          descrizione: analisiPredefinita.descrizione ?? null,
          spec: analisiPredefinita.spec,
          serie: analisiPredefinita.serie ?? null,
          grafico: analisiPredefinita.grafico ?? null,
          visibilita: "condivisa",
          aggiornato_il: new Date().toISOString(),
        })
        .eq("id", analisi.id);
      if (erroreAggiornamentoAnalisi) {
        interrompi("Impossibile aggiornare un'analisi del Cruscotto", erroreAggiornamentoAnalisi.message);
      }

      const { error: erroreInserimentoRiquadro } = await database.from("dashboard_riquadri").upsert(
        {
          pagina_id: pagina.id,
          analisi_id: analisi.id,
          chiave: analisiPredefinita.chiave,
          titolo: analisiPredefinita.titolo,
          posizione,
          larghezza: analisiPredefinita.larghezza ?? 6,
          altezza: 4,
          grafico: analisiPredefinita.grafico ?? null,
        },
        { onConflict: "pagina_id,chiave", ignoreDuplicates: true }
      );
      if (erroreInserimentoRiquadro) {
        interrompi("Impossibile creare un riquadro del Cruscotto", erroreInserimentoRiquadro.message);
      }

      const { error: erroreAggiornamentoRiquadro } = await database
        .from("dashboard_riquadri")
        .update({
          analisi_id: analisi.id,
          titolo: analisiPredefinita.titolo,
          posizione,
          larghezza: analisiPredefinita.larghezza ?? 6,
          grafico: analisiPredefinita.grafico ?? null,
        })
        .eq("pagina_id", pagina.id)
        .eq("chiave", analisiPredefinita.chiave);
      if (erroreAggiornamentoRiquadro) {
        interrompi("Impossibile aggiornare un riquadro del Cruscotto", erroreAggiornamentoRiquadro.message);
      }
    }
  }

  return dashboard.id;
}
