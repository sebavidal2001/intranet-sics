/**
 * Assegnazione di una dashboard ai dipendenti.
 *
 * Solo la direzione. L'assegnazione fa tre cose in un colpo:
 *   1. registra chi riceve la dashboard (`dashboard_assegnazioni`);
 *   2. se il dipendente non ha ancora accesso al portale Statistiche BI, glielo
 *      concede col livello più basso (viewer = "solo dashboard assegnate");
 *   3. imposta il suo perimetro dati, perché senza perimetro il BI non mostra
 *      niente (fail-closed) e la dashboard arriverebbe vuota.
 *
 * Non si tocca mai un accesso negato esplicitamente dal superadmin: quel
 * "no" è una decisione, e assegnare una dashboard non la annulla.
 */

import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, negato } from "../../../_comune";
import { createAdminClient } from "@/lib/supabase/admin";
import { registraOperazione, UUID_VALIDO } from "../../_utili";

export const dynamic = "force-dynamic";

type Contesto = { params: Promise<{ id: string }> };
type TipoPerimetro = "tutto" | "agente" | "business_unit";

interface RichiestaUtente {
  id: string;
  perimetro?: { tipo: TipoPerimetro; valori: string[] };
}

const TIPI_PERIMETRO = new Set<string>(["tutto", "agente", "business_unit"]);
const UUID_NULLO = "00000000-0000-0000-0000-000000000000";

interface PermessoRiga {
  is_portal_admin: boolean | null;
  override_export: boolean | null;
  override_access: boolean | null;
}

type LivelloUtente = "superadmin" | "admin" | "exporter" | "viewer" | "negato" | null;

/** Livello sul portale ricavato dalla riga di `permessi_utente` (null = nessuna riga). */
function livelloDaPermesso(riga: PermessoRiga | undefined): LivelloUtente {
  if (!riga) return null;
  if (riga.is_portal_admin) return "admin";
  if (riga.override_export) return "exporter";
  if (riga.override_access) return "viewer";
  return "negato";
}

export async function GET(_request: NextRequest, { params }: Contesto) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  if (!pre.accesso.gestisceDashboard) return negato("Le assegnazioni le gestisce la direzione.");
  const { id } = await params;
  if (!UUID_VALIDO.test(id)) return errore("Identificativo dashboard non valido");

  const admin = createAdminClient();
  const bi = admin.schema("bi_direzionale");

  const { data: portale } = await admin.from("portali").select("id").eq("slug", "bi").maybeSingle();
  const [utenti, permessi, perimetri, assegnazioni, agenti] = await Promise.all([
    admin.from("utenti").select("id,nome,cognome,username,ruolo,stato").eq("stato", "attivo").order("cognome"),
    portale
      ? admin
          .from("permessi_utente")
          .select("utente_id,is_portal_admin,override_export,override_access")
          .eq("portale_id", portale.id)
      : Promise.resolve({ data: [], error: null }),
    bi.from("perimetro_utente").select("utente_id,tipo,valori"),
    bi.from("dashboard_assegnazioni").select("utente_id,assegnata_il").eq("dashboard_id", id),
    admin.from("bi_agenti").select("codice,nome").order("nome"),
  ]);
  if (utenti.error || assegnazioni.error) {
    return errore("Impossibile leggere utenti e assegnazioni.", 500);
  }

  const permessoPer = new Map((permessi.data ?? []).map((p) => [String(p.utente_id), p as PermessoRiga]));
  const perimetroPer = new Map((perimetri.data ?? []).map((p) => [String(p.utente_id), p]));
  const assegnatePer = new Map((assegnazioni.data ?? []).map((a) => [String(a.utente_id), String(a.assegnata_il)]));

  const elenco = (utenti.data ?? []).map((u) => {
    const uid = String(u.id);
    const perimetro = perimetroPer.get(uid);
    return {
      id: uid,
      nome: [u.nome, u.cognome].filter(Boolean).join(" ") || String(u.username ?? ""),
      username: u.username,
      ruolo: u.ruolo,
      // Il superadmin entra sempre e vede tutto: non ha bisogno di niente.
      livello: u.ruolo === "superadmin" ? "superadmin" : livelloDaPermesso(permessoPer.get(uid)),
      perimetro: perimetro
        ? { tipo: String(perimetro.tipo), valori: (perimetro.valori as string[] | null) ?? [] }
        : null,
      assegnata_il: assegnatePer.get(uid) ?? null,
    };
  });

  return NextResponse.json({ utenti: elenco, agenti: agenti.data ?? [] });
}

