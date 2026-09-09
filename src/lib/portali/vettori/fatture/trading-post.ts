import type { FatturaLetta, RigaFattura, TotaliDichiarati } from "./tipi";
import { dataIt, interoIt, numeroIt, normalizzaRiferimento, righe } from "./testo";

/**
 * Lettura della fattura Trading Post.
 *
 * Una riga per spedizione, con il **riferimento del mittente** in testa: è il
 * numero di bolla, e in questa fattura c'è sempre. La sigla `M`/`D` distingue
 * il verso: `M` significa che la controparte è il mittente — quindi merce in
 * arrivo da un fornitore — e `D` che è il destinatario, cioè una nostra
 * partenza verso un cliente.
 *
 * Sulla riga la colonna dopo il nolo si chiama FUEL ma vale l'11,0% esatto su
 * tutte le 67 righe di luglio e agosto: è l'**addizionale di gestione** fissata
 * a contratto, non un carburante mensile. Il parser la legge come supplemento e
 * non come carburante, perché è così che va confrontata con il listino.
 */

// 2113 01/07 74967/MI M BONAITA BUSTO AR VA 1 5,0 0,013 5 9,20 9,20 1,01
// 1845 01/07 295577/TP D SALUMIFICI GR REGGIO E RE 1 3,0 3 8,90 8,90 0,98
//
// La colonna `Tariffa` può mancare: sulla fattura di luglio una riga porta
// `... 3 8,90 2,75` invece di `... 3 8,90 8,90 0,98`. I totali di piede
// confermano che quegli 8,90 sono il nolo e 2,75 l'addizionale, quindi gli
// importi si leggono **da destra** — dove l'ordine è stabile — e non da
// sinistra, dove basta una colonna vuota per far scivolare tutto di uno.
const RIGA =
  /^(\S+)\s+(\d{2}\/\d{2})\s+(\S+\/[A-Z]{2})\s+([MD])\s+(.+?)\s+(\d+)\s+([\d.]+,\d)\s+(?:([\d.]+,\d{3})\s+)?(\d+)\s+((?:[\d.]+,\d{2}\s+){1,2}[\d.]+,\d{2})\s*$/;

