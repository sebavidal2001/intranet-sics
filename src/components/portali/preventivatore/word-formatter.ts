// Parser per i Word commerciali SICS. Riconosce la struttura tipica:
//   "Spett.le X Alla c.a. Sig. Y Oggetto: Z Nr. 1 TITOLO Comprendente: ; ; ;
//    Compreso nella fornitura: ... Escluso dalla fornitura: ..."

export interface VoceWord {
  numero: string;
  titolo: string;
  comprendente: string[]; // lista dei punti dell'elenco "Comprendente:"
}

export interface DocumentoWordFormatted {
  destinatario: string | null;    // Es. "ALPHAMAC"
  attenzione: string[];           // Es. ["Sig. Malavasi", ...]
  oggetto: string | null;         // Es. "Offerta nr. 1055 del 16/10/24"
  voci: VoceWord[];
  compreso: string[];
  escluso: string[];
  testo_residuo: string | null;   // Eventuali parti non parsate (per non perdere info)
}

// Regex che riconosce l'inizio di una voce numerata in qualsiasi formato:
// "Nr. 1 SCALA", "N°1 NASTRO", "N. 1 PEDANA", "N°1NASTRO" (senza spazio).
// Richiede maiuscola dopo (per evitare match su "nr. 1295 del 10/12").
const VOCE_START = /\b(?:N\s*°|Nr\.?|N\.)\s*(\d{1,3})\s*([A-ZÀ-Ý][^]*)/;

// Variante "look-ahead" per uso in split/oggetto-end (matcha solo "header"
// dell'inizio voce, restituisce match position).
const VOCE_HEAD_LOOKAHEAD = /\b(?:N\s*°|Nr\.?|N\.)\s*\d{1,3}\s*[A-ZÀ-Ý]/g;

// Titoli onorifici da usare come separatore della lista destinatari.
// Inclusi: Sig., Sig.ra, Sig.na, Ing., Dott., Dott.ssa, Geom., Avv., Arch., Rag., P.I.
const TITOLO_PERSONA = /\b(?:Sig\.?(?:r[ae])?|Sig\.?na|Ing\.?|Dott\.?(?:ssa)?|Geom\.?|Avv\.?|Arch\.?|Rag\.?|P\.?I\.?)\s+/gi;

function splitPunti(s: string): string[] {
  // Split su ";" o "—" o (in fallback) frase puntata. Toglie vuoti.
  return s
    .split(/[;]+/)
    .map((p) => p.trim().replace(/[\.\s]+$/, ""))
    .filter((p) => p.length > 1);
}

function splitDestinatari(block: string): string[] {
  // Trova tutte le posizioni dei titoli onorifici; ogni titolo apre una persona.
  const matches: Array<{ index: number; titolo: string }> = [];
  let m: RegExpExecArray | null;
  TITOLO_PERSONA.lastIndex = 0;
  while ((m = TITOLO_PERSONA.exec(block)) !== null) {
    matches.push({ index: m.index, titolo: m[0].trim() });
  }
  if (matches.length === 0) return [block.trim()].filter(Boolean);

  const persone: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : block.length;
    const slice = block.slice(start, end).trim().replace(/[,;\.\s]+$/, "");
    if (slice.length > 1) persone.push(slice);
  }
  return persone;
}

