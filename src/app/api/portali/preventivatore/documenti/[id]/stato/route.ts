import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import {
  haRuoloFunzionaleAsync,
  PREVENTIVATORE_RUOLI,
  getFiltroCommerciale,
  getIdClientiVisibili,
} from "@/lib/portali/preventivatore/ruoli";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ── Transizioni valide ─────────────────────────────────────────────────────
// stato_corrente → stati raggiungibili.
//
// Dal 17/09/2026 il portale fa SOLO PREVENTIVI: restano due stati, `aperta`
// (bozza) e `completato` (definitivo), e si va avanti e indietro fra i due.
// Il ciclo offerta→esito (`inviata` → `ordinata`/`fallita`) è stato rimosso:
// non è mai entrato in servizio — zero documenti in quegli stati, e nemmeno un
// pulsante per entrare in `presa_in_carico` — mentre l'esito vero (conversione,
// giorni di risposta, carico back office) lo produce già il gestionale.
//
// Gli stati vecchi restano ELENCATI, non raggiungibili: se un documento ne
// porta uno deve continuare a mostrarsi e a non muoversi.
const TRANSIZIONI_VALIDE: Record<string, string[]> = {
  aperta:          ["completato"],
  completato:      ["aperta"],   // si torna in bozza finché non è uscito niente
  // Stati non più raggiungibili: nessuna transizione in uscita.
  presa_in_carico: [],
  inviata:         [],
  ordinata:        [],
  fallita:         [],
  storico:         [],
  // Legacy V2 (compat con i documenti importati)
  pending:         [],
  ordinato:        [],
  rifiutato:       [],
};

// Ruoli funzionali ammessi per ogni transizione di stato (target).
// Restano solo i due stati vivi, ed è sempre il preventivatore a muoverli.
const RUOLI_PER_STATO_TARGET: Record<string, string[]> = {
  aperta:     [PREVENTIVATORE_RUOLI.preventivatore],
  completato: [PREVENTIVATORE_RUOLI.preventivatore],
};

/**
 * PATCH /api/portali/preventivatore/documenti/[id]/stato
 *
 * Cambio di stato del preventivo. Accetta sia gli stati legacy (compat
 * con vecchio import V2: pending/ordinato/rifiutato) sia i nuovi stati
 * workflow (migration 039: aperta/presa_in_carico/completato/inviata/
 * ordinata/fallita/storico).
 *
 * Body: {
 *   stato: <stato>,
 *   codici_articolo?: string[],
 *   note?: string,                      // salvata su stato_note
 * }
 *
 * Auth: livello di portale non nullo per vedere il preventivatore, ruolo
 * funzionale `preventivatore` (o admin/superadmin) per muovere lo stato.
 *
 * I campi del ciclo offerta (`numero_preventivo`, `importo_offerta`,
 * `note_offerta`, `motivo_rifiuto_id`, `importo_ordinato`) non sono più
 * accettati: il ciclo è stato rimosso. Le colonne restano in tabella — tre
 * documenti storici hanno un `numero_preventivo` valorizzato dall'import V2 —
 * ma nessuno le scrive più da qui.
 */

const STATI_VALIDI = [
  // legacy compat
  "pending", "ordinato", "rifiutato",
  // workflow nuovo (migration 039)
  "storico", "aperta", "presa_in_carico", "completato", "inviata", "ordinata", "fallita",
] as const;

