/**
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

import {
  esegui,
  validaSpec,
  vocabolario,
  formattaEuro,
  DIMENSIONI,
  SpecNonValida,
  elencaValoriDimensione,
} from "./semantico";
import { calcolaPrevisione, type Previsione } from "./previsione";
import { instrada, calcolaCosto, MODELLI, type Complessita, type Consumo } from "./modelli";
import { leggiConfigurazione } from "./archivio";
import { chiusureEffettive } from "./chiusure-dedotte";
import { eseguiSqlBi, ErroreSqlBi, SCHEMA_SQL_BI, validaSqlSolaLettura } from "./sql";
import { graficiPossibili, scegliGrafico, type TipoGrafico } from "./scelta-grafico";
import { validaSerieAnalisi } from "./analisi-composita";
import { calcolaPunteggi, costruisciContesto, rilevaTutto } from "./rilevatori";
import {
  verificaNumeri,
  type EsitoVerifica,
  type ValoreNoto,
} from "./verifica-numeri";
import type {
  Briefing,
  ConfigurazioneAnno,
  Dimensione,
  FamigliaRilevatore,
  Periodo,
  RuoloBriefing,
  SerieAnalisi,
  SerieAnalisiEseguita,
  Segnale,
  Snapshot,
  SpecQuery,
  RisultatoQuery,
  VoceBriefing,
  UnitaMisura,
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
const NOMI_STRUMENTI_ANALISI = new Set<NomeStrumentoAnalisi>([
  "rileva_anomalie",
  "confronta_periodi",
  "scomponi_variazione",
  "classifica",
]);

const STRUMENTI_TUTTI = [
  {
    type: "function",
    function: {
      name: "rileva_anomalie",
      description:
        "Trova anomalie, rotture di serie, concentrazioni e altri segnali già calcolati " +
        "dai rilevatori deterministici. È il primo strumento per andamenti strani o cali.",
      parameters: {
        type: "object",
        properties: {
          famiglie: { type: "array", items: { type: "string" } },
          periodo: {
            type: "object",
            properties: { dal: { type: "string" }, al: { type: "string" }, anno: { type: "number" } },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confronta_periodi",
      description:
        "Confronta la stessa metrica fra due periodi e mette in cima i gruppi con la maggiore variazione assoluta.",
      parameters: {
        type: "object",
        properties: {
          metrica: { type: "string" },
          periodoA: { type: "object" },
          periodoB: { type: "object" },
          raggruppa: { type: "string" },
        },
        required: ["metrica", "periodoA", "periodoB"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scomponi_variazione",
      description:
        "Scompone la variazione fra due periodi nei contributi per dimensione. Dice DOVE nasce " +
        "la differenza, non PERCHÉ: non aggiungere cause speculative.",
      parameters: {
        type: "object",
        properties: {
          metrica: { type: "string" },
          da: { type: "object" },
          a: { type: "object" },
          dimensione: { type: "string" },
        },
        required: ["metrica", "da", "a", "dimensione"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "classifica",
      description:
        "Calcola top o bottom N per una dimensione, con quota sul totale e quota cumulata Pareto.",
      parameters: {
        type: "object",
        properties: {
          metrica: { type: "string" },
          dimensione: { type: "string" },
          verso: { type: "string", enum: ["alto", "basso"] },
          quanti: { type: "number", minimum: 1, maximum: 50 },
          periodo: { type: "object" },
        },
        required: ["metrica", "dimensione", "verso"],
      },
    },
  },
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
      name: "elenca_valori",
      description:
        "Elenca i valori realmente presenti in una dimensione (clienti, agenti, business unit, " +
        "categorie, articoli, addetti), con quanto pesano. Usalo PRIMA di filtrare su un nome: " +
        "la grafia del gestionale non e' quella del parlato, e un filtro che sbaglia una lettera " +
        "torna vuoto senza dire perche'.",
      parameters: {
        type: "object",
        properties: {
          dimensione: {
            type: "string",
            enum: ["bu", "agente", "cliente", "categoria", "causale", "articolo", "creatore", "esito", "fascia_eta"],
          },
          contiene: {
            type: "string",
            description: "Filtra i valori che contengono questo testo (senza distinzione di maiuscole)",
          },
          massimo: { type: "number", description: "Quanti valori restituire, predefinito 40" },
        },
        required: ["dimensione"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "proponi_analisi",
      description:
        "Crea un'analisi visuale certificata, già eseguita, con il grafico più adatto. " +
        "Usalo per confronti, andamenti nel tempo, classifiche e composizioni.",
      parameters: {
        type: "object",
        properties: {
          titolo: {
            type: "string",
            description: "Titolo breve dell'analisi, per esempio Ordinato per business unit, 2026",
          },
          spec: { type: "object", description: "SpecQuery certificata da eseguire" },
          serie: {
            type: "array",
            description:
              "Serie della stessa analisi. Usale per confronti, obiettivi e soglie invece di creare grafici separati.",
            items: {
              type: "object",
              properties: {
                ruolo: {
                  type: "string",
                  enum: ["principale", "confronto", "obiettivo", "soglia"],
                },
                nome: { type: "string", description: "Etichetta breve mostrata in legenda" },
                spec: { type: "object", description: "SpecQuery certificata della serie" },
              },
              required: ["ruolo", "nome", "spec"],
            },
          },
          grafico: {
            type: "string",
            enum: [
              "linee",
              "barre",
              "combo",
              "torta",
              "anelli",
              "areeImpilate",
              "pareto",
              "bullet",
              "heatmap",
              "quadranti",
              "imbuto",
              "treemap",
              "sparkline",
              "kpi",
              "tabella",
            ],
          },
          commento: {
            type: "string",
            description: "Una riga che spiega cosa mostra l'analisi",
          },
        },
        required: ["titolo", "spec"],
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

La prima riga di ogni risposta finale deve avere esattamente questo formato:
INTERPRETAZIONE: <una riga: metrica, periodo, taglio>
Non anteporre titoli, saluti o altro testo a questa riga.

STRUMENTI
- rileva_anomalie: usalo per primo davanti ad anomalie, andamenti strani o cali.
- confronta_periodi: per affiancare due periodi e vedere chi si è mosso di più.
- scomponi_variazione: per localizzare DOVE nasce una variazione, senza inventarne le cause.
- classifica: per top, bottom e analisi Pareto con quote cumulative.
- proponi_analisi: usalo ogni volta che la risposta si capisce meglio con un
  grafico: confronti, andamenti nel tempo, classifiche e composizioni.
  Per domande come "rispetto all'anno scorso", "contro budget" o "chi è sotto
  obiettivo" proponi UNA sola analisi con più serie e ruoli, mai analisi separate
  che costringano chi legge a confrontare grafici diversi a mente.
- interroga_metrica: usalo quando serve solo un numero dentro una frase.
- elenca_valori: PRIMA di filtrare su un nome proprio (cliente, agente, articolo,
  addetto). La grafia del gestionale non è quella del parlato — ragioni sociali
  abbreviate, maiuscole incoerenti, doppi spazi — e un filtro che sbaglia una
  lettera torna vuoto senza dire perché, il che somiglia moltissimo a "quel
  cliente non ha comprato". Cerca il nome con il parametro "contiene", poi
  filtra con la grafia esatta che ti è stata restituita.
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

QUANDO UNO STRUMENTO TI RIFIUTA
La risposta di errore può contenere un campo "suggerimento": leggilo e correggi
di conseguenza al passo successivo, invece di riprovare la stessa cosa o di
ripiegare su una metrica diversa da quella che serviva. Se il suggerimento non
basta, dichiara cosa non sei riuscito a ottenere.

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

export interface AnalisiProposta {
  titolo: string;
  spec: SpecQuery;
  serie?: SerieAnalisi[];
  grafico: TipoGrafico;
  motivoGrafico: string;
  commento?: string;
  risultato: RisultatoQuery;
  risultatiSerie?: SerieAnalisiEseguita[];
}

export interface RispostaAnalista {
  testo: string;
  interpretazione: string | null;
  verifica: EsitoVerifica | null;
  correzioneApplicata: boolean;
  passi: PassoAnalista[];
  interrogazioni: { spec: SpecQuery; totale: number; righe: number }[];
  analisi: AnalisiProposta[];
  previsioni: Previsione[];
  documenti: DocumentoProposto[];
  motore: "openrouter" | "non_disponibile";
  modello: string;
  complessita: Complessita;
  motivoModello: string;
  consumo: Consumo | null;
}

interface DestinazioneAnalisi {
  analisi: AnalisiProposta[];
  valoriNoti: ValoreNoto[];
  interrogazioni?: RispostaAnalista["interrogazioni"];
  passi?: PassoAnalista[];
}

function aggiungiValoriRisultato(
  spec: SpecQuery,
  risultato: RisultatoQuery,
  valoriNoti: ValoreNoto[]
) {
  valoriNoti.push({
    valore: risultato.totale,
    fonte: `totale di ${spec.metrica}`,
    unita: risultato.unita,
  });
  for (const riga of risultato.righe) {
    valoriNoti.push({
      valore: riga.valore,
      fonte: `${spec.metrica} per ${riga.etichetta}`,
      unita: risultato.unita,
    });
  }
}

export type NomeStrumentoAnalisi =
  | "rileva_anomalie"
  | "confronta_periodi"
  | "scomponi_variazione"
  | "classifica";

interface DestinazioneStrumentoAnalisi {
  valoriNoti?: ValoreNoto[];
  interrogazioni?: RispostaAnalista["interrogazioni"];
  passi?: PassoAnalista[];
  configurazione?: ConfigurazioneAnno | null;
}

const FAMIGLIE_RILEVATORI: FamigliaRilevatore[] = [
  "scostamento_budget",
  "rottura_serie",
  "clienti_dormienti",
  "concentrazione",
  "pipeline",
  "portafoglio",
  "qualita_dato",
];

function argomentiOggetto(argomento: unknown): Record<string, unknown> {
  const valore: unknown = typeof argomento === "string" ? JSON.parse(argomento || "{}") : argomento;
  if (!valore || typeof valore !== "object" || Array.isArray(valore)) {
    throw new Error("Gli argomenti devono essere un oggetto JSON.");
  }
  return valore as Record<string, unknown>;
}

function validaPeriodoAnalisi(valore: unknown, nome: string, obbligatorio = true): Periodo | undefined {
  if (valore === undefined && !obbligatorio) return undefined;
  if (!valore || typeof valore !== "object" || Array.isArray(valore)) {
    throw new Error(`${nome} deve essere un periodo con dal/al oppure anno.`);
  }
  const grezzo = valore as Record<string, unknown>;
  const dal = grezzo.dal === undefined ? undefined : String(grezzo.dal);
  const al = grezzo.al === undefined ? undefined : String(grezzo.al);
  const anno = grezzo.anno === undefined ? undefined : Number(grezzo.anno);
  const dataValida = (data: string) => /^\d{4}-\d{2}-\d{2}$/u.test(data);
  if ((dal && !dataValida(dal)) || (al && !dataValida(al))) {
    throw new Error(`${nome} contiene una data non valida: usare yyyy-mm-dd.`);
  }
  if (anno !== undefined && (!Number.isInteger(anno) || anno < 1900 || anno > 2200)) {
    throw new Error(`${nome} contiene un anno non valido.`);
  }
  if (!dal && !al && anno === undefined) throw new Error(`${nome} è vuoto.`);
  if (dal && al && dal > al) throw new Error(`${nome}: la data iniziale supera quella finale.`);
  return { dal, al, anno };
}

function specRaggruppata(
  arg: Record<string, unknown>,
  periodo: Periodo,
  campoDimensione: "raggruppa" | "dimensione"
): SpecQuery {
  const dimensione = String(arg[campoDimensione] ?? "") as Dimensione;
  return validaSpec({ metrica: arg.metrica, raggruppa: [dimensione], periodo });
}

function registraRisultato(
  spec: SpecQuery,
  risultato: RisultatoQuery,
  destinazione?: DestinazioneStrumentoAnalisi
) {
  if (destinazione?.valoriNoti) aggiungiValoriRisultato(spec, risultato, destinazione.valoriNoti);
  destinazione?.interrogazioni?.push({ spec, totale: risultato.totale, righe: risultato.righe.length });
}

function aggiungiValore(
  destinazione: DestinazioneStrumentoAnalisi | undefined,
  valore: number | null,
  fonte: string,
  unita: UnitaMisura
) {
  if (valore !== null && Number.isFinite(valore)) {
    destinazione?.valoriNoti?.push({ valore, fonte, unita });
  }
}

function snapshotNelPeriodo(snapshot: Snapshot, periodo?: Periodo): Snapshot {
  if (!periodo) return snapshot;
  const dentro = (data: string) => {
    if (periodo.anno !== undefined && Number(data.slice(0, 4)) !== periodo.anno) return false;
    if (periodo.dal && data < periodo.dal) return false;
    if (periodo.al && data > periodo.al) return false;
    return true;
  };
  const dataset = { ...snapshot.dataset };
  for (const chiave of Object.keys(dataset) as Array<keyof Snapshot["dataset"]>) {
    dataset[chiave] = snapshot.dataset[chiave].filter((riga) => dentro(riga.data));
  }
  const date = Object.values(dataset).flat().map((riga) => riga.data).filter(Boolean).sort();
  return {
    ...snapshot,
    dataset,
    dataMinima: date[0] ?? null,
    dataMassima: date.at(-1) ?? periodo.al ?? (periodo.anno ? `${periodo.anno}-12-31` : null),
  };
}

/**
 * Espone i calcoli analitici senza modello né database: gli stessi risultati
 * usati in chat possono così essere verificati con snapshot costruiti a mano.
 */
