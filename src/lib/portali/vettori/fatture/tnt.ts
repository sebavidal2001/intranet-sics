import type { FatturaLetta, RigaFattura, TotaliDichiarati } from "./tipi";
import { dataIt, interoIt, numeroIt, normalizzaRiferimento, righe } from "./testo";

/**
 * Lettura della fattura TNT.
 *
 * Due righe per spedizione: la prima con data, riferimento, lettera di vettura,
 * mittente e destinatario; la seconda con i soli numeri. È la struttura più
 * scomoda delle tre, perché la riga numerica ha un numero **variabile** di
 * campi — c'è un secondo peso solo quando TNT ha corretto quello dichiarato.
 *
 * Per questo i numeri si leggono **da destra**, dove l'ordine è stabile:
 *
 *     ... volume  tassato  tassato  carburante  nolo  totale
 *
 * Leggerli da sinistra funzionerebbe sulle righe complete e sbaglierebbe
 * silenziosamente tutte le altre, spostando il nolo di una posizione.
 *
 * I supplementi (movimentazione manuale, merce non sovrapponibile) non stanno
 * sulle righe ma sono riepilogati in coda: entrano nei totali, non nelle righe.
 */

/**
 * Il riferimento fra la data e la lettera di vettura **può mancare**: su sette
 * spedizioni di luglio su ventitré la lettera segue la data. Renderlo
 * obbligatorio faceva perdere quelle sette righe senza che niente lo dicesse —
 * la quadratura le avrebbe pescate, ma solo dopo.
 */
const RIGA_TESTA =
  /^(\d{1,2}\/\d{1,2}\/\d{4})\s+(?:(.+?)\s+)?([A-Z]{2}\d{6,})\s+(.+)$/;

/** Almeno sette numeri e nient'altro: è la riga dei valori. */
const RIGA_NUMERI = /^[\d.,\s]+$/;

export function leggiTnt(testo: string): FatturaLetta {
  const linee = righe(testo);
  const righeLette: RigaFattura[] = [];
  const nonLette: string[] = [];
  const avvertenze: string[] = [];

  const intestazione = leggiIntestazione(linee);

  for (let i = 0; i < linee.length; i++) {
    const testa = linee[i].trim();
    const m = testa.match(RIGA_TESTA);
    if (!m) continue;

    const successiva = (linee[i + 1] ?? "").trim();
    if (!RIGA_NUMERI.test(successiva)) {
      nonLette.push(testa);
      continue;
    }

    const valori = successiva
      .split(/\s+/)
      .map((v) => numeroIt(v))
      .filter((v): v is number => v != null);

    // colli + peso + tassato + carburante + nolo + totale = 6 minimo
    if (valori.length < 6) {
      nonLette.push(`${testa} || ${successiva}`);
      i++;
      continue;
    }

    const totale = valori.at(-1)!;
    const nolo = valori.at(-2)!;
    const carburante = valori.at(-3)!;
    const tassato = valori.at(-4)!;
    const colli = valori[0];

    // Quello che resta in mezzo sono i pesi reali, e — quando la spedizione ha
    // un volume dichiarato — la coppia volume/peso volumetrico.
    //
    // La coppia non si riconosce dalla posizione: il volume manca su alcune
    // spedizioni, e contarlo sempre presente sposta tutto di una colonna. Si
    // riconosce invece da una relazione che deve valere: il peso volumetrico è
    // il volume moltiplicato per il divisore del vettore. Verificarla, invece
    // di assumerla, rende la lettura indipendente dalla forma della riga.
    const mezzo = valori.slice(1, valori.length - 4);
    const DIVISORE = 250;
    let volume: number | null = null;
    let volumetrico: number | null = null;
    let pesi = mezzo;

    if (mezzo.length >= 2) {
      const possibileVolume = mezzo.at(-2)!;
      const possibileVolumetrico = mezzo.at(-1)!;
      const atteso = possibileVolume * DIVISORE;
      if (Math.abs(atteso - possibileVolumetrico) <= 0.05) {
        volume = possibileVolume;
        volumetrico = possibileVolumetrico;
        pesi = mezzo.slice(0, -2);
      }
    }

    if (volume == null && mezzo.length >= 3) {
      // Tre valori in mezzo senza una coppia volume/volumetrico riconoscibile:
      // il tracciato non è quello che conosco, e tirare a indovinare qui
      // significherebbe sbagliare il nolo in silenzio.
      nonLette.push(`${testa} || ${successiva}`);
      i++;
      continue;
    }

    // Fra i pesi reali, quando ce ne sono due, il secondo è la correzione di TNT.
    const peso = pesi.length ? pesi.at(-1)! : null;

    const [, data, riferimento, ldv, resto] = m;
    const controparte = resto.split(/\s+AIRFLUID/i)[0]?.trim() ?? resto.trim();

    righeLette.push({
      numero: righeLette.length + 1,
      data: dataIt(data),
      numeroSpedizione: ldv,
      riferimento: normalizzaRiferimento(riferimento),
      controparte,
      // Sulla fattura TNT esaminata la controparte è sempre il mittente e
      // AIRFLUID il destinatario: sono spedizioni in arrivo. Il verso va
      // comunque riletto dagli indirizzi quando compariranno delle partenze.
      direzione: /AIRFLUID/i.test(resto) ? "entrata" : null,
      colli: Math.round(colli),
      peso,
      pesoVolumetrico: volumetrico,
      pesoTassato: tassato,
      nolo,
      supplementi: 0,
      carburante,
      totale,
      dettaglio: { volumeMc: volume ?? 0, lettera_di_vettura: ldv },
    });
    i++; // la riga dei numeri è consumata
  }

  const totali = leggiTotaliTnt(linee);

  const senzaDirezione = righeLette.filter((r) => r.direzione == null).length;
  if (senzaDirezione > 0) {
    avvertenze.push(
      `${senzaDirezione} spedizioni senza verso riconoscibile dagli indirizzi: vanno decise a mano.`
    );
  }

  return {
    vettore: "tnt",
    numero: intestazione.numero,
    data: intestazione.data,
    anno: intestazione.anno,
    mese: intestazione.mese,
    righe: righeLette,
    totali,
    righeNonLette: nonLette,
    avvertenze,
  };
}

