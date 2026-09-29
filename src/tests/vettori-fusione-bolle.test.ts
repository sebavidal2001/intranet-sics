import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpedizioneLogica } from "@/lib/portali/vettori/abbinamento";
import {
  dimenticaUltimaFusione,
  fondiDocumentiRecenti,
  pianificaAggiornamentoSpedizione,
  sincronizzaSpedizioniGestionali,
} from "@/lib/portali/vettori/bolle";
import * as adminModulo from "@/lib/supabase/admin";

type Riga = Record<string, unknown>;
interface Stato {
  tabelle: Map<string, Riga[]>;
  chiamate: Array<{ op: string; tabella: string; dati?: unknown }>;
  prossimoId: number;
}

// Un database in memoria che parla come il client Supabase per le sole
// chiamate che la fusione fa: basta per contare le richieste e le scritture.
vi.mock("@/lib/supabase/admin", () => {
  const stato: Stato = { tabelle: new Map(), chiamate: [], prossimoId: 1 };
  const righeDi = (nome: string) => {
    if (!stato.tabelle.has(nome)) stato.tabelle.set(nome, []);
    return stato.tabelle.get(nome) as Riga[];
  };

  class Query implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
    private modo: "select" | "insert" | "upsert" | "update" = "select";
    private filtri: Array<(riga: Riga) => boolean> = [];
    private payload: unknown;
    private conflitto: string[] = [];
    private unico = false;
    private massimo: number | undefined;
    private ordine: { colonna: string; crescente: boolean } | null = null;

    constructor(private nome: string) {}

    select() { return this; }
    in(colonna: string, valori: unknown[]) { this.filtri.push((r) => valori.includes(r[colonna])); return this; }
    eq(colonna: string, valore: unknown) { this.filtri.push((r) => r[colonna] === valore); return this; }
    order(colonna: string, opzioni?: { ascending?: boolean }) { this.ordine = { colonna, crescente: opzioni?.ascending !== false }; return this; }
    limit(n: number) { this.massimo = n; return this; }
    single() { this.unico = true; return this; }
    insert(dati: unknown) { this.modo = "insert"; this.payload = dati; return this; }
    upsert(dati: unknown, opzioni?: { onConflict?: string }) {
      this.modo = "upsert";
      this.payload = dati;
      this.conflitto = (opzioni?.onConflict ?? "").split(",").filter(Boolean);
      return this;
    }
    update(dati: unknown) { this.modo = "update"; this.payload = dati; return this; }

    then<T, U>(
      ok?: ((v: { data: unknown; error: { message: string } | null }) => T | PromiseLike<T>) | null,
      ko?: ((e: unknown) => U | PromiseLike<U>) | null
    ) {
      return Promise.resolve(this.esegui()).then(ok, ko);
    }

    private risposta(righe: Riga[]) {
      if (this.unico) {
        return righe[0]
          ? { data: righe[0], error: null }
          : { data: null, error: { message: "nessuna riga" } };
      }
      return { data: righe, error: null };
    }

    private esegui() {
      const righe = righeDi(this.nome);
      stato.chiamate.push({ op: this.modo, tabella: this.nome, dati: this.payload });
      if (this.modo === "insert") {
        const nuova: Riga = {
          id: `nuova-${stato.prossimoId++}`,
          campi_forzati: {},
          congelata: false,
          ...(this.payload as Riga),
        };
        righe.push(nuova);
        return this.risposta([nuova]);
      }
      if (this.modo === "upsert") {
        for (const dato of [this.payload].flat() as Riga[]) {
          const i = righe.findIndex((r) => this.conflitto.every((k) => r[k] === dato[k]));
          if (i >= 0) righe[i] = { ...righe[i], ...dato };
          else righe.push({ ...dato });
        }
        return { data: null, error: null };
      }
      const trovate = righe.filter((r) => this.filtri.every((f) => f(r)));
      if (this.modo === "update") {
        for (const riga of trovate) Object.assign(riga, this.payload);
        return { data: null, error: null };
      }
      const ordine = this.ordine;
      const ordinate = ordine
        ? [...trovate].sort((a, b) => {
            const x = String(a[ordine.colonna] ?? "");
            const y = String(b[ordine.colonna] ?? "");
            return (x < y ? -1 : x > y ? 1 : 0) * (ordine.crescente ? 1 : -1);
          })
        : trovate;
      return this.risposta(this.massimo ? ordinate.slice(0, this.massimo) : ordinate);
    }
  }

  return {
    createAdminClient: () => ({ schema: () => ({ from: (nome: string) => new Query(nome) }) }),
    __stato: stato,
  };
});

