import { normalizzaRiferimento } from "./fatture/testo";
import type { RigaFattura } from "./fatture/tipi";

/**
 * Aggancio delle righe di fattura ai documenti di trasporto del gestionale.
 *
 * ---------------------------------------------------------------------------
 * DUE COSE DA SAPERE PRIMA DI LEGGERE IL CODICE
 * ---------------------------------------------------------------------------
 *
 * **1. La chiave cambia verso.** Sulle partenze la fattura cita il nostro numero
 * di bolla; sugli arrivi cita quello *del fornitore*, che il gestionale conserva
 * in `numero_documento` sui carichi. Una chiave sola non basta, e sceglierne una
 * sbagliata non produce un errore: produce zero abbinamenti.
 *
 * **2. La spedizione logica non è il documento.** Una bolla del fornitore
 * corrisponde a più carichi nel gestionale in 62 casi sul 2026, e un documento
 * risulta suddiviso in undici. Il vettore però fattura una spedizione sola. Si
 * raggruppa quindi per controparte + numero + data prima di abbinare, altrimenti
 * la riga di fattura trova N candidati identici e non sa quale scegliere.
 */

/** Una testata di documento come arriva da `bi.trasporti_documenti`. */
export interface BollaGestionale {
  id_documento: number;
  codice_profilo: string | null;
  tipo_registro: string | null;
  numero_progressivo: string | null;
  numero_documento: string | null;
  data_documento: string | null;
  data_registrazione: string | null;
  id_sog_commerciale: number | null;
  codice_soggetto: string | null;
  soggetto: string | null;
  zona_cap: string | null;
  zona_provincia: string | null;
  fonte_zona: string | null;
  tipo_trasporto_codice: string | null;
  tipo_trasporto: string | null;
  vettore_codice: string | null;
  vettore: string | null;
  num_colli: string | number | null;
  peso_netto: string | number | null;
  peso_lordo: string | number | null;
  volume: string | number | null;
}

export type Direzione = "entrata" | "uscita";

/** L'unità con cui il vettore fattura: uno o più documenti che viaggiano insieme. */
export interface SpedizioneLogica {
  chiave: string;
  direzione: Direzione;
  /** Il numero con cui il vettore la fattura, grezzo. */
  riferimento: string | null;
  riferimentoNorm: string | null;
  dataDocumento: string | null;
  codiceControparte: string | null;
  controparte: string | null;
  zonaCap: string | null;
  zonaProvincia: string | null;
  portoCodice: string | null;
  porto: string | null;
  aNostroCarico: boolean | null;
  vettoreCodice: string | null;
  colli: number | null;
  peso: number | null;
  volumeMc?: number | null;
  idDocumenti: number[];
}

function n(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : null;
}

/**
 * Il verso del documento. `BF` è un carico da fornitore, `BC` un DDT di vendita;
 * il `tipo_registro` (`DA` / `DV`) è il classificatore primario, come stabilito
 * per `filiera_righe`, e il profilo serve da conferma.
 */
export function direzioneDi(b: BollaGestionale): Direzione | null {
  if (b.tipo_registro === "DA") return "entrata";
  if (b.tipo_registro === "DV") return "uscita";
  if (b.codice_profilo === "BF") return "entrata";
  if (b.codice_profilo === "BC") return "uscita";
  return null;
}

/**
 * La spedizione è a nostro carico, cioè ce la fattura il vettore?
 *
 * **Il porto si legge al contrario nei due versi.** Sulle uscite paghiamo noi
 * col franco (`01`) e col franco addebito fattura (`03`); sugli arrivi paghiamo
 * noi col porto assegnato (`02`), perché lì è il vettore che fattura a noi.
 * Sulle 39 bolle agganciate alla fattura GLS di luglio, 37 erano in `02`.
 */
export function aNostroCarico(
  direzione: Direzione,
  portoCodice: string | null
): boolean | null {
  if (!portoCodice) return null;
  return direzione === "uscita"
    ? portoCodice === "01" || portoCodice === "03"
    : portoCodice === "02";
}

