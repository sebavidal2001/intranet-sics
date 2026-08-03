/**
 * Formattazione dei testi MAIUSCOLI che arrivano dal gestionale.
 *
 * Ragioni sociali (`ALPHAMAC srl`) e descrizioni articolo (`TRAVE + 4 GUIDE +
 * CATENA POM STD`) sono scritte tutte in maiuscolo alla fonte. A video risultano
 * pesanti, ma un `toLowerCase()` cieco distruggerebbe gli acronimi tecnici:
 * `RIDUTTORE NMRV R1:20` non deve diventare "riduttore nmrv".
 *
 * Regola, ricavata dai dati reali (9.494 righe distinta, 5.699 clienti):
 * - token con cifre o punteggiatura interna (`M8`, `45×90`, `D.18`, `R1:20`,
 *   `S.G.E.`) → invariati;
 * - token di 1-3 lettere → invariati, sono quasi sempre sigle (`FRL`, `POM`,
 *   `STD`, `IMA`, `BM`), tranne le preposizioni italiane;
 * - token di 4+ lettere **senza vocali** → invariati: sono acronimi (`NMRV`,
 *   `FMDD`, `FSDD`, `FSPC` sono gli unici presenti in archivio);
 * - tutto il resto → parola normale, quindi trasformabile.
 *
 * La trasformazione è **solo di presentazione**: il DB non viene toccato e i
 * valori inviati alle API restano quelli originali.
 */

// Preposizioni/articoli: restano minuscoli anche se corti.
const PAROLE_MINUSCOLE = new Set([
  "di", "da", "de", "del", "dei", "della", "delle", "dello", "degli",
  "a", "al", "ai", "alla", "alle", "allo", "agli",
  "e", "ed", "o", "od", "in", "nel", "nella", "con", "per", "su", "sul", "tra", "fra",
  "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "x",
]);

// Sigle di 4+ lettere con vocali, che la regola generale non riconoscerebbe.
// Elenco volutamente corto: aggiungere solo casi visti davvero in archivio.
const ACRONIMI = new Set(["UCFC", "TCEI", "ITAS", "AISI", "UNI", "ISO", "DIN"]);

// Forme societarie: sempre minuscole, sono già così nel Cruscotto.
const FORME_SOCIETARIE = new Set(["srl", "spa", "snc", "sas", "sc", "scarl", "sr", "ss"]);

/** True se il token va lasciato esattamente com'è. */
function daPreservare(token: string): boolean {
  if (ACRONIMI.has(token)) return true;
  // Si tocca SOLO ciò che è interamente maiuscolo: `soc.coop.agricola`,
  // `spa a socio unico` o `Taglio & Lavorazioni` sono scelte di chi ha scritto,
  // non rumore del gestionale.
  if (token !== token.toUpperCase()) return true;
  // Le abbreviazioni tronche (`FISS.`, `PROF.`, `ORIZ.`) sono parole: si valuta
  // il token senza il punto finale.
  const base = token.replace(/\.$/, "");
  // Cifre o punteggiatura interna: codici, misure, diametri, sigle puntate.
  if (!/^[A-ZÀ-Ý]+$/.test(base)) return true;
  // Sigle corte.
  if (base.length <= 3 && !PAROLE_MINUSCOLE.has(base.toLowerCase())) return true;
  // Acronimi senza vocali.
  if (base.length >= 4 && !/[AEIOUÀ-Ý]/.test(base)) return true;
  return false;
}

/**
 * Divide conservando i separatori, così spazi e punteggiatura tornano identici.
 * `.` e `:` restano dentro al token (servono a riconoscere codici come `D.18`,
 * `R1:20`, `S.G.E.`), mentre `-` e `/` separano: `TECNO-ONE` → `Tecno-ONE`.
 */
function mappaToken(testo: string, trasforma: (t: string) => string): string {
  return testo.replace(/[A-Za-zÀ-ÿ0-9×.:]+/g, (token) =>
    daPreservare(token) ? token : trasforma(token)
  );
}

/**
 * Ragione sociale leggibile: `ALPHAMAC srl` → `Alphamac srl`,
 * `SACMI IMOLA sc` → `Sacmi Imola sc`, `IMA spa` → `IMA spa` (sigla preservata).
 */
export function formattaNomeCliente(nome: string | null | undefined): string {
  if (!nome) return "";
  const formattato = mappaToken(nome, (token) => {
    const lower = token.toLowerCase();
    // Forme societarie e congiunzioni restano minuscole: "Allestimenti e
    // Pubblicità", non "Allestimenti E Pubblicità".
    if (FORME_SOCIETARIE.has(lower) || PAROLE_MINUSCOLE.has(lower.replace(/\.$/, ""))) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
  // Se il nome iniziava con una congiunzione, l'iniziale va comunque maiuscola.
  // Ancorata a inizio stringa: senza `^`, "IMA spa" diventerebbe "IMA Spa".
  return formattato.replace(/^[a-zà-ÿ]/, (c) => c.toUpperCase());
}

/**
 * Sigle e unità che devono restare in MAIUSCOLO nelle descrizioni articolo.
 * (I token che contengono cifre — es. `FMIE-A85`, `W=85MM`, `Ø60` — sono già
 * preservati automaticamente perché sono codici/misure.)
 */
const SIGLE_DESCRIZIONE = new Set([
  "HDPE", "PVC", "PTFE", "PP", "PE", "PA", "PU", "POM", "ABS", "EPDM", "NBR", "PET",
  "INOX", "AISI", "UNI", "ISO", "DIN", "CE", "IP", "SX", "DX", "AC", "DC", "KW", "HP",
  "RPM", "VAC", "VDC", "LED", "PLC", "USB", "NR", "MT", "PZ", "ØD", "OK",
  // Aggiunte dopo scansione dell'archivio reale (9.494 righe distinta):
  "UCFC", "TCEI", "ITAS", "NMRV", "FMDD", "FSDD", "FSPC", "FRL", "STD", "UFX", "TS", "CI",
]);

/**
 * Normalizza una descrizione da anagrafica (tutta MAIUSCOLA) in "prima lettera
 * maiuscola, resto minuscolo", preservando sigle tecniche e codici.
 *   "TESTATA FOLLE FMIE-A85"  → "Testata folle FMIE-A85"
 *   "GUIDA HDPE COLORE BIANCO" → "Guida HDPE colore bianco"
 * Se la descrizione non è tutta maiuscola viene lasciata invariata (l'utente
 * l'ha già scritta come voleva).
 */
export function capitalizzaDescrizione(testo: string): string {
  const s = (testo ?? "").trim();
  if (!s) return s;
  // Solo se è "urlata": nessuna lettera minuscola presente.
  if (/[a-zàèéìòùâêîôû]/.test(s)) return s;

  const convertito = s
    .split(/(\s+)/)
    .map((tok) => {
      if (/^\s+$/.test(tok) || tok === "") return tok;
      const nudo = tok.replace(/[^A-Za-zÀ-Ý]/g, "");
      if (/\d/.test(tok)) return tok;                      // codici e misure: invariati
      if (SIGLE_DESCRIZIONE.has(nudo.toUpperCase())) return tok;
      return tok.toLowerCase();
    })
    .join("");

  // Prima lettera utile in maiuscolo
  const idx = convertito.search(/[a-zàèéìòùâêîôû]/);
  if (idx < 0) return convertito;
  return convertito.slice(0, idx) + convertito[idx].toUpperCase() + convertito.slice(idx + 1);
}
