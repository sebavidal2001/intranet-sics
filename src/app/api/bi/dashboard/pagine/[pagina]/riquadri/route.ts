import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, negato } from "../../../../_comune";
import { createAdminClient } from "@/lib/supabase/admin";
import { graficoValido, interoTra, oggettoJson, registraOperazione, UUID_VALIDO } from "../../../_utili";

export const dynamic = "force-dynamic";

type Contesto = { params: Promise<{ pagina: string }> };

async function proprietarioPagina(paginaId: string) {
  return createAdminClient()
    .schema("bi_direzionale")
    .from("dashboard_pagine")
    .select("id,dashboard_id,dashboard!inner(autore_id,di_sistema)")
    .eq("id", paginaId)
    .maybeSingle();
}

function statoDashboard(valore: unknown): { autoreId: string | null; diSistema: boolean } {
  if (!oggettoJson(valore)) return { autoreId: null, diSistema: false };
  return {
    autoreId: typeof valore.autore_id === "string" ? valore.autore_id : null,
    diSistema: valore.di_sistema === true,
  };
}

export async function POST(request: NextRequest, { params }: Contesto) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  const { pagina } = await params;
  if (!UUID_VALIDO.test(pagina)) return errore("Identificativo pagina non valido");

  let body: {
    analisi_id?: unknown;
    titolo?: unknown;
    larghezza?: unknown;
    altezza?: unknown;
    grafico?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }
  if (typeof body.analisi_id !== "string" || !UUID_VALIDO.test(body.analisi_id)) {
    return errore("Identificativo analisi non valido");
  }
  if (body.titolo !== undefined && body.titolo !== null && typeof body.titolo !== "string") {
    return errore("Titolo riquadro non valido");
  }
  if (body.larghezza !== undefined && !interoTra(body.larghezza, 1, 12)) return errore("Larghezza non valida");
  if (body.altezza !== undefined && !interoTra(body.altezza, 1, 12)) return errore("Altezza non valida");
  if (body.grafico !== undefined && body.grafico !== null && !graficoValido(body.grafico)) {
    return errore("Tipo di grafico non valido");
  }

  const { data: paginaDb, error: errorePagina } = await proprietarioPagina(pagina);
  if (errorePagina) return errore("Impossibile verificare la pagina.", 500);
  if (!paginaDb) return errore("Pagina non trovata", 404);
  const dashboard = statoDashboard(paginaDb.dashboard);
  if (dashboard.diSistema) {
    return negato("Il Cruscotto di sistema non si modifica: duplicalo per creare la tua versione.");
  }
  if (dashboard.autoreId !== pre.accesso.userId) {
    await registraOperazione(pre.accesso, "negato", { errore: "Aggiunta riquadro consentita solo all'autore." });
    return negato("Puoi aggiungere riquadri soltanto alle tue dashboard.");
  }

  const database = createAdminClient().schema("bi_direzionale");
  const { data: analisi, error: erroreAnalisi } = await database
    .from("analisi")
    .select("id,autore_id,visibilita")
    .eq("id", body.analisi_id)
    .maybeSingle();
  if (erroreAnalisi) return errore("Impossibile verificare l'analisi.", 500);
  if (!analisi) return errore("Analisi non trovata", 404);
  if (analisi.autore_id !== pre.accesso.userId && analisi.visibilita !== "condivisa") {
    return negato("Non puoi aggiungere un'analisi privata di un altro autore.");
  }

  const { data: ultimo, error: erroreOrdine } = await database
    .from("dashboard_riquadri")
    .select("posizione")
    .eq("pagina_id", pagina)
    .order("posizione", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erroreOrdine) return errore("Impossibile determinare la posizione del riquadro.", 500);

  const titolo = typeof body.titolo === "string" && body.titolo.trim() ? body.titolo.trim() : null;
  const { data, error: erroreDb } = await database
    .from("dashboard_riquadri")
    .insert({
      pagina_id: pagina,
      analisi_id: body.analisi_id,
      titolo,
      posizione: (ultimo?.posizione ?? -1) + 1,
      larghezza: body.larghezza ?? 6,
      altezza: body.altezza ?? 4,
      grafico: body.grafico ?? null,
    })
    .select("id,pagina_id,analisi_id,titolo,posizione,larghezza,altezza,grafico,creato_il")
    .single();
  if (erroreDb?.code === "23505") {
    return errore("Questa analisi e gia presente nella pagina.", 409);
  }
  if (erroreDb) return errore("Impossibile aggiungere il riquadro.", 500);

  await registraOperazione(pre.accesso, "ok", { righe: 1 });
  return NextResponse.json({ riquadro: data }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: Contesto) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  const { pagina } = await params;
  if (!UUID_VALIDO.test(pagina)) return errore("Identificativo pagina non valido");

  let body: { riquadri?: unknown };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }
  if (!Array.isArray(body.riquadri) || body.riquadri.length === 0 || !body.riquadri.every(oggettoJson)) {
    return errore("Elenco riquadri non valido");
  }
  const riquadri = body.riquadri;
  for (const riquadro of riquadri) {
    if (typeof riquadro.id !== "string" || !UUID_VALIDO.test(riquadro.id)) return errore("Identificativo riquadro non valido");
    if (riquadro.posizione !== undefined && !interoTra(riquadro.posizione, 0, 10_000)) return errore("Posizione non valida");
    if (riquadro.larghezza !== undefined && !interoTra(riquadro.larghezza, 1, 12)) return errore("Larghezza non valida");
    if (riquadro.altezza !== undefined && !interoTra(riquadro.altezza, 1, 12)) return errore("Altezza non valida");
    if (riquadro.titolo !== undefined && riquadro.titolo !== null && typeof riquadro.titolo !== "string") return errore("Titolo non valido");
    if (riquadro.grafico !== undefined && riquadro.grafico !== null && !graficoValido(riquadro.grafico)) return errore("Tipo di grafico non valido");
  }

  const { data: paginaDb, error: errorePagina } = await proprietarioPagina(pagina);
  if (errorePagina) return errore("Impossibile verificare la pagina.", 500);
  if (!paginaDb) return errore("Pagina non trovata", 404);
  const dashboard = statoDashboard(paginaDb.dashboard);
  if (dashboard.diSistema) {
    return negato("Il Cruscotto di sistema non si modifica: duplicalo per creare la tua versione.");
  }
  if (dashboard.autoreId !== pre.accesso.userId) {
    await registraOperazione(pre.accesso, "negato", { errore: "Modifica riquadri consentita solo all'autore." });
    return negato("Puoi modificare riquadri soltanto nelle tue dashboard.");
  }

  const database = createAdminClient().schema("bi_direzionale");
  const ids = riquadri.map((riquadro) => String(riquadro.id));
  const { data: esistenti, error: erroreLettura } = await database
    .from("dashboard_riquadri")
    .select("id,pagina_id")
    .in("id", ids);
  if (erroreLettura) return errore("Impossibile verificare i riquadri.", 500);
  if ((esistenti?.length ?? 0) !== ids.length || esistenti?.some((riquadro) => riquadro.pagina_id !== pagina)) {
    return errore("Uno o piu riquadri non appartengono alla pagina.", 400);
  }

  const esiti = await Promise.all(riquadri.map((riquadro) => {
    const modifiche: Record<string, unknown> = {};
    if (riquadro.posizione !== undefined) modifiche.posizione = riquadro.posizione;
    if (riquadro.larghezza !== undefined) modifiche.larghezza = riquadro.larghezza;
    if (riquadro.altezza !== undefined) modifiche.altezza = riquadro.altezza;
    if (riquadro.titolo !== undefined) {
      modifiche.titolo = typeof riquadro.titolo === "string" && riquadro.titolo.trim() ? riquadro.titolo.trim() : null;
    }
    if (riquadro.grafico !== undefined) modifiche.grafico = riquadro.grafico;
    return database.from("dashboard_riquadri").update(modifiche).eq("id", riquadro.id).eq("pagina_id", pagina);
  }));
  const fallito = esiti.find((esito) => esito.error);
  if (fallito?.error) return errore("Impossibile aggiornare tutti i riquadri.", 500);

  await registraOperazione(pre.accesso, "ok", { righe: riquadri.length });
  return NextResponse.json({ aggiornati: riquadri.length });
}