/**
 * Raggruppa i documenti in spedizioni logiche.
 *
 * Chiave: verso + controparte + numero normalizzato + data. I documenti senza
 * numero restano **individuali**: fonderli per controparte e data unirebbe
 * spedizioni diverse dello stesso fornitore nello stesso giorno, che è un errore
 * peggiore del non raggrupparle.
 */
export function raggruppaInSpedizioni(
  bolle: BollaGestionale[]
): SpedizioneLogica[] {
  const gruppi = new Map<string, SpedizioneLogica>();

  for (const b of bolle) {
    const direzione = direzioneDi(b);
    if (!direzione) continue;

    // Sulle uscite il riferimento è il nostro progressivo; sugli arrivi è il
    // numero del fornitore, che il gestionale mette in `numero_documento`.
    const grezzo =
      direzione === "uscita"
        ? (b.numero_progressivo ?? b.numero_documento)
        : (b.numero_documento ?? b.numero_progressivo);
    const norm = normalizzaRiferimento(grezzo);
    const data = b.data_documento ?? b.data_registrazione;

    const chiave = norm
      ? `${direzione}|${b.codice_soggetto ?? ""}|${norm}|${data ?? ""}`
      : `${direzione}|doc|${b.id_documento}`;

    const esistente = gruppi.get(chiave);
    if (esistente) {
      esistente.idDocumenti.push(b.id_documento);
      const c = n(b.num_colli);
      if (c != null) esistente.colli = (esistente.colli ?? 0) + c;
      const p = n(b.peso_lordo) ?? n(b.peso_netto);
      if (p != null) esistente.peso = (esistente.peso ?? 0) + p;
      const volume = n(b.volume);
      if (volume != null) esistente.volumeMc = (esistente.volumeMc ?? 0) + volume;
      continue;
    }

    gruppi.set(chiave, {
      chiave,
      direzione,
      riferimento: grezzo ?? null,
      riferimentoNorm: norm,
      dataDocumento: data,
      codiceControparte: b.codice_soggetto,
      controparte: b.soggetto,
      zonaCap: b.zona_cap,
      zonaProvincia: b.zona_provincia,
      portoCodice: b.tipo_trasporto_codice,
      porto: b.tipo_trasporto,
      aNostroCarico: aNostroCarico(direzione, b.tipo_trasporto_codice),
      vettoreCodice: b.vettore_codice,
      colli: n(b.num_colli),
      peso: n(b.peso_lordo) ?? n(b.peso_netto),
      volumeMc: n(b.volume),
      idDocumenti: [b.id_documento],
    });
  }

  return [...gruppi.values()];
}

/** Forme societarie: rumore, non nome. */
const FORME_SOCIETARIE = new Set([
  "SRL", "SRLS", "SPA", "SNC", "SAS", "SAPA", "SCRL", "SCARL", "SCPA",
  "SR", "SOC", "SOCIETA", "COOP", "COOPERATIVA", "CONSORTILE", "UNIPERSONALE",
]);

/**
 * Spezza una ragione sociale nelle sue parole significative.
 *
 * I punti si tolgono **senza** inserire spazio, così «T.M.T. srl» diventa
 * `[TMT]` e non `[T, M, T]`. Le altre punteggiature diventano separatori.
 */
function paroleNome(s: string | null | undefined): string[] {
  return (s ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\./g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0 && !FORME_SOCIETARIE.has(p));
}

