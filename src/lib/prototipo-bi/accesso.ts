/**
 * CONTROLLO ACCESSI DEL BI.
 *
 * Due assi separati, come sul Preventivatore — tenerli distinti è ciò che ha
 * evitato lì il bug del codice irraggiungibile:
 *
 *   1. LIVELLO   — *se* entri e cosa puoi fare (direzione / responsabile / operativo)
 *   2. PERIMETRO — *quali righe* vedi (vedi `perimetro.ts`)
 *
 * Il livello decide una cosa sola di sicurezza, ed è la più importante:
 * **chi può scrivere SQL libero**. Solo la direzione, che è anche l'unico
 * livello senza perimetro da imporre. Le due cose vanno insieme e non è un
 * caso: non esiste modo affidabile di imporre un filtro di riga dentro una
 * SELECT arbitraria scritta da un'AI, quindi chi ha un perimetro non riceve
 * quello strumento.
 */

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PERIMETRO_TUTTO, risolviPerimetro, type Perimetro } from "./perimetro";
import type { RuoloBriefing } from "./tipi";

const RUOLI_DIREZIONE = new Set(["superadmin", "amministratore"]);
const RUOLI_RESPONSABILE = new Set(["responsabile", "responsabile_intermedio"]);

export type LivelloBi = "direzione" | "responsabile" | "operativo";

export interface AccessoBi {
  userId: string;
  nome: string;
  ruoloUtente: string;
  livello: LivelloBi;
  ruolo: RuoloBriefing;
  /** Le righe che questo utente può vedere. Applicato allo snapshot. */
  perimetro: Perimetro;
  /**
   * Vero solo per la direzione. È l'unico permesso che apre una superficie
   * di rischio vera, quindi è un campo esplicito e non un confronto di
   * stringhe sparso per le route.
   */
  sqlLibero: boolean;
  /**
   * Compatibilità con `costruisciContesto`, che accetta ancora un singolo
   * codice agente. Vale null quando il perimetro non è per agente.
   */
  agenteScope: string | null;
}

export class AccessoNegato extends Error {}

// ─────────────────────────────────────────────────────────────────────────────
// Asse 1 — livello
// ─────────────────────────────────────────────────────────────────────────────

function livelloDaRuolo(ruolo: string): LivelloBi | null {
  if (RUOLI_DIREZIONE.has(ruolo)) return "direzione";
  if (RUOLI_RESPONSABILE.has(ruolo)) return "responsabile";
  return null;
}

function livelloDaPortale(livelloPortale: string | null): LivelloBi | null {
  switch (livelloPortale) {
    case "superadmin":
    case "admin":
      return "direzione";
    case "exporter":
      return "responsabile";
    case "viewer":
      return "operativo";
    default:
      return null;
  }
}

/**
 * Il livello dell'utente sul BI.
 *
 * Fonte primaria: il portale `bi` (migration 103). Ripiego: i ruoli cablati,
 * che è il comportamento in vigore fino a oggi.
 *
 * Il ripiego serve perché il portale **nasce spento** (`is_attivo = false`):
 * il rollout è per gruppi e si apre alla Fase 5, dopo il confronto con il
 * PBIX. Ma `get_portale_livello` richiede `is_attivo = true`, quindi finché il
 * portale resta spento risponde `null` a chiunque — e senza ripiego nessuno
 * entrerebbe più, sviluppo compreso.
 *
 * Non è un buco: il ripiego concede esattamente gli stessi livelli che
 * concederanno i `permessi_portale` della 103 (direzione a superadmin e
 * amministratore, responsabile agli altri due). Quando il portale verrà
 * acceso, la fonte primaria risponderà e il ripiego smetterà da solo di
 * servire.
 */
async function risolviLivello(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  ruoloUtente: string
): Promise<LivelloBi | null> {
  try {
    const { data } = await supabase.rpc("get_portale_livello", {
      p_user_id: userId,
      p_slug: "bi",
    });
    const daPortale = livelloDaPortale(typeof data === "string" ? data : null);
    if (daPortale) return daPortale;
  } catch {
    // Portale non ancora creato: si ripiega sui ruoli.
  }
  return livelloDaRuolo(ruoloUtente);
}

