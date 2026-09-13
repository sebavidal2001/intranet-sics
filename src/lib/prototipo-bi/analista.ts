/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * L'ANALISTA.
 *
 * Tre principi, in ordine di importanza:
 *
 * 1. I NUMERI LI CALCOLA IL CODICE. Il modello sceglie cosa chiedere e come
 *    leggerlo, ma somme, medie, tassi e previsioni escono da funzioni
 *    deterministiche. Un modello che fa i conti a occhio produce cifre
 *    plausibili che nessuno può rifare.
 *
 * 2. SCOMPONE, NON IPOTIZZA LE CAUSE. Alla domanda «perché è sceso?» un
 *    modello produce sempre una spiegazione credibile e non verificabile.
 *    Può dire DOVE si concentra uno scostamento — è aritmetica — e deve
 *    fermarsi lì.
 *
 * 3. IL PERIMETRO È CHIUSO. Le metriche ricorrenti usano il vocabolario
 *    certificato. Le richieste SQL complesse girano come `powerbi_reader`,
 *    con sole SELECT/WITH, timeout, limite righe e viste in allowlist.
 */

import { esegui, validaSpec, vocabolario, formattaEuro } from "./semantico";
import { calcolaPrevisione, type Previsione } from "./previsione";
import { instrada, calcolaCosto, MODELLI, type Complessita, type Consumo } from "./modelli";
import { leggiConfigurazione } from "./archivio";
import { eseguiSqlBi, SCHEMA_SQL_BI, validaSqlSolaLettura } from "./sql";
import type {
  Briefing,
  RuoloBriefing,
  Segnale,
  Snapshot,
  SpecQuery,
  VoceBriefing,
} from "./tipi";

function haChiave() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

