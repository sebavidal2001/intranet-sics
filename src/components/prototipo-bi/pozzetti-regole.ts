/**
 * LE REGOLE DEI POZZETTI — dove puo' andare cosa, e con che effetto.
 *
 * I pozzetti (Asse, Legenda, Valori, Filtri) sono il modo in cui chi viene da
 * Power BI e' abituato a costruire un grafico: si prende un campo dall'albero e
 * lo si lascia dove serve. Qui non c'e' un modello nuovo: i pozzetti sono una
 * VISTA della stessa `SelezioneCampi` dell'albero, e ogni gesto passa dalle
 * stesse funzioni pure (`selezioneConMisura`, `selezioneConSuddivisione`,
 * `riconciliaMisure`). Due modi di fare la stessa cosa danno lo stesso risultato
 * per costruzione.
 *
 * Come la selezione si legge nei pozzetti:
 *
 *   Valori   = le misure, la prima e' la principale;
 *   Asse     = il tempo (se c'e' una granularita') altrimenti la prima dimensione;
 *   Legenda  = la dimensione che suddivide l'asse (la seconda, o la prima se
 *              l'asse e' il tempo);
 *   Filtri   = i filtri della spec (non fanno parte della selezione: li gestisce
 *              chi usa il componente, qui si dice solo se un campo puo' entrarci).
 *
 * Ogni pozzetto di asse e legenda tiene UNA cosa e un nuovo arrivo SOSTITUISCE:
 * e' il comportamento che chi usa Power BI si aspetta, e quello che non lascia
 * mai piu' di due suddivisioni (oltre non esiste un grafico che le disegni).
 *
 * Ogni rifiuto ha un motivo scritto in italiano: un gesto che non fa niente,
 * senza dire perche', sembra un guasto.
 */

import {
  dimensioniAmmesse,
  motivoDimensioneFuoriDalleMisure,
  motivoMisuraNonSelezionabile,
  riconciliaMisure,
  selezioneConMisura,
  selezioneConSuddivisione,
  type SelezioneCampi,
} from "@/components/prototipo-bi/albero-campi";
import { VOCI_CALENDARIO } from "@/lib/prototipo-bi/gruppi-campi";
import {
  alternativeDiCalcolo,
  ammetteProgressivo,
} from "@/lib/prototipo-bi/albero-modello";
import {
  NOMI_VARIANTE,
  chiaveBase,
  componiValore,
  scomponiValore,
  type ChiaveCampo,
  type ChiaveValore,
  type VarianteValore,
} from "@/lib/prototipo-bi/misure-vocabolario";
import type { Dimensione, Granularita, MisuraDefinita } from "@/lib/prototipo-bi/tipi";
import { sonoUguali, type VoceCampo } from "./pozzetti-trascinamento";

// Chi usa le regole trova qui anche il tipo e il trascinamento.
export {
  TIPO_MIME_CAMPO,
  impostaTrascinamento,
  iscriviTrascinamento,
  leggiTrascinamento,
  leggiVoceDalTrasferimento,
  sonoUguali,
  type VoceCampo,
} from "./pozzetti-trascinamento";

/**
 * Nei grafici i pozzetti sono Asse, Legenda, Valori, Filtri. Nelle tabelle non
 * c'e' un asse ne' una legenda: ogni campo e' una colonna, e ne servono quanti
 * se ne vuole. Li' i pozzetti sono Campi, Valori, Filtri.
 */
export type NomePozzetto = "asse" | "legenda" | "valori" | "filtri" | "campi";

export interface ContestoPozzetti {
  perMetrica: Record<string, Dimensione[]>;
  /** Le operazioni coinvolte da ogni misura personalizzata (vedi `VocabolarioAlbero.famiglie`). */
  famiglie?: Record<string, string[]>;
  /** Le definizioni delle misure personalizzate: dicono se ammettono il progressivo. */
  definizioni?: Record<string, MisuraDefinita>;
  /** Il nome da mostrare per una voce (etichetta di mestiere, non la chiave). */
  etichetta: (voce: VoceCampo) => string;
}

export type EsitoDeposito =
  | {
      ok: true;
      selezione: SelezioneCampi;
      /** Qualcosa che il gesto ha fatto in piu' di quanto chiesto (sostituzioni, misure tolte). */
      avviso?: string;
      /** Per i Filtri: la selezione non cambia, chi chiama deve aggiungere un filtro su questa dimensione. */
      aggiungiFiltroSu?: Dimensione;
    }
  | { ok: false; motivo: string };