export async function PUT(request: NextRequest, { params }: Contesto) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  if (!pre.accesso.gestisceDashboard) {
    await registraOperazione(pre.accesso, "negato", { errore: "Assegnazione riservata alla direzione." });
    return negato("Le assegnazioni le gestisce la direzione.");
  }
  const { id } = await params;
  if (!UUID_VALIDO.test(id)) return errore("Identificativo dashboard non valido");

  let body: { utenti?: unknown };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }
  if (!Array.isArray(body.utenti)) return errore("Elenco utenti mancante");

  const richieste: RichiestaUtente[] = [];
  for (const voce of body.utenti as unknown[]) {
    if (!voce || typeof voce !== "object") return errore("Voce utente non valida");
    const { id: uid, perimetro } = voce as { id?: unknown; perimetro?: unknown };
    if (typeof uid !== "string" || !UUID_VALIDO.test(uid)) return errore("Identificativo utente non valido");
    let perim: RichiestaUtente["perimetro"];
    if (perimetro !== undefined && perimetro !== null) {
      const { tipo, valori } = perimetro as { tipo?: unknown; valori?: unknown };
      if (typeof tipo !== "string" || !TIPI_PERIMETRO.has(tipo)) return errore("Tipo di perimetro non valido");
      const elencoValori = Array.isArray(valori)
        ? valori.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim())
        : [];
      if (tipo !== "tutto" && elencoValori.length === 0) {
        return errore("Un perimetro per agente o business unit richiede almeno un valore.");
      }
      perim = { tipo: tipo as TipoPerimetro, valori: tipo === "tutto" ? [] : elencoValori };
    }
    richieste.push({ id: uid, perimetro: perim });
  }

  const admin = createAdminClient();
  const bi = admin.schema("bi_direzionale");

  const { data: dashboard } = await bi.from("dashboard").select("id").eq("id", id).maybeSingle();
  if (!dashboard) return errore("Dashboard non trovata", 404);

  const { data: portale } = await admin.from("portali").select("id").eq("slug", "bi").maybeSingle();
  if (!portale) return errore("Portale Statistiche BI non configurato.", 500);

  const ids = richieste.length > 0 ? richieste.map((r) => r.id) : [UUID_NULLO];
  const [{ data: utenti }, { data: permessi }, { data: perimetri }] = await Promise.all([
    admin.from("utenti").select("id,ruolo,stato").in("id", ids),
    admin
      .from("permessi_utente")
      .select("utente_id,is_portal_admin,override_export,override_access")
      .eq("portale_id", portale.id)
      .in("utente_id", ids),
    bi.from("perimetro_utente").select("utente_id").in("utente_id", ids),
  ]);
  const utentePer = new Map((utenti ?? []).map((u) => [String(u.id), u]));
  const permessoPer = new Map((permessi ?? []).map((p) => [String(p.utente_id), p as PermessoRiga]));
  const conPerimetro = new Set((perimetri ?? []).map((p) => String(p.utente_id)));

  const accettati: RichiestaUtente[] = [];
  const scartati: { id: string; motivo: string }[] = [];

  for (const r of richieste) {
    const utente = utentePer.get(r.id);
    if (!utente || utente.stato !== "attivo") {
      scartati.push({ id: r.id, motivo: "Utente non trovato o non attivo." });
      continue;
    }
    const livello = utente.ruolo === "superadmin" ? "superadmin" : livelloDaPermesso(permessoPer.get(r.id));
    if (livello === "negato") {
      scartati.push({ id: r.id, motivo: "L'accesso a Statistiche BI è stato negato dal superadmin." });
      continue;
    }
    const direzione = livello === "superadmin" || livello === "admin";
    if (!direzione && !r.perimetro && !conPerimetro.has(r.id)) {
      scartati.push({ id: r.id, motivo: "Manca il perimetro dati: senza, la dashboard arriverebbe vuota." });
      continue;
    }
    accettati.push(r);
  }

  // 1) accesso al portale per chi non ha nessuna riga
  const senzaAccesso = accettati.filter((r) => {
    const u = utentePer.get(r.id);
    return u?.ruolo !== "superadmin" && !permessoPer.has(r.id);
  });
  if (senzaAccesso.length > 0) {
    const { error } = await admin.from("permessi_utente").insert(
      senzaAccesso.map((r) => ({
        portale_id: portale.id,
        utente_id: r.id,
        override_access: true,
        override_export: false,
        is_portal_admin: false,
        can_access: true,
      }))
    );
    if (error) {
      await registraOperazione(pre.accesso, "errore", { errore: error.message });
      return errore("Impossibile concedere l'accesso al portale.", 500);
    }
  }

  // 2) perimetro dove indicato
  const conNuovoPerimetro = accettati.filter((r) => r.perimetro);
  if (conNuovoPerimetro.length > 0) {
    const { error } = await bi.from("perimetro_utente").upsert(
      conNuovoPerimetro.map((r) => ({
        utente_id: r.id,
        tipo: r.perimetro!.tipo,
        valori: r.perimetro!.valori,
        nota: "Impostato dall'assegnazione di una dashboard.",
        aggiornato_il: new Date().toISOString(),
        aggiornato_da: pre.accesso.userId,
      })),
      { onConflict: "utente_id" }
    );
    if (error) {
      await registraOperazione(pre.accesso, "errore", { errore: error.message });
      return errore("Impossibile impostare il perimetro dati.", 500);
    }
  }

  // 3) l'insieme delle assegnazioni: chi non è più nell'elenco la perde.
  const idAccettati = accettati.map((r) => r.id);
  const { data: attuali } = await bi.from("dashboard_assegnazioni").select("utente_id").eq("dashboard_id", id);
  const daTogliere = (attuali ?? []).map((a) => String(a.utente_id)).filter((u) => !idAccettati.includes(u));
  if (daTogliere.length > 0) {
    const { error } = await bi.from("dashboard_assegnazioni").delete().eq("dashboard_id", id).in("utente_id", daTogliere);
    if (error) return errore("Impossibile aggiornare le assegnazioni.", 500);
  }
  if (idAccettati.length > 0) {
    const { error } = await bi.from("dashboard_assegnazioni").upsert(
      idAccettati.map((uid) => ({ dashboard_id: id, utente_id: uid, assegnata_da: pre.accesso.userId })),
      { onConflict: "dashboard_id,utente_id", ignoreDuplicates: true }
    );
    if (error) return errore("Impossibile salvare le assegnazioni.", 500);
  }

  await registraOperazione(pre.accesso, "ok", { righe: idAccettati.length });
  return NextResponse.json({ assegnati: idAccettati.length, rimossi: daTogliere.length, scartati });
}