/**
 * Le due ragioni sociali possono essere la stessa azienda?
 *
 * È il confronto più insidioso di tutto il modulo, perché i due lati scrivono i
 * nomi in modi diversi e **nessuno dei due li scrive per intero**:
 *
 * | In fattura | Nel gestionale |
 * |---|---|
 * | `HTP HIGH TECH PROD` | `H.T.P. High Tech Products sr` |
 * | `SAF CARBONAT CO` | `SAF srl` |
 * | `S G E BAGNACAV RA` | `S.G.E. srl` |
 * | `BONAITA BUSTO AR VA` | `AIR BONAITA spa` |
 *
 * Trading Post tronca il nome a larghezza fissa e ci attacca **città e
 * provincia**; GLS lo tronca a metà parola; il gestionale ci mette i punti e la
 * forma societaria. Un confronto per prefisso sui primi sei caratteri sembra
 * funzionare e invece perde tutti i nomi corti: `SAF srl` contro
 * `SAF CARBONAT CO` non aggancia, perché il sesto carattere di uno è la `S` di
 * «srl» e dell'altro la `A` di «CARBONAT».
 *
 * Si confrontano quindi le **parole**, tolte le forme societarie, in due modi:
 *
 * 1. il nome più corto coincide con le prime parole del più lungo — e la
 *    coincidenza deve finire su un confine di parola, altrimenti `SAF`
 *    aggancerebbe anche `SAFE SAN GIOV BO`, che è un'altra azienda presente
 *    sulla stessa fattura;
 * 2. oppure condividono una parola lunga almeno quattro lettere, che è il caso
 *    di `AIR BONAITA` contro `BONAITA BUSTO`.
 */
export function nomiCompatibili(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const x = paroleNome(a);
  const y = paroleNome(b);
  if (x.length === 0 || y.length === 0) return false;

  const cx = x.join("");
  const cy = y.join("");
  if (cx === cy) return true;

  // 1. Prefisso che finisce su un confine di parola.
  const prefissoDiParole = (corto: string, parole: string[]) => {
    if (corto.length < 3) return false;
    let acc = "";
    for (const p of parole) {
      acc += p;
      if (acc === corto) return true;
      if (acc.length > corto.length) return false;
    }
    return false;
  };
  if (prefissoDiParole(cx, y) || prefissoDiParole(cy, x)) return true;

  // 2. Una parola significativa in comune.
  const lunghe = new Set(x.filter((p) => p.length >= 4));
  return y.some((p) => p.length >= 4 && lunghe.has(p));
}

export type QualitaAbbinamento = "numero" | "assistito" | "nessuno";

export interface EsitoAbbinamento {
  rigaFattura: number;
  spedizione: SpedizioneLogica | null;
  qualita: QualitaAbbinamento;
  /** Alternative da proporre all'operatore quando l'abbinamento non è certo. */
  candidati: SpedizioneLogica[];
  motivo: string;
}

const GIORNI_FINESTRA = 12;

function distanzaGiorni(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const x = Date.parse(`${a}T00:00:00Z`);
  const y = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.abs(x - y) / 86_400_000;
}

/**
 * Abbina le righe di una fattura alle spedizioni attese.
 *
 * Due sole qualità di esito, e nessuna via di mezzo che finga certezza:
 *
 * - **`numero`** — il riferimento normalizzato coincide e la ragione sociale è
 *   compatibile. Si salva agganciato.
 * - **`assistito`** — c'è un candidato plausibile (per numero senza conferma del
 *   nome, o per controparte e data) ma non è certo. Va in coda e lo conferma una
 *   persona.
 * - **`nessuno`** — nessun candidato.
 *
 * Sui dati veri di luglio 2026 questo produce il 100% di abbinamento certo sulle
 * partenze Trading Post e circa il 90% sugli arrivi GLS fra le righe che portano
 * un riferimento in fattura.
 */
