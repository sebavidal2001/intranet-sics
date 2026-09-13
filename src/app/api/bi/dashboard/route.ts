/**
 * Elenco e creazione delle dashboard.
 *
 * Alla creazione nasce anche la prima pagina: una dashboard senza pagine non è
 * apribile, e costringerebbe l'utente a un secondo passaggio per arrivare a
 * qualcosa che si possa guardare.
 */

import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore } from "../_comune";
import { createAdminClient } from "@/lib/supabase/admin";
import { registraOperazione } from "./_utili";

export const dynamic = "force-dynamic";

interface DashboardElencoDb {
  id: string;
  titolo: string;
  descrizione: string | null;
  autore_id: string;
  visibilita: "privata" | "condivisa";
  creato_il: string;
  aggiornato_il: string;
  chiave: string | null;
  di_sistema: boolean;
  dashboard_pagine?: Array<{ count: number }>;
}

export async function GET() {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  const { data, error: erroreDb } = await createAdminClient()
    .schema("bi_direzionale")
    .from("dashboard")
    .select("id,titolo,descrizione,autore_id,visibilita,creato_il,aggiornato_il,chiave,di_sistema,dashboard_pagine(count)")
    .or(`autore_id.eq.${pre.accesso.userId},visibilita.eq.condivisa`)
    .order("aggiornato_il", { ascending: false });

  if (erroreDb) {
    await registraOperazione(pre.accesso, "errore", { errore: erroreDb.message });
    return errore("Impossibile leggere le dashboard.", 500);
  }

  const dashboard = ((data ?? []) as DashboardElencoDb[]).map(({ dashboard_pagine, ...voce }) => ({
    ...voce,
    conteggio_pagine: dashboard_pagine?.[0]?.count ?? 0,
  }));
  await registraOperazione(pre.accesso, "ok", { righe: dashboard.length });
  return NextResponse.json({ dashboard });
}

export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  let body: { titolo?: unknown; descrizione?: unknown; visibilita?: unknown };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }

  const titolo = typeof body.titolo === "string" ? body.titolo.trim() : "";
  if (!titolo) return errore("Titolo obbligatorio");
  const descrizione = typeof body.descrizione === "string" && body.descrizione.trim()
    ? body.descrizione.trim()
    : null;
  const visibilita = body.visibilita ?? "privata";
  if (visibilita !== "privata" && visibilita !== "condivisa") {
    return errore("Visibilita non valida");
  }

  const database = createAdminClient().schema("bi_direzionale");
  const { data: dashboard, error: erroreDashboard } = await database
    .from("dashboard")
    .insert({ titolo, descrizione, visibilita, autore_id: pre.accesso.userId })
    .select("id,titolo,descrizione,autore_id,visibilita,creato_il,aggiornato_il")
    .single();

  if (erroreDashboard || !dashboard) {
    await registraOperazione(pre.accesso, "errore", { errore: erroreDashboard?.message });
    return errore("Impossibile creare la dashboard.", 500);
  }

  const { data: pagina, error: errorePagina } = await database
    .from("dashboard_pagine")
    .insert({ dashboard_id: dashboard.id, titolo: "Pagina 1", ordine: 0, filtri: {} })
    .select("id,dashboard_id,titolo,ordine,filtri,creato_il")
    .single();

  if (errorePagina || !pagina) {
    // La dashboard senza pagine non e utilizzabile: il ripiego ristabilisce
    // l'invariante quando i due inserimenti non possono stare in una RPC unica.
    await database.from("dashboard").delete().eq("id", dashboard.id);
    await registraOperazione(pre.accesso, "errore", { errore: errorePagina?.message });
    return errore("Impossibile creare la prima pagina della dashboard.", 500);
  }

  await registraOperazione(pre.accesso, "ok", { righe: 2 });
  return NextResponse.json({ dashboard: { ...dashboard, pagine: [{ ...pagina, riquadri: [] }] } }, { status: 201 });
}