const no = (motivo: string): EsitoDeposito => ({ ok: false, motivo });

/** Cosa c'e' in ciascun pozzetto, dato la selezione. */
export function contenutoPozzetti(selezione: SelezioneCampi): {
  asse: VoceCampo | null;
  /** Normalmente una; di piu' solo se la selezione ne ha oltre il limite (si vedono per poterle togliere). */
  legenda: VoceCampo[];
  valori: ChiaveValore[];
} {
  const dims = selezione.suddivisioni;
  const tempo = selezione.granularita;
  const asse: VoceCampo | null = tempo
    ? { tipo: "calendario", chiave: tempo }
    : dims[0]
      ? { tipo: "dimensione", chiave: dims[0] }
      : null;
  const perLegenda = tempo ? dims : dims.slice(1);
  return {
    asse,
    legenda: perLegenda.map((d): VoceCampo => ({ tipo: "dimensione", chiave: d })),
    valori: selezione.misure,
  };
}

/**
 * Cosa c'e' nei pozzetti di una tabella.
 *
 * Il tempo, se c'e', e' la prima colonna; poi i campi nell'ordine scelto. L'ordine
 * conta: e' quello delle colonne e quello del raggruppamento delle righe.
 */
export function contenutoTabella(selezione: SelezioneCampi): { campi: VoceCampo[]; valori: ChiaveValore[] } {
  return {
    campi: [
      ...(selezione.granularita ? [{ tipo: "calendario", chiave: selezione.granularita } as VoceCampo] : []),
      ...selezione.suddivisioni.map((d): VoceCampo => ({ tipo: "dimensione", chiave: d })),
    ],
    valori: selezione.misure,
  };
}

function senzaGranularita(s: SelezioneCampi): SelezioneCampi {
  const copia = { ...s };
  delete copia.granularita;
  return copia;
}

/** Applica nuove suddivisioni e granularita', togliendo le misure che non reggono e dicendolo. */
function conSuddivisioni(
  selezione: SelezioneCampi,
  suddivisioni: Dimensione[],
  granularita: Granularita | undefined,
  contesto: ContestoPozzetti,
  avvisi: string[]
): EsitoDeposito {
  const { misure, tolte } = riconciliaMisure(selezione, suddivisioni, contesto.perMetrica, contesto.famiglie);
  for (const t of tolte) {
    avvisi.push(`Ho tolto «${contesto.etichetta({ tipo: "misura", chiave: t })}»: non esiste per questa suddivisione.`);
  }
  const base = senzaGranularita(selezione);
  return {
    ok: true,
    selezione: { ...base, misure, suddivisioni, ...(granularita ? { granularita } : {}) },
    ...(avvisi.length ? { avviso: avvisi.join(" ") } : {}),
  };
}

