import type { FatturaLetta, RigaFattura, TotaliDichiarati } from "./tipi";
import { dataIt, interoIt, numeroIt, normalizzaRiferimento, righe } from "./testo";

/**
 * Lettura della fattura GLS.
 *
 * Struttura: una riga per spedizione, raggruppate per giorno, con un
 * «Tot.Giorno» a chiudere ogni gruppo. In coda i totali generali, i supplementi
 * riepilogati per tipo, l'adeguamento ISTAT distinto fra anno corrente e
 * arretrati, e il carburante con la sua percentuale.
 *
 * Il campo che conta più di tutti è **BDA**: è il numero di bolla del fornitore,
 * cioè la chiave con cui la spedizione si aggancia al documento di trasporto.
 * Vale `0` quando GLS non lo ha registrato — su 55 spedizioni di luglio succede
 * 11 volte — e in quel caso la riga passa dall'abbinamento assistito.
 *
 * Righe di dettaglio: sotto alcune spedizioni compare `0 0 - A.10/10 - 0,50`,
 * che è l'assicurazione. Va sommata alla spedizione precedente, non contata
 * come spedizione a sé: farlo la conterebbe due volte nel totale colli.
 */

// 01/07/26 260134364 2459 da HTP HIGH TECH PROD 1 3,1 1,0 10,52 T
const RIGA_SPEDIZIONE =
  /^(\d{2}\/\d{2}\/\d{2})\s+(\d{6,})\s+(\S+)\s+(.+?)\s+(\d+)\s+([\d.]+,\d)\s+([\d.]+,\d)\s+([\d.]+,\d{2})\s*(.*)$/;

// 0 0 - A.10/10 - 0,50
const RIGA_ASSICURAZIONE = /^0\s+0\s+-\s+A\.\d+\/\d+\s+-\s+([\d.]+,\d{2})\s*$/;

export function leggiGls(testo: string): FatturaLetta {
  const linee = righe(testo);
  const righeLette: RigaFattura[] = [];
  const nonLette: string[] = [];
  const avvertenze: string[] = [];

  // In coda alla fattura c'è il «Dettaglio Servizi Sprinter»: righe con data e
  // numero di spedizione come quelle sopra, ma che non sono spedizioni — sono
  // servizi accessori già compresi. Contarle raddoppierebbe alcune spedizioni.
  let nelDettaglioServizi = false;

  for (const l of linee) {
    const riga = l.trim();

    if (/Dettaglio Servizi Sprinter/i.test(riga)) {
      nelDettaglioServizi = true;
      continue;
    }
    if (nelDettaglioServizi) continue;

    // L'assicurazione appartiene alla spedizione sopra.
    const ass = riga.match(RIGA_ASSICURAZIONE);
    if (ass) {
      const ultima = righeLette.at(-1);
      const importo = numeroIt(ass[1]) ?? 0;
      if (ultima) {
        ultima.supplementi += importo;
        ultima.totale = (ultima.totale ?? 0) + importo;
        ultima.dettaglio.assicurazione = importo;
      } else {
        nonLette.push(riga);
      }
      continue;
    }

    if (/Tot\.Giorno|^TOTALI|^Generale\b/.test(riga)) continue;

    const m = riga.match(RIGA_SPEDIZIONE);
    if (!m) {
      // Una riga che comincia con una data ma non si lascia leggere è il
      // segnale che il tracciato è cambiato: va mostrata, non ignorata.
      if (/^\d{2}\/\d{2}\/\d{2}\s+\d{6,}/.test(riga)) nonLette.push(riga);
      continue;
    }

    const [, data, nSped, bda, controparte, colli, peso, pesoVol, nolo, codici] = m;
    const inArrivo = /^da\s+/i.test(controparte.trim());

    righeLette.push({
      numero: righeLette.length + 1,
      data: dataIt(data),
      numeroSpedizione: nSped,
      riferimento: normalizzaRiferimento(bda),
      controparte: controparte.replace(/^da\s+/i, "").trim(),
      direzione: inArrivo ? "entrata" : "uscita",
      colli: interoIt(colli),
      peso: numeroIt(peso),
      pesoVolumetrico: numeroIt(pesoVol),
      pesoTassato: null, // GLS non lo espone: si ricava dal maggiore dei due
      nolo: numeroIt(nolo),
      supplementi: 0,
      carburante: 0, // esposto solo a livello di fattura, non di riga
      totale: numeroIt(nolo),
      dettaglio: {
        bdaGrezzo: bda,
        codiciSupplemento: (codici ?? "").trim(),
      },
    });
  }

  const totali = leggiTotaliGls(linee);

  const senzaRiferimento = righeLette.filter((r) => !r.riferimento).length;
  if (senzaRiferimento > 0) {
    avvertenze.push(
      `${senzaRiferimento} spedizioni su ${righeLette.length} non riportano il numero di bolla: passeranno dall'abbinamento assistito.`
    );
  }
  if (totali.percentualeCarburante == null) {
    avvertenze.push(
      "Percentuale carburante non trovata in fattura: non sarà possibile verificarla contro quella comunicata."
    );
  }

  return {
    vettore: "gls",
    numero: null, // il numero di fattura non compare nel dettaglio spedizioni
    data: null,
    anno: righeLette[0]?.data ? Number(righeLette[0].data.slice(0, 4)) : null,
    mese: righeLette[0]?.data ? Number(righeLette[0].data.slice(5, 7)) : null,
    righe: righeLette,
    totali,
    righeNonLette: nonLette,
    avvertenze,
  };
}

function leggiTotaliGls(linee: string[]): TotaliDichiarati {
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

  for (const l of linee) {
    // Generale 55 67 872,1 1027,6 1.013,22 11,00
    const gen = l.match(
      /^Generale\s+(\d+)\s+(\d+)\s+([\d.]+,\d+)\s+([\d.]+,\d+)\s+([\d.]+,\d{2})(?:\s+([\d.]+,\d{2}))?/
    );
    if (gen) {
      t.spedizioni = interoIt(gen[1]);
      t.colli = interoIt(gen[2]);
      t.peso = numeroIt(gen[3]);
      t.nolo = numeroIt(gen[5]);
      // La colonna successiva è Dir/Ass: l'assicurazione, esposta a parte.
      t.supplementi = numeroIt(gen[6] ?? "") ?? 0;
      continue;
    }

    const istat = l.match(/Totale adeguamento ISTAT:\s*([\d.]+,\d{2})/i);
    if (istat) {
      t.adeguamento = numeroIt(istat[1]);
      continue;
    }

    // Periodo Dal: 01/07/26 Al: 31/07/26 Tot. Nolo: 1086,25 Imp. % Camionistico 13,00 Importo: 141,21
    const fuel = l.match(
      /Imp\.\s*%\s*Camionistico\s+([\d.]+,\d{2}).*?Importo:\s*([\d.]+,\d{2})/i
    );
    if (fuel) {
      const pct = numeroIt(fuel[1]);
      t.percentualeCarburante = pct == null ? null : pct / 100;
      t.carburante = numeroIt(fuel[2]);
      continue;
    }

    const surch = l.match(/Totale Surcharge:\s*([\d.]+,\d{2})/i);
    if (surch && t.carburante == null) t.carburante = numeroIt(surch[1]);
  }

  if (t.nolo != null) {
    t.totaleDocumento =
      t.nolo + (t.supplementi ?? 0) + (t.adeguamento ?? 0) + (t.carburante ?? 0);
  }
  return t;
}
