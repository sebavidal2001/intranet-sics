import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, negato } from "../../../_comune";
import { createAdminClient } from "@/lib/supabase/admin";
import { interoTra, oggettoJson, registraOperazione, UUID_VALIDO } from "../../_utili";

export const dynamic = "force-dynamic";

type Contesto = { params: Promise<{ id: string }> };

async function verificaAutoreDashboard(id: string, utenteId: string) {
  const { data, error: erroreDb } = await createAdminClient()
    .schema("bi_direzionale")
    .from("dashboard")
    .select("id,autore_id,di_sistema")
    .eq("id", id)
    .maybeSingle();
  return {
    autorizzato: data?.autore_id === utenteId && data.di_sistema !== true,
    diSistema: data?.di_sistema === true,
    esiste: Boolean(data),
    erroreDb,
  };
}

export async function POST(request: NextRequest, { params }: Contesto) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  const { id } = await params;
  if (!UUID_VALIDO.test(id)) return errore("Identificativo dashboard non valido");

  let body: { titolo?: unknown; filtri?: unknown };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }
  const titolo = typeof body.titolo === "string" ? body.titolo.trim() : "";
  if (!titolo) return errore("Titolo pagina obbligatorio");
  if (body.filtri !== undefined && !oggettoJson(body.filtri)) return errore("Filtri pagina non validi");

  const verifica = await verificaAutoreDashboard(id, pre.accesso.userId);
  if (verifica.erroreDb) return errore("Impossibile verificare la dashboard.", 500);
  if (!verifica.esiste) return errore("Dashboard non trovata", 404);
  if (verifica.diSistema) {
    return negato("Il Cruscotto di sistema non si modifica: duplicalo per creare la tua versione.");
  }
  if (!verifica.autorizzato) {
    await registraOperazione(pre.accesso, "negato", { errore: "Aggiunta pagina consentita solo all'autore." });
    return negato("Puoi aggiungere pagine soltanto alle tue dashboard.");
  }

  const database = createAdminClient().schema("bi_direzionale");
  const { data: ultima, error: erroreOrdine } = await database
    .from("dashboard_pagine")
    .select("ordine")
    .eq("dashboard_id", id)
    .order("ordine", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erroreOrdine) return errore("Impossibile determinare l'ordine della pagina.", 500);

  const { data, error: erroreDb } = await database
    .from("dashboard_pagine")
    .insert({ dashboard_id: id, titolo, filtri: body.filtri ?? {}, ordine: (ultima?.ordine ?? -1) + 1 })
    .select("id,dashboard_id,titolo,ordine,filtri,creato_il")
    .single();
  if (erroreDb) return errore("Impossibile aggiungere la pagina.", 500);

  await registraOperazione(pre.accesso, "ok", { righe: 1 });
  return NextResponse.json({ pagina: { ...data, riquadri: [] } }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: Contesto) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  const { id } = await params;
  if (!UUID_VALIDO.test(id)) return errore("Identificativo dashboard non valido");

  let body: { pagine?: unknown };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }
  if (!Array.isArray(body.pagine) || body.pagine.length === 0 || !body.pagine.every(oggettoJson)) {
    return errore("Elenco pagine non valido");
  }

  const pagine = body.pagine.map((voce) => ({
    id: voce.id,
    titolo: voce.titolo,
    ordine: voce.ordine,
    filtri: voce.filtri,
  }));
  if (pagine.some((pagina) => typeof pagina.id !== "string" || !UUID_VALIDO.test(pagina.id))) {
    return errore("Identificativo pagina non valido");
  }
  for (const pagina of pagine) {
    if (pagina.titolo !== undefined && (typeof pagina.titolo !== "string" || !pagina.titolo.trim())) {
      return errore("Titolo pagina non valido");
    }
    if (pagina.ordine !== undefined && !interoTra(pagina.ordine, 0, 10_000)) return errore("Ordine pagina non valido");
    if (pagina.filtri !== undefined && !oggettoJson(pagina.filtri)) return errore("Filtri pagina non validi");
  }

  const verifica = await verificaAutoreDashboard(id, pre.accesso.userId);
  if (verifica.erroreDb) return errore("Impossibile verificare la dashboard.", 500);
  if (!verifica.esiste) return errore("Dashboard non trovata", 404);
  if (verifica.diSistema) {
    return negato("Il Cruscotto di sistema non si modifica: duplicalo per creare la tua versione.");
  }
  if (!verifica.autorizzato) {
    await registraOperazione(pre.accesso, "negato", { errore: "Modifica pagine consentita solo all'autore." });
    return negato("Puoi modificare pagine soltanto nelle tue dashboard.");
  }

  const database = createAdminClient().schema("bi_direzionale");
  const ids = pagine.map((pagina) => String(pagina.id));
  const { data: esistenti, error: erroreLettura } = await database
    .from("dashboard_pagine")
    .select("id,dashboard_id")
    .in("id", ids);
  if (erroreLettura) return errore("Impossibile verificare le pagine.", 500);
  if ((esistenti?.length ?? 0) !== ids.length || esistenti?.some((pagina) => pagina.dashboard_id !== id)) {
    return errore("Una o piu pagine non appartengono alla dashboard.", 400);
  }

  const esiti = await Promise.all(pagine.map((pagina) => {
    const modifiche: Record<string, unknown> = {};
    if (pagina.titolo !== undefined) modifiche.titolo = String(pagina.titolo).trim();
    if (pagina.ordine !== undefined) modifiche.ordine = pagina.ordine;
    if (pagina.filtri !== undefined) modifiche.filtri = pagina.filtri;
    return database.from("dashboard_pagine").update(modifiche).eq("id", pagina.id).eq("dashboard_id", id);
  }));
  const fallito = esiti.find((esito) => esito.error);
  if (fallito?.error) return errore("Impossibile aggiornare tutte le pagine.", 500);

  await registraOperazione(pre.accesso, "ok", { righe: pagine.length });
  return NextResponse.json({ aggiornate: pagine.length });
}