/** Lascia una voce in un pozzetto. Rifiuta, col motivo, quando non puo'. */
export function deponi(
  selezione: SelezioneCampi,
  pozzetto: NomePozzetto,
  voce: VoceCampo,
  contesto: ContestoPozzetti
): EsitoDeposito {
  const nome = contesto.etichetta(voce);

  // ── Valori: solo misure ───────────────────────────────────────────────────
  if (pozzetto === "valori") {
    if (voce.tipo !== "misura") return no("Nei valori vanno le misure: trascina qui una misura, per esempio «Ordinato».");
    if (selezione.misure.includes(voce.chiave)) return no(`«${nome}» è già nei valori.`);
    const motivo = motivoMisuraNonSelezionabile(voce.chiave, selezione, contesto.perMetrica, contesto.famiglie);
    if (motivo) return no(motivo);
    return { ok: true, selezione: selezioneConMisura(selezione, voce.chiave, true, contesto.perMetrica, contesto.famiglie) };
  }

  // ── Filtri: solo dimensioni, e la selezione non cambia ────────────────────
  if (pozzetto === "filtri") {
    if (voce.tipo !== "dimensione") {
      return no(
        voce.tipo === "misura"
          ? "Nei filtri vanno le dimensioni, non le misure: trascina qui, per esempio, «Cliente» o «Agente»."
          : "Il tempo non si filtra da qui: il periodo si sceglie nel riquadro «Quando»."
      );
    }
    if (selezione.misure.length === 0) return no("Scegli prima una misura.");
    const ammesse = contesto.perMetrica[selezione.misure[0]] ?? [];
    if (!ammesse.includes(voce.chiave) && voce.chiave !== "bu_categoria") {
      return no(motivoDimensioneFuoriDalleMisure(voce.chiave, selezione.misure, contesto.famiglie));
    }
    return { ok: true, selezione, aggiungiFiltroSu: voce.chiave };
  }

  // ── Campi di una tabella: tutti quelli che si vuole, ciascuno una colonna ──
  if (pozzetto === "campi") {
    if (voce.tipo === "misura") return no("Le misure vanno nei valori: trascinala lì.");
    if (selezione.misure.length === 0) return no("Scegli prima una misura.");
    if (voce.tipo === "calendario") {
      if (selezione.granularita === voce.chiave) return { ok: true, selezione };
      return { ok: true, selezione: { ...selezione, granularita: voce.chiave } };
    }
    if (!dimensioniAmmesse(selezione.misure, contesto.perMetrica, contesto.famiglie).includes(voce.chiave)) {
      return no(motivoDimensioneFuoriDalleMisure(voce.chiave, selezione.misure, contesto.famiglie));
    }
    if (selezione.suddivisioni.includes(voce.chiave)) return no(`«${nome}» è già nelle colonne.`);
    // Senza limite di due: in una tabella ogni campo e' una colonna.
    const avvisi: string[] = [];
    return conSuddivisioni(selezione, [...selezione.suddivisioni, voce.chiave], selezione.granularita, contesto, avvisi);
  }

  // ── Asse e legenda ────────────────────────────────────────────────────────
  if (voce.tipo === "misura") return no("Le misure vanno nei valori: trascinala lì.");
  if (voce.tipo === "calendario" && pozzetto === "legenda") {
    return no("Il tempo va sull'asse: l'andamento nel tempo è l'asse del grafico, la legenda suddivide.");
  }
  if (selezione.misure.length === 0) return no("Scegli prima una misura.");
  if (
    voce.tipo === "dimensione" &&
    !dimensioniAmmesse(selezione.misure, contesto.perMetrica, contesto.famiglie).includes(voce.chiave)
  ) {
    return no(motivoDimensioneFuoriDalleMisure(voce.chiave, selezione.misure, contesto.famiglie));
  }

  const dims = selezione.suddivisioni;
  const tempo = selezione.granularita;
  const avvisi: string[] = [];

  if (pozzetto === "asse") {
    if (voce.tipo === "calendario") {
      if (tempo === voce.chiave) return { ok: true, selezione };
      if (tempo) return conSuddivisioni(selezione, dims, voce.chiave, contesto, avvisi);
      // Il tempo prende il posto di quello che c'era sull'asse.
      const tolta = dims[0];
      if (tolta) avvisi.push(`Il tempo ha preso il posto di «${contesto.etichetta({ tipo: "dimensione", chiave: tolta })}» sull'asse.`);
      return conSuddivisioni(selezione, dims.slice(1), voce.chiave, contesto, avvisi);
    }
    // Dimensione sull'asse.
    if (tempo) {
      avvisi.push(`«${nome}» ha preso il posto del tempo sull'asse.`);
      const nuove = dims[0] === voce.chiave ? [voce.chiave] : [voce.chiave, ...dims.slice(0, 1)];
      return conSuddivisioni(selezione, nuove, undefined, contesto, avvisi);
    }
    if (dims[0] === voce.chiave) return { ok: true, selezione };
    if (dims[1] === voce.chiave) return conSuddivisioni(selezione, [voce.chiave, dims[0]], undefined, contesto, avvisi);
    if (dims[0]) avvisi.push(`«${nome}» ha preso il posto di «${contesto.etichetta({ tipo: "dimensione", chiave: dims[0] })}» sull'asse.`);
    return conSuddivisioni(selezione, [voce.chiave, ...dims.slice(1)], undefined, contesto, avvisi);
  }

  // Legenda: solo dimensioni.
  if (voce.tipo !== "dimensione") return no("La legenda suddivide l'asse con una dimensione.");
  if (tempo) {
    if (dims[0] === voce.chiave) return { ok: true, selezione };
    return conSuddivisioni(selezione, [voce.chiave], tempo, contesto, avvisi);
  }
  if (dims.length === 0) return no("Metti prima qualcosa sull'asse: la legenda suddivide l'asse.");
  if (dims[0] === voce.chiave) {
    if (dims.length === 1) return no(`«${nome}» è già sull'asse: per cambiarlo trascina un altro campo sull'asse.`);
    return conSuddivisioni(selezione, [dims[1], voce.chiave], undefined, contesto, avvisi);
  }
  if (dims[1] === voce.chiave) return { ok: true, selezione };
  if (dims[1]) avvisi.push(`«${nome}» ha preso il posto di «${contesto.etichetta({ tipo: "dimensione", chiave: dims[1] })}» nella legenda.`);
  return conSuddivisioni(selezione, [dims[0], voce.chiave], undefined, contesto, avvisi);
}

