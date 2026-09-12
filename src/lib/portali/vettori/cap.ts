import { createAdminClient } from "@/lib/supabase/admin";
import type { EsitoCap, FonteProvincia } from "./tipi";

interface RigaCapRpc {
  province: string[] | null;
  comuni: string[] | null;
  fonte: string | null;
  certo: boolean | null;
  estero: boolean | null;
}

export interface ProvinciaDaCap {
  provincia: string | null;
  fonteProvincia: FonteProvincia | null;
  capDaChiarire: EsitoCap | null;
  estero: boolean;
}

/** La stessa normalizzazione applicata dalla RPC, resa esplicita anche al chiamante. */
export function normalizzaCap(cap: string): string | null {
  const valore = cap.trim();
  if (!/^\d{1,5}$/.test(valore)) return null;
  return valore.padStart(5, "0");
}

/**
 * Traduce la forma PostgREST nel contratto applicativo.
 *
 * Rimane pura per poter collaudare separatamente i casi delicati (CAP a cavallo,
 * prefisso ed estero) senza trasformare i test in test di Supabase.
 */
export function esitoCapDaRiga(
  cap: string,
  riga: RigaCapRpc | null | undefined
): EsitoCap | null {
  const normalizzato = normalizzaCap(cap);
  if (!normalizzato || !riga) return null;
  return {
    cap: normalizzato,
    province: (riga.province ?? []).map((provincia) => provincia.trim().toUpperCase()),
    comuni: riga.comuni ?? [],
    fonte: riga.fonte ?? "sconosciuta",
    certo: riga.certo === true,
    estero: riga.estero === true,
  };
}

/** Risolve il CAP attraverso l'unica fonte canonica, la RPC `vettori.risolvi_cap`. */
export async function risolviCap(cap: string): Promise<EsitoCap | null> {
  const normalizzato = normalizzaCap(cap);
  if (!normalizzato) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("vettori")
    .rpc("risolvi_cap", { p_cap: normalizzato });
  if (error) throw new Error(`Risoluzione CAP fallita: ${error.message}`);

  const righe = (data ?? []) as unknown;
  const riga = Array.isArray(righe)
    ? (righe[0] as RigaCapRpc | undefined)
    : (righe as RigaCapRpc | null);
  return esitoCapDaRiga(normalizzato, riga);
}

/**
 * Decide quale provincia usare senza spacciare una deduzione per un dato certo.
 *
 * L'ordine dei casi e' la sostanza di questa funzione, non una formalita':
 *
 *   1. estero  — San Marino non diventa Rimini nemmeno se qualcuno scrive RN.
 *   2. CAP certo — un CAP in elenco e' un dato verificato e batte il campo
 *      provincia, che spesso resta compilato da una spedizione precedente.
 *   3. provincia scritta a mano — batte il prefisso, perche' chi spedisce sa
 *      dove sta mandando la merce e il prefisso sta solo tirando a indovinare.
 *   4. prefisso — ripiego, e resta dichiarato come tale.
 *
 * Invertire 3 e 4 sembra innocuo e non lo e': sul CAP 23080 il prefisso dice
 * Sondrio, l'operatore sa che e' Lecco, e vincerebbe la deduzione.
 */
export function determinaProvincia(
  esito: EsitoCap | null,
  provinciaManuale?: string | null
): ProvinciaDaCap {
  const manuale = provinciaManuale?.trim().toUpperCase() || null;
  if (esito?.estero) {
    return {
      provincia: null,
      fonteProvincia: null,
      capDaChiarire: null,
      estero: true,
    };
  }
  if (esito?.certo && esito.province.length === 1) {
    return {
      provincia: esito.province[0],
      fonteProvincia: "cap",
      capDaChiarire: null,
      estero: false,
    };
  }
  if (manuale) {
    return {
      provincia: manuale,
      fonteProvincia: "manuale",
      capDaChiarire: null,
      estero: false,
    };
  }
  if (esito?.fonte === "prefisso" && esito.province.length === 1) {
    return {
      provincia: esito.province[0],
      fonteProvincia: "prefisso",
      capDaChiarire: null,
      estero: false,
    };
  }
  return {
    provincia: null,
    fonteProvincia: null,
    capDaChiarire: esito,
    estero: false,
  };
}
