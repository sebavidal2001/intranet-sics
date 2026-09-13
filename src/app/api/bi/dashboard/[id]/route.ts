import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, negato } from "../../_comune";
import { createAdminClient } from "@/lib/supabase/admin";
import { oggettoJson, registraOperazione, UUID_VALIDO } from "../_utili";

export const dynamic = "force-dynamic";

type Contesto = { params: Promise<{ id: string }> };

async function dashboardAutore(id: string) {
  return createAdminClient()
    .schema("bi_direzionale")
    .from("dashboard")
    .select("id,autore_id,di_sistema")
    .eq("id", id)
    .maybeSingle();
}

export async function GET(_request: NextRequest, { params }: Contesto) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  const { id } = await params;
  if (!UUID_VALIDO.test(id)) return errore("Identificativo dashboard non valido");

  // La RPC restituisce l'albero completo in un viaggio e, soprattutto, solo
  // spec: i risultati vengono sempre ricalcolati nel perimetro di chi apre.
  const { data, error: erroreDb } = await createAdminClient()
    .schema("bi_direzionale")
    .rpc("dashboard_completa", { p_dashboard_id: id });

  if (erroreDb) {
    await registraOperazione(pre.accesso, "errore", { errore: erroreDb.message });
    return errore("Impossibile leggere la dashboard.", 500);
  }
  if (!data) return errore("Dashboard non trovata", 404);
  if (!oggettoJson(data)) return errore("Formato dashboard non valido.", 500);

  const visibile = data.autore_id === pre.accesso.userId || data.visibilita === "condivisa";
  if (!visibile) {
    await registraOperazione(pre.accesso, "negato", { errore: "Dashboard non visibile." });
    return negato("Non puoi aprire questa dashboard.");
  }

  await registraOperazione(pre.accesso, "ok", { righe: 1 });
  return NextResponse.json({
    dashboard: {
      ...data,
      modificabile: data.autore_id === pre.accesso.userId && data.di_sistema !== true,
    },
  });
}

export async function PATCH(request: NextRequest, { params }: Contesto) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  const { id } = await params;
  if (!UUID_VALIDO.test(id)) return errore("Identificativo dashboard non valido");

  let body: { titolo?: unknown; descrizione?: unknown; visibilita?: unknown };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }

  const { data: esistente, error: erroreLettura } = await dashboardAutore(id);
  if (erroreLettura) return errore("Impossibile verificare la dashboard.", 500);
  if (!esistente) return errore("Dashboard non trovata", 404);
  if (esistente.di_sistema) {
    return negato("Il Cruscotto di sistema non si modifica: duplicalo per creare la tua versione.");
  }
  if (esistente.autore_id !== pre.accesso.userId) {
    await registraOperazione(pre.accesso, "negato", { errore: "Modifica consentita solo all'autore." });
    return negato("Puoi modificare soltanto le tue dashboard.");
  }

  const modifiche: Record<string, string | null> = {};
  if (body.titolo !== undefined) {
    const titolo = typeof body.titolo === "string" ? body.titolo.trim() : "";
    if (!titolo) return errore("Titolo obbligatorio");
    modifiche.titolo = titolo;
  }
  if (body.descrizione !== undefined) {
    if (body.descrizione !== null && typeof body.descrizione !== "string") {
      return errore("Descrizione non valida");
    }
    modifiche.descrizione = typeof body.descrizione === "string" && body.descrizione.trim()
      ? body.descrizione.trim()
      : null;
  }
  if (body.visibilita !== undefined) {
    if (body.visibilita !== "privata" && body.visibilita !== "condivisa") {
      return errore("Visibilita non valida");
    }
    modifiche.visibilita = body.visibilita;
  }
  if (Object.keys(modifiche).length === 0) return errore("Nessuna modifica richiesta");

  const { data, error: erroreDb } = await createAdminClient()
    .schema("bi_direzionale")
    .from("dashboard")
    .update({ ...modifiche, aggiornato_il: new Date().toISOString() })
    .eq("id", id)
    .eq("autore_id", pre.accesso.userId)
    .select("id,titolo,descrizione,autore_id,visibilita,creato_il,aggiornato_il")
    .single();
  if (erroreDb) return errore("Impossibile aggiornare la dashboard.", 500);

  await registraOperazione(pre.accesso, "ok", { righe: 1 });
  return NextResponse.json({ dashboard: data });
}

export async function DELETE(_request: NextRequest, { params }: Contesto) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  const { id } = await params;
  if (!UUID_VALIDO.test(id)) return errore("Identificativo dashboard non valido");

  const { data: esistente, error: erroreLettura } = await dashboardAutore(id);
  if (erroreLettura) return errore("Impossibile verificare la dashboard.", 500);
  if (!esistente) return errore("Dashboard non trovata", 404);
  if (esistente.di_sistema) {
    return negato("Il Cruscotto di sistema non si elimina: duplicalo per creare la tua versione.");
  }
  if (esistente.autore_id !== pre.accesso.userId) {
    await registraOperazione(pre.accesso, "negato", { errore: "Eliminazione consentita solo all'autore." });
    return negato("Puoi eliminare soltanto le tue dashboard.");
  }

  const { error: erroreDb } = await createAdminClient()
    .schema("bi_direzionale")
    .from("dashboard")
    .delete()
    .eq("id", id)
    .eq("autore_id", pre.accesso.userId);
  if (erroreDb) return errore("Impossibile eliminare la dashboard.", 500);

  await registraOperazione(pre.accesso, "ok", { righe: 1 });
  return NextResponse.json({ eliminata: true });
}