/**
 * Toglie una voce da un pozzetto. Anche l'ultima misura si puo' togliere: il
 * riquadro resta vuoto e l'errore c'e' solo se poi si prova a salvarlo.
 */
export function togliVoce(
  selezione: SelezioneCampi,
  voce: VoceCampo,
  contesto: ContestoPozzetti,
  /** In una tabella non c'e' una legenda che scala sull'asse: niente avviso. */
  inTabella = false
): EsitoDeposito {
  if (voce.tipo === "misura") {
    return { ok: true, selezione: selezioneConMisura(selezione, voce.chiave, false, contesto.perMetrica, contesto.famiglie) };
  }
  if (voce.tipo === "calendario") return { ok: true, selezione: senzaGranularita(selezione) };
  const dopo = selezioneConSuddivisione(selezione, voce.chiave, false, contesto.perMetrica, contesto.famiglie);
  // Togliendo l'asse la legenda scala al suo posto: dirlo.
  const eraAsse =
    !inTabella && !selezione.granularita && selezione.suddivisioni[0] === voce.chiave && selezione.suddivisioni.length > 1;
  return {
    ok: true,
    selezione: dopo,
    ...(eraAsse
      ? { avviso: `«${contesto.etichetta({ tipo: "dimensione", chiave: selezione.suddivisioni[1] })}» è passata dalla legenda all'asse.` }
      : {}),
  };
}

/** Sposta una misura nei valori. La prima e' la principale: spostarla in testa cambia la misura principale. */
export function spostaValore(selezione: SelezioneCampi, da: number, a: number): SelezioneCampi {
  if (da === a || da < 0 || a < 0 || da >= selezione.misure.length || a >= selezione.misure.length) return selezione;
  const misure = [...selezione.misure];
  const [mossa] = misure.splice(da, 1);
  misure.splice(a, 0, mossa);
  return { ...selezione, misure };
}

/**
 * Cosa si puo' lasciare in un pozzetto, per l'alternativa al trascinamento:
 * touch, tastiera e chi non ha pratica del trascinamento scelgono da un elenco.
 * Sono solo le voci che `deponi` accetterebbe.
 */
