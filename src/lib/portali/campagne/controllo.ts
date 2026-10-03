/**
 * Il controllo delle campagne contro i dati di Impresa (Fase 2).
 *
 * Funzione PURA: riceve i dati gia' letti e restituisce cosa cambiare e quali
 * anomalie esistono. Niente database, niente orologio: per questo si prova con
 * casi scritti a mano e con una riproduzione sui dati reali.
 *
 * Fonti, tutte gia' caricate ogni notte dalla pipeline BI (nessuna estrazione
 * nuova, vedi migration 132):
 *   - righe d'ordine con l'articolo della campagna  (public.bi_ordinato)
 *   - riga ancora aperta = presente in portafoglio   (public.bi_portafoglio)
 *   - righe DDT con lo stesso articolo               (public.bi_consegnato)
 *
 * Cosa NON c'e' in quei dati: il legame riga d'ordine -> riga DDT. Si ricostruisce
 * abbinando, per cliente, ogni riga evasa al DDT piu' vecchio non ancora usato
 * che non preceda l'ordine, scorrendo le righe per data di consegna confermata.
 * Sul 2026 ha dato 425 abbinamenti giusti su 425 verificabili contro il campo di
 * derivazione vero di Impresa; l'ordine cronologico semplice ne sbagliava 5, tutti
 * casi di inversione. Il risultato e' marcato `ddt_metodo = 'euristico'`.
 */

// ─── Tipi ──────────────────────────────────────────────────────────────────
export interface CampagnaCtrl {
  id: string;
  codice: string;
  nome: string;
  articolo_codice: string;
  testo_riconoscimento: string[];
  ordine: number;
}

export interface InvioCtrl {
  id: string;
  campagna_id: string;
  codice_cliente: string;
  ragione_sociale: string;
  stato: "preparata" | "da_spedire";
  ordine_numero: string | null;
  ordine_anno: number | null;
  ordine_profilo: string | null;
  assegnata_il: string;
  riga_vista_il: string | null;
}

export interface OrdineImpresa {
  profilo: string;
  numero: string;
  anno: number;
  cliente: string;
  data_doc: string;
  consegna_prevista: string | null;
  aperto: boolean;
}

export interface RigaImpresa {
  profilo: string;
  numero: string;
  anno: number;
  cliente: string;
  nome_cliente: string | null;
  data_doc: string;
  richiesta: string | null;
  confermata: string | null;
  articolo: string;
  descrizione: string | null;
  aperta: boolean;
}

export interface DdtImpresa {
  numero: string;
  cliente: string;
  data_doc: string;
  articolo: string;
  descrizione: string | null;
}

/** (cliente, anno, numero) di tutti gli invii non annullati, anche quelli chiusi. */
export interface OrdineCollegato {
  codice_cliente: string;
  ordine_anno: number | null;
  ordine_numero: string | null;
}

export interface InputControllo {
  /** Istante del controllo (ISO). */
  adesso: string;
  /** Istante dei dati di Impresa (ISO), o null se non si conosce. */
  datiDel: string | null;
  campagne: CampagnaCtrl[];
  /** Invii in lavorazione: preparata e da_spedire. */
  invii: InvioCtrl[];
  /** Testate degli ordini dei clienti degli invii. */
  ordini: OrdineImpresa[];
  /** Righe con articolo di campagna dei clienti degli invii. */
  righe: RigaImpresa[];
  /** Righe con articolo di campagna ancora APERTE, di tutti i clienti. */
  righeAperte: RigaImpresa[];
  /** DDT con articolo di campagna dei clienti degli invii. */
  ddt: DdtImpresa[];
  ordiniCollegati: OrdineCollegato[];
}

export type EsitoControllo =
  | "attesa_dati"
  | "riga_trovata"
  | "consegnata"
  | "ordine_non_trovato"
  | "riga_mancante"
  | "campagna_incoerente"
  | "evasa_senza_ddt";

