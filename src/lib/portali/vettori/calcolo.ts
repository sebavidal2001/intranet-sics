import type {
  CondizioneSpedizione,
  CostoAtteso,
  DatiSpedizione,
  Fascia,
  ListinoRisolto,
  Supplemento,
  VoceCalcolo,
} from "./tipi";

/**
 * Motore di calcolo del costo atteso di una spedizione.
 *
 * Funzione pura: nessun accesso al database, nessuna data implicita. Il listino
 * arriva già risolto alla data della spedizione, così il ricalcolo di un mese
 * chiuso dà lo stesso risultato di allora.
 *
 * ---------------------------------------------------------------------------
 * L'ORDINE DELLE OPERAZIONI È IL PUNTO
 * ---------------------------------------------------------------------------
 * I fogli di calcolo in uso confrontano il solo nolo con un importo di fattura
 * che contiene assicurazione, adeguamento e carburante: 151 spedizioni su 192
 * risultano fuori del 10%, cioè l'allarme suona sempre. Qui si ricostruisce la
 * fattura nello stesso ordine in cui la costruisce il vettore:
 *
 *   1. peso tassabile   = max(reale, volumetrico), poi minimo e arrotondamento
 *   2. nolo             = fascia di peso sulla zona
 *   3. supplementi      = fissi, a peso, a collo, percentuali
 *   4. imponibile nolo  = nolo + supplementi che fanno base
 *   5. adeguamento      = imponibile x percentuale contrattuale
 *   6. carburante       = (imponibile + adeguamento) x percentuale del mese
 *   7. totale           = imponibile + adeguamento + carburante + fuori base
 *
 * Il passo 4 non è pignoleria contabile. Sulla fattura GLS di luglio 2026 la
 * voce "Nolo 1.013,22" comprende già handling, autostrade, oversized, safety &
 * energy e bollettazione manuale, mentre l'assicurazione (11,00) è esposta a
 * parte. Il conto torna al centesimo: (1.013,22 + 73,03) x 13% = 141,21, che è
 * l'importo stampato. Mettere l'assicurazione dentro la base gonfierebbe il
 * costo atteso su ogni spedizione assicurata, cioè su quasi tutte.
 */