export function abbina(
  righe: RigaFattura[],
  spedizioni: SpedizioneLogica[]
): EsitoAbbinamento[] {
  const perNumero = new Map<string, SpedizioneLogica[]>();
  for (const s of spedizioni) {
    if (!s.riferimentoNorm) continue;
    const arr = perNumero.get(s.riferimentoNorm);
    if (arr) arr.push(s);
    else perNumero.set(s.riferimentoNorm, [s]);
  }

  return righe.map((r): EsitoAbbinamento => {
    const norm = r.riferimento ? normalizzaRiferimento(r.riferimento) : null;

    // Il verso è un filtro, non un indizio. Lo stesso numero esiste sia su un
    // nostro DDT di vendita sia su un carico da fornitore, e senza questo
    // controllo una riga di fattura in arrivo si aggancia a una partenza con un
    // nome somigliante — con la certezza dell'aggancio per numero, per giunta.
    const stessoVerso = (s: SpedizioneLogica) =>
      !r.direzione || s.direzione === r.direzione;

    const candidatiNumero = (norm ? (perNumero.get(norm) ?? []) : []).filter(
      stessoVerso
    );

    // 1. Numero + nome compatibile: è l'aggancio di cui ci si può fidare.
    const certi = candidatiNumero.filter((s) =>
      nomiCompatibili(r.controparte, s.controparte)
    );
    if (certi.length === 1) {
      return {
        rigaFattura: r.numero,
        spedizione: certi[0],
        qualita: "numero",
        candidati: [],
        motivo: "Numero di bolla e controparte coincidono.",
      };
    }
    if (certi.length > 1) {
      // Stesso numero e stessa controparte su date diverse: decide la data.
      const perData = [...certi].sort((a, b) => {
        const da = distanzaGiorni(r.data, a.dataDocumento) ?? 9999;
        const db = distanzaGiorni(r.data, b.dataDocumento) ?? 9999;
        return da - db;
      });
      return {
        rigaFattura: r.numero,
        spedizione: null,
        qualita: "assistito",
        candidati: perData.slice(0, 5),
        motivo: `${certi.length} bolle hanno lo stesso numero e la stessa controparte: sceglie una persona.`,
      };
    }

    // 2. Numero trovato ma nome non riconducibile: candidato, non certezza.
    if (candidatiNumero.length > 0) {
      return {
        rigaFattura: r.numero,
        spedizione: null,
        qualita: "assistito",
        candidati: candidatiNumero.slice(0, 5),
        motivo:
          "Il numero coincide ma la ragione sociale in fattura non corrisponde a quella del documento.",
      };
    }

    // 3. Nessun numero utile: si propone per controparte e vicinanza di data.
    const vicini = spedizioni
      .filter((s) => {
        if (r.direzione && s.direzione !== r.direzione) return false;
        if (!nomiCompatibili(r.controparte, s.controparte)) return false;
        const d = distanzaGiorni(r.data, s.dataDocumento);
        return d != null && d <= GIORNI_FINESTRA;
      })
      .sort(
        (a, b) =>
          (distanzaGiorni(r.data, a.dataDocumento) ?? 9999) -
          (distanzaGiorni(r.data, b.dataDocumento) ?? 9999)
      );

    if (vicini.length > 0) {
      return {
        rigaFattura: r.numero,
        spedizione: null,
        qualita: "assistito",
        candidati: vicini.slice(0, 5),
        motivo: norm
          ? "Il numero di bolla non trova riscontro: candidati per controparte e data."
          : "La fattura non riporta il numero di bolla: candidati per controparte e data.",
      };
    }

    return {
      rigaFattura: r.numero,
      spedizione: null,
      qualita: "nessuno",
      candidati: [],
      motivo: norm
        ? "Nessuna bolla con questo numero, e nessuna della stessa controparte nei giorni vicini."
        : "La fattura non riporta il numero di bolla e non risultano bolle della stessa controparte nei giorni vicini.",
    };
  });
}

/** Riepilogo per la schermata di acquisizione. */
export function riepilogoAbbinamento(esiti: EsitoAbbinamento[]) {
  const per = (q: QualitaAbbinamento) => esiti.filter((e) => e.qualita === q).length;
  return {
    totale: esiti.length,
    agganciate: per("numero"),
    daConfermare: per("assistito"),
    senzaCandidati: per("nessuno"),
  };
}
