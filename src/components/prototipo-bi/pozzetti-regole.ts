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
  motivoMisuraNonSelezionabile,
  riconciliaMisure,
  selezioneConMisura,
  selezioneConSuddivisione,
  type SelezioneCampi,
} from "@/components/prototipo-bi/albero-campi";
import { VOCI_CALENDARIO, motivoDimensioneNonAmmessa } from "@/lib/prototipo-bi/gruppi-campi";
import type { ChiaveCampo } from "@/lib/prototipo-bi/misure-vocabolario";
import type { Dimensione, Granularita } from "@/lib/prototipo-bi/tipi";
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

export type NomePozzetto = "asse" | "legenda" | "valori" | "filtri";

export interface ContestoPozzetti {
  perMetrica: Record<string, Dimensione[]>;
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
  valori: ChiaveCampo[];
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
  const { misure, tolte } = riconciliaMisure(selezione, suddivisioni, contesto.perMetrica);
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
    const motivo = motivoMisuraNonSelezionabile(voce.chiave, selezione, contesto.perMetrica);
    if (motivo) return no(motivo);
    return { ok: true, selezione: selezioneConMisura(selezione, voce.chiave, true, contesto.perMetrica) };
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
    if (!ammesse.includes(voce.chiave) && voce.chiave !== "bu_categoria") return no(motivoDimensioneNonAmmessa(voce.chiave));
    return { ok: true, selezione, aggiungiFiltroSu: voce.chiave };
  }

  // ── Asse e legenda ────────────────────────────────────────────────────────
  if (voce.tipo === "misura") return no("Le misure vanno nei valori: trascinala lì.");
  if (voce.tipo === "calendario" && pozzetto === "legenda") {
    return no("Il tempo va sull'asse: l'andamento nel tempo è l'asse del grafico, la legenda suddivide.");
  }
  if (selezione.misure.length === 0) return no("Scegli prima una misura.");
  if (voce.tipo === "dimensione" && !dimensioniAmmesse(selezione.misure, contesto.perMetrica).includes(voce.chiave)) {
    return no(motivoDimensioneNonAmmessa(voce.chiave));
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

/** Toglie una voce da un pozzetto. Dall'ultimo valore non si toglie: senza misure non c'e' domanda. */
export function togliVoce(selezione: SelezioneCampi, voce: VoceCampo, contesto: ContestoPozzetti): EsitoDeposito {
  if (voce.tipo === "misura") {
    if (selezione.misure.length <= 1) {
      return no("Serve almeno una misura: aggiungine un'altra prima di togliere questa.");
    }
    return { ok: true, selezione: selezioneConMisura(selezione, voce.chiave, false, contesto.perMetrica) };
  }
  if (voce.tipo === "calendario") return { ok: true, selezione: senzaGranularita(selezione) };
  const dopo = selezioneConSuddivisione(selezione, voce.chiave, false, contesto.perMetrica);
  // Togliendo l'asse la legenda scala al suo posto: dirlo.
  const eraAsse = !selezione.granularita && selezione.suddivisioni[0] === voce.chiave && selezione.suddivisioni.length > 1;
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
          ...(pozzetto === "asse" ? VOCI_CALENDARIO.map((v): VoceCampo => ({ tipo: "calendario", chiave: v.chiave })) : []),
          ...campi.dimensioni.map((chiave): VoceCampo => ({ tipo: "dimensione", chiave })),
        ];
  const { asse, legenda } = contenutoPozzetti(selezione);
  const gia = pozzetto === "asse" ? [asse] : pozzetto === "legenda" ? legenda : [];
  return candidate.filter((voce) => {
    if (gia.some((g) => g && sonoUguali(g, voce))) return false;
    const esito = deponi(selezione, pozzetto, voce, contesto);
    // Un deposito che non cambia niente non e' un'offerta.
    return esito.ok && !(!esito.aggiungiFiltroSu && esito.selezione === selezione);
  });
}