export interface PatchInvio {
  stato?: "preparata" | "da_spedire" | "consegnata";
  ordine_numero?: string;
  ordine_anno?: number;
  ordine_profilo?: string | null;
  ordine_data?: string | null;
  ordine_data_consegna?: string | null;
  riga_vista_il?: string;
  ddt_numero?: string;
  ddt_metodo?: "euristico";
  data_consegna?: string;
  fonte_consegna?: "ddt";
  consegna_registrata_il?: string;
  controllo_esito: EsitoControllo;
  ultimo_controllo_il: string;
}

export type TipoAnomalia =
  | "ordine_non_trovato"
  | "riga_mancante"
  | "campagna_incoerente"
  | "riga_senza_campagna"
  | "evasa_senza_ddt"
  | "documentazione_senza_busta"
  | "ordine_invertito";

export interface AnomaliaCalcolata {
  chiave: string;
  tipo: TipoAnomalia;
  gravita: "errore" | "avviso";
  codice_cliente: string;
  ragione_sociale: string | null;
  invio_id: string | null;
  campagna_id: string | null;
  ordine_numero: string | null;
  ordine_anno: number | null;
  dettaglio: Record<string, unknown>;
}

export interface MossaScambio {
  invio_id: string;
  campagna_codice: string;
  campagna_nome: string;
  da: RiferimentoOrdine;
  a: RiferimentoOrdine;
}

export interface RiferimentoOrdine {
  ordine_numero: string;
  ordine_anno: number;
  ordine_profilo: string | null;
  ordine_data: string | null;
  ordine_data_consegna: string | null;
}

export interface RisultatoControllo {
  aggiornamenti: { id: string; patch: PatchInvio; cambiaStato: boolean; adottato: boolean }[];
  anomalie: AnomaliaCalcolata[];
}

// ─── Normalizzazioni ───────────────────────────────────────────────────────
/** Stessa regola di campagne.norm_numero (migration 132): niente zeri iniziali. */
export function normNumero(n: string | null | undefined): string {
  const t = (n ?? "").trim();
  if (/^0+$/.test(t)) return "0";
  return t.replace(/^0+(?=\d)/, "");
}