// ─────────────────────────────────────────────────────────────────────────────
// Asse 2 — perimetro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Se l'infrastruttura del perimetro esiste su questo database.
 *
 * Distinzione che vale la pena fare bene, perché i due casi si assomigliano e
 * vogliono risposte opposte:
 *
 *   - **tabella assente** (migration 102-103 non applicate): il perimetro non
 *     esiste come concetto su questo database, e non c'è nessun posto dove
 *     configurarlo. Chiudere qui lascerebbe ogni responsabile senza dati e
 *     nessuno con il modo di riaprirli: non è sicurezza, è un guasto. Si
 *     mantiene il comportamento precedente e si avvisa.
 *
 *   - **tabella presente, nessuna riga per l'utente**: qui sì, chiuso. Un
 *     perimetro mancante è un errore di configurazione, e un errore di
 *     configurazione non deve aprire i dati.
 *
 * Il risultato si ricorda per non interrogare il catalogo a ogni richiesta.
 */
let infrastrutturaPerimetro: boolean | null = null;

async function perimetroDisponibile(): Promise<boolean> {
  if (infrastrutturaPerimetro !== null) return infrastrutturaPerimetro;
  try {
    const { error } = await createAdminClient()
      .schema("bi_direzionale")
      .from("perimetro_effettivo")
      .select("utente_id")
      .limit(1);
    infrastrutturaPerimetro = !error;
    if (error) {
      console.warn(
        "[bi] perimetro per utente non attivo (migration 102-103 da applicare):",
        error.message
      );
    }
  } catch {
    infrastrutturaPerimetro = false;
  }
  return infrastrutturaPerimetro;
}

/** Azzera il ricordo: da chiamare dopo aver applicato le migration. */
export function reimpostaRilevamentoPerimetro() {
  infrastrutturaPerimetro = null;
}

async function perimetroDi(livello: LivelloBi, userId: string): Promise<Perimetro> {
  if (livello === "direzione") return PERIMETRO_TUTTO;

  if (!(await perimetroDisponibile())) {
    // Vedi sopra: senza infrastruttura si resta al comportamento precedente.
    return PERIMETRO_TUTTO;
  }

  const { data } = await createAdminClient()
    .schema("bi_direzionale")
    .from("perimetro_effettivo")
    .select("tipo, valori")
    .eq("utente_id", userId)
    .maybeSingle();

  if (!data) return risolviPerimetro({ livello }); // fail-closed

  const valori = Array.isArray(data.valori) ? (data.valori as string[]) : [];
  switch (data.tipo) {
    case "tutto":
      return PERIMETRO_TUTTO;
    case "agente":
      return risolviPerimetro({ livello, codiciAgente: valori });
    case "business_unit":
      return risolviPerimetro({ livello, businessUnit: valori });
    default:
      return risolviPerimetro({ livello }); // 'nessuno' o valore ignoto
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica l'accesso e restituisce livello e perimetro.
 * Solleva `AccessoNegato` se l'utente non è autenticato o non ha i requisiti.
 */
export async function verificaAccesso(): Promise<AccessoBi> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new AccessoNegato("Non autenticato");

  const { data: profilo } = await supabase
    .from("utenti")
    .select("id, nome, cognome, ruolo")
    .eq("id", user.id)
    .single();

  if (!profilo) throw new AccessoNegato("Profilo non trovato");

  const ruoloUtente = String(profilo.ruolo ?? "");
  const nome = [profilo.nome, profilo.cognome].filter(Boolean).join(" ") || "Utente";
  const livello = await risolviLivello(supabase, user.id, ruoloUtente);

  if (!livello) {
    throw new AccessoNegato(
      "Il BI è riservato ai ruoli abilitati. " +
        `Ruolo attuale: "${ruoloUtente || "non impostato"}".`
    );
  }

  const perimetro = await perimetroDi(livello, user.id);

  return {
    userId: user.id,
    nome,
    ruoloUtente,
    livello,
    ruolo: livello === "direzione" ? "direzione" : "responsabile",
    perimetro,
    sqlLibero: livello === "direzione",
    agenteScope: perimetro.tipo === "agente" ? perimetro.codici[0] : null,
  };
}

/** Variante che non solleva: utile nelle pagine per mostrare un messaggio. */
export async function verificaAccessoSicuro(): Promise<
  { ok: true; accesso: AccessoBi } | { ok: false; motivo: string }
> {
  try {
    return { ok: true, accesso: await verificaAccesso() };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "Accesso negato" };
  }
}