export function vociDisponibili(
  pozzetto: NomePozzetto,
  selezione: SelezioneCampi,
  contesto: ContestoPozzetti,
  campi: { misure: ChiaveCampo[]; dimensioni: Dimensione[] }
): VoceCampo[] {
  const candidate: VoceCampo[] =
    pozzetto === "valori"
      ? campi.misure.map((chiave): VoceCampo => ({ tipo: "misura", chiave }))
      : [
          ...(pozzetto === "asse" || pozzetto === "campi"
            ? VOCI_CALENDARIO.map((v): VoceCampo => ({ tipo: "calendario", chiave: v.chiave }))
            : []),
          ...campi.dimensioni.map((chiave): VoceCampo => ({ tipo: "dimensione", chiave })),
        ];
  const { asse, legenda } = contenutoPozzetti(selezione);
  const gia =
    pozzetto === "asse" ? [asse] : pozzetto === "legenda" ? legenda : pozzetto === "campi" ? contenutoTabella(selezione).campi : [];
  return candidate.filter((voce) => {
    if (gia.some((g) => g && sonoUguali(g, voce))) return false;
    const esito = deponi(selezione, pozzetto, voce, contesto);
    // Un deposito che non cambia niente non e' un'offerta.
    return esito.ok && !(!esito.aggiungiFiltroSu && esito.selezione === selezione);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Il periodo e il calcolo di un valore
//
// Un valore non e' solo «Ordinato»: e' «Ordinato dell'anno corrente», o «del
// precedente», o «cumulato». E «Ordinato» si puo' leggere come somma degli
// importi, come numero di ordini, come valore medio. Sono le scelte che in Power
// BI si fanno sul campo; qui si fanno sul valore, dal suo menu.
// ─────────────────────────────────────────────────────────────────────────────

/** Perche' un valore non puo' avere questo periodo, o `null` se puo'. */
export function motivoPeriodoNonAmmesso(
  valore: ChiaveValore,
  variante: VarianteValore | undefined,
  definizioni: Record<string, MisuraDefinita> = {}
): string | null {
  if (variante !== "progressivo" && variante !== "progressivo_ap") return null;
  return ammetteProgressivo(chiaveBase(valore), definizioni)
    ? null
    : "Il progressivo cumula: ha senso per somme e conteggi, non per medie, percentuali o misure personalizzate.";
}

/**
 * Cambia il periodo del valore in posizione `indice`.
 *
 * Se lo stesso valore, con quel periodo, c'e' gia', il gesto e' rifiutato: due
 * colonne identiche non dicono niente di piu'.
 */
export function cambiaPeriodoValore(
  selezione: SelezioneCampi,
  indice: number,
  variante: VarianteValore | undefined,
  contesto: ContestoPozzetti
): EsitoDeposito {
  const attuale = selezione.misure[indice];
  if (attuale === undefined) return no("Valore non trovato.");
  const { chiave, variante: prima } = scomponiValore(attuale);
  if (prima === variante) return { ok: true, selezione };
  const motivo = motivoPeriodoNonAmmesso(chiave, variante, contesto.definizioni);
  if (motivo) return no(motivo);
  const nuovo = componiValore(chiave, variante);
  if (selezione.misure.includes(nuovo)) {
    return no(`«${contesto.etichetta({ tipo: "misura", chiave })}» con questo periodo è già nei valori.`);
  }
  const misure = [...selezione.misure];
  misure[indice] = nuovo;
  return { ok: true, selezione: { ...selezione, misure } };
}

/**
 * Aggiunge, accanto al valore in posizione `indice`, lo stesso valore con un
 * altro periodo: e' il modo di avere «ordinato di quest'anno» e «ordinato
 * dell'anno scorso» come due colonne.
 */
export function aggiungiPeriodoAlValore(
  selezione: SelezioneCampi,
  indice: number,
  variante: VarianteValore,
  contesto: ContestoPozzetti
): EsitoDeposito {
  const attuale = selezione.misure[indice];
  if (attuale === undefined) return no("Valore non trovato.");
  const { chiave } = scomponiValore(attuale);
  const motivo = motivoPeriodoNonAmmesso(chiave, variante, contesto.definizioni);
  if (motivo) return no(motivo);
  const nuovo = componiValore(chiave, variante);
  if (selezione.misure.includes(nuovo)) {
    return no(`«${contesto.etichetta({ tipo: "misura", chiave })}» · ${NOMI_VARIANTE[variante].toLocaleLowerCase("it")} è già nei valori.`);
  }
  const misure = [...selezione.misure];
  misure.splice(indice + 1, 0, nuovo);
  return { ok: true, selezione: { ...selezione, misure } };
}

/**
 * Cambia il calcolo di un valore (somma, numero di documenti, valore medio)
 * tenendo il suo periodo e il suo posto.
 */
export function cambiaCalcoloValore(
  selezione: SelezioneCampi,
  indice: number,
  nuova: ChiaveCampo,
  contesto: ContestoPozzetti
): EsitoDeposito {
  const attuale = selezione.misure[indice];
  if (attuale === undefined) return no("Valore non trovato.");
  const { chiave, variante } = scomponiValore(attuale);
  if (chiave === nuova) return { ok: true, selezione };
  if (!alternativeDiCalcolo(chiave).some((a) => a.chiave === nuova)) return no("Questo valore non si legge in questo modo.");
  // Il progressivo non si applica a una media: si perde, e va detto.
  const nuovaVariante =
    motivoPeriodoNonAmmesso(nuova, variante, contesto.definizioni) !== null ? undefined : variante;
  const valore = componiValore(nuova, nuovaVariante);
  if (selezione.misure.includes(valore) && valore !== attuale) {
    return no(`«${contesto.etichetta({ tipo: "misura", chiave: nuova })}» è già nei valori.`);
  }
  const misure = [...selezione.misure];
  misure[indice] = valore;
  return {
    ok: true,
    selezione: { ...selezione, misure },
    ...(nuovaVariante !== variante
      ? { avviso: "Il progressivo non si applica a una media: ho tenuto il periodo scelto." }
      : {}),
  };
}

/** Sposta un campo (dimensione) di una tabella: cambia l'ordine delle colonne e del raggruppamento. */
export function spostaCampo(selezione: SelezioneCampi, da: number, a: number): SelezioneCampi {
  const dims = selezione.suddivisioni;
  if (da === a || da < 0 || a < 0 || da >= dims.length || a >= dims.length) return selezione;
  const suddivisioni = [...dims];
  const [mossa] = suddivisioni.splice(da, 1);
  suddivisioni.splice(a, 0, mossa);
  return { ...selezione, suddivisioni };
}
