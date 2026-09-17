/**
 * Freschezza dello snapshot.
 *
 * Il 17 settembre 2026 il cruscotto scriveva «Dati aggiornati al 11/09» mentre
 * l'ingest notturno da SRVWOA aveva consegnato regolarmente fino al 16. Il
 * file di cache sulla VM portava la data del 14/09 alle 19:28 e non era piu'
 * stato riscritto: `ottieniSnapshot` restituiva la copia in memoria senza mai
 * guardarne l'eta', e sotto pm2 quel processo era vivo da tre giorni.
 *
 * Questi test descrivono le tre condizioni che devono far ricostruire lo
 * snapshot. Il primo fallisce sul codice precedente alla correzione.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

/** Run pubblicato dal finto database. I test lo cambiano per simulare l'ingest. */
let runPubblicato = "20260914_013001";
/** Quante volte lo snapshot e' stato ricostruito dalle viste. */
let ricostruzioni = 0;

vi.mock("@/lib/supabase/admin", () => {
  // Una risposta che sa fare sia da `await` diretto (il conteggio con
  // `head: true`) sia da catena `.range()` / `.eq().limit()`.
  const risposta = (dati: unknown[], count: number) => {
    const esito = { data: dati, error: null, count };
    return Object.assign(Promise.resolve(esito), {
      range: () => Promise.resolve(esito),
      limit: () => Promise.resolve(esito),
      eq: () => ({ limit: () => Promise.resolve(esito) }),
    });
  };

  const from = (tabella: string) => ({
    select: (_campi?: string, _opzioni?: { count?: string; head?: boolean }) => {
      if (tabella === "bi_runs") {
        return risposta(
          [{ run_id: runPubblicato, received_at: "2026-09-14T01:31:00Z", status: "current" }],
          1
        );
      }
      // Tutte le viste sono vuote: qui si misura QUANDO si ricostruisce, non cosa.
      return risposta([], 0);
    },
  });

  return {
    createAdminClient: () => ({ from, schema: () => ({ from }) }),
  };
});

/** Finto file di cache: tiene contenuto e istante di scrittura. */
let fileContenuto: unknown = null;
let fileScrittoIl = 0;

vi.mock("@/lib/prototipo-bi/archivio", () => ({
  etaSnapshot: async () => (fileContenuto === null ? null : Date.now() - fileScrittoIl),
  leggiSnapshotDaCache: async () => fileContenuto,
  salvaSnapshotInCache: async (s: unknown) => {
    fileContenuto = s;
    fileScrittoIl = Date.now();
    ricostruzioni += 1;
  },
}));

import { ottieniSnapshot, invalidaCacheMemoria } from "@/lib/prototipo-bi/sorgente";

const ORA = 60 * 60 * 1000;
const MINUTO = 60 * 1000;

describe("Freschezza dello snapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-14T19:28:00Z"));
    runPubblicato = "20260914_013001";
    ricostruzioni = 0;
    fileContenuto = null;
    fileScrittoIl = 0;
    invalidaCacheMemoria();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("la copia in memoria scade come il file, non alla morte del processo", async () => {
    await ottieniSnapshot();
    expect(ricostruzioni).toBe(1);

    // Mezz'ora dopo: giustamente non si rifa' niente.
    vi.setSystemTime(new Date("2026-09-14T19:58:00Z"));
    await ottieniSnapshot();
    expect(ricostruzioni).toBe(1);

    // Tre giorni dopo — la situazione vera del 17/09 — si deve ricostruire.
    // Prima della correzione qui `ricostruzioni` restava 1 per sempre.
    vi.setSystemTime(new Date("2026-09-17T15:00:00Z"));
    await ottieniSnapshot();
    expect(ricostruzioni).toBe(2);
  });

  it("un caricamento nuovo entra entro dieci minuti, senza aspettare le sei ore", async () => {
    await ottieniSnapshot();
    expect(ricostruzioni).toBe(1);

    // L'ingest della notte pubblica un run nuovo.
    runPubblicato = "20260917_013001";

    // Entro i dieci minuti non lo si chiede nemmeno: la cache regge.
    vi.setSystemTime(Date.now() + 5 * MINUTO);
    await ottieniSnapshot();
    expect(ricostruzioni).toBe(1);

    // Passati i dieci minuti si controlla, il run e' diverso, si ricostruisce.
    vi.setSystemTime(Date.now() + 6 * MINUTO);
    const dopo = await ottieniSnapshot();
    expect(ricostruzioni).toBe(2);
    expect(dopo.runCorrente).toBe("20260917_013001");
  });

  it("il file vecchio non viene riletto quando il run e' cambiato", async () => {
    await ottieniSnapshot();
    // Il file su disco resta quello del run vecchio, scritto adesso: senza il
    // salto esplicito verrebbe riletto come se fosse fresco.
    runPubblicato = "20260917_013001";
    vi.setSystemTime(Date.now() + 11 * MINUTO);

    const dopo = await ottieniSnapshot();
    expect(dopo.runCorrente).toBe("20260917_013001");
  });

  it("dieci richieste insieme fanno una sola ricostruzione", async () => {
    vi.setSystemTime(Date.now() + 7 * ORA);
    const esiti = await Promise.all(Array.from({ length: 10 }, () => ottieniSnapshot()));
    expect(ricostruzioni).toBe(1);
    expect(new Set(esiti).size).toBe(1);
  });
});
