/**
 * La duplicazione è l'unico ingresso di modifica per il Cruscotto di sistema:
 * copia anche le analisi, così la nuova dashboard non conserva riferimenti a
 * oggetti condivisi che il proprietario non controlla.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { errore, negato, preliminari } from "../../../_comune";
import { registraOperazione, UUID_VALIDO } from "../../_utili";

export const dynamic = "force-dynamic";

type Contesto = { params: Promise<{ id: string }> };

interface PaginaSorgente {
  id: string;
  titolo: string;
  ordine: number;
  filtri: Record<string, unknown>;
}

interface RiquadroSorgente {
  pagina_id: string;
  analisi_id: string;
  titolo: string | null;
  posizione: number;
  larghezza: number;
  altezza: number;
  grafico: string | null;
}

interface AnalisiSorgente {
  id: string;
  titolo: string;
  descrizione: string | null;
  spec: Record<string, unknown>;
  serie: unknown[] | null;
  grafico: string | null;
  aspetto: Record<string, unknown> | null;
}

export async function POST(_request: NextRequest, { params }: Contesto) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  const { id } = await params;
  if (!UUID_VALIDO.test(id)) return errore("Identificativo dashboard non valido");

  const database = createAdminClient().schema("bi_direzionale");
  const { data: sorgente, error: erroreSorgente } = await database
    .from("dashboard")
    .select("id,titolo,descrizione,autore_id,visibilita")
    .eq("id", id)
    .maybeSingle();
  if (erroreSorgente) return errore("Impossibile leggere la dashboard da duplicare.", 500);
  if (!sorgente) return errore("Dashboard non trovata", 404);
  if (sorgente.autore_id !== pre.accesso.userId && sorgente.visibilita !== "condivisa") {
    return negato("Non puoi duplicare una dashboard privata di un altro autore.");
  }

  const { data: pagineDati, error: errorePagine } = await database
    .from("dashboard_pagine")
    .select("id,titolo,ordine,filtri")
    .eq("dashboard_id", id)
    .order("ordine");
  if (errorePagine) return errore("Impossibile leggere le pagine da duplicare.", 500);
  const pagine = (pagineDati ?? []) as PaginaSorgente[];

  const idsPagine = pagine.map((pagina) => pagina.id);
  let riquadri: RiquadroSorgente[] = [];
  if (idsPagine.length > 0) {
    const { data, error: erroreRiquadri } = await database
      .from("dashboard_riquadri")
      .select("pagina_id,analisi_id,titolo,posizione,larghezza,altezza,grafico")
      .in("pagina_id", idsPagine)
      .order("posizione");
    if (erroreRiquadri) return errore("Impossibile leggere i riquadri da duplicare.", 500);
    riquadri = (data ?? []) as RiquadroSorgente[];
  }

  const idsAnalisi = [...new Set(riquadri.map((riquadro) => riquadro.analisi_id))];
  let analisi: AnalisiSorgente[] = [];
  if (idsAnalisi.length > 0) {
    const { data, error: erroreAnalisi } = await database
      .from("analisi")
      .select("id,titolo,descrizione,spec,serie,grafico,aspetto")
      .in("id", idsAnalisi);
    if (erroreAnalisi) return errore("Impossibile leggere le analisi da duplicare.", 500);
    analisi = (data ?? []) as AnalisiSorgente[];
  }
  if (analisi.length !== idsAnalisi.length) {
    return errore("La dashboard contiene analisi non più disponibili.", 409);
  }

  const { data: copia, error: erroreCopia } = await database
    .from("dashboard")
    .insert({
      titolo: `${sorgente.titolo} (copia)`,
      descrizione: sorgente.descrizione,
      autore_id: pre.accesso.userId,
      visibilita: "privata",
      di_sistema: false,
      chiave: null,
    })
    .select("id,titolo,descrizione,autore_id,visibilita,di_sistema")
    .single();
  if (erroreCopia || !copia) return errore("Impossibile creare la copia della dashboard.", 500);

  const nuoveAnalisi: string[] = [];
  try {
    const mappaAnalisi = new Map<string, string>();
    for (const voce of analisi) {
      const { data: nuova, error: erroreNuova } = await database
        .from("analisi")
        .insert({
          titolo: voce.titolo,
          descrizione: voce.descrizione,
          spec: voce.spec,
          // Senza le serie la copia perdeva budget, BEP e confronti: restava
          // la sola misura principale, e il riquadro cambiava significato.
          serie: voce.serie ?? null,
          grafico: voce.grafico,
          aspetto: voce.aspetto ?? null,
          autore_id: pre.accesso.userId,
          visibilita: "privata",
          chiave: null,
        })
        .select("id")
        .single();
      if (erroreNuova || !nuova) throw new Error(erroreNuova?.message ?? "Analisi non creata");
      nuoveAnalisi.push(nuova.id);
      mappaAnalisi.set(voce.id, nuova.id);
    }

    const mappaPagine = new Map<string, string>();
    for (const pagina of pagine) {
      const { data: nuova, error: erroreNuova } = await database
        .from("dashboard_pagine")
        .insert({
          dashboard_id: copia.id,
          titolo: pagina.titolo,
          ordine: pagina.ordine,
          filtri: pagina.filtri,
          chiave: null,
        })
        .select("id")
        .single();
      if (erroreNuova || !nuova) throw new Error(erroreNuova?.message ?? "Pagina non creata");
      mappaPagine.set(pagina.id, nuova.id);
    }

    for (const riquadro of riquadri) {
      const paginaId = mappaPagine.get(riquadro.pagina_id);
      const analisiId = mappaAnalisi.get(riquadro.analisi_id);
      if (!paginaId || !analisiId) throw new Error("Collegamento della copia incompleto");
      const { error: erroreNuovo } = await database.from("dashboard_riquadri").insert({
        pagina_id: paginaId,
        analisi_id: analisiId,
        titolo: riquadro.titolo,
        posizione: riquadro.posizione,
        larghezza: riquadro.larghezza,
        altezza: riquadro.altezza,
        grafico: riquadro.grafico,
        chiave: null,
      });
      if (erroreNuovo) throw new Error(erroreNuovo.message);
    }
  } catch (causa) {
    // Senza una RPC transazionale, il ripiego elimina entrambi i rami creati:
    // la cascata della dashboard non comprende le analisi private appena copiate.
    await database.from("dashboard").delete().eq("id", copia.id);
    if (nuoveAnalisi.length > 0) await database.from("analisi").delete().in("id", nuoveAnalisi);
    await registraOperazione(pre.accesso, "errore", {
      errore: causa instanceof Error ? causa.message : "Duplicazione incompleta",
    });
    return errore("Impossibile completare la duplicazione.", 500);
  }

  await registraOperazione(pre.accesso, "ok", {
    righe: 1 + pagine.length + riquadri.length + analisi.length,
  });
  return NextResponse.json({ dashboard: copia }, { status: 201 });
}