const stato = (adminModulo as unknown as { __stato: Stato }).__stato;
const tabella = (nome: string) => {
  if (!stato.tabelle.has(nome)) stato.tabelle.set(nome, []);
  return stato.tabelle.get(nome) as Riga[];
};
const scritture = (dopo = 0) =>
  stato.chiamate.slice(dopo).filter((c) => ["insert", "upsert", "update"].includes(c.op));

const dettagli = new Map([
  [101, { codiceProfilo: "BF", tipoRegistro: "DA", numeroProgressivo: "2149", numeroDocumento: "4745" }],
]);

const logica = (extra: Partial<SpedizioneLogica> = {}): SpedizioneLogica => ({
  chiave: "entrata|F1|4745|2026-09-28",
  direzione: "entrata",
  riferimento: "4745",
  riferimentoNorm: "4745",
  dataDocumento: "2026-09-28",
  codiceControparte: "F1",
  controparte: "Fornitore",
  zonaCap: "40023",
  zonaProvincia: "BO",
  portoCodice: "02",
  porto: "Assegnato",
  aNostroCarico: true,
  vettoreCodice: null,
  colli: 0,
  peso: 1.33,
  volumeMc: null,
  idDocumenti: [101],
  ...extra,
});

const rigaDb = (extra: Riga = {}): Riga => ({
  id: "sp-1",
  direzione: "entrata",
  vettore_id: null,
  numero_riferimento: "4745",
  numero_riferimento_norm: "4745",
  data_documento: "2026-09-28",
  controparte_codice: "F1",
  controparte_nome: "Fornitore",
  zona_cap: "40023",
  zona_provincia: "BO",
  fonte_zona: null,
  porto_codice: "02",
  porto_descrizione: "Assegnato",
  a_nostro_carico: true,
  colli_bolla: 0,
  peso_bolla: "1.330",
  numero_protocollo: "2149",
  origine: "gestionale",
  campi_forzati: {},
  congelata: false,
  ...extra,
});

const legameDb = (extra: Riga = {}): Riga => ({
  spedizione_id: "sp-1",
  id_documento: 101,
  codice_profilo: "BF",
  tipo_registro: "DA",
  numero_progressivo: "2149",
  numero_documento: "4745",
  ...extra,
});

beforeEach(() => {
  stato.tabelle.clear();
  stato.chiamate.length = 0;
  stato.prossimoId = 1;
  dimenticaUltimaFusione();
});
afterEach(() => vi.useRealTimers());

