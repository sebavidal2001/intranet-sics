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
 * Il livello dell'utente sul BI. **Unica fonte: il portale.**
 *
 * `get_portale_livello(utente, 'bi')`, come ogni altro portale. Non c'è
 * ripiego sui ruoli: un ripiego renderebbe il BI l'unico portale in cui
 * l'accesso si ottiene *anche* per ruolo, scavalcando in silenzio le
 * abilitazioni decise dal superadmin — cioè esattamente ciò che il modello
 * `permessi_utente` serve a evitare.
 *
 * Chi entra lo decide il superadmin da `/superadmin/portali/[id]/permessi`.
 * Il superadmin di piattaforma bypassa sempre, per il primo CASE della
 * funzione.
 */
async function risolviLivello(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<LivelloBi | null> {
  const { data, error } = await supabase.rpc("get_portale_livello", {
    p_user_id: userId,
    p_slug: "bi",
  });
  if (error) {
    // Meglio negare che aprire: se la funzione non risponde non si sa chi sia
    // l'utente, e non saperlo non è una ragione per farlo entrare.
    console.error("[bi] get_portale_livello non disponibile:", error.message);
    return null;
  }
  return livelloDaPortale(typeof data === "string" ? data : null);
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
  const livello = await risolviLivello(supabase, user.id);

  if (!livello) {
    throw new AccessoNegato(
      "Non sei abilitato al portale BI. L'accesso si richiede a un amministratore, " +
        "che lo concede dalla gestione permessi del portale."
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