function leggiIntestazione(linee: string[]) {
  for (const l of linee) {
    // 85027776 del 29/07/2026 40023 CASTEL GUELFO ...
    const m = l.match(/^(\d{6,})\s+del\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (m) {
      const data = dataIt(m[2]);
      return {
        numero: m[1],
        data,
        anno: data ? Number(data.slice(0, 4)) : null,
        mese: data ? Number(data.slice(5, 7)) : null,
      };
    }
  }
  return { numero: null, data: null, anno: null, mese: null };
}

/**
 * Coda: i supplementi riepilogati e la riga dei totali.
 *
 *     MANH2 - Manual Handling : 10,00
 *     NOSTK - Not Stackable : 30,00
 *     35 406,35 23/ 23 62,09 255,18 357,27
 */
function leggiTotaliTnt(linee: string[]): TotaliDichiarati {
  const t: TotaliDichiarati = {
    spedizioni: null,
    colli: null,
    peso: null,
    pesoRiferito: "tassato",
    nolo: null,
    supplementi: 0,
    adeguamento: null,
    carburante: null,
    percentualeCarburante: null,
    totaleDocumento: null,
  };

  for (const l of linee) {
    const riga = l.trim();

    const suppl = riga.match(/^[A-Z0-9]+\s+-\s+.+?:\s*([\d.]+,\d{2})\s*$/);
    if (suppl) {
      t.supplementi = (t.supplementi ?? 0) + (numeroIt(suppl[1]) ?? 0);
      continue;
    }

    const tot = riga.match(
      /^(\d+)\s+([\d.]+,\d{2})\s+(\d+)\/\s*(\d+)\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s*$/
    );
    if (tot) {
      t.colli = interoIt(tot[1]);
      t.peso = numeroIt(tot[2]);
      t.spedizioni = interoIt(tot[4]);
      t.carburante = numeroIt(tot[5]);
      t.nolo = numeroIt(tot[6]);
      t.totaleDocumento = numeroIt(tot[7]);
    }
  }

  if (t.nolo != null && t.carburante != null && t.nolo > 0) {
    t.percentualeCarburante = Math.round((t.carburante / t.nolo) * 1000) / 1000;
  }
  return t;
}