describe("fusione delle bolle: si scrive solo dove e' cambiato qualcosa", () => {
  it("una spedizione gia' allineata non genera nessuna scrittura", async () => {
    tabella("spedizioni").push(rigaDb());
    tabella("spedizioni_documenti").push(legameDb());

    await sincronizzaSpedizioniGestionali([logica()], dettagli);

    expect(scritture()).toEqual([]);
  });

  it("il peso del gestionale cambia: una sola scrittura, e solo su quella spedizione", async () => {
    tabella("spedizioni").push(rigaDb(), rigaDb({ id: "sp-2", numero_riferimento_norm: "9", numero_riferimento: "9" }));
    tabella("spedizioni_documenti").push(legameDb());

    await sincronizzaSpedizioniGestionali([logica({ peso: 32 })], dettagli);

    const fatte = scritture();
    expect(fatte).toHaveLength(1);
    expect(fatte[0]).toMatchObject({ op: "update", tabella: "spedizioni" });
    expect(tabella("spedizioni")[0]).toMatchObject({ id: "sp-1", peso_bolla: 32 });
    expect(tabella("spedizioni")[0].aggiornata_il).toBeTruthy();
    expect(tabella("spedizioni")[1].aggiornata_il).toBeUndefined();
  });

  it("un campo forzato a mano non viene sovrascritto, e senza altre differenze non si scrive", async () => {
    tabella("spedizioni").push(
      rigaDb({
        peso_bolla: 50,
        campi_forzati: { peso_bolla: { valore_precedente: 1.33, forzato_da: "utente", forzato_il: "2026-09-29T10:00:00Z" } },
      })
    );
    tabella("spedizioni_documenti").push(legameDb());

    await sincronizzaSpedizioniGestionali([logica({ peso: 1.33 })], dettagli);

    expect(scritture()).toEqual([]);
    expect(tabella("spedizioni")[0].peso_bolla).toBe(50);
  });

  it("il gestionale che non sa non cancella chi sa: peso zero non azzera un peso inserito", async () => {
    tabella("spedizioni").push(rigaDb({ peso_bolla: 12 }));
    tabella("spedizioni_documenti").push(legameDb());

    await sincronizzaSpedizioniGestionali([logica({ peso: 0 })], dettagli);

    expect(scritture()).toEqual([]);
    expect(tabella("spedizioni")[0].peso_bolla).toBe(12);
  });

  it("un documento nuovo crea la spedizione e il suo legame, senza riscriverla", async () => {
    await sincronizzaSpedizioniGestionali([logica()], dettagli);

    expect(scritture().map((c) => `${c.op} ${c.tabella}`)).toEqual([
      "insert spedizioni",
      "upsert spedizioni_documenti",
    ]);
    expect(tabella("spedizioni")).toHaveLength(1);
    expect(tabella("spedizioni")[0]).toMatchObject({ origine: "gestionale", stato: "attesa", numero_protocollo: "2149" });
    expect(tabella("spedizioni_documenti")[0]).toMatchObject({ id_documento: 101, numero_progressivo: "2149" });
  });

  it("una spedizione senza legame ma con la stessa chiave viene riusata, non duplicata", async () => {
    tabella("spedizioni").push(rigaDb({ origine: "excel_storico" }));

    await sincronizzaSpedizioniGestionali([logica()], dettagli);

    expect(tabella("spedizioni")).toHaveLength(1);
    expect(tabella("spedizioni_documenti")).toHaveLength(1);
    expect(scritture().map((c) => `${c.op} ${c.tabella}`)).toEqual(["upsert spedizioni_documenti"]);
  });

  it("se cambia solo il dettaglio del documento si riscrive il legame e basta", async () => {
    tabella("spedizioni").push(rigaDb());
    tabella("spedizioni_documenti").push(legameDb({ numero_documento: "vecchio" }));

    await sincronizzaSpedizioniGestionali([logica()], dettagli);

    expect(scritture().map((c) => `${c.op} ${c.tabella}`)).toEqual(["upsert spedizioni_documenti"]);
    expect(tabella("spedizioni_documenti")[0].numero_documento).toBe("4745");
  });

  it("una spedizione congelata non si tocca: si annota lo scostamento", async () => {
    tabella("spedizioni").push(rigaDb({ congelata: true, peso_bolla: 5 }));
    tabella("spedizioni_documenti").push(legameDb());

    await sincronizzaSpedizioniGestionali([logica({ peso: 32 })], dettagli);

    expect(scritture().map((c) => `${c.op} ${c.tabella}`)).toEqual(["upsert spedizioni_scostamenti"]);
    expect(tabella("spedizioni")[0].peso_bolla).toBe(5);
  });

  it("tante spedizioni invariate costano poche letture e nessuna scrittura", async () => {
    const logiche: SpedizioneLogica[] = [];
    const piu = new Map(dettagli);
    for (let i = 0; i < 250; i++) {
      const idDocumento = 1000 + i;
      piu.set(idDocumento, { codiceProfilo: "BF", tipoRegistro: "DA", numeroProgressivo: String(i), numeroDocumento: `N${i}` });
      logiche.push(logica({ riferimento: `N${i}`, riferimentoNorm: `N${i}`, idDocumenti: [idDocumento] }));
      tabella("spedizioni").push(rigaDb({ id: `sp-${i}`, numero_riferimento: `N${i}`, numero_riferimento_norm: `N${i}`, numero_protocollo: String(i) }));
      tabella("spedizioni_documenti").push(
        legameDb({ spedizione_id: `sp-${i}`, id_documento: idDocumento, numero_progressivo: String(i), numero_documento: `N${i}` })
      );
    }

    await sincronizzaSpedizioniGestionali(logiche, piu);

    expect(scritture()).toEqual([]);
    // codici + (legami + righe) per ciascuno dei 3 blocchi da 100: prima erano ~5 chiamate per spedizione.
    expect(stato.chiamate.length).toBeLessThanOrEqual(1 + 3 * 2);
  });
});

