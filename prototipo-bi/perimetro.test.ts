/**
 * PERIMETRO DEI DATI — chi vede quali righe.
 *
 * Questi test sono l'esito verificabile della Fase 2 del passaggio in
 * produzione. La domanda a cui rispondono è una sola, e va potuta rifare a
 * chiunque la ponga: **un utente con perimetro ristretto può, in qualche modo,
 * arrivare ai dati di un collega?**
 *
 * Si verificano le tre strade per cui potrebbe arrivarci:
 *   1. leggendo lo snapshot;
 *   2. facendo una query certificata che raggruppa per agente;
 *   3. leggendo dalla cache una risposta calcolata per qualcun altro.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applicaPerimetro,
  descriviPerimetro,
  perimetroAperto,
  predicatoPerimetro,
  risolviPerimetro,
  PERIMETRO_NESSUNO,
  PERIMETRO_TUTTO,
  type Perimetro,
} from "@/lib/prototipo-bi/perimetro";
import { esegui } from "@/lib/prototipo-bi/semantico";
import { chiaveStabile } from "@/lib/prototipo-bi/cache";
import type { RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

// ─────────────────────────────────────────────────────────────────────────────
// Uno snapshot minimo con due agenti e due business unit
// ─────────────────────────────────────────────────────────────────────────────

function riga(p: Partial<RigaFatto> & { codiceAgente: string; importo: number }): RigaFatto {
  // I default vanno prima dello spread, e nient'altro dopo: elencare anche
  // `importo` e `codiceAgente` qui sotto li farebbe sovrascrivere da `...p`
  // con lo stesso valore — innocuo ma confuso, e TypeScript lo segnala.
  return {
    data: "2026-03-10",
    bu: "COMPONENTI",
    categoria: "",
    agente: "Agente",
    cliente: "Cliente",
    codiceCliente: "C1",
    documento: "D1",
    articolo: "A1",
    descrizioneArticolo: "Articolo",
    quantita: 1,
    ...p,
  };
}

const VALERIA = riga({ codiceAgente: "VA", agente: "Valeria", importo: 1000, cliente: "Cliente Valeria" });
const DANIELE = riga({ codiceAgente: "DA", agente: "Daniele", importo: 400, cliente: "Cliente Daniele", documento: "D2" });
const DANIELE_IMPIANTI = riga({
  codiceAgente: "DA",
  agente: "Daniele",
  importo: 250,
  bu: "IMPIANTI",
  cliente: "Cliente Impianti",
  documento: "D3",
});
// Codice scritto male nel gestionale: spazi e minuscole. Deve rientrare.
const VALERIA_SPORCO = riga({
  codiceAgente: " va ",
  agente: "Valeria",
  importo: 100,
  cliente: "Cliente Valeria",
  documento: "D4",
});

const SNAPSHOT: Snapshot = {
  generatoIl: "2026-03-11T08:00:00.000Z",
  runCorrente: "run-1",
  runRicevutoIl: "2026-03-11T07:00:00.000Z",
  dataMassima: "2026-03-10",
  dataMinima: "2026-01-01",
  dataset: {
    ordinato: [VALERIA, DANIELE, DANIELE_IMPIANTI, VALERIA_SPORCO],
    fatturato: [VALERIA, DANIELE],
    consegnato: [DANIELE],
    portafoglio: [VALERIA],
    preventivi_aperti: [DANIELE],
    controllo_banco: [],
    consegnato_futuro_per_mese: [VALERIA],
  },
  conteggi: { ordinato: 4, fatturato: 2, consegnato: 1, portafoglio: 1, preventivi_aperti: 1 },
};

const SOLO_VALERIA: Perimetro = { tipo: "agente", codici: ["VA"] };

// ─────────────────────────────────────────────────────────────────────────────

describe("Il perimetro filtra il dato, non la domanda", () => {
  it("toglie le righe degli altri agenti da OGNI dataset", () => {
    const s = applicaPerimetro(SNAPSHOT, SOLO_VALERIA);

    for (const chiave of Object.keys(s.dataset) as (keyof Snapshot["dataset"])[]) {
      for (const r of s.dataset[chiave]) {
        expect(r.codiceAgente.trim().toUpperCase()).toBe("VA");
      }
    }
    // Daniele compare in quattro dataset diversi: non deve restarne traccia.
    expect(s.dataset.consegnato).toHaveLength(0);
    expect(s.dataset.preventivi_aperti).toHaveLength(0);
  });

  it("riconosce il codice agente anche scritto con spazi e minuscole", () => {
    const s = applicaPerimetro(SNAPSHOT, SOLO_VALERIA);
    // Le righe di Valeria sono due, una delle quali con codice " va ".
    expect(s.dataset.ordinato).toHaveLength(2);
    expect(s.dataset.ordinato.reduce((t, r) => t + r.importo, 0)).toBe(1100);
  });

  it("ricalcola i conteggi sulle righe rimaste", () => {
    const s = applicaPerimetro(SNAPSHOT, SOLO_VALERIA);
    // Lasciare i conteggi originali farebbe dire "4 righe" a chi ne vede 2.
    expect(s.conteggi.ordinato).toBe(2);
    expect(s.conteggi.consegnato).toBe(0);
    expect(SNAPSHOT.conteggi.ordinato).toBe(4); // l'originale non è stato toccato
  });

  it("con perimetro aperto non copia nemmeno l'oggetto", () => {
    expect(applicaPerimetro(SNAPSHOT, PERIMETRO_TUTTO)).toBe(SNAPSHOT);
    expect(perimetroAperto(PERIMETRO_TUTTO)).toBe(true);
  });

  it("perimetro nessuno non lascia passare niente", () => {
    const s = applicaPerimetro(SNAPSHOT, PERIMETRO_NESSUNO);
    expect(s.dataset.ordinato).toHaveLength(0);
    expect(s.dataset.fatturato).toHaveLength(0);
  });

  it("filtra per business unit quando è quello il perimetro", () => {
    const s = applicaPerimetro(SNAPSHOT, { tipo: "business_unit", unita: ["IMPIANTI"] });
    expect(s.dataset.ordinato).toHaveLength(1);
    expect(s.dataset.ordinato[0].bu).toBe("IMPIANTI");
  });
});

describe("La strada che conta: una query certificata non esce dal perimetro", () => {
  it("raggruppando per agente si vede solo il proprio", () => {
    const mio = applicaPerimetro(SNAPSHOT, SOLO_VALERIA);
    const res = esegui(
      { metrica: "ordinato", raggruppa: ["agente"], periodo: { dal: "2026-01-01", al: "2026-12-31" } },
      mio
    );

    const agenti = res.righe.map((r) => r.chiavi.agente);
    expect(agenti).toEqual(["Valeria"]);
    expect(agenti).not.toContain("Daniele");
    expect(res.totale).toBe(1100);
  });

  it("chiedendo esplicitamente il collega non si ottiene niente, non un errore", () => {
    const mio = applicaPerimetro(SNAPSHOT, SOLO_VALERIA);
    const res = esegui(
      {
        metrica: "ordinato",
        filtri: [{ campo: "agente", op: "eq", valore: "Daniele" }],
        periodo: { dal: "2026-01-01", al: "2026-12-31" },
      },
      mio
    );
    // Il filtro è legittimo e viene applicato: semplicemente non c'è nulla su
    // cui applicarlo. Il perimetro non si difende rifiutando le domande, si
    // difende non avendo i dati.
    expect(res.totale).toBe(0);
    expect(res.righe).toHaveLength(0);
  });

  it("nemmeno passando per i clienti si raggiungono le righe altrui", () => {
    const mio = applicaPerimetro(SNAPSHOT, SOLO_VALERIA);
    const res = esegui(
      { metrica: "ordinato", raggruppa: ["cliente"], periodo: { dal: "2026-01-01", al: "2026-12-31" } },
      mio
    );
    expect(res.righe.map((r) => r.chiavi.cliente)).not.toContain("Cliente Daniele");
  });
});

describe("La cache non fa trapelare i dati fra utenti", () => {
  it("perimetri diversi producono chiavi di cache diverse", () => {
    // Se questa uguaglianza saltasse, il primo utente a eseguire una spec
    // riempirebbe la cache per tutti gli altri, perimetro compreso.
    const a = chiaveStabile(PERIMETRO_TUTTO);
    const b = chiaveStabile(SOLO_VALERIA);
    const c = chiaveStabile({ tipo: "agente", codici: ["DA"] } as Perimetro);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("la route delle query mette il perimetro nella chiave", () => {
    const sorgente = readFileSync(
      resolve(process.cwd(), "src/app/api/prototipo-bi/query/route.ts"),
      "utf8"
    );
    expect(sorgente).toContain("chiaveStabile(pre.accesso.perimetro)");
    expect(sorgente).toMatch(/chiave = `\$\{snapshot\.runCorrente[^`]*chiavePerimetro/);
  });
});

describe("In assenza di configurazione il perimetro è chiuso, non aperto", () => {
  it("un livello non direzionale senza codici né BU non vede niente", () => {
    expect(risolviPerimetro({ livello: "responsabile" })).toEqual(PERIMETRO_NESSUNO);
    expect(risolviPerimetro({ livello: "operativo", codiciAgente: [] })).toEqual(PERIMETRO_NESSUNO);
    // Le stringhe vuote non contano come configurazione.
    expect(risolviPerimetro({ livello: "operativo", codiciAgente: ["  "] })).toEqual(PERIMETRO_NESSUNO);
  });

  it("la direzione vede tutto", () => {
    expect(risolviPerimetro({ livello: "direzione" })).toEqual(PERIMETRO_TUTTO);
  });

  it("predicatoPerimetro non restituisce mai un passa-tutto per errore", () => {
    // Un `null` significa "nessun filtro": deve arrivare SOLO da `tutto`.
    const casi: Perimetro[] = [
      PERIMETRO_NESSUNO,
      { tipo: "agente", codici: [] },
      { tipo: "business_unit", unita: [] },
    ];
    for (const p of casi) {
      const pred = predicatoPerimetro(p);
      expect(pred).not.toBeNull();
      expect(pred!(VALERIA)).toBe(false);
    }
    expect(predicatoPerimetro(PERIMETRO_TUTTO)).toBeNull();
  });
});

describe("SQL libero e perimetro non coesistono mai", () => {
  it("la route SQL rifiuta chi non ha sqlLibero, e lo registra", () => {
    const sorgente = readFileSync(
      resolve(process.cwd(), "src/app/api/prototipo-bi/sql/route.ts"),
      "utf8"
    );
    expect(sorgente).toContain("if (!accesso.sqlLibero)");
    expect(sorgente).toContain('esito: "negato"');
    // Anche la GET dello schema: sapere quali viste e colonne esistono è già
    // informazione che non serve a chi non può interrogarle.
    expect(sorgente).toContain("if (!pre.accesso.sqlLibero) return negato");
  });

  it("solo la direzione ottiene sqlLibero, e ha perimetro aperto", () => {
    const sorgente = readFileSync(
      resolve(process.cwd(), "src/lib/prototipo-bi/accesso.ts"),
      "utf8"
    );
    expect(sorgente).toContain('sqlLibero: livello === "direzione"');
  });

  it("l'analista non riceve gli strumenti SQL se chi chiede non può usarli", () => {
    const sorgente = readFileSync(
      resolve(process.cwd(), "src/lib/prototipo-bi/analista.ts"),
      "utf8"
    );
    expect(sorgente).toContain("function strumentiPer(sqlLibero: boolean)");
    // Seconda cintura: anche se il modello inventasse il nome dello strumento.
    expect(sorgente).toContain("STRUMENTI_SQL.has(nome) && !sqlLibero");
    // Il default deve essere ristretto: chi dimentica il campo non apre nulla.
    expect(sorgente).toContain("opzioni.sqlLibero === true");
  });
});

describe("Nessuna route legge lo snapshot scavalcando il perimetro", () => {
  it("le route che leggono dati passano da snapshotPerimetrato", () => {
    const base = resolve(process.cwd(), "src/app/api/prototipo-bi");
    const conDati = ["query", "dettaglio", "briefing", "esporta", "configurazione", "snapshot", "analista"];

    for (const nome of conDati) {
      const sorgente = readFileSync(resolve(base, nome, "route.ts"), "utf8");
      expect(
        sorgente.includes("snapshotPerimetrato"),
        `${nome}/route.ts deve usare snapshotPerimetrato`
      ).toBe(true);
      expect(
        /await ottieniSnapshot\(/.test(sorgente),
        `${nome}/route.ts non deve chiamare ottieniSnapshot direttamente`
      ).toBe(false);
    }
  });
});

describe("Descrizioni leggibili, per l'interfaccia e per l'audit", () => {
  it("dice a parole cosa vede l'utente", () => {
    expect(descriviPerimetro(PERIMETRO_TUTTO)).toBe("Tutta l'azienda");
    expect(descriviPerimetro(SOLO_VALERIA)).toBe("Solo agente VA");
    expect(descriviPerimetro({ tipo: "agente", codici: ["VA", "DA"] })).toBe("Solo agenti VA, DA");
    expect(descriviPerimetro(PERIMETRO_NESSUNO)).toBe("Nessun dato");
  });
});