export function leggiTradingPost(testo: string): FatturaLetta {
  const linee = righe(testo);
  const righeLette: RigaFattura[] = [];
  const nonLette: string[] = [];
  const avvertenze: string[] = [];

  const intestazione = leggiIntestazione(linee);

  for (const l of linee) {
    const riga = l.trim();
    const m = riga.match(RIGA);
    if (!m) {
      // Una riga che comincia con un riferimento e una data ma non si lascia
      // leggere: il tracciato è cambiato, e va vista.
      if (/^\S+\s+\d{2}\/\d{2}\s+\S+\/[A-Z]{2}\s+[MD]\s/.test(riga)) nonLette.push(riga);
      continue;
    }

    const [
      ,
      riferimento,
      giornoMese,
      nSped,
      sigla,
      controparte,
      colli,
      peso,
      volume,
      quantita,
      importiCoda,
    ] = m;

    // Da destra: l'ultimo importo è l'addizionale, il penultimo il nolo. Quando
    // ce n'è un terzo davanti, è la tariffa unitaria.
    const importi = importiCoda.trim().split(/\s+/);
    const addizionale = importi.at(-1)!;
    const nolo = importi.at(-2)!;
    const tariffa = importi.length >= 3 ? importi.at(-3)! : null;

    const anno = intestazione.anno ?? new Date().getFullYear();
    const [gg, mm] = giornoMese.split("/");

    righeLette.push({
      numero: righeLette.length + 1,
      data: dataIt(`${gg}/${mm}/${anno}`),
      numeroSpedizione: nSped,
      riferimento: normalizzaRiferimento(riferimento),
      controparte: controparte.trim(),
      // M = la controparte è il mittente, quindi la merce arriva a noi.
      direzione: sigla === "M" ? "entrata" : "uscita",
      colli: interoIt(colli),
      peso: numeroIt(peso),
      pesoVolumetrico: null, // in fattura c'è il volume, non il peso volumetrico
      pesoTassato: interoIt(quantita),
      nolo: numeroIt(nolo),
      supplementi: numeroIt(addizionale) ?? 0,
      carburante: 0,
      totale: (numeroIt(nolo) ?? 0) + (numeroIt(addizionale) ?? 0),
      dettaglio: {
        provincia: controparte.trim().match(/\b([A-Z]{2})$/)?.[1] ?? "",
        sigla,
        tariffa: numeroIt(tariffa ?? "") ?? 0,
        volumeMc: numeroIt(volume ?? "") ?? 0,
        addizionaleGestione: numeroIt(addizionale) ?? 0,
      },
    });
  }

  const totali = leggiTotaliTradingPost(linee);

  if (righeLette.length > 0) {
    const senzaVolume = righeLette.filter((r) => !r.dettaglio.volumeMc).length;
    if (senzaVolume > 0) {
      avvertenze.push(
        `${senzaVolume} spedizioni su ${righeLette.length} non riportano il volume: su quelle il peso volumetrico non è verificabile.`
      );
    }
  }
  avvertenze.push(
    "La colonna FUEL di Trading Post è l'addizionale di gestione dell'11% fissata a contratto, non un carburante mensile: viene confrontata con il listino, non con la percentuale del mese."
  );

  return {
    vettore: "trading_post",
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
  let numero: string | null = null;
  let data: string | null = null;
  for (const l of linee) {
    // 2218/TP 31/07/2026
    const m = l.match(/^(\d+\/[A-Z]{2})\s+(\d{2}\/\d{2}\/\d{4})\s*$/);
    if (m) {
      numero = m[1];
      data = dataIt(m[2]);
      break;
    }
  }
  return {
    numero,
    data,
    anno: data ? Number(data.slice(0, 4)) : null,
    mese: data ? Number(data.slice(5, 7)) : null,
  };
}

/**
 * I totali di piede sono spezzati su più righe dall'estrazione, perché
 * nell'originale sono etichette e valori su colonne affiancate. Si riconoscono
 * per forma: `53` da solo è il numero di spedizioni, `96,34` l'addizionale, e
 * `60 1.200,20 859,00 FUEL` porta colli, chili e nolo.
 */
function leggiTotaliTradingPost(linee: string[]): TotaliDichiarati {
  const t: TotaliDichiarati = {
    spedizioni: null,
    colli: null,
    peso: null,
    pesoRiferito: "reale",
    nolo: null,
    supplementi: null,
    adeguamento: null,
    carburante: null,
    percentualeCarburante: null,
    totaleDocumento: null,
  };

  for (let i = 0; i < linee.length; i++) {
    const l = linee[i].trim();

    // 60 1.200,20 859,00 FUEL
    const corpo = l.match(/^(\d+)\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+FUEL\s*$/);
    if (corpo) {
      t.colli = interoIt(corpo[1]);
      t.peso = numeroIt(corpo[2]);
      t.nolo = numeroIt(corpo[3]);
      // Le due righe precedenti portano spedizioni e addizionale.
      for (let k = Math.max(0, i - 4); k < i; k++) {
        const p = linee[k].trim();
        if (/^\d+$/.test(p) && t.spedizioni == null) t.spedizioni = interoIt(p);
        else if (/^[\d.]+,\d{2}$/.test(p) && t.supplementi == null)
          t.supplementi = numeroIt(p);
      }
      continue;
    }

    // 955,34 2200 22% 210,17 955,34
    const chiusura = l.match(/^([\d.]+,\d{2})\s+\d{4}\s+\d{1,2}%\s+([\d.]+,\d{2})/);
    if (chiusura) t.totaleDocumento = numeroIt(chiusura[1]);
  }

  return t;
}