describe("pianificaAggiornamentoSpedizione", () => {
  it("numeri e testi equivalenti non contano come differenza", () => {
    const riga = rigaDb({ peso_bolla: "1.330", colli_bolla: 0 }) as unknown as Parameters<typeof pianificaAggiornamentoSpedizione>[0];
    const valori = {
      direzione: "entrata", vettore_id: null, numero_riferimento: "4745", numero_riferimento_norm: "4745",
      data_documento: "2026-09-28", controparte_codice: "F1", controparte_nome: "Fornitore", zona_cap: "40023",
      zona_provincia: "BO", fonte_zona: null, porto_codice: "02", porto_descrizione: "Assegnato",
      a_nostro_carico: true, colli_bolla: 0, peso_bolla: 1.33,
    } as Parameters<typeof pianificaAggiornamentoSpedizione>[1];
    expect(pianificaAggiornamentoSpedizione(riga, valori, "2149")).toBeNull();
    expect(pianificaAggiornamentoSpedizione(riga, { ...valori, porto_codice: "03" }, "2149")).toMatchObject({ porto_codice: "03" });
    expect(pianificaAggiornamentoSpedizione(riga, valori, "2150")).toMatchObject({ numero_protocollo: "2150" });
  });
});

describe("fusione dei documenti recenti: salta se il gestionale non ha mandato niente", () => {
  const documento = (extra: Riga = {}): Riga => ({
    id_documento: 101,
    codice_profilo: "BF",
    tipo_registro: "DA",
    numero_progressivo: "2149",
    numero_documento: "4745",
    data_documento: "2026-09-28",
    data_registrazione: "2026-09-28",
    data_creazione: "2026-09-28 10:21:00",
    codice_soggetto: "F1",
    soggetto: "Fornitore",
    zona_cap: "40023",
    zona_provincia: "BO",
    tipo_trasporto_codice: "02",
    tipo_trasporto: "Assegnato",
    tras_mezzo: "V",
    vettore_codice: null,
    num_colli: 0,
    peso_lordo: 0,
    peso_netto: 1.33,
    volume: null,
    aggiornato_il: "2026-09-29T10:00:00Z",
    ...extra,
  });
  const letturaGrezzo = (dopo = 0) =>
    stato.chiamate.slice(dopo).filter((c) => c.tabella === "trasporti_documenti").length;

  it("la seconda richiesta fa solo due letture leggere e nessuna scrittura", async () => {
    tabella("trasporti_documenti").push(documento());

    await fondiDocumentiRecenti();
    expect(tabella("spedizioni")).toHaveLength(1);
    expect(tabella("spedizioni")[0]).toMatchObject({ peso_bolla: 1.33 });

    const dopo = stato.chiamate.length;
    await fondiDocumentiRecenti();

    expect(stato.chiamate.slice(dopo).map((c) => `${c.op} ${c.tabella}`).sort()).toEqual([
      "select codici_gestionale",
      "select trasporti_documenti",
    ]);
  });

  it("se il gestionale manda qualcosa di nuovo, rifonde", async () => {
    tabella("trasporti_documenti").push(documento());
    await fondiDocumentiRecenti();

    tabella("trasporti_documenti")[0] = documento({ peso_netto: 4, aggiornato_il: "2026-09-29T10:05:00Z" });
    await fondiDocumentiRecenti();

    expect(tabella("spedizioni")[0]).toMatchObject({ peso_bolla: 4 });
  });

  it("rifonde comunque dopo dieci minuti", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T10:00:00Z"));
    tabella("trasporti_documenti").push(documento());
    await fondiDocumentiRecenti();
    const dopo = stato.chiamate.length;

    vi.setSystemTime(new Date("2026-09-29T10:05:00Z"));
    await fondiDocumentiRecenti();
    expect(letturaGrezzo(dopo)).toBe(1);

    vi.setSystemTime(new Date("2026-09-29T10:11:00Z"));
    await fondiDocumentiRecenti();
    expect(letturaGrezzo(dopo)).toBe(3);
  });

  it("piu' richieste contemporanee aspettano la stessa fusione", async () => {
    tabella("trasporti_documenti").push(documento());

    await Promise.all([fondiDocumentiRecenti(), fondiDocumentiRecenti(), fondiDocumentiRecenti()]);

    expect(tabella("spedizioni")).toHaveLength(1);
    // Una sola passata: marca del grezzo (1) + lettura dei 500 documenti (1).
    expect(letturaGrezzo()).toBe(2);
  });
});