/** Maiuscolo, senza caratteri di controllo (nelle righe reali c'e' uno 0x1F spurio) e con gli spazi ridotti. */
export function normTesto(t: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (t ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

export const chiaveOrdine = (cliente: string, anno: number | null, numero: string | null) =>
  `${cliente}|${anno ?? ""}|${normNumero(numero)}`;

const chiaveRiga = (r: RigaImpresa) =>
  `${r.profilo}|${normNumero(r.numero)}|${r.anno}|${r.cliente}|${r.articolo}|${normTesto(r.descrizione)}`;

/** Il testo che l'operatrice deve scrivere nella descrizione della riga in Impresa. */
export function testoRigaCampagna(c: Pick<CampagnaCtrl, "codice" | "nome">): string {
  return `INVIO DOCUMENTAZIONE ${c.codice} ${c.nome}`;
}

// ─── Attribuzione di una riga a una campagna ───────────────────────────────
export type Attribuzione = "si" | "altra" | "neutra" | "no";

const haParole = (testo: string, c: CampagnaCtrl) =>
  c.testo_riconoscimento.some((p) => {
    const parola = normTesto(p);
    return parola !== "" && testo.includes(parola);
  });

/**
 * La riga appartiene a questa campagna?
 *   no      articolo diverso
 *   si      articolo uguale e (articolo dedicato, oppure il testo nomina la campagna)
 *   altra   articolo condiviso e il testo nomina un'ALTRA campagna
 *   neutra  articolo condiviso e il testo non nomina nessuna campagna
 */
export function attribuzioneRiga(
  riga: { articolo: string; descrizione: string | null },
  campagna: CampagnaCtrl,
  tutte: CampagnaCtrl[]
): Attribuzione {
  if (riga.articolo !== campagna.articolo_codice) return "no";
  if (campagna.testo_riconoscimento.length === 0) return "si";
  const testo = normTesto(riga.descrizione);
  if (haParole(testo, campagna)) return "si";
  const altre = tutte.some(
    (c) => c.id !== campagna.id && c.articolo_codice === campagna.articolo_codice && haParole(testo, c)
  );
  return altre ? "altra" : "neutra";
}

/** Le campagne che il testo nomina, fra quelle che usano quell'articolo. */
export function campagneNominate(
  riga: { articolo: string; descrizione: string | null },
  tutte: CampagnaCtrl[]
): CampagnaCtrl[] {
  return tutte.filter((c) => attribuzioneRiga(riga, c, tutte) === "si");
}

const dataConsegnaRiga = (r: RigaImpresa) => r.confermata ?? r.richiesta ?? null;
const numeroOrd = (n: string) => Number.parseInt(normNumero(n), 10) || 0;

// ─── Abbinamento riga evasa → DDT ──────────────────────────────────────────
/**
 * Abbina ogni riga evasa al DDT dello stesso cliente e dello stesso articolo.
 * Si scorrono le righe per data di consegna (confermata, altrimenti richiesta,
 * altrimenti data dell'ordine) e ognuna prende il DDT piu' vecchio non ancora
 * usato che non preceda il suo ordine. Fra i candidati si preferisce quello la
 * cui descrizione nomina la stessa campagna: una preferenza e non un vincolo,
 * perche' imporlo bloccava un abbinamento giusto su 425.
 */
export function abbinaDdt(
  righeEvase: RigaImpresa[],
  ddt: DdtImpresa[],
  campagne: CampagnaCtrl[]
): Map<string, DdtImpresa> {
  const esito = new Map<string, DdtImpresa>();
  const clienti = new Set(righeEvase.map((r) => r.cliente));

  for (const cliente of clienti) {
    const righe = righeEvase
      .filter((r) => r.cliente === cliente)
      .sort(
        (a, b) =>
          (dataConsegnaRiga(a) ?? a.data_doc).localeCompare(dataConsegnaRiga(b) ?? b.data_doc) ||
          numeroOrd(a.numero) - numeroOrd(b.numero)
      );
    const lista = ddt
      .filter((d) => d.cliente === cliente)
      .sort((a, b) => a.data_doc.localeCompare(b.data_doc) || numeroOrd(a.numero) - numeroOrd(b.numero));
    const usati = new Set<number>();

    for (const riga of righe) {
      const ammessi = lista
        .map((d, i) => ({ d, i }))
        .filter(({ d, i }) => !usati.has(i) && d.articolo === riga.articolo && d.data_doc >= riga.data_doc);
      if (ammessi.length === 0) continue;

      const nomiRiga = new Set(campagneNominate(riga, campagne).map((c) => c.id));
      const compatibile = ammessi.find(({ d }) => {
        const nomiDdt = campagneNominate(d, campagne).map((c) => c.id);
        return nomiRiga.size === 0 || nomiDdt.length === 0 || nomiDdt.some((id) => nomiRiga.has(id));
      });
      const scelto = compatibile ?? ammessi[0];
      usati.add(scelto.i);
      esito.set(chiaveRiga(riga), scelto.d);
    }
  }
  return esito;
}

// ─── Il controllo ──────────────────────────────────────────────────────────
export function eseguiControllo(input: InputControllo): RisultatoControllo {
  const { adesso, datiDel, campagne } = input;
  const perId = new Map(campagne.map((c) => [c.id, c]));
  const anomalie: AnomaliaCalcolata[] = [];
  const nuova = (a: AnomaliaCalcolata) => anomalie.push(a);

  const righePerOrdine = new Map<string, RigaImpresa[]>();
  for (const r of input.righe) {
    const k = chiaveOrdine(r.cliente, r.anno, r.numero);
    righePerOrdine.set(k, [...(righePerOrdine.get(k) ?? []), r]);
  }
  const testatePerOrdine = new Map<string, OrdineImpresa>();
  for (const o of input.ordini) testatePerOrdine.set(chiaveOrdine(o.cliente, o.anno, o.numero), o);

  // Gli ordini gia' legati a un invio: servono per l'adozione e per "documentazione senza busta".
  const occupati = new Set(
    input.ordiniCollegati
      .filter((o) => o.ordine_numero && o.ordine_anno !== null)
      .map((o) => chiaveOrdine(o.codice_cliente, o.ordine_anno, o.ordine_numero))
  );

  const abbinamenti = abbinaDdt(
    input.righe.filter((r) => !r.aperta),
    input.ddt,
    campagne
  );

  // Gli invii sono lavorati su una copia: l'adozione e le mosse li cambiano.
  const lavoro = input.invii.map((i) => ({ ...i }));
  const adottati = new Set<string>();

  // 1) ADOZIONE — una busta importata dall'Excel (la "X") non ha numero d'ordine.
  //    Se in Impresa c'e' UNA SOLA riga aperta di quella campagna per quel cliente
  //    non ancora legata ad altro, e' la sua.
  for (const invio of lavoro) {
    if (invio.ordine_numero) continue;
    const campagna = perId.get(invio.campagna_id);
    if (!campagna) continue;
    const candidate = input.righeAperte.filter(
      (r) =>
        r.cliente === invio.codice_cliente &&
        attribuzioneRiga(r, campagna, campagne) === "si" &&
        !occupati.has(chiaveOrdine(r.cliente, r.anno, r.numero))
    );
    if (candidate.length === 1) {
      const r = candidate[0];
      invio.ordine_numero = normNumero(r.numero);
      invio.ordine_anno = r.anno;
      invio.ordine_profilo = r.profilo;
      occupati.add(chiaveOrdine(r.cliente, r.anno, r.numero));
      adottati.add(invio.id);
    }
  }

  // 2) UN INVIO ALLA VOLTA CONTRO I DATI DI IMPRESA
  const aggiornamenti: RisultatoControllo["aggiornamenti"] = [];
  const stato = new Map<string, InvioCtrl["stato"] | "consegnata">();
  const rif = new Map<string, RiferimentoOrdine>();

  for (const invio of lavoro) {
    const campagna = perId.get(invio.campagna_id);
    const originale = input.invii.find((i) => i.id === invio.id)!;
    const patch: PatchInvio = { controllo_esito: "attesa_dati", ultimo_controllo_il: adesso };
    if (adottati.has(invio.id)) {
      patch.ordine_numero = invio.ordine_numero!;
      patch.ordine_anno = invio.ordine_anno!;
      patch.ordine_profilo = invio.ordine_profilo;
    }
    let nuovoStato: InvioCtrl["stato"] | "consegnata" = invio.stato;

    if (!campagna || !invio.ordine_numero || invio.ordine_anno === null) {
      // Nessun ordine da cercare (busta importata senza riga ancora in Impresa).
      stato.set(invio.id, nuovoStato);
      aggiornamenti.push({ id: invio.id, patch, cambiaStato: false, adottato: adottati.has(invio.id) });
      continue;
    }

    const cliente = invio.codice_cliente;
    const k = chiaveOrdine(cliente, invio.ordine_anno, invio.ordine_numero);
    const testata = testatePerOrdine.get(k);
    const righeOrdine = righePerOrdine.get(k) ?? [];
    // Un invio piu' recente dei dati non e' in ritardo: il dato non c'e' ancora.
    const inAttesa = datiDel === null || new Date(invio.assegnata_il).getTime() > new Date(datiDel).getTime();

    const comune = {
      codice_cliente: cliente,
      ragione_sociale: invio.ragione_sociale,
      invio_id: invio.id,
      campagna_id: campagna.id,
      ordine_numero: normNumero(invio.ordine_numero),
      ordine_anno: invio.ordine_anno,
    };

    if (!testata && righeOrdine.length === 0) {
      if (!inAttesa) {
        patch.controllo_esito = "ordine_non_trovato";
        nuova({
          ...comune,
          chiave: `ordine_non_trovato|${invio.id}`,
          tipo: "ordine_non_trovato",
          gravita: "errore",
          dettaglio: { campagna_codice: campagna.codice, campagna_nome: campagna.nome },
        });
        if (nuovoStato === "da_spedire") nuovoStato = "preparata";
      }
    } else {
      const mie = righeOrdine
        .map((r) => ({ r, att: attribuzioneRiga(r, campagna, campagne) }))
        .filter((x) => x.att !== "no");
      const si = mie.find((x) => x.att === "si");
      const neutra = mie.find((x) => x.att === "neutra");
      const altra = mie.find((x) => x.att === "altra");
      const scelta = si?.r ?? neutra?.r ?? null;

      if (!scelta) {
        if (altra) {
          patch.controllo_esito = "campagna_incoerente";
          const nominate = campagneNominate(altra.r, campagne).map((c) => c.codice);
          nuova({
            ...comune,
            chiave: `campagna_incoerente|${invio.id}`,
            tipo: "campagna_incoerente",
            gravita: "errore",
            dettaglio: {
              campagna_codice: campagna.codice,
              campagna_nome: campagna.nome,
              descrizione_riga: altra.r.descrizione,
              campagne_nella_riga: nominate,
            },
          });
          if (nuovoStato === "da_spedire") nuovoStato = "preparata";
        } else if (!inAttesa) {
          patch.controllo_esito = "riga_mancante";
          nuova({
            ...comune,
            chiave: `riga_mancante|${invio.id}`,
            tipo: "riga_mancante",
            gravita: "errore",
            // Quanto serve al popup: cosa scrivere, dove, per chi.
            dettaglio: {
              articolo: campagna.articolo_codice,
              testo_riga: testoRigaCampagna(campagna),
              campagna_codice: campagna.codice,
              campagna_nome: campagna.nome,
              data_ordine: testata?.data_doc ?? null,
              profilo: testata?.profilo ?? null,
            },
          });
          if (nuovoStato === "da_spedire") nuovoStato = "preparata";
        }
      } else {
        if (!si) {
          // La riga c'e' ma non dice di quale campagna e': si procede, e si segnala.
          nuova({
            ...comune,
            chiave: `riga_senza_campagna|${invio.id}`,
            tipo: "riga_senza_campagna",
            gravita: "avviso",
            dettaglio: {
              campagna_codice: campagna.codice,
              testo_riga: testoRigaCampagna(campagna),
              descrizione_riga: scelta.descrizione,
            },
          });
        }
        const riferimento: RiferimentoOrdine = {
          ordine_numero: normNumero(scelta.numero),
          ordine_anno: scelta.anno,
          ordine_profilo: scelta.profilo,
          ordine_data: scelta.data_doc,
          ordine_data_consegna: dataConsegnaRiga(scelta),
        };
        rif.set(invio.id, riferimento);
        patch.ordine_profilo = scelta.profilo;
        patch.ordine_data = scelta.data_doc;
        patch.ordine_data_consegna = dataConsegnaRiga(scelta);
        if (!invio.riga_vista_il) patch.riga_vista_il = adesso;

        if (scelta.aperta) {
          patch.controllo_esito = "riga_trovata";
          nuovoStato = "da_spedire";
        } else {
          const ddt = abbinamenti.get(chiaveRiga(scelta));
          if (ddt) {
            patch.controllo_esito = "consegnata";
            patch.data_consegna = ddt.data_doc;
            patch.fonte_consegna = "ddt";
            patch.ddt_numero = ddt.numero;
            patch.ddt_metodo = "euristico";
            patch.consegna_registrata_il = adesso;
            nuovoStato = "consegnata";
          } else {
            patch.controllo_esito = "evasa_senza_ddt";
            nuovoStato = "da_spedire";
            nuova({
              ...comune,
              chiave: `evasa_senza_ddt|${invio.id}`,
              tipo: "evasa_senza_ddt",
              gravita: "errore",
              dettaglio: { campagna_codice: campagna.codice, data_consegna: dataConsegnaRiga(scelta) },
            });
          }
        }
      }
    }

    if (nuovoStato !== originale.stato) patch.stato = nuovoStato;
    stato.set(invio.id, nuovoStato);
    aggiornamenti.push({ id: invio.id, patch, cambiaStato: nuovoStato !== originale.stato, adottato: adottati.has(invio.id) });
  }

  // 3) DOCUMENTAZIONE SENZA BUSTA — una riga aperta che nessun invio spiega.
  const legati = new Set([
    ...occupati,
    ...lavoro.filter((i) => i.ordine_numero && i.ordine_anno !== null).map((i) => chiaveOrdine(i.codice_cliente, i.ordine_anno, i.ordine_numero)),
  ]);
  for (const r of input.righeAperte) {
    const k = chiaveOrdine(r.cliente, r.anno, r.numero);
    if (legati.has(k)) continue;
    const nominate = campagneNominate(r, campagne);
    const campagna = nominate.length === 1 ? nominate[0] : null;
    nuova({
      chiave: `documentazione_senza_busta|${k}`,
      tipo: "documentazione_senza_busta",
      gravita: "errore",
      codice_cliente: r.cliente,
      ragione_sociale: r.nome_cliente,
      invio_id: null,
      campagna_id: campagna?.id ?? null,
      ordine_numero: normNumero(r.numero),
      ordine_anno: r.anno,
      dettaglio: {
        profilo: r.profilo,
        data_ordine: r.data_doc,
        data_consegna: dataConsegnaRiga(r),
        descrizione_riga: r.descrizione,
        campagna_codice: campagna?.codice ?? null,
      },
    });
  }

  // 4) INVERSIONE — per ogni cliente le campagne devono partire nell'ordine delle
  //    campagne: la piu' vecchia con la data di consegna piu' vicina.
  const perCliente = new Map<string, InvioCtrl[]>();
  for (const i of lavoro) {
    const s = stato.get(i.id);
    if ((s === "preparata" || s === "da_spedire") && rif.has(i.id) && rif.get(i.id)!.ordine_data_consegna) {
      perCliente.set(i.codice_cliente, [...(perCliente.get(i.codice_cliente) ?? []), i]);
    }
  }
  for (const [cliente, lista] of perCliente) {
    if (lista.length < 2) continue;
    const perCampagna = [...lista].sort(
      (a, b) => (perId.get(a.campagna_id)?.ordine ?? 0) - (perId.get(b.campagna_id)?.ordine ?? 0)
    );
    const ordiniPerData = perCampagna
      .map((i) => ({ invio: i, r: rif.get(i.id)! }))
      .sort((a, b) => a.r.ordine_data_consegna!.localeCompare(b.r.ordine_data_consegna!) || numeroOrd(a.r.ordine_numero) - numeroOrd(b.r.ordine_numero));

    const mosse: MossaScambio[] = [];
    perCampagna.forEach((invio, k) => {
      const attuale = rif.get(invio.id)!;
      const destinazione = ordiniPerData[k].r;
      // Si confrontano le DATE: due ordini che partono lo stesso giorno non sono invertiti.
      if (attuale.ordine_data_consegna !== destinazione.ordine_data_consegna) {
        const c = perId.get(invio.campagna_id)!;
        mosse.push({ invio_id: invio.id, campagna_codice: c.codice, campagna_nome: c.nome, da: attuale, a: destinazione });
      }
    });
    if (mosse.length >= 2) {
      nuova({
        chiave: `ordine_invertito|${cliente}`,
        tipo: "ordine_invertito",
        gravita: "errore",
        codice_cliente: cliente,
        ragione_sociale: perCampagna[0].ragione_sociale,
        invio_id: null,
        campagna_id: null,
        ordine_numero: null,
        ordine_anno: null,
        dettaglio: { mosse },
      });
    }
  }

  return { aggiornamenti, anomalie };
}