// Validazione body con Zod (hardening): stato enum, importi finiti e non negativi, stringhe limitate.
const StatoBodySchema = z.object({
  stato: z.enum(STATI_VALIDI),
  codici_articolo: z.array(z.string().trim().max(64)).max(500).optional(),
  note: z.string().trim().max(4000).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "ID documento mancante" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    // Il livello di portale stabilisce solo SE vedi il preventivatore; CHI può
    // fare una data transizione è deciso dal ruolo funzionale, più sotto
    // (RUOLI_PER_STATO_TARGET). Prima qui c'era `hasMinLivello(livello,"admin")`
    // che rendeva irraggiungibile quel controllo: o eri admin del portale o non
    // potevi muovere nulla, quindi back office e preventivatori non potevano
    // lavorare senza permessi pieni.
    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    // Recupera stato corrente del documento (per validare la transizione)
    const adminCheckClient = createAdminClient();
    const { data: docCorrente, error: dcErr } = await adminCheckClient
      .schema("preventivatore")
      .from("documenti")
      .select("id, stato, cliente_master_id")
      .eq("id", id)
      .maybeSingle();
    if (dcErr || !docCorrente) {
      return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });
    }
    const statoCorrente = docCorrente.stato as string;

    // Filtro commerciale: un commerciale ristretto può cambiare stato SOLO sui suoi
    const agenteCommerciale = await getFiltroCommerciale(user.id, livello);
    if (agenteCommerciale && docCorrente.cliente_master_id) {
      const ids = await getIdClientiVisibili(agenteCommerciale);
      if (!ids.includes(docCorrente.cliente_master_id as string)) {
        return NextResponse.json({ error: "Documento fuori dal tuo portfolio" }, { status: 403 });
      }
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = StatoBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload invalido", dettagli: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 }
      );
    }
    const { stato, codici_articolo, note } = parsed.data;

    // ── Validazione transizione workflow ────────────────────────────────────
    // Se stato corrente è uno workflow nuovo, controlla che la transizione sia valida.
    if (TRANSIZIONI_VALIDE[statoCorrente] !== undefined) {
      const transizioniAmmesse = TRANSIZIONI_VALIDE[statoCorrente];
      // Caso "storico/legacy → workflow": ammesso solo da superadmin (livello superadmin) per re-aprire
      const isUnlock = ["storico","pending","ordinato","rifiutato"].includes(statoCorrente);
      // Una transizione verso SE STESSI non e' un no-op: il body puo' riscrivere
      // `numero_preventivo`, `importo_offerta` e `note_offerta`. Su un preventivo
      // gia' 'inviata' significava cambiare il numero dell'offerta mandata al
      // cliente, in silenzio e senza traccia — bastava ripremere «Conferma invio».
      // Il guard aveva una deroga esplicita (`stato !== statoCorrente`) che
      // lasciava passare proprio questo caso: qui viene tolta.
      if (!isUnlock && stato === statoCorrente) {
        return NextResponse.json({
          error: `Il preventivo è già nello stato '${statoCorrente}': non c'è niente da cambiare.`
        }, { status: 409 });
      }
      if (!isUnlock && !transizioniAmmesse.includes(stato)) {
        return NextResponse.json({
          error: `Transizione non valida: da '${statoCorrente}' non si può passare a '${stato}'. Ammesse: ${transizioniAmmesse.join(", ") || "(nessuna)"}.`
        }, { status: 400 });
      }
      if (isUnlock && livello !== "superadmin") {
        return NextResponse.json({
          error: `Lo stato '${statoCorrente}' è archivio: solo superadmin può rimetterlo in workflow.`
        }, { status: 403 });
      }
    }

    // ── Validazione ruolo funzionale per il nuovo stato ─────────────────────
    // superadmin/admin del portale bypassano; altrimenti serve uno dei ruoli
    // ammessi per lo stato di destinazione. È QUESTO il vero controllo di
    // autorizzazione sul workflow.
    const ruoliRichiesti = RUOLI_PER_STATO_TARGET[stato];
    if (ruoliRichiesti && ruoliRichiesti.length > 0) {
      const ok = await haRuoloFunzionaleAsync(user.id, livello, ruoliRichiesti);
      if (!ok) {
        return NextResponse.json({
          error: `Per passare allo stato '${stato}' serve uno dei ruoli: ${ruoliRichiesti.join(", ")}.`
        }, { status: 403 });
      }
    } else if (livello !== "admin" && livello !== "superadmin") {
      // Stati senza ruolo mappato: ormai sono tutti quelli non più
      // raggiungibili (legacy V2, storico, e i residui del ciclo offerta).
      // Restano riservati agli admin, come prima.
      return NextResponse.json(
        { error: `Lo stato '${stato}' può essere impostato solo da un admin del portale.` },
        { status: 403 }
      );
    }

    if (codici_articolo !== undefined && !Array.isArray(codici_articolo)) {
      return NextResponse.json({ error: "Codici articolo non validi" }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {
      stato,
      stato_aggiornato_da: user.id,
      stato_aggiornato_il: new Date().toISOString(),
    };

    if (codici_articolo !== undefined) updatePayload.codici_articolo = codici_articolo;
    if (note !== undefined) updatePayload.stato_note = note;

    const adminClient = createAdminClient();
    const { error } = await adminClient
      .schema("preventivatore")
      .from("documenti")
      .update(updatePayload)
      .eq("id", id);

    if (error) {
      logError("preventivatore.documenti.stato", "update stato fallita", error, { id });
      return NextResponse.json({ error: "Errore aggiornamento stato: " + error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("preventivatore.documenti.stato", "PATCH stato fallita", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
