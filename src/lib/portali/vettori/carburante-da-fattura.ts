import { createAdminClient } from "@/lib/supabase/admin";
import type { FatturaLetta } from "./fatture/tipi";

/**
 * La percentuale di carburante che una fattura dichiara, ricondotta al mese
 * della spedizione a cui si applica.
 *
 * Il carburante cambia ogni mese e il costo atteso lo usa per data di
 * spedizione, non per mese di fattura: una fattura di giugno contiene anche
 * spedizioni di fine maggio al 20,38%. Per questo il mese si prende dalla riga
 * quando c'è, e dalla fattura solo in mancanza.
 *
 * Cosa si legge, vettore per vettore:
 * - GLS: la percentuale è stampata a piè di fattura («Imp. % Camionistico»).
 * - FedEx: la dichiara in chiaro su ogni spedizione («supplemento carburante
 *   del X%»), e per quella tabella vale anche per TNT.
 * - TNT: non la scrive da nessuna parte; ricavarla dal rapporto carburante/nolo
 *   dà solo tre decimali e inventerebbe scarti. Non si salva.
 * - Trading Post: non ha carburante mensile ma un'addizionale di contratto.
 */
export interface CarburanteLetto {
  vettore: "gls" | "tnt" | "fedex";
  anno: number;
  mese: number;
  percentuale: number;
  nota: string;
}

const DATA_ISO = /^(\d{4})-(\d{2})-\d{2}/;

function mesePerRiga(data: string | null): { anno: number; mese: number } | null {
  const m = data ? DATA_ISO.exec(data) : null;
  return m ? { anno: Number(m[1]), mese: Number(m[2]) } : null;
}

/** Il valore più frequente: una riga isolata con un carburante diverso non decide. */
function moda(valori: number[]): number {
  const conteggi = new Map<number, number>();
  for (const v of valori) conteggi.set(v, (conteggi.get(v) ?? 0) + 1);
  return [...conteggi.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

const plausibile = (p: number) => Number.isFinite(p) && p > 0 && p < 1;

export function carburanteDaFattura(fattura: FatturaLetta): CarburanteLetto[] {
  const riferimento = fattura.numero ? `fattura ${fattura.numero}` : "fattura caricata";

  if (fattura.vettore === "gls") {
    const p = fattura.totali.percentualeCarburante;
    if (p == null || !plausibile(p) || !fattura.anno || !fattura.mese) return [];
    return [{
      vettore: "gls", anno: fattura.anno, mese: fattura.mese, percentuale: p,
      nota: `Stampata in ${riferimento}.`,
    }];
  }

  if (fattura.vettore === "fedex") {
    const perMese = new Map<string, { anno: number; mese: number; valori: number[] }>();
    for (const riga of fattura.righe) {
      const grezzo = riga.dettaglio.percentuale_carburante;
      const p = Number(grezzo);
      const quando = mesePerRiga(riga.data);
      if (!quando || grezzo === undefined || grezzo === "" || !plausibile(p)) continue;
      const chiave = `${quando.anno}-${quando.mese}`;
      const gruppo = perMese.get(chiave) ?? { ...quando, valori: [] };
      gruppo.valori.push(p);
      perMese.set(chiave, gruppo);
    }
    // Senza percentuale per riga si ripiega sul dato di testata, se c'è.
    const testata = fattura.totali.percentualeCarburante;
    if (perMese.size === 0 && testata != null && plausibile(testata) && fattura.anno && fattura.mese) {
      perMese.set("testata", { anno: fattura.anno, mese: fattura.mese, valori: [testata] });
    }
    const esiti: CarburanteLetto[] = [];
    for (const g of perMese.values()) {
      const percentuale = moda(g.valori);
      esiti.push({ vettore: "fedex", anno: g.anno, mese: g.mese, percentuale, nota: `Dichiarata in ${riferimento} (FedEx).` });
      esiti.push({ vettore: "tnt", anno: g.anno, mese: g.mese, percentuale, nota: `Stessa tabella di FedEx, dichiarata in ${riferimento}.` });
    }
    return esiti;
  }

  return [];
}

export interface EsitoRegistrazioneCarburante {
  inseriti: Array<{ vettore: string; anno: number; mese: number; percentuale: number }>;
  /** Già presenti con un valore diverso: non si sovrascrive, si segnala. */
  discordanti: Array<{ vettore: string; anno: number; mese: number; presente: number; letta: number }>;
}

/**
 * Salva le percentuali lette, **solo dove manca il dato del mese**.
 *
 * Non si sovrascrive mai una comunicazione o un valore già inserito a mano:
 * una lettura sbagliata della fattura non deve poter cambiare, in silenzio, i
 * controlli di un mese. Se il valore c'è già e non coincide lo si restituisce,
 * perché chi carica la fattura lo veda.
 */
export async function registraCarburanteLetto(
  voci: CarburanteLetto[],
  utenteId: string | null
): Promise<EsitoRegistrazioneCarburante> {
  const esito: EsitoRegistrazioneCarburante = { inseriti: [], discordanti: [] };
  if (voci.length === 0) return esito;

  const admin = createAdminClient();
  const { data: vettori, error: eV } = await admin
    .schema("vettori").from("vettori").select("id, codice")
    .in("codice", [...new Set(voci.map((v) => v.vettore))]);
  if (eV) throw new Error(`Lettura vettori fallita: ${eV.message}`);
  const idPer = new Map((vettori ?? []).map((v) => [v.codice as string, v.id as string]));

  for (const voce of voci) {
    const vettoreId = idPer.get(voce.vettore);
    if (!vettoreId) continue;

    const { data: esistente, error: eE } = await admin
      .schema("vettori").from("carburante").select("percentuale, fonte")
      .eq("vettore_id", vettoreId).eq("anno", voce.anno).eq("mese", voce.mese).limit(1);
    if (eE) throw new Error(`Lettura carburante fallita: ${eE.message}`);
    const presente = (esistente ?? [])[0] as { percentuale: number; fonte: string } | undefined;
    const registrazione = { vettore: voce.vettore, anno: voce.anno, mese: voce.mese, percentuale: voce.percentuale };

    if (presente) {
      // Uno stimato lascia il posto a un dato letto; il resto resta com'è.
      if (presente.fonte === "stimato") {
        const { error } = await admin.schema("vettori").from("carburante")
          .update({ percentuale: voce.percentuale, fonte: "letto_da_fattura", note: voce.nota, inserito_da: utenteId, inserito_il: new Date().toISOString() })
          .eq("vettore_id", vettoreId).eq("anno", voce.anno).eq("mese", voce.mese);
        if (error) throw new Error(`Aggiornamento carburante fallito: ${error.message}`);
        esito.inseriti.push(registrazione);
      } else if (Math.abs(Number(presente.percentuale) - voce.percentuale) > 0.00005) {
        esito.discordanti.push({ vettore: voce.vettore, anno: voce.anno, mese: voce.mese, presente: Number(presente.percentuale), letta: voce.percentuale });
      }
      continue;
    }

    const { error } = await admin.schema("vettori").from("carburante").insert({
      vettore_id: vettoreId, anno: voce.anno, mese: voce.mese,
      percentuale: voce.percentuale, fonte: "letto_da_fattura", note: voce.nota,
      inserito_da: utenteId, inserito_il: new Date().toISOString(),
    });
    if (error) throw new Error(`Inserimento carburante fallito: ${error.message}`);
    esito.inseriti.push(registrazione);
  }
  return esito;
}