interface MessaggioChat {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface EsitoModello {
  testo: string;
  toolCalls: ToolCall[];
  ingresso: number;
  uscita: number;
}

async function chiamaModello(
  modelloId: string,
  messaggi: MessaggioChat[],
  opzioni: { strumenti?: unknown[]; temperatura?: number; maxToken?: number } = {}
): Promise<EsitoModello> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "X-Title": "SICS BI Direzionale (prototipo)",
    },
    body: JSON.stringify({
      model: modelloId,
      messages: messaggi,
      tools: opzioni.strumenti,
      temperature: opzioni.temperatura ?? 0.2,
      max_tokens: opzioni.maxToken ?? 1600,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = json.choices?.[0]?.message;
  return {
    testo: msg?.content ?? "",
    toolCalls: msg?.tool_calls ?? [],
    ingresso: json.usage?.prompt_tokens ?? 0,
    uscita: json.usage?.completion_tokens ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Briefing (stadio 3 e 4 dei rilevatori)
// ─────────────────────────────────────────────────────────────────────────────

const ISTRUZIONI_BRIEFING = `Sei l'analista di supporto alla direzione di SICS.
Ricevi segnali GIÀ RILEVATI e GIÀ CALCOLATI da rilevatori deterministici.
Il tuo compito è trasformarli in un briefing mattutino brevissimo.

REGOLE TASSATIVE
1. Non inventare numeri. Usa SOLO le cifre presenti nei segnali.
2. NON IPOTIZZARE LE CAUSE. Puoi dire dove si concentra uno scostamento
   (quale cliente, quale agente, quale mese) perché è già calcolato.
   Non puoi dire perché è successo. Mai "probabilmente", "verosimilmente
   dovuto a", "per effetto della stagionalità".
3. Una voce = 1-2 frasi. Italiano piano, da leggere in dieci secondi.
4. Se un segnale riguarda la qualità del dato, va detto per primo.
5. L'azione suggerita è una riga concreta rivolta a qualcuno, oppure null.

Rispondi SOLO con JSON valido:
{"voci":[{"segnaleId":"...","testo":"...","azioneSuggerita":"..."}]}`;

function azioneDeterministica(s: Segnale): string | null {
  switch (s.famiglia) {
    case "clienti_dormienti":
      return "Assegnare la lista agli agenti per un contatto di riattivazione.";
    case "pipeline":
      return "Rivedere i preventivi più vecchi: chiudere o archiviare.";
    case "scostamento_budget":
      return s.direzione === "negativo"
        ? "Verificare il recupero previsto nel mese in corso."
        : null;
    case "qualita_dato":
      return "Verificare la pipeline di caricamento prima di usare questi numeri.";
    case "portafoglio":
      return "Verificare la capacità di consegna sul mese di picco.";
    default:
      return null;
  }
}

export async function generaBriefing(opzioni: {
  segnali: Segnale[];
  snapshot: Snapshot;
  destinatario: string;
  ruolo: RuoloBriefing;
  massimoVoci?: number;
}): Promise<Briefing> {
  const { segnali, snapshot, destinatario, ruolo } = opzioni;
  const massimo = opzioni.massimoVoci ?? 3;

  const selezionati = segnali.slice(0, massimo);
  const scartati = Math.max(0, segnali.length - selezionati.length);

  const deterministiche = (): VoceBriefing[] =>
    selezionati.map((s, i) => ({
      ordine: i + 1,
      segnaleId: s.id,
      famiglia: s.famiglia,
      testo: s.descrizione,
      azioneSuggerita: azioneDeterministica(s),
      certificata: true,
      prove: s.prove,
    }));

  let voci: VoceBriefing[];
  let motore: Briefing["motoreAI"] = "deterministico";
  let nota: string | null = null;

  if (haChiave() && selezionati.length > 0) {
    try {
      const payload = selezionati.map((s) => ({
        segnaleId: s.id,
        famiglia: s.famiglia,
        titolo: s.titolo,
        fatti: s.descrizione,
        direzione: s.direzione,
        dettaglio: s.dettaglio ?? null,
      }));

      // Il briefing è redazione su fatti già calcolati: il modello economico
      // basta e avanza, e gira ogni mattina per ogni destinatario.
      const { testo } = await chiamaModello(
        MODELLI.leggero.id,
        [
          { role: "system", content: ISTRUZIONI_BRIEFING },
          {
            role: "user",
            content:
              `Destinatario: ${destinatario} (ruolo: ${ruolo}).\n` +
              `Dati aggiornati al ${snapshot.dataMassima}.\n\n` +
              `Segnali:\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
        { temperatura: 0.2, maxToken: 900 }
      );

      const parsed = JSON.parse(testo.replace(/^```json\s*|\s*```$/g, "").trim()) as {
        voci?: Array<{ segnaleId: string; testo: string; azioneSuggerita?: string | null }>;
      };

      const perId = new Map(selezionati.map((s) => [s.id, s]));
      voci = (parsed.voci ?? [])
        .filter((v) => perId.has(v.segnaleId))
        .map((v, i) => {
          const s = perId.get(v.segnaleId)!;
          return {
            ordine: i + 1,
            segnaleId: s.id,
            famiglia: s.famiglia,
            testo: String(v.testo).slice(0, 600),
            azioneSuggerita: v.azioneSuggerita ? String(v.azioneSuggerita).slice(0, 200) : null,
            certificata: true,
            prove: s.prove,
          };
        });

      if (voci.length === 0) throw new Error("Nessuna voce utilizzabile dal modello");
      motore = "openrouter";
    } catch (e) {
      nota = `Redazione AI non disponibile (${e instanceof Error ? e.message : "errore"}): usata la versione deterministica.`;
      voci = deterministiche();
    }
  } else {
    voci = deterministiche();
    if (!haChiave()) nota = "Chiave OPENROUTER_API_KEY assente: briefing in modalità deterministica.";
  }

  return {
    generatoIl: new Date().toISOString(),
    dataRiferimento: snapshot.dataMassima ?? "",
    runRicevutoIl: snapshot.runRicevutoIl,
    destinatario,
    ruolo,
    voci,
    segnaliValutati: segnali.length,
    segnaliScartati: scartati,
    motoreAI: motore,
    nota,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Strumenti
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gli strumenti dell'analista, filtrati sul permesso di chi ha fatto la domanda.
 *
 * `descrivi_schema_sql` ed `esegui_sql_bi` escono dalla lista quando il
 * richiedente non ha l'SQL libero. Non è una schermata nascosta: lo strumento
 * non viene proprio proposto al modello, quindi non può chiamarlo, e non deve
 * neanche sapere che esiste — un modello a cui dici "c'è ma non puoi" prova
 * comunque e spende il turno a giustificarsi.
 */
function strumentiPer(sqlLibero: boolean) {
  return sqlLibero ? STRUMENTI_TUTTI : STRUMENTI_TUTTI.filter((s) => !STRUMENTI_SQL.has(s.function.name));
}

const STRUMENTI_SQL = new Set(["descrivi_schema_sql", "esegui_sql_bi"]);

const STRUMENTI_TUTTI = [
  {
    type: "function",
    function: {
      name: "interroga_metrica",
      description:
        "Interroga il vocabolario di metriche certificate. Usalo per KPI, confronti standard " +
        "e numeri che devono restare semanticamente certificati.",
      parameters: {
        type: "object",
        properties: {
          metrica: { type: "string", description: "Chiave della metrica dal vocabolario" },
          modificatore: {
            type: "string",
            enum: ["corrente", "anno_precedente", "progressivo", "progressivo_ap"],
          },
          granularita: { type: "string", enum: ["giorno", "settimana", "mese", "anno"] },
          raggruppa: {
            type: "array",
            items: {
              type: "string",
              enum: ["bu", "agente", "cliente", "categoria", "causale", "articolo", "creatore", "esito", "fascia_eta"],
            },
          },
          filtri: {
            type: "array",
            items: {
              type: "object",
              properties: {
                campo: { type: "string" },
                op: { type: "string", enum: ["eq", "neq", "in", "contiene"] },
                valore: {},
              },
              required: ["campo", "op", "valore"],
            },
          },
          periodo: {
            type: "object",
            properties: {
              dal: { type: "string", description: "yyyy-mm-dd" },
              al: { type: "string", description: "yyyy-mm-dd" },
              anno: { type: "number" },
            },
          },
          ordina: { type: "string", enum: ["valore_desc", "valore_asc", "etichetta"] },
          limite: { type: "number" },
        },
        required: ["metrica"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "descrivi_schema_sql",
      description:
        "Restituisce viste e colonne autorizzate prima di comporre una query SQL. " +
        "Usalo se la domanda richiede join, CTE, HAVING, CASE, ranking o funzioni finestra.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "esegui_sql_bi",
      description:
        "Esegue SQL complesso di sola lettura sulle viste BI autorizzate. Accetta soltanto una " +
        "SELECT o WITH, applica timeout e limite massimo di 500 righe. Prima chiama descrivi_schema_sql.",
      parameters: {
        type: "object",
        properties: {
          sql: { type: "string", description: "Una singola query PostgreSQL SELECT/WITH, senza commenti" },
          limite: { type: "number", description: "Numero massimo di righe da restituire, 1–500" },
          scopo: { type: "string", description: "Una frase che spiega quale domanda verifica la query" },
        },
        required: ["sql", "scopo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prevedi_chiusura_anno",
      description:
        "Stima la chiusura d'anno di una metrica con tre metodi deterministici (ritmo sui giorni " +
        "lavorativi, stagionalità dell'anno precedente, tendenza dei mesi chiusi) e ne restituisce " +
        "l'intervallo. NON stimare mai a mano: usa sempre questo strumento.",
      parameters: {
        type: "object",
        properties: {
          metrica: {
            type: "string",
            description: "Metrica cumulabile: ordinato, fatturato, consegnato, banco",
          },
          anno: { type: "number" },
          filtri: {
            type: "array",
            items: {
              type: "object",
              properties: {
                campo: { type: "string" },
                op: { type: "string", enum: ["eq", "neq", "in", "contiene"] },
                valore: {},
              },
              required: ["campo", "op", "valore"],
            },
          },
        },
        required: ["metrica"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prepara_documento",
      description:
        "Prepara un documento scaricabile con i dati citati. L'utente riceve un pulsante per " +
        "scaricarlo. Usalo quando viene chiesto un report, una relazione o un file.",
      parameters: {
        type: "object",
        properties: {
          formato: { type: "string", enum: ["excel", "word"] },
          titolo: { type: "string" },
          commento: {
            type: "string",
            description: "Testo di accompagnamento per il documento Word",
          },
          blocchi: {
            type: "array",
            description: "Tabelle da includere: ogni blocco contiene una spec certificata oppure una SELECT SQL già verificata",
            items: {
              type: "object",
              properties: {
                titolo: { type: "string" },
                spec: { type: "object" },
                sql: { type: "string" },
              },
              required: ["titolo"],
            },
          },
        },
        required: ["formato", "titolo", "blocchi"],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Istruzioni: il "manuale operativo" dell'analista
// ─────────────────────────────────────────────────────────────────────────────

function istruzioni(snapshot: Snapshot, sqlLibero: boolean) {
  const strumentiSql = sqlLibero
    ? `- descrivi_schema_sql: prima di scrivere SQL; restituisce viste e colonne autorizzate.
- esegui_sql_bi: per richieste che richiedono CTE, join, CASE, HAVING, ranking,
  funzioni finestra o aggregazioni non esprimibili dal vocabolario.
`
    : `Non hai accesso a SQL libero. Se una domanda non è esprimibile con
interroga_metrica, dillo apertamente invece di approssimare: una risposta
costruita su una metrica che non risponde alla domanda è peggio di un "non
posso rispondere con i dati certificati".
`;

  return `Sei l'analista dati di SICS.

STRUMENTI
- interroga_metrica: per KPI, confronti ricorrenti e misure certificate.
${strumentiSql}- prevedi_chiusura_anno: per ogni stima di fine anno. NON calcolare proiezioni
  a mente: sbaglieresti e nessuno potrebbe rifare il conto.
- prepara_documento: quando serve un file Excel o Word.

COPERTURA DEI DATI
Dal ${snapshot.dataMinima} al ${snapshot.dataMassima}. Prima del
${snapshot.dataMinima} non esiste nulla: se ti chiedono un periodo non coperto
DILLO. Zero e "non disponibile" sono cose diverse.

METODO
1. Interroga prima di rispondere. Mai numeri a memoria.
2. Confronta sempre a parità di periodo. Il ${snapshot.dataMassima?.slice(0, 4)} è
   un anno in corso: confrontarlo con l'anno precedente INTERO mostra un calo
   che è solo il tempo che manca. Usa periodo { dal, al } su entrambi gli anni.
3. Se un risultato sorprende, scomponilo prima di commentarlo: per business
   unit, per agente, per cliente.
4. Distingui il consuntivo dalla stima. Una previsione è una previsione.

TRAPPOLE DI QUESTI DATI — sono errori già commessi, non ipotesi
- "portafoglio" e "consegnato_futuro" hanno la stessa origine: non sommarle.
- Agosto ha la chiusura aziendale (nel 2026 dal 10 al 23): i cali di agosto
  sono di calendario, non di domanda. Vale anche per dicembre.
- La business unit "(non assegnata)" è dato mancante, non una divisione.
- Il tasso di conversione è un rapporto fra totali, non la media dei tassi.
- L'anzianità dei preventivi riguarda solo le righe con inevaso residuo.

LIMITI
- NON IPOTIZZARE LE CAUSE. Puoi dire dove si concentra uno scostamento, perché
  è aritmetica. Non puoi dire perché è avvenuto: quello lo sa chi legge.
- Se il vocabolario non esprime una domanda, dillo apertamente invece di
  approssimare con una metrica vicina: usa SQL se le viste autorizzate la coprono.
- SQL è esplorativo e non "certificato": distinguilo sempre dalle metriche
  certificate. Non proporre mai INSERT, UPDATE, DELETE, DDL o chiamate a funzioni.

FORMA DELLA RISPOSTA
Markdown. Struttura consigliata:
- una frase di risposta diretta, in apertura
- i numeri a supporto, in elenco o tabella
- se serve, una riga finale su cosa guardare o cosa fare
Numeri in euro con separatore delle migliaia. Niente preamboli tipo "certo,
ecco l'analisi". Vai al punto.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ciclo conversazionale
// ─────────────────────────────────────────────────────────────────────────────

export interface PassoAnalista {
  tipo: "interrogazione" | "sql" | "previsione" | "documento" | "risposta" | "errore";
  descrizione: string;
  spec?: SpecQuery;
  sql?: string;
  colonne?: string[];
  righe?: number;
  totale?: number;
}

export interface DocumentoProposto {
  formato: "excel" | "word";
  titolo: string;
  commento?: string;
  blocchi: Array<{ titolo: string; spec?: SpecQuery; sql?: string }>;
}

export interface RispostaAnalista {
  testo: string;
  passi: PassoAnalista[];
  interrogazioni: { spec: SpecQuery; totale: number; righe: number }[];
  previsioni: Previsione[];
  documenti: DocumentoProposto[];
  motore: "openrouter" | "non_disponibile";
  modello: string;
  complessita: Complessita;
  motivoModello: string;
  consumo: Consumo | null;
}

export async function chiediAnalista(opzioni: {
  domanda: string;
  snapshot: Snapshot;
  storico?: { ruolo: "utente" | "analista"; testo: string }[];
  /** Forza un livello invece di lasciarlo dedurre dalla domanda. */
  complessita?: Complessita;
  /**
   * Se chi ha fatto la domanda può usare SQL libero. Senza, l'analista lavora
   * solo con le metriche certificate. Il default è `false`: un chiamante che
   * dimentica il campo ottiene l'analista ristretto, non quello aperto.
   */
  sqlLibero?: boolean;
}): Promise<RispostaAnalista> {
  const { domanda, snapshot } = opzioni;
  const sqlLibero = opzioni.sqlLibero === true;
  const rotta = instrada(domanda, opzioni.complessita);

  const passi: PassoAnalista[] = [];
  const interrogazioni: RispostaAnalista["interrogazioni"] = [];
  const previsioni: Previsione[] = [];
  const documenti: DocumentoProposto[] = [];
  let ingresso = 0;
  let uscita = 0;

  const vuota = (testo: string): RispostaAnalista => ({
    testo,
    passi,
    interrogazioni,
    previsioni,
    documenti,
    motore: "non_disponibile",
    modello: rotta.modello.nome,
    complessita: rotta.complessita,
    motivoModello: rotta.motivo,
    consumo: null,
  });

  if (!haChiave()) {
    return vuota(
      "L'analista conversazionale richiede la chiave OPENROUTER_API_KEY. " +
        "Il resto del prototipo (cruscotto, budget, briefing deterministico) funziona senza."
    );
  }

  const messaggi: MessaggioChat[] = [
    { role: "system", content: istruzioni(snapshot, sqlLibero) },
    { role: "system", content: `Vocabolario disponibile:\n${JSON.stringify(vocabolario(), null, 2)}` },
  ];

  for (const m of opzioni.storico ?? []) {
    messaggi.push({ role: m.ruolo === "utente" ? "user" : "assistant", content: m.testo });
  }
  messaggi.push({ role: "user", content: domanda });

  // ── Esecuzione degli strumenti ──────────────────────────────────────────
  async function eseguiStrumento(nome: string, argomenti: string): Promise<string> {
    const arg = JSON.parse(argomenti || "{}");

    if (nome === "interroga_metrica") {
      const spec = validaSpec(arg);
      const res = esegui(spec, snapshot);
      interrogazioni.push({ spec, totale: res.totale, righe: res.righe.length });
      passi.push({
        tipo: "interrogazione",
        descrizione: `${spec.metrica}${spec.raggruppa?.length ? ` per ${spec.raggruppa.join(", ")}` : ""}`,
        spec,
        righe: res.righe.length,
        totale: res.totale,
      });
      // Il troncamento va DICHIARATO, non subito.
      //
      // Il modello riceveva le prime 60 righe senza sapere che fossero le
      // prime 60: su una query che ne restituisce 300 vedeva un quinto dei
      // dati e ne parlava come se fossero tutti. Da qui affermazioni false su
      // classifiche e concentrazioni — "nessun altro cliente supera X" quando
      // il 61esimo lo superava — con numeri singolarmente corretti.
      //
      // Le righe restano 60 (il contesto costa), ma ora il modello sa cosa
      // non ha visto e quanto pesa: puo' chiedere un raggruppamento diverso o
      // dirlo, invece di generalizzare al buio.
      const MOSTRATE = 60;
      const mostrate = res.righe.slice(0, MOSTRATE);
      const troncato = res.righe.length > MOSTRATE;
      const sommaMostrate = mostrate.reduce((t, r) => t + r.valore, 0);

      return JSON.stringify({
        metrica: res.metrica,
        unita: res.unita,
        totale: res.totale,
        avvisi: res.avvisi,
        righe_totali: res.righe.length,
        righe_mostrate: mostrate.length,
        troncato,
        ...(troncato
          ? {
              attenzione:
                `Vedi solo le prime ${mostrate.length} righe di ${res.righe.length}, ` +
                `che coprono ${Math.round((sommaMostrate / (res.totale || 1)) * 100)}% del totale. ` +
                "NON trarre conclusioni su classifiche complete, minimi, o \"nessun altro\": " +
                "per quelle rifai la domanda con un limite o un raggruppamento piu' stretto.",
            }
          : {}),
        righe: mostrate,
      });
    }

    // Seconda cintura, prima di entrambi gli strumenti SQL: non sono stati
    // nemmeno offerti al modello, ma se li invoca comunque la risposta è un
    // rifiuto, non un'esecuzione.
    if (STRUMENTI_SQL.has(nome) && !sqlLibero) {
      return JSON.stringify({
        errore: "Strumento non disponibile con questo livello di accesso.",
      });
    }

    if (nome === "descrivi_schema_sql") {
      passi.push({ tipo: "sql", descrizione: "Schema SQL BI autorizzato consultato" });
      return SCHEMA_SQL_BI;
    }

    if (nome === "esegui_sql_bi") {
      const res = await eseguiSqlBi(arg.sql, arg.limite);
      passi.push({
        tipo: "sql",
        descrizione: String(arg.scopo ?? "Query SQL esplorativa").slice(0, 180),
        sql: res.sql,
        colonne: res.colonne,
        righe: res.righe.length,
      });
      return JSON.stringify({
        natura: "SQL esplorativo di sola lettura — non metrica certificata",
        colonne: res.colonne,
        righe: res.righe,
        troncato: res.troncato,
        limite: res.limite,
      });
    }

    if (nome === "prevedi_chiusura_anno") {
      const metrica = String(arg.metrica ?? "ordinato");
      const anno = Number(arg.anno) || Number((snapshot.dataMassima ?? "").slice(0, 4));
      const filtri = Array.isArray(arg.filtri) ? arg.filtri : [];
      const limite = `${anno}-${(snapshot.dataMassima ?? "").slice(5, 10)}`;

      const q = (s: Record<string, unknown>) => esegui(validaSpec(s), snapshot);
      const consuntivo = q({ metrica, filtri, periodo: { dal: `${anno}-01-01`, al: limite } });
      const precAlGiorno = q({
        metrica,
        filtri,
        modificatore: "anno_precedente",
        periodo: { dal: `${anno}-01-01`, al: limite },
      });
      const precIntero = q({ metrica, filtri, periodo: { anno: anno - 1 } });
      const serie = q({
        metrica,
        filtri,
        granularita: "mese",
        periodo: { anno },
        ordina: "etichetta",
      });

      const config = await leggiConfigurazione(anno);
      const previsione = calcolaPrevisione({
        anno,
        giornoLimite: limite,
        consuntivoAlGiorno: consuntivo.totale,
        precedenteAlGiorno: precAlGiorno.totale,
        precedenteIntero: precIntero.totale,
        serieMensile: serie.righe,
        chiusure: config?.chiusure ?? [],
        escludiWeekend: config?.escludiWeekend ?? true,
      });

      previsioni.push(previsione);
      passi.push({
        tipo: "previsione",
        descrizione: `Previsione ${metrica} ${anno}: ${formattaEuro(previsione.stimaCentrale)}`,
      });
      return JSON.stringify(previsione);
    }

    if (nome === "prepara_documento") {
      const blocchi = (Array.isArray(arg.blocchi) ? arg.blocchi : [])
        .map((b: { titolo?: string; spec?: unknown; sql?: unknown }) => {
          try {
            if (typeof b.sql === "string" && b.sql.trim()) {
              return { titolo: String(b.titolo ?? "Dati"), sql: validaSqlSolaLettura(b.sql) };
            }
            return { titolo: String(b.titolo ?? "Dati"), spec: validaSpec(b.spec) };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<{ titolo: string; spec?: SpecQuery; sql?: string }>;

      if (blocchi.length === 0) {
        return JSON.stringify({ errore: "Nessun blocco valido: serve una spec certificata o una SELECT SQL." });
      }

      const doc: DocumentoProposto = {
        formato: arg.formato === "word" ? "word" : "excel",
        titolo: String(arg.titolo ?? "Report").slice(0, 90),
        commento: arg.commento ? String(arg.commento).slice(0, 4000) : undefined,
        blocchi,
      };
      documenti.push(doc);
      passi.push({
        tipo: "documento",
        descrizione: `${doc.formato === "word" ? "Word" : "Excel"}: ${doc.titolo} (${blocchi.length} tabelle)`,
      });
      return JSON.stringify({
        ok: true,
        messaggio:
          "Documento preparato: l'utente vede un pulsante per scaricarlo sotto la tua risposta. Non ripetere il contenuto delle tabelle nel testo.",
      });
    }

    return JSON.stringify({ errore: `Strumento sconosciuto: ${nome}` });
  }

  // ── Ciclo ───────────────────────────────────────────────────────────────
  for (let passo = 0; passo < rotta.massimoPassi; passo++) {
    const esito = await chiamaModello(rotta.modello.id, messaggi, {
      strumenti: strumentiPer(sqlLibero),
      temperatura: 0.2,
      maxToken: 1800,
    });
    ingresso += esito.ingresso;
    uscita += esito.uscita;

    if (esito.toolCalls.length === 0) {
      passi.push({ tipo: "risposta", descrizione: "Risposta finale" });
      return {
        testo: esito.testo,
        passi,
        interrogazioni,
        previsioni,
        documenti,
        motore: "openrouter",
        modello: rotta.modello.nome,
        complessita: rotta.complessita,
        motivoModello: rotta.motivo,
        consumo: calcolaCosto(rotta.modello, ingresso, uscita),
      };
    }

    messaggi.push({ role: "assistant", content: esito.testo || null, tool_calls: esito.toolCalls });

    for (const tc of esito.toolCalls) {
      let risultato: string;
      try {
        risultato = await eseguiStrumento(tc.function.name, tc.function.arguments);
      } catch (e) {
        const messaggio = e instanceof Error ? e.message : String(e);
        passi.push({ tipo: "errore", descrizione: messaggio });
        risultato = JSON.stringify({ errore: messaggio });
      }
      messaggi.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: risultato,
      });
    }
  }

  return {
    testo:
      "Ho raggiunto il numero massimo di interrogazioni senza arrivare a una risposta " +
      "conclusiva. Prova a restringere la domanda a un periodo, una business unit o un agente.",
    passi,
    interrogazioni,
    previsioni,
    documenti,
    motore: "openrouter",
    modello: rotta.modello.nome,
    complessita: rotta.complessita,
    motivoModello: rotta.motivo,
    consumo: calcolaCosto(rotta.modello, ingresso, uscita),
  };
}

/** Riassunto testuale usato nei documenti esportati. */
export function riassuntoBriefing(b: Briefing): string {
  return b.voci
    .map((v) => `${v.ordine}. ${v.testo}${v.azioneSuggerita ? `\n   → ${v.azioneSuggerita}` : ""}`)
    .join("\n\n");
}

export { formattaEuro };
