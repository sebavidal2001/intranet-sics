/**
 *
 * Cache dei risultati aggregati, lato server.
 *
 * Misurato: costruire lo snapshot costa ~3 secondi (una volta ogni sei ore),
 * ma ogni spec costa ~13 ms e una schermata ne chiede fra le dieci e le venti.
 * Cambiare filtro, tornare indietro e ricambiarlo rifaceva ogni volta gli
 * stessi conti: da qui la sensazione di lentezza rispetto a Power BI, che
 * tiene il modello in memoria.
 *
 * La chiave comprende il run pubblicato: quando arriva un caricamento nuovo,
 * tutte le voci precedenti diventano irraggiungibili e non c'è rischio di
 * servire numeri vecchi.
 */

interface Voce<T> {
  valore: T;
  scadenza: number;
  /** Ordine di ultimo utilizzo, per lo sfratto. */
  usataIl: number;
}

export class CacheRisultati<T> {
  private voci = new Map<string, Voce<T>>();
  private colpi = 0;
  private mancati = 0;

  constructor(
    private readonly massimo = 400,
    private readonly durataMs = 10 * 60 * 1000
  ) {}

  private sfratta() {
    if (this.voci.size <= this.massimo) return;
    // Sfratto del meno usato di recente: le schermate ruotano su poche
    // combinazioni di filtri, quindi bastano poche centinaia di voci.
    const ordinate = [...this.voci.entries()].sort((a, b) => a[1].usataIl - b[1].usataIl);
    const daTogliere = ordinate.slice(0, Math.ceil(this.massimo * 0.2));
    for (const [k] of daTogliere) this.voci.delete(k);
  }

  leggi(chiave: string): T | undefined {
    const v = this.voci.get(chiave);
    if (!v) {
      this.mancati += 1;
      return undefined;
    }
    if (v.scadenza < Date.now()) {
      this.voci.delete(chiave);
      this.mancati += 1;
      return undefined;
    }
    v.usataIl = Date.now();
    this.colpi += 1;
    return v.valore;
  }

  scrivi(chiave: string, valore: T) {
    this.voci.set(chiave, {
      valore,
      scadenza: Date.now() + this.durataMs,
      usataIl: Date.now(),
    });
    this.sfratta();
  }

  /** Esegue `calcola` solo se la chiave non è già in cache. */
  async ottieni(chiave: string, calcola: () => Promise<T> | T): Promise<T> {
    const esistente = this.leggi(chiave);
    if (esistente !== undefined) return esistente;
    const valore = await calcola();
    this.scrivi(chiave, valore);
    return valore;
  }

  svuota() {
    this.voci.clear();
  }

  get statistiche() {
    const totale = this.colpi + this.mancati;
    return {
      voci: this.voci.size,
      colpi: this.colpi,
      mancati: this.mancati,
      efficacia: totale > 0 ? Math.round((this.colpi / totale) * 100) : 0,
    };
  }
}

/**
 * Chiave stabile per una spec: le proprietà vengono ordinate, così due spec
 * identiche scritte con le chiavi in ordine diverso condividono la cache.
 */
export function chiaveStabile(valore: unknown): string {
  if (valore === null || typeof valore !== "object") return JSON.stringify(valore) ?? "null";
  if (Array.isArray(valore)) return `[${valore.map(chiaveStabile).join(",")}]`;
  const o = valore as Record<string, unknown>;
  const parti = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${chiaveStabile(o[k])}`);
  return `{${parti.join(",")}}`;
}

/** Cache condivisa dalle rotte di interrogazione. */
export const cacheQuery = new CacheRisultati<unknown>(500, 10 * 60 * 1000);