export function eseguiStrumentoAnalisi(
  nome: NomeStrumentoAnalisi,
  argomento: unknown,
  snapshot: Snapshot,
  destinazione?: DestinazioneStrumentoAnalisi
): string {
  try {
    const arg = argomentiOggetto(argomento);

    if (nome === "rileva_anomalie") {
      const periodo = validaPeriodoAnalisi(arg.periodo, "periodo", false);
      const famiglieGrezze = arg.famiglie === undefined ? FAMIGLIE_RILEVATORI : arg.famiglie;
      if (!Array.isArray(famiglieGrezze)) throw new Error("famiglie deve essere un elenco.");
      const famiglie = famiglieGrezze.map(String) as FamigliaRilevatore[];
      const nonValide = famiglie.filter((famiglia) => !FAMIGLIE_RILEVATORI.includes(famiglia));
      if (nonValide.length) throw new Error(`Famiglie non valide: ${nonValide.join(", ")}.`);
      const contesto = costruisciContesto(
        snapshotNelPeriodo(snapshot, periodo),
        destinazione?.configurazione ?? null
      );
      const segnali = calcolaPunteggi(rilevaTutto(contesto))
        .filter((segnale) => famiglie.includes(segnale.famiglia))
        .map((segnale) => ({
          famiglia: segnale.famiglia,
          titolo: segnale.titolo,
          descrizione: segnale.descrizione,
          magnitudineEuro: segnale.magnitudineEuro,
          direzione: segnale.direzione,
          punteggio: segnale.punteggio,
        }));
      for (const segnale of segnali) {
        aggiungiValore(destinazione, segnale.magnitudineEuro, segnale.titolo, "euro");
        aggiungiValore(destinazione, segnale.punteggio, `punteggio ${segnale.titolo}`, "numero");
      }
      destinazione?.passi?.push({
        tipo: "interrogazione",
        descrizione: `Rilevate ${segnali.length} anomalie e segnali deterministici`,
        righe: segnali.length,
      });
      return JSON.stringify({ segnali });
    }

    if (nome === "confronta_periodi") {
      const periodoA = validaPeriodoAnalisi(arg.periodoA, "periodoA")!;
      const periodoB = validaPeriodoAnalisi(arg.periodoB, "periodoB")!;
      const dimensione = arg.raggruppa === undefined ? undefined : String(arg.raggruppa);
      const base = { metrica: arg.metrica, raggruppa: dimensione ? [dimensione] : [] };
      const specA = validaSpec({ ...base, periodo: periodoA });
      const specB = validaSpec({ ...base, periodo: periodoB });
      const risultatoA = esegui(specA, snapshot);
      const risultatoB = esegui(specB, snapshot);
      registraRisultato(specA, risultatoA, destinazione);
      registraRisultato(specB, risultatoB, destinazione);
      const valoriA = new Map(risultatoA.righe.map((riga) => [riga.etichetta, riga.valore]));
      const valoriB = new Map(risultatoB.righe.map((riga) => [riga.etichetta, riga.valore]));
      const etichette = new Set([...valoriA.keys(), ...valoriB.keys()]);
      const righe = [...etichette].map((etichetta) => {
        const valoreA = valoriA.get(etichetta) ?? 0;
        const valoreB = valoriB.get(etichetta) ?? 0;
        const delta = valoreB - valoreA;
        const deltaPct = valoreA === 0 ? null : (delta / Math.abs(valoreA)) * 100;
        aggiungiValore(destinazione, delta, `variazione ${etichetta}`, risultatoA.unita);
        aggiungiValore(destinazione, deltaPct, `variazione percentuale ${etichetta}`, "percentuale");
        return { etichetta, valoreA, valoreB, delta, deltaPct };
      }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      destinazione?.passi?.push({
        tipo: "interrogazione",
        descrizione: `Confronto ${String(arg.metrica)} fra due periodi${dimensione ? ` per ${dimensione}` : ""}`,
        righe: righe.length,
      });
      return JSON.stringify({ metrica: risultatoA.metrica, unita: risultatoA.unita, righe });
    }

    if (nome === "scomponi_variazione") {
      const da = validaPeriodoAnalisi(arg.da, "da")!;
      const a = validaPeriodoAnalisi(arg.a, "a")!;
      const specDa = specRaggruppata(arg, da, "dimensione");
      const specA = specRaggruppata(arg, a, "dimensione");
      const risultatoDa = esegui(specDa, snapshot);
      const risultatoA = esegui(specA, snapshot);
      registraRisultato(specDa, risultatoDa, destinazione);
      registraRisultato(specA, risultatoA, destinazione);
      const valoriDa = new Map(risultatoDa.righe.map((riga) => [riga.etichetta, riga.valore]));
      const valoriA = new Map(risultatoA.righe.map((riga) => [riga.etichetta, riga.valore]));
      const etichette = new Set([...valoriDa.keys(), ...valoriA.keys()]);
      const contributi = [...etichette].map((etichetta) => ({
        etichetta,
        valoreDa: valoriDa.get(etichetta) ?? 0,
        valoreA: valoriA.get(etichetta) ?? 0,
        contributo: (valoriA.get(etichetta) ?? 0) - (valoriDa.get(etichetta) ?? 0),
      })).sort((x, y) => Math.abs(y.contributo) - Math.abs(x.contributo));
      const variazioneTotale = risultatoA.totale - risultatoDa.totale;
      const sommaContributi = contributi.reduce((somma, voce) => somma + voce.contributo, 0);
      for (const voce of contributi) {
        aggiungiValore(destinazione, voce.contributo, `contributo ${voce.etichetta}`, risultatoA.unita);
      }
      aggiungiValore(destinazione, variazioneTotale, "variazione totale", risultatoA.unita);
      destinazione?.passi?.push({
        tipo: "interrogazione",
        descrizione: `Scomposta la variazione di ${String(arg.metrica)} per ${String(arg.dimensione)}`,
        righe: contributi.length,
        totale: variazioneTotale,
      });
      return JSON.stringify({
        metrica: risultatoA.metrica,
        unita: risultatoA.unita,
        variazioneTotale,
        sommaContributi,
        verifica: sommaContributi === variazioneTotale,
        contributi,
      });
    }

    const periodo = validaPeriodoAnalisi(arg.periodo, "periodo", false);
    if (arg.verso !== "alto" && arg.verso !== "basso") throw new Error('verso deve essere "alto" o "basso".');
    const quanti = arg.quanti === undefined ? 10 : Number(arg.quanti);
    if (!Number.isInteger(quanti) || quanti < 1 || quanti > 50) throw new Error("quanti deve essere fra 1 e 50.");
    const spec = specRaggruppata(arg, periodo ?? {}, "dimensione");
    const risultato = esegui(spec, snapshot);
    registraRisultato(spec, risultato, destinazione);
    const ordinate = [...risultato.righe].sort((a, b) =>
      arg.verso === "alto" ? b.valore - a.valore : a.valore - b.valore
    );
    let cumulato = 0;
    const selezionate = ordinate.slice(0, quanti);
    const righe = selezionate.map((riga, indice) => {
      const quota = risultato.totale === 0 ? 0 : (riga.valore / risultato.totale) * 100;
      cumulato += quota;
      const quotaCumulata = selezionate.length === ordinate.length && indice === selezionate.length - 1 ? 100 : cumulato;
      aggiungiValore(destinazione, quota, `quota ${riga.etichetta}`, "percentuale");
      aggiungiValore(destinazione, quotaCumulata, `quota cumulata ${riga.etichetta}`, "percentuale");
      return { etichetta: riga.etichetta, valore: riga.valore, quota, quotaCumulata };
    });
    destinazione?.passi?.push({
      tipo: "interrogazione",
      descrizione: `${arg.verso === "alto" ? "Top" : "Bottom"} ${quanti} ${String(arg.metrica)} per ${String(arg.dimensione)}`,
      righe: righe.length,
      totale: risultato.totale,
    });
    return JSON.stringify({ metrica: risultato.metrica, unita: risultato.unita, totale: risultato.totale, righe });
  } catch (errore) {
    const messaggio = errore instanceof Error ? errore.message : String(errore);
    destinazione?.passi?.push({ tipo: "errore", descrizione: messaggio });
    return JSON.stringify({ errore: messaggio });
  }
}

/**
 * Isola il solo strumento visuale per poter verificare validazione e numeri
 * senza coinvolgere il modello: una risposta tool fallita deve consumare un
 * passo, non interrompere l'intera conversazione.
 */
export function eseguiPropostaAnalisi(
  argomento: unknown,
  snapshot: Snapshot,
  destinazione: DestinazioneAnalisi
): string {
  try {
    if (!argomento || typeof argomento !== "object" || Array.isArray(argomento)) {
      throw new Error("Argomenti di proponi_analisi non validi.");
    }
    const arg = argomento as Record<string, unknown>;
    const titolo = typeof arg.titolo === "string" ? arg.titolo.trim() : "";
    if (!titolo) throw new Error("Titolo dell'analisi obbligatorio.");

    const serie = arg.serie === undefined ? null : validaSerieAnalisi(arg.serie);
    const spec = serie?.find((voce) => voce.ruolo === "principale")?.spec ?? validaSpec(arg.spec);
    const risultatiSerie = (serie ?? [{ ruolo: "principale" as const, nome: spec.metrica, spec }])
      .map((voce): SerieAnalisiEseguita => ({
        ...voce,
        risultato: esegui(voce.spec, snapshot),
      }));
    const risultato = risultatiSerie.find((voce) => voce.ruolo === "principale")!.risultato;
    const risultatoGrafico = serie ? risultatiSerie : risultato;
    const proposta = scegliGrafico(risultatoGrafico);
    let grafico = proposta.tipo;
    let motivoGrafico = proposta.motivo;

    if (arg.grafico !== undefined) {
      const richiesto = String(arg.grafico) as TipoGrafico;
      if (!graficiPossibili(risultatoGrafico).includes(richiesto)) {
        throw new Error(`Il grafico ${richiesto} non è applicabile a questo risultato.`);
      }
      grafico = richiesto;
      if (grafico !== proposta.tipo) {
        motivoGrafico = "Grafico scelto dall'analista fra quelli applicabili a questo risultato.";
      }
    }

    const commento = typeof arg.commento === "string" ? arg.commento.trim() : "";
    const analisi: AnalisiProposta = {
      titolo,
      spec,
      ...(serie ? { serie } : {}),
      grafico,
      motivoGrafico,
      ...(commento ? { commento } : {}),
      risultato,
      ...(serie ? { risultatiSerie } : {}),
    };
    destinazione.analisi.push(analisi);
    for (const voce of risultatiSerie) {
      aggiungiValoriRisultato(voce.spec, voce.risultato, destinazione.valoriNoti);
      destinazione.interrogazioni?.push({
        spec: voce.spec,
        totale: voce.risultato.totale,
        righe: voce.risultato.righe.length,
      });
      destinazione.passi?.push({
        tipo: "interrogazione",
        descrizione: serie ? `${titolo} — ${voce.nome}` : titolo,
        spec: voce.spec,
        righe: voce.risultato.righe.length,
        totale: voce.risultato.totale,
      });
    }

    return JSON.stringify({
      titolo,
      grafico,
      totale: risultato.totale,
      righe: risultato.righe.length,
      serie: risultatiSerie.length,
      istruzione: "Non ripetere i numeri nel testo: il grafico li mostra già.",
    });
  } catch (errore) {
    const messaggio = errore instanceof Error ? errore.message : String(errore);
    destinazione.passi?.push({ tipo: "errore", descrizione: messaggio });
    return JSON.stringify({ errore: messaggio });
  }
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
  const valoriNoti: ValoreNoto[] = [];
  const analisi: AnalisiProposta[] = [];
  const previsioni: Previsione[] = [];
  const documenti: DocumentoProposto[] = [];
  let ingresso = 0;
  let uscita = 0;

  const vuota = (testo: string): RispostaAnalista => ({
    testo,
    interpretazione: null,
    verifica: null,
    correzioneApplicata: false,
    passi,
    interrogazioni,
    analisi,
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
    if (NOMI_STRUMENTI_ANALISI.has(nome as NomeStrumentoAnalisi)) {
      let configurazione: ConfigurazioneAnno | null = null;
      if (nome === "rileva_anomalie") {
        const anno = Number((snapshot.dataMassima ?? "").slice(0, 4));
        if (Number.isInteger(anno)) {
          try {
            configurazione = await leggiConfigurazione(anno);
          } catch {
            // Budget e chiusure affinano alcuni segnali, ma la loro assenza non
            // deve togliere all'analista i rilevatori basati sullo snapshot.
            configurazione = null;
          }
        }
      }
      return eseguiStrumentoAnalisi(nome as NomeStrumentoAnalisi, argomenti, snapshot, {
        valoriNoti,
        interrogazioni,
        passi,
        configurazione,
      });
    }
    const arg = JSON.parse(argomenti || "{}");

    if (nome === "proponi_analisi") {
      return eseguiPropostaAnalisi(arg, snapshot, {
        analisi,
        valoriNoti,
        interrogazioni,
        passi,
      });
    }

    if (nome === "elenca_valori") {
      const a = arg as { dimensione?: string; contiene?: string; massimo?: number };
      const chiave = String(a.dimensione ?? "") as Dimensione;
      const estrattore = DIMENSIONI[chiave];
      if (!estrattore) {
        return JSON.stringify({
          errore: `Dimensione "${a.dimensione}" non esiste.`,
          suggerimento: `Disponibili: ${Object.keys(DIMENSIONI).join(", ")}.`,
        });
      }

      const esito = elencaValoriDimensione(snapshot, chiave, {
        contiene: a.contiene,
        massimo: a.massimo,
      });

      passi.push({
        tipo: "interrogazione",
        descrizione:
          `valori di ${estrattore.etichetta}` +
          `${a.contiene ? ` che contengono "${a.contiene}"` : ""}: ${esito.distinti}`,
        righe: esito.distinti,
      });

      return JSON.stringify({
        dimensione: chiave,
        etichetta: estrattore.etichetta,
        distinti: esito.distinti,
        mostrati: esito.valori.length,
        valori: esito.valori,
        nota:
          esito.valori.length < esito.distinti
            ? `Mostrati i ${esito.valori.length} di maggior peso su ${esito.distinti}. ` +
              'Restringi con "contiene" se cerchi un nome preciso.'
            : "Elenco completo.",
      });
    }

    if (nome === "interroga_metrica") {
      const spec = validaSpec(arg);
      const res = esegui(spec, snapshot);
      // L'unita' viaggia col valore: senza, una percentuale citata nel testo
      // verrebbe confrontata anche con importi e conteggi, e con centinaia di
      // righe fra i noti troverebbe quasi sempre un riscontro casuale.
      aggiungiValoriRisultato(spec, res, valoriNoti);
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
      for (const riga of res.righe) {
        for (const [colonna, valore] of Object.entries(riga)) {
          if (typeof valore === "number" && Number.isFinite(valore)) {
            // In SQL libero l'unita' non e' dichiarata da nessuna parte: la si
            // deduce dal nome della colonna, che per convenzione la contiene
            // ("Margine %", "quota_pct"). Nel dubbio si lascia indefinita, e
            // il valore resta confrontabile con tutto: meglio un riscontro in
            // piu' che marcare come inventata una cifra che c'e' davvero.
            const nome = colonna.toLowerCase();
            const unita = /%|pct|percentual/u.test(nome) ? "percentuale" : undefined;
            valoriNoti.push({ valore, fonte: `SQL: ${colonna}`, unita });
          }
        }
      }
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
        // Come per i rilevatori: senza calendario compilato le chiusure si
        // deducono, altrimenti la proiezione estrapola agosto come se fosse
        // un mese di lavoro normale e la stima di fine anno esce bassa.
        chiusure: chiusureEffettive(config?.chiusure, snapshot, anno).chiusure,
        escludiWeekend: config?.escludiWeekend ?? true,
      });

      previsioni.push(previsione);
      valoriNoti.push(
        { valore: previsione.stimaCentrale, fonte: `stima centrale ${metrica} ${anno}`, unita: "euro" },
        { valore: previsione.minimo, fonte: `estremo minimo ${metrica} ${anno}`, unita: "euro" },
        { valore: previsione.massimo, fonte: `estremo massimo ${metrica} ${anno}`, unita: "euro" }
      );
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
  function separaInterpretazione(testo: string): {
    testo: string;
    interpretazione: string | null;
  } {
    const righe = testo.split(/\r?\n/u);
    const prima = righe[0]?.match(/^INTERPRETAZIONE:\s*(.+?)\s*$/u);
    if (!prima) return { testo, interpretazione: null };
    return {
      testo: righe.slice(1).join("\n").replace(/^\s+/, ""),
      interpretazione: prima[1],
    };
  }

  async function verificaECorreggi(testoOriginale: string): Promise<{
    testo: string;
    interpretazione: string | null;
    verifica: EsitoVerifica;
    correzioneApplicata: boolean;
  }> {
    let risposta = separaInterpretazione(testoOriginale);
    let verifica = verificaNumeri(risposta.testo, valoriNoti);
    if (verifica.nonVerificati === 0) {
      return { ...risposta, verifica, correzioneApplicata: false };
    }

    const nonRiscontrati = verifica.numeri
      .filter((numero) => !numero.verificato)
      .map((numero) => numero.testo);
    messaggi.push({ role: "assistant", content: testoOriginale });
    messaggi.push({
      role: "user",
      content:
        `Correggi la risposta completa: queste cifre non risultano dai dati interrogati: ` +
        `${JSON.stringify(nonRiscontrati)}. Correggile o toglile usando esclusivamente i valori ` +
        `ottenuti dagli strumenti. Mantieni come prima riga ` +
        `"INTERPRETAZIONE: <una riga: metrica, periodo, taglio>". Non chiamare strumenti.`,
    });
    try {
      const correzione = await chiamaModello(rotta.modello.id, messaggi, {
        temperatura: 0.1,
        maxToken: 1800,
      });
      ingresso += correzione.ingresso;
      uscita += correzione.uscita;
      if (!correzione.testo.trim()) {
        return { ...risposta, verifica, correzioneApplicata: false };
      }
      risposta = separaInterpretazione(correzione.testo);
      verifica = verificaNumeri(risposta.testo, valoriNoti);
      return { ...risposta, verifica, correzioneApplicata: true };
    } catch (errore) {
      const messaggio = errore instanceof Error ? errore.message : String(errore);
      passi.push({
        tipo: "errore",
        descrizione: `Correzione automatica non disponibile: ${messaggio}`,
      });
      return { ...risposta, verifica, correzioneApplicata: false };
    }
  }

  for (let passo = 0; passo < rotta.massimoPassi; passo++) {
    const ultimoPasso = passo === rotta.massimoPassi - 1;
    if (ultimoPasso) {
      messaggi.push({
        role: "user",
        content:
          "Rispondi ora con quello che hai raccolto, dichiarando chiaramente cosa non hai " +
          "potuto verificare. Non chiamare altri strumenti.",
      });
    }
    const esito = await chiamaModello(rotta.modello.id, messaggi, {
      ...(ultimoPasso ? {} : { strumenti: strumentiPer(sqlLibero) }),
      temperatura: 0.2,
      maxToken: 1800,
    });
    ingresso += esito.ingresso;
    uscita += esito.uscita;

    if (esito.toolCalls.length === 0 || ultimoPasso) {
      passi.push({ tipo: "risposta", descrizione: "Risposta finale" });
      const testoFinale = esito.testo.trim() ||
        "Non sono riuscito a completare tutte le verifiche richieste, ma i dati raccolti " +
        "nei passaggi precedenti restano disponibili qui sotto.";
      const risposta = await verificaECorreggi(testoFinale);
      return {
        testo: risposta.testo,
        interpretazione: risposta.interpretazione,
        verifica: risposta.verifica,
        correzioneApplicata: risposta.correzioneApplicata,
        passi,
        interrogazioni,
        analisi,
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
        // Il suggerimento e' la differenza fra un rifiuto e un'indicazione.
        // «Funzione SQL non autorizzata: where» non dice al modello cosa fare,
        // e il ciclo bruciava passi a riprovare a caso finche' non ripiegava su
        // una metrica piu' debole. Gli errori che ne portano uno lo espongono.
        const suggerimento =
          e instanceof ErroreSqlBi || e instanceof SpecNonValida ? e.suggerimento : null;
        passi.push({
          tipo: "errore",
          descrizione: suggerimento ? `${messaggio} ${suggerimento}` : messaggio,
        });
        risultato = JSON.stringify(
          suggerimento ? { errore: messaggio, suggerimento } : { errore: messaggio }
        );
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
    testo: interrogazioni.length
      ? "Ho raccolto questi dati ma non sono arrivato a una conclusione:\n" +
        interrogazioni.map((voce) => `- ${voce.spec.metrica}: ${voce.righe} righe`).join("\n")
      : "Non sono riuscito ad arrivare a una conclusione con i dati disponibili. " +
        "Prova a indicare un periodo o una dimensione più precisa.",
    interpretazione: null,
    verifica: { numeri: [], nonVerificati: 0 },
    correzioneApplicata: false,
    passi,
    interrogazioni,
    analisi,
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