/** Due decimali, con arrotondamento commerciale. */
function euro(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Peso volumetrico in kg.
 *
 * Il divisore non è una costante: 300 kg/mc per GLS e Trading Post, 250 per TNT
 * e FedEx. Applicare quello sbagliato cambia la fascia, e quindi il prezzo.
 */
export function pesoVolumetrico(
  dati: DatiSpedizione,
  divisoreKgMc: number
): number {
  if (dati.misureColli?.length) {
    return dati.misureColli.reduce((s, c) => s + c.quantita * c.lunghezzaCm * c.larghezzaCm * c.altezzaCm, 0) / 1_000_000 * divisoreKgMc;
  }
  if (dati.volumeMc != null && dati.volumeMc > 0) {
    return dati.volumeMc * divisoreKgMc;
  }
  const { lunghezzaCm, larghezzaCm, altezzaCm } = dati;
  if (lunghezzaCm && larghezzaCm && altezzaCm) {
    const mc = (lunghezzaCm * larghezzaCm * altezzaCm) / 1_000_000;
    return mc * divisoreKgMc * Math.max(1, dati.colli);
  }
  return 0;
}

/**
 * Peso su cui si applica la tariffa, con l'indicazione di quale dei due ha
 * fatto prezzo — che è l'informazione che serve davanti a una contestazione.
 */
export function pesoTassabile(
  dati: DatiSpedizione,
  divisoreKgMc: number,
  minimoTassabile = 0,
  arrotondamentoKg = 0,
  arrotondamentoDaKg = 0
): { peso: number; volumetrico: number; applicato: "reale" | "volumetrico" | "minimo" } {
  const volumetrico = pesoVolumetrico(dati, divisoreKgMc);
  let peso = Math.max(dati.pesoReale, volumetrico);
  let applicato: "reale" | "volumetrico" | "minimo" =
    volumetrico > dati.pesoReale ? "volumetrico" : "reale";

  if (minimoTassabile > 0 && peso < minimoTassabile) {
    peso = minimoTassabile;
    applicato = "minimo";
  }
  // L'arrotondamento può valere solo oltre una soglia. Trading Post arrotonda ai
  // 100 kg ma solo sopra il quintale: applicarlo sempre farebbe pagare 100 kg
  // per un collo da 5, che è l'errore più caro che questo motore possa fare.
  if (arrotondamentoKg > 0 && peso >= arrotondamentoDaKg) {
    peso = Math.ceil(peso / arrotondamentoKg) * arrotondamentoKg;
  }
  return { peso, volumetrico, applicato };
}

/**
 * Trova la fascia di peso.
 *
 * Le soglie sono inclusive in alto ed esclusive in basso — «fino a 3 kg» include
 * i 3 kg esatti — come fanno i fogli in uso e come confermano le fatture: una
 * spedizione TNT da 3,95 kg cade in 3,1-5 e viene addebitata 8,00 €.
 */
export function trovaFascia(fasce: Fascia[], peso: number): Fascia | null {
  const ordinate = [...fasce].sort((a, b) => a.pesoDa - b.pesoDa);
  for (const f of ordinate) {
    const sopraIlMinimo = peso > f.pesoDa || f.pesoDa === 0;
    const sottoIlMassimo = f.pesoA == null || peso <= f.pesoA;
    if (sopraIlMinimo && sottoIlMassimo) return f;
  }
  return null;
}

/**
 * Nolo della fascia.
 *
 * Tre casi: importo fisso, tariffa al quintale (Trading Post oltre i 100 kg),
 * e fascia finale a scatti — GLS aggiunge 18,10 € ogni 50 kg oltre il quintale,
 * TNT e FedEx 16,06 €.
 */
export function calcolaNolo(fascia: Fascia, peso: number): number {
  if (fascia.tipo === "quintale") {
    return euro(fascia.importo * (peso / 100));
  }
  if (fascia.pesoA == null && fascia.scattoKg && fascia.scattoImporto) {
    const eccedenza = Math.max(0, peso - fascia.pesoDa);
    const scatti = Math.ceil(eccedenza / fascia.scattoKg);
    return euro(fascia.importo + scatti * fascia.scattoImporto);
  }
  return euro(fascia.importo);
}

function supplementoApplicabile(
  s: Supplemento,
  peso: number,
  condizioni: Set<CondizioneSpedizione>
): boolean {
  if (s.condizione !== "sempre" && !condizioni.has(s.condizione)) return false;
  if (s.sogliaKgDa != null && peso < s.sogliaKgDa) return false;
  if (s.sogliaKgA != null && peso > s.sogliaKgA) return false;
  return true;
}

function importoSupplemento(
  s: Supplemento,
  peso: number,
  colli: number,
  nolo: number
): number {
  let v: number;
  switch (s.tipoCalcolo) {
    case "fisso_spedizione":
      v = s.valore;
      break;
    case "per_kg":
      v = s.valore * peso;
      break;
    case "per_collo":
      v = s.valore * Math.max(1, colli);
      break;
    case "percentuale_nolo":
      v = s.valore * nolo;
      break;
  }
  if (s.importoMinimo != null && v < s.importoMinimo) v = s.importoMinimo;
  if (s.importoMassimo != null && v > s.importoMassimo) v = s.importoMassimo;
  return euro(v);
}

/**
 * Costo atteso completo di una spedizione.
 *
 * Non solleva eccezioni per dati mancanti: quello che non si può calcolare
 * finisce in `avvertenze` e il totale resta parziale. Un controllo che si
 * rifiuta di rispondere non serve a nessuno; uno che risponde nascondendo
 * quello che non sapeva è peggio.
 */
export function calcolaCostoAtteso(
  dati: DatiSpedizione,
  listino: ListinoRisolto
): CostoAtteso {
  const avvertenze: string[] = [];
  const { vettore } = listino;

  const nonSovrapponibileTP = vettore.codice === "trading_post" && dati.condizioni?.includes("non_sovrapponibile");
  const datiCalcolo = nonSovrapponibileTP ? {
    ...dati,
    altezzaCm: dati.altezzaCm ? Math.max(180, dati.altezzaCm) : dati.altezzaCm,
    misureColli: dati.misureColli?.map((c) => ({ ...c, altezzaCm: Math.max(180, c.altezzaCm) })),
  } : dati;
  const { peso, volumetrico, applicato } = pesoTassabile(
    datiCalcolo,
    vettore.divisoreVolumetrico,
    vettore.pesoMinimoTassabile,
    vettore.arrotondamentoKg,
    vettore.arrotondamentoDaKg
  );
  if (nonSovrapponibileTP) avvertenze.push("Trading Post non sovrapponibile: altezza minima tariffaria 180 cm per i colli misurati.");

  if (volumetrico === 0) {
    avvertenze.push(
      "Peso volumetrico non calcolabile: mancano volume e dimensioni. Il controllo verifica la tariffa applicata, non il peso addebitato."
    );
  }

  const fascia = trovaFascia(listino.fasce, peso);
  if (!fascia) {
    return {
      pesoReale: dati.pesoReale,
      pesoVolumetrico: euro(volumetrico),
      pesoTassabile: peso,
      pesoApplicato: applicato,
      nolo: 0,
      fasciaDescrizione: "nessuna fascia",
      supplementi: [],
      imponibileNolo: 0,
      adeguamento: 0,
      carburante: 0,
      fuoriBase: 0,
      totale: 0,
      avvertenze: [
        ...avvertenze,
        `Nessuna fascia di peso copre ${peso.toFixed(3)} kg sulla zona ${listino.zonaCodice}: il listino va completato.`,
      ],
    };
  }

  const nolo = calcolaNolo(fascia, peso);
  const fasciaDescrizione =
    fascia.pesoA == null
      ? `oltre ${fascia.pesoDa} kg`
      : `da ${fascia.pesoDa} a ${fascia.pesoA} kg`;

  const condizioni = new Set(dati.condizioni ?? []);
  const inBase: VoceCalcolo[] = [];
  const fuoriBaseVoci: VoceCalcolo[] = [];

  for (const s of listino.supplementi) {
    if (!supplementoApplicabile(s, peso, condizioni)) continue;
    const importo = importoSupplemento(s, peso, dati.colli, nolo);
    if (importo === 0) continue;
    (s.baseNolo ? inBase : fuoriBaseVoci).push({
      codice: s.codice,
      descrizione: s.nome,
      importo,
    });
  }

  const imponibileNolo = euro(
    nolo + inBase.reduce((t, v) => t + v.importo, 0)
  );
  const fuoriBase = euro(fuoriBaseVoci.reduce((t, v) => t + v.importo, 0));

  const adeguamento = listino.adeguamento
    ? euro(imponibileNolo * listino.adeguamento)
    : 0;

  if (listino.carburante == null) {
    avvertenze.push(
      "Nessuna percentuale carburante registrata per il mese o i mesi precedenti: il totale atteso è al netto del carburante e non è confrontabile con la fattura."
    );
  }
  const carburante = listino.carburante
    ? euro((imponibileNolo + adeguamento) * listino.carburante)
    : 0;

  return {
    pesoReale: dati.pesoReale,
    pesoVolumetrico: euro(volumetrico),
    pesoTassabile: peso,
    pesoApplicato: applicato,
    nolo,
    fasciaDescrizione,
    supplementi: [...inBase, ...fuoriBaseVoci],
    imponibileNolo,
    adeguamento,
    carburante,
    fuoriBase,
    totale: euro(imponibileNolo + adeguamento + carburante + fuoriBase),
    avvertenze,
  };
}

/**
 * Scostamento fra fatturato e atteso, come frazione dell'atteso.
 * `null` quando l'atteso è zero: una divisione per zero travestita da -100%
 * è il modo più rapido per riempire un cruscotto di anomalie inesistenti.
 */
export function scostamento(fatturato: number, atteso: number): number | null {
  if (atteso <= 0) return null;
  return (fatturato - atteso) / atteso;
}

export type EsitoControllo = "in_linea" | "da_verificare" | "anomalia" | "non_valutabile";

export interface SoglieControllo {
  /** Oltre questa frazione lo scostamento va guardato. Default 5%. */
  verifica: number;
  /** Oltre questa frazione è anomalia. Default 10%. */
  anomalia: number;
}

export const SOGLIE_DEFAULT: SoglieControllo = { verifica: 0.05, anomalia: 0.10 };

/**
 * Classifica una riga di controllo.
 *
 * Le soglie di partenza vengono dai dati reali, non da un'intuizione: rifacendo
 * il confronto su grandezze omogenee sulle 192 spedizioni GLS del foglio, lo
 * scarto tipico è il 5,9%, oltre il 10% restano 41 righe e oltre il 20% quindici.
 * Sono quelle quindici a valere una contestazione.
 */
export function classifica(
  fatturato: number,
  atteso: number,
  soglie: SoglieControllo = SOGLIE_DEFAULT
): { esito: EsitoControllo; scostamento: number | null } {
  const s = scostamento(fatturato, atteso);
  if (s === null) return { esito: "non_valutabile", scostamento: null };
  const abs = Math.abs(s);
  if (abs > soglie.anomalia) return { esito: "anomalia", scostamento: s };
  if (abs > soglie.verifica) return { esito: "da_verificare", scostamento: s };
  return { esito: "in_linea", scostamento: s };
}