export function parseWordCommerciale(rawText: string): DocumentoWordFormatted {
  // 1) Normalizza spazi
  const text = rawText.replace(/\s+/g, " ").trim();

  const out: DocumentoWordFormatted = {
    destinatario: null,
    attenzione: [],
    oggetto: null,
    voci: [],
    compreso: [],
    escluso: [],
    testo_residuo: null,
  };

  // 2) Spett.le destinatario (terminale su Alla c.a., Oggetto: o inizio voce numerata)
  const spettM = text.match(
    /Spett\.?\s*le\s+(.+?)\s+(?:Alla\s+c\.?a\.?|Oggetto:|(?:N\s*°|Nr\.?|N\.)\s*\d+\s*[A-Z])/i
  );
  if (spettM) out.destinatario = spettM[1].trim();

  // 3) Alla c.a. → lista persone (split su qualsiasi titolo onorifico)
  const caM = text.match(
    /Alla\s+c\.?a\.?\s+(.+?)\s+(?:Oggetto:|(?:N\s*°|Nr\.?|N\.)\s*\d+\s*[A-Z])/i
  );
  if (caM) {
    out.attenzione = splitDestinatari(caM[1]);
  }

  // 4) Oggetto: tutto fino al primo marker di voce numerata o sezione "Compreso/Escluso"
  // Importante: il match terminale richiede UPPERCASE dopo il numero per evitare
  // di troncare su "Offerta nr. 1295" o "rif. 12/3/24" (lowercase).
  const oggM = text.match(
    /Oggetto:\s+(.+?)\s+(?:(?:N\s*°|Nr\.?|N\.)\s*\d+\s*[A-Z]|Compreso\s+nella|Escluso\s+dalla|$)/i
  );
  if (oggM) out.oggetto = oggM[1].trim();

  // 5) Voci numerate: cerchiamo tutti gli inizi "(N°|Nr.|N.) <num> <UPPERCASE>"
  //    e prendiamo il testo fino al prossimo inizio o sezione Compreso/Escluso.
  const headers: Array<{ start: number; numero: string }> = [];
  let h: RegExpExecArray | null;
  VOCE_HEAD_LOOKAHEAD.lastIndex = 0;
  while ((h = VOCE_HEAD_LOOKAHEAD.exec(text)) !== null) {
    // Estrai il numero dal match
    const numM = h[0].match(/\d{1,3}/);
    headers.push({ start: h.index, numero: numM ? numM[0] : "" });
  }

  // Posizione di inizio sezioni di chiusura (per troncare l'ultima voce)
  const compresoIdx = text.search(/Compreso\s+nella\s+fornitura/i);
  const esclusoIdx = text.search(/Escluso\s+dalla\s+fornitura/i);
  const endIdx = [compresoIdx, esclusoIdx]
    .filter((i) => i >= 0)
    .reduce((a, b) => Math.min(a, b), text.length);

  for (let i = 0; i < headers.length; i += 1) {
    const startRaw = headers[i].start;
    const numero = headers[i].numero;
    // Skippa il "header" stesso (N°1 / Nr. 1)
    const afterHeader = text.slice(startRaw).match(VOCE_START);
    if (!afterHeader) continue;
    const headerLen = afterHeader[0].length - afterHeader[2].length;
    const start = startRaw + headerLen;
    const endNext = i + 1 < headers.length ? headers[i + 1].start : endIdx;
    const body = text.slice(start, endNext).trim().replace(/[\.\s]+$/, "");

    // Separa titolo da Comprendente:
    const compIdx = body.search(/\bComprendente:/i);
    let titolo: string;
    let comprendente: string[] = [];
    if (compIdx >= 0) {
      titolo = body.slice(0, compIdx).trim().replace(/[\.,]+$/, "");
      const compBody = body.slice(compIdx).replace(/^Comprendente:\s*/i, "").trim();
      comprendente = splitPunti(compBody);
    } else {
      titolo = body.trim();
    }
    out.voci.push({ numero, titolo, comprendente });
  }

  // 6) Compreso/Escluso nella fornitura
  const compresoM = text.match(/Compreso\s+nella\s+fornitura:?\s+(.+?)(?=Escluso\s+dalla\s+fornitura|$)/i);
  if (compresoM) out.compreso = splitPunti(compresoM[1]);

  const esclusoM = text.match(/Escluso\s+dalla\s+fornitura:?\s+(.+)$/i);
  if (esclusoM) out.escluso = splitPunti(esclusoM[1]);

  // 7) Testo residuo: tutto quello che non è stato matchato
  // (semplice euristica: se nessuna struttura riconosciuta, tieni il testo originale)
  if (
    !out.destinatario &&
    !out.oggetto &&
    out.voci.length === 0 &&
    out.compreso.length === 0 &&
    out.escluso.length === 0
  ) {
    out.testo_residuo = rawText;
  }

  return out;
}
