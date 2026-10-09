/**
 * CATALOGO DELLE MISURE — lettura e scrittura su `bi_direzionale.misure`
 * (migration 149). Solo lato server, con la service role: i permessi si
 * controllano nelle route prima di arrivare qui.
 *
 * La definizione nel database e' sempre rivalidata alla lettura (`validaMisura`):
 * una riga che non passa non viene nascosta ne' eseguita, viene segnalata come
 * non valida, cosi' chi guarda l'elenco sa che c'e' qualcosa da sistemare.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { SpecNonValida } from "./semantico";
import { descriviMisura, validaMisura } from "./misure";
import type { EspressioneMisura, MisuraDefinita } from "./tipi";

export interface MisuraSalvata {
  id: string;
  nome: string;
  descrizione: string | null;
  versione: number;
  sostituisceId: string | null;
  autoreId: string;
  autoreNome: string | null;
  creatoIl: string;
  /** La definizione pronta da copiare in una spec; assente se non piu' valida. */
  misura?: MisuraDefinita;
  nonValida?: string;
}

interface RigaMisura {
  id: string;
  nome: string;
  descrizione: string | null;
  definizione: unknown;
  versione: number;
  sostituisce_id: string | null;
  autore_id: string;
  archiviata_il: string | null;
  creato_il: string;
}

const COLONNE = "id,nome,descrizione,definizione,versione,sostituisce_id,autore_id,archiviata_il,creato_il";

function database() {
  return createAdminClient().schema("bi_direzionale");
}

async function nomiAutori(ids: string[]): Promise<Map<string, string>> {
  const distinti = [...new Set(ids)];
  const mappa = new Map<string, string>();
  if (distinti.length === 0) return mappa;
  const { data } = await createAdminClient().from("utenti").select("id,nome,cognome").in("id", distinti);
  for (const u of (data ?? []) as Array<{ id: string; nome: string | null; cognome: string | null }>) {
    mappa.set(u.id, [u.nome, u.cognome].filter(Boolean).join(" ").trim());
  }
  return mappa;
}

function daRiga(riga: RigaMisura, autori: Map<string, string>): MisuraSalvata {
  const base = {
    id: riga.id,
    nome: riga.nome,
    descrizione: riga.descrizione,
    versione: riga.versione,
    sostituisceId: riga.sostituisce_id,
    autoreId: riga.autore_id,
    autoreNome: autori.get(riga.autore_id) || null,
    creatoIl: riga.creato_il,
  };
  try {
    const misura = validaMisura({
      id: riga.id,
      versione: riga.versione,
      nome: riga.nome,
      espressione: riga.definizione,
    });
    return { ...base, misura };
  } catch (e) {
    return { ...base, nonValida: e instanceof SpecNonValida ? e.message : "Definizione non leggibile." };
  }
}

/** Le misure attive, dalla piu' recente. */
export async function elencaMisure(): Promise<MisuraSalvata[]> {
  const { data, error } = await database()
    .from("misure")
    .select(COLONNE)
    .is("archiviata_il", null)
    .order("creato_il", { ascending: false });
  if (error) throw new Error(`Impossibile leggere le misure: ${error.message}`);
  const righe = (data ?? []) as RigaMisura[];
  const autori = await nomiAutori(righe.map((r) => r.autore_id));
  return righe.map((r) => daRiga(r, autori));
}

export async function leggiMisura(id: string): Promise<(MisuraSalvata & { archiviata: boolean }) | null> {
  const { data, error } = await database().from("misure").select(COLONNE).eq("id", id).maybeSingle();
  if (error) throw new Error(`Impossibile leggere la misura: ${error.message}`);
  if (!data) return null;
  const riga = data as RigaMisura;
  const autori = await nomiAutori([riga.autore_id]);
  return { ...daRiga(riga, autori), archiviata: riga.archiviata_il !== null };
}

export class NomeGiaUsato extends Error {}

/**
 * Salva una misura gia' validata. Con `sostituisce` crea la versione successiva
 * e archivia la precedente: prima l'archivio (il nome e' unico fra le attive),
 * poi l'inserimento, e se questo fallisce si riapre la vecchia.
 */
export async function salvaMisura(opzioni: {
  misura: MisuraDefinita;
  autoreId: string;
  sostituisce?: { id: string; versione: number };
}): Promise<MisuraSalvata> {
  const { misura, autoreId, sostituisce } = opzioni;
  const db = database();

  if (sostituisce) {
    const { error } = await db
      .from("misure")
      .update({ archiviata_il: new Date().toISOString() })
      .eq("id", sostituisce.id)
      .is("archiviata_il", null);
    if (error) throw new Error(`Impossibile archiviare la versione precedente: ${error.message}`);
  }

  const { data, error } = await db
    .from("misure")
    .insert({
      nome: misura.nome,
      descrizione: descriviMisura(misura),
      definizione: misura.espressione satisfies EspressioneMisura,
      versione: sostituisce ? sostituisce.versione + 1 : 1,
      sostituisce_id: sostituisce?.id ?? null,
      autore_id: autoreId,
    })
    .select(COLONNE)
    .single();

  if (error || !data) {
    if (sostituisce) await db.from("misure").update({ archiviata_il: null }).eq("id", sostituisce.id);
    if (error?.code === "23505") throw new NomeGiaUsato("Esiste già una misura con questo nome.");
    throw new Error(`Impossibile salvare la misura: ${error?.message ?? "risposta vuota"}`);
  }
  const riga = data as RigaMisura;
  return daRiga(riga, await nomiAutori([riga.autore_id]));
}

export async function archiviaMisura(id: string): Promise<void> {
  const { error } = await database()
    .from("misure")
    .update({ archiviata_il: new Date().toISOString() })
    .eq("id", id)
    .is("archiviata_il", null);
  if (error) throw new Error(`Impossibile archiviare la misura: ${error.message}`);
}
