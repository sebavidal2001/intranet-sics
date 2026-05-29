import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";
import {
  getRuoliFunzionali,
  PREVENTIVATORE_RUOLI,
  getFiltroCommerciale,
  getIdClientiVisibili,
} from "@/lib/portali/preventivatore/ruoli";

export const dynamic = "force-dynamic";

// ── Transizioni workflow valide ────────────────────────────────────────────
// stato_corrente → array di stati raggiungibili.
// Da uno stato "finale" (ordinata/fallita/storico) NON si torna indietro.
const TRANSIZIONI_VALIDE: Record<string, string[]> = {
  aperta:          ["presa_in_carico", "completato"],
  presa_in_carico: ["aperta", "completato"],            // rollback ammesso
  completato:      ["presa_in_carico", "inviata"],     // rollback ammesso prima invio
  inviata:         ["ordinata", "fallita"],
  // Stati finali (ammessi solo da chi ha accesso totale admin)
  ordinata:        [],
  fallita:         [],
  storico:         [],
  // Legacy V2 (compat)
  pending:         [],
  ordinato:        [],
  rifiutato:       [],
};

// Ruoli funzionali ammessi per ogni transizione di stato (target)
const RUOLI_PER_STATO_TARGET: Record<string, string[]> = {
  presa_in_carico: [PREVENTIVATORE_RUOLI.preventivatore],
  completato:      [PREVENTIVATORE_RUOLI.preventivatore],
  inviata:         [PREVENTIVATORE_RUOLI.back_office],
  ordinata:        [PREVENTIVATORE_RUOLI.back_office],
  fallita:         [PREVENTIVATORE_RUOLI.back_office],
  aperta:          [PREVENTIVATORE_RUOLI.preventivatore, PREVENTIVATORE_RUOLI.back_office, PREVENTIVATORE_RUOLI.commerciale],
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
 *   motivo_rifiuto_id?: string,        // obbligatorio per fallita/rifiutato
 *   note?: string,                      // salvata su stato_note
 *   importo_ordinato?: number,          // per ordinato (legacy)
 *   numero_preventivo?: string,         // per inviata (PC N°)
 *   importo_offerta?: number,           // per inviata (importo confermato)
 *   note_offerta?: string,              // motivo scostamento vs importo_preventivo
 * }
 *
 * Auth: serve livello >= 'admin' sul portale preventivatore. (In futuro
 * affineremo con ruoli funzionali commerciale/preventivatore/back_office.)
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
  motivo_rifiuto_id: z.string().uuid().optional(),
  note: z.string().trim().max(4000).optional(),
  importo_ordinato: z.number().finite().min(0).max(100_000_000).optional(),
  numero_preventivo: z.string().trim().max(64).optional(),
  importo_offerta: z.number().finite().min(0).max(100_000_000).optional(),
  note_offerta: z.string().trim().max(4000).optional(),
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

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) {
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
    const { stato, codici_articolo, motivo_rifiuto_id, note, importo_ordinato,
            numero_preventivo, importo_offerta, note_offerta } = parsed.data;

    // ── Validazione transizione workflow ────────────────────────────────────
    // Se stato corrente è uno workflow nuovo, controlla che la transizione sia valida.
    if (TRANSIZIONI_VALIDE[statoCorrente] !== undefined) {
      const transizioniAmmesse = TRANSIZIONI_VALIDE[statoCorrente];
      // Caso "storico/legacy → workflow": ammesso solo da superadmin (livello superadmin) per re-aprire
      const isUnlock = ["storico","pending","ordinato","rifiutato"].includes(statoCorrente);
      if (!isUnlock && !transizioniAmmesse.includes(stato) && stato !== statoCorrente) {
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
    // superadmin/admin del portale bypass; altrimenti l'utente deve avere uno dei ruoli ammessi.
    if (livello !== "superadmin" && livello !== "admin") {
      const ruoliRichiesti = RUOLI_PER_STATO_TARGET[stato];
      if (ruoliRichiesti && ruoliRichiesti.length > 0) {
        const ruoliUtente = await getRuoliFunzionali(user.id);
        const ok = ruoliUtente.some((r) => ruoliRichiesti.includes(r));
        if (!ok) {
          return NextResponse.json({
            error: `Per passare allo stato '${stato}' serve uno dei ruoli: ${ruoliRichiesti.join(", ")}.`
          }, { status: 403 });
        }
      }
    }

    // Validazioni per stati specifici
    if ((stato === "rifiutato" || stato === "fallita") && !motivo_rifiuto_id) {
      return NextResponse.json({ error: "Motivo rifiuto obbligatorio" }, { status: 400 });
    }
    if (stato === "inviata" && !numero_preventivo?.trim()) {
      return NextResponse.json(
        { error: "Numero preventivo obbligatorio per stato 'inviata'" },
        { status: 400 }
      );
    }
    if (codici_articolo !== undefined && !Array.isArray(codici_articolo)) {
      return NextResponse.json({ error: "Codici articolo non validi" }, { status: 400 });
    }
    if (importo_ordinato !== undefined && typeof importo_ordinato !== "number") {
      return NextResponse.json({ error: "Importo ordinato non valido" }, { status: 400 });
    }
    if (importo_offerta !== undefined && typeof importo_offerta !== "number") {
      return NextResponse.json({ error: "Importo offerta non valido" }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {
      stato,
      stato_aggiornato_da: user.id,
      stato_aggiornato_il: new Date().toISOString(),
    };

    if (codici_articolo !== undefined) updatePayload.codici_articolo = codici_articolo;
    if (motivo_rifiuto_id !== undefined) updatePayload.motivo_rifiuto_id = motivo_rifiuto_id;
    if (note !== undefined) updatePayload.stato_note = note;

    // Legacy: importo_ordinato si applica a 'ordinato'
    if (stato === "ordinato" && importo_ordinato !== undefined && importo_ordinato > 0) {
      updatePayload.importo_ordinato = importo_ordinato;
    }

    // Workflow: inviata → setta numero_preventivo + importo_offerta + note_offerta
    if (stato === "inviata") {
      updatePayload.numero_preventivo = numero_preventivo?.trim();
      if (typeof importo_offerta === "number" && importo_offerta > 0) {
        updatePayload.importo_offerta = importo_offerta;
      }
      if (note_offerta !== undefined) updatePayload.note_offerta = note_offerta;
    }

    // Workflow: ordinata → si può fissare un importo_ordinato come per legacy
    if (stato === "ordinata" && importo_ordinato !== undefined && importo_ordinato > 0) {
      updatePayload.importo_ordinato = importo_ordinato;
    }

    const adminClient = createAdminClient();
    const { error } = await adminClient
      .schema("preventivatore")
      .from("documenti")
      .update(updatePayload)
      .eq("id", id);

    if (error) {
      console.error("Stato update error:", error);
      return NextResponse.json({ error: "Errore aggiornamento stato: " + error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Stato PATCH error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
