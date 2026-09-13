import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, negato } from "../_comune";
import { createAdminClient } from "@/lib/supabase/admin";
import { registraAccesso } from "@/lib/prototipo-bi/registro";
import { SpecNonValida, validaSpec } from "@/lib/prototipo-bi/semantico";
import type { TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import type { SpecQuery } from "@/lib/prototipo-bi/tipi";

export const dynamic = "force-dynamic";

const TIPI_GRAFICO = new Set<TipoGrafico>([
  "linee",
  "barre",
  "combo",
  "torta",
  "anelli",
  "areeImpilate",
  "pareto",
  "bullet",
  "heatmap",
  "quadranti",
  "imbuto",
  "treemap",
  "sparkline",
  "kpi",
  "tabella",
]);

function graficoValido(valore: unknown): valore is TipoGrafico {
  return typeof valore === "string" && TIPI_GRAFICO.has(valore as TipoGrafico);
}

function eOggetto(valore: unknown): valore is Record<string, unknown> {
  return typeof valore === "object" && valore !== null;
}

function primaRelazione(valore: unknown): Record<string, unknown> | null {
  if (eOggetto(valore)) return valore;
  if (Array.isArray(valore) && eOggetto(valore[0])) return valore[0];
  return null;
}

interface UtilizzoAnalisi {
  dashboard_id: string;
  dashboard_titolo: string;
  pagina_id: string;
  pagina_titolo: string;
}

export async function GET() {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  const database = createAdminClient().schema("bi_direzionale");
  const { data, error: erroreDb } = await database
    .from("analisi")
    .select("id,titolo,descrizione,spec,grafico,autore_id,visibilita,creato_il,aggiornato_il,chiave")
    .or(`autore_id.eq.${pre.accesso.userId},visibilita.eq.condivisa`)
    .order("aggiornato_il", { ascending: false });

  if (erroreDb) return errore("Impossibile leggere le analisi.", 500);

  const ids = (data ?? []).map((voce) => voce.id);
  const utilizziPerAnalisi = new Map<string, UtilizzoAnalisi[]>();
  if (ids.length > 0) {
    const { data: righeUtilizzo, error: erroreUtilizzi } = await database
      .from("dashboard_riquadri")
      .select("analisi_id,dashboard_pagine!inner(id,titolo,dashboard!inner(id,titolo,autore_id,visibilita))")
      .in("analisi_id", ids);

    if (erroreUtilizzi) return errore("Impossibile leggere gli utilizzi delle analisi.", 500);

    // Una dashboard privata altrui non deve diventare visibile solo perché usa
    // un'analisi condivisa: si espongono esclusivamente contenitori già visibili.
    for (const riga of (righeUtilizzo ?? []) as unknown[]) {
      if (!eOggetto(riga) || typeof riga.analisi_id !== "string") continue;
      const pagina = primaRelazione(riga.dashboard_pagine);
      const dashboard = primaRelazione(pagina?.dashboard);
      if (
        !pagina ||
        !dashboard ||
        typeof pagina.id !== "string" ||
        typeof pagina.titolo !== "string" ||
        typeof dashboard.id !== "string" ||
        typeof dashboard.titolo !== "string"
      ) continue;
      const visibile = dashboard.autore_id === pre.accesso.userId || dashboard.visibilita === "condivisa";
      if (!visibile) continue;
      const correnti = utilizziPerAnalisi.get(riga.analisi_id) ?? [];
      correnti.push({
        dashboard_id: dashboard.id,
        dashboard_titolo: dashboard.titolo,
        pagina_id: pagina.id,
        pagina_titolo: pagina.titolo,
      });
      utilizziPerAnalisi.set(riga.analisi_id, correnti);
    }
  }

  const analisi = (data ?? []).map((voce) => ({
    ...voce,
    modificabile: voce.autore_id === pre.accesso.userId && voce.chiave === null,
    utilizzi: utilizziPerAnalisi.get(voce.id) ?? [],
  }));

  await registraAccesso({
    utenteId: pre.accesso.userId,
    livello: pre.accesso.livello,
    perimetro: pre.accesso.perimetro,
    canale: "spec",
    righe: analisi.length,
    esito: "ok",
  });
  return NextResponse.json({ analisi });
}

export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  let body: {
    titolo?: unknown;
    descrizione?: unknown;
    spec?: unknown;
    grafico?: unknown;
    visibilita?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }

  const titolo = typeof body.titolo === "string" ? body.titolo.trim() : "";
  if (!titolo) return errore("Titolo obbligatorio");
  const descrizione =
    typeof body.descrizione === "string" && body.descrizione.trim()
      ? body.descrizione.trim()
      : null;
  const visibilita = body.visibilita ?? "privata";
  if (visibilita !== "privata" && visibilita !== "condivisa") {
    return errore("Visibilita non valida");
  }
  if (body.grafico !== undefined && !graficoValido(body.grafico)) {
    return errore("Tipo di grafico non valido");
  }

  let spec: SpecQuery;
  try {
    spec = validaSpec(body.spec);
  } catch (causa) {
    if (causa instanceof SpecNonValida) return errore(causa.message, 422);
    return errore("Spec non valida", 422);
  }

  // Si persiste soltanto la domanda certificata: chi la riapre la riesegue sul
  // proprio perimetro, evitando che una condivisione trasporti dati o risultati.
  const { data, error: erroreDb } = await createAdminClient()
    .schema("bi_direzionale")
    .from("analisi")
    .insert({
      titolo,
      descrizione,
      spec,
      grafico: body.grafico ?? null,
      autore_id: pre.accesso.userId,
      visibilita,
    })
    .select("id,titolo,descrizione,spec,grafico,autore_id,visibilita,creato_il,aggiornato_il")
    .single();

  if (erroreDb) {
    await registraAccesso({
      utenteId: pre.accesso.userId,
      livello: pre.accesso.livello,
      perimetro: pre.accesso.perimetro,
      canale: "spec",
      spec,
      esito: "errore",
      errore: erroreDb.message,
    });
    return errore("Impossibile salvare l'analisi.", 500);
  }

  await registraAccesso({
    utenteId: pre.accesso.userId,
    livello: pre.accesso.livello,
    perimetro: pre.accesso.perimetro,
    canale: "spec",
    spec,
    righe: 1,
    esito: "ok",
  });
  return NextResponse.json({ analisi: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    return errore("Identificativo analisi non valido");
  }

  let body: {
    titolo?: unknown;
    descrizione?: unknown;
    spec?: unknown;
    grafico?: unknown;
    visibilita?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }

  const titolo = typeof body.titolo === "string" ? body.titolo.trim() : "";
  if (!titolo) return errore("Titolo obbligatorio");
  if (body.grafico !== undefined && !graficoValido(body.grafico)) {
    return errore("Tipo di grafico non valido");
  }
  if (body.visibilita !== undefined && body.visibilita !== "privata" && body.visibilita !== "condivisa") {
    return errore("Visibilita non valida");
  }

  let spec: SpecQuery;
  try {
    spec = validaSpec(body.spec);
  } catch (causa) {
    if (causa instanceof SpecNonValida) return errore(causa.message, 422);
    return errore("Spec non valida", 422);
  }

  const database = createAdminClient().schema("bi_direzionale");
  const { data: esistente, error: erroreLettura } = await database
    .from("analisi")
    .select("autore_id,chiave,descrizione,visibilita")
    .eq("id", id)
    .maybeSingle();
  if (erroreLettura) return errore("Impossibile verificare l'analisi.", 500);
  if (!esistente) return errore("Analisi non trovata", 404);
  if (esistente.chiave !== null) {
    return negato("Le analisi del Cruscotto di sistema non si modificano: duplicale prima.");
  }
  if (esistente.autore_id !== pre.accesso.userId) {
    return negato("Puoi modificare soltanto le tue analisi.");
  }

  const descrizione = body.descrizione === undefined
    ? esistente.descrizione
    : typeof body.descrizione === "string" && body.descrizione.trim()
      ? body.descrizione.trim()
      : null;
  const { data, error: erroreDb } = await database
    .from("analisi")
    .update({
      titolo,
      descrizione,
      spec,
      grafico: body.grafico ?? null,
      visibilita: body.visibilita ?? esistente.visibilita,
      aggiornato_il: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("autore_id", pre.accesso.userId)
    .select("id,titolo,descrizione,spec,grafico,autore_id,visibilita,creato_il,aggiornato_il")
    .single();
  if (erroreDb) return errore("Impossibile aggiornare l'analisi.", 500);

  await registraAccesso({
    utenteId: pre.accesso.userId,
    livello: pre.accesso.livello,
    perimetro: pre.accesso.perimetro,
    canale: "spec",
    spec,
    righe: 1,
    esito: "ok",
  });
  return NextResponse.json({ analisi: data });
}

export async function DELETE(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    return errore("Identificativo analisi non valido");
  }

  const database = createAdminClient().schema("bi_direzionale");
  const { data: esistente, error: erroreLettura } = await database
    .from("analisi")
    .select("autore_id,chiave")
    .eq("id", id)
    .maybeSingle();

  if (erroreLettura) return errore("Impossibile verificare l'analisi.", 500);
  if (!esistente) return errore("Analisi non trovata", 404);
  if (esistente.chiave !== null) {
    return negato("Le analisi del Cruscotto di sistema non si eliminano.");
  }
  if (esistente.autore_id !== pre.accesso.userId) {
    await registraAccesso({
      utenteId: pre.accesso.userId,
      livello: pre.accesso.livello,
      perimetro: pre.accesso.perimetro,
      canale: "spec",
      esito: "negato",
      errore: "Eliminazione consentita solo all'autore.",
    });
    return negato("Puoi eliminare soltanto le tue analisi.");
  }

  const { error: erroreDb } = await database
    .from("analisi")
    .delete()
    .eq("id", id)
    .eq("autore_id", pre.accesso.userId);
  if (erroreDb) return errore("Impossibile eliminare l'analisi.", 500);

  await registraAccesso({
    utenteId: pre.accesso.userId,
    livello: pre.accesso.livello,
    perimetro: pre.accesso.perimetro,
    canale: "spec",
    righe: 1,
    esito: "ok",
  });
  return NextResponse.json({ eliminata: true });
}