export async function DELETE(request: NextRequest, { params }: Contesto) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  const { pagina } = await params;
  const riquadro = request.nextUrl.searchParams.get("riquadro")?.trim() ?? "";
  if (!UUID_VALIDO.test(pagina)) return errore("Identificativo pagina non valido");
  if (!UUID_VALIDO.test(riquadro)) return errore("Identificativo riquadro non valido");

  const { data: paginaDb, error: errorePagina } = await proprietarioPagina(pagina);
  if (errorePagina) return errore("Impossibile verificare la pagina.", 500);
  if (!paginaDb) return errore("Pagina non trovata", 404);
  const dashboard = statoDashboard(paginaDb.dashboard);
  if (dashboard.diSistema) {
    return negato("Il Cruscotto di sistema non si modifica: duplicalo per creare la tua versione.");
  }
  if (dashboard.autoreId !== pre.accesso.userId) {
    await registraOperazione(pre.accesso, "negato", { errore: "Rimozione riquadro consentita solo all'autore." });
    return negato("Puoi togliere riquadri soltanto dalle tue dashboard.");
  }

  const database = createAdminClient().schema("bi_direzionale");
  const { data: esistente, error: erroreLettura } = await database
    .from("dashboard_riquadri")
    .select("id,pagina_id")
    .eq("id", riquadro)
    .maybeSingle();
  if (erroreLettura) return errore("Impossibile verificare il riquadro.", 500);
  if (!esistente) return errore("Riquadro non trovato", 404);
  if (esistente.pagina_id !== pagina) return errore("Il riquadro non appartiene alla pagina.", 400);

  const { error: erroreDb } = await database
    .from("dashboard_riquadri")
    .delete()
    .eq("id", riquadro)
    .eq("pagina_id", pagina);
  if (erroreDb) return errore("Impossibile togliere il riquadro.", 500);

  await registraOperazione(pre.accesso, "ok", { righe: 1 });
  return NextResponse.json({ eliminato: true });
}
