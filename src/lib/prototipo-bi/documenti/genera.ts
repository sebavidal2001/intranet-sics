/**
 *
 * Produzione di documenti: l'analista non risponde solo a schermo, consegna
 * file. Usa le librerie già presenti nel progetto (xlsx, docx) — nessuna
 * dipendenza nuova.
 */

import * as XLSX from "xlsx";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { CATALOGO, DIMENSIONI, esegui, formattaEuro } from "../semantico";
import type {
  Briefing,
  ConfigurazioneAnno,
  DistribuzioneBudget,
  RisultatoQuery,
  Snapshot,
  SpecQuery,
} from "../tipi";

const INTESTAZIONE_DOCUMENTO =
  "Documento generato dal BI Direzionale SICS";

// ─────────────────────────────────────────────────────────────────────────────
// Excel
// ─────────────────────────────────────────────────────────────────────────────

function foglioDaRisultato(res: RisultatoQuery, titolo: string) {
  const chiavi = res.righe[0] ? Object.keys(res.righe[0].chiavi) : [];
  const righe = res.righe.map((r) => {
    const base: Record<string, string | number> = {};
    for (const k of chiavi) base[k] = r.chiavi[k] ?? "";
    if (chiavi.length === 0) base["Voce"] = r.etichetta;
    base[res.unita === "euro" ? "Valore (€)" : "Valore"] = r.valore;
    base["Righe"] = r.conteggio;
    return base;
  });
  const ws = XLSX.utils.json_to_sheet(righe);
  ws["!cols"] = [{ wch: 42 }, { wch: 18 }, { wch: 14 }, { wch: 10 }];
  void titolo;
  return ws;
}

/** Esporta una o più query certificate in un unico Excel. */
export function esportaQueryExcel(
  blocchi: { titolo: string; spec: SpecQuery }[],
  snapshot: Snapshot
): Buffer {
  const wb = XLSX.utils.book_new();

  const copertina = XLSX.utils.aoa_to_sheet([
    [INTESTAZIONE_DOCUMENTO],
    [],
    ["Generato il", new Date().toLocaleString("it-IT")],
    ["Dati aggiornati al", snapshot.dataMassima ?? "n/d"],
    ["Run pubblicato", snapshot.runCorrente ?? "n/d"],
    ["Ricevuto il", snapshot.runRicevutoIl ?? "n/d"],
    [],
    ["Fogli inclusi"],
    ...blocchi.map((b) => [b.titolo]),
  ]);
  copertina["!cols"] = [{ wch: 30 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, copertina, "Informazioni");

  const usati = new Set<string>();
  for (const b of blocchi) {
    const res = esegui(b.spec, snapshot);
    // I nomi foglio Excel: max 31 caratteri, niente caratteri speciali.
    let nome = b.titolo.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Foglio";
    let i = 2;
    while (usati.has(nome)) nome = `${nome.slice(0, 28)} ${i++}`;
    usati.add(nome);
    XLSX.utils.book_append_sheet(wb, foglioDaRisultato(res, b.titolo), nome);
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Esporta tabelle già calcolate (incluse query SQL esplorative) in Excel. */
export function esportaTabelleExcel(
  blocchi: { titolo: string; righe: Record<string, unknown>[]; natura: string }[],
  snapshot: Snapshot
): Buffer {
  const wb = XLSX.utils.book_new();
  const copertina = XLSX.utils.aoa_to_sheet([
    [INTESTAZIONE_DOCUMENTO],
    [],
    ["Generato il", new Date().toLocaleString("it-IT")],
    ["Dati commerciali aggiornati al", snapshot.dataMassima ?? "n/d"],
    ["Run pubblicato", snapshot.runCorrente ?? "n/d"],
    [],
    ["Foglio", "Natura"],
    ...blocchi.map((b) => [b.titolo, b.natura]),
  ]);
  copertina["!cols"] = [{ wch: 38 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(wb, copertina, "Informazioni");

  const usati = new Set<string>();
  for (const b of blocchi) {
    const ws = XLSX.utils.json_to_sheet(b.righe.length ? b.righe : [{ Esito: "Nessuna riga" }]);
    ws["!cols"] = Object.keys(b.righe[0] ?? { Esito: "" }).map(() => ({ wch: 22 }));
    let nome = b.titolo.replace(/[\/?*[\]:]/g, " ").slice(0, 31) || "Foglio";
    let i = 2;
    while (usati.has(nome)) nome = `${nome.slice(0, 28)} ${i++}`;
    usati.add(nome);
    XLSX.utils.book_append_sheet(wb, ws, nome);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Esporta la distribuzione budget/BEP: sostituisce i tre Excel manuali. */
export function esportaBudgetExcel(
  config: ConfigurazioneAnno,
  d: DistribuzioneBudget
): Buffer {
  const wb = XLSX.utils.book_new();

  const riepilogo = XLSX.utils.aoa_to_sheet([
    [INTESTAZIONE_DOCUMENTO],
    [],
    ["Anno", config.anno],
    ["Budget annuo (€)", config.budgetAnnuo],
    ["BEP annuo (€)", config.bepAnnuo],
    ["Modalità", config.modalita === "giorni_lavorativi" ? "Per giorni lavorativi" : "Lineare per mese"],
    ["Giorni lavorativi", d.giorniLavorativi],
    ["Budget giornaliero (€)", d.budgetGiornaliero],
    ["BEP giornaliero (€)", d.bepGiornaliero],
    [],
    ["Chiusure aziendali"],
    ["Dal", "Al", "Descrizione"],
    ...config.chiusure.map((c) => [c.dal, c.al, c.descrizione]),
    [],
    ["Incidenza business unit"],
    ["Business unit", "Peso %", "Budget annuo (€)"],
    ...config.incidenzeBU.map((i) => [
      i.bu,
      i.pesoPct,
      Math.round((config.budgetAnnuo * i.pesoPct) / 100),
    ]),
  ]);
  riepilogo["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 34 }];
  XLSX.utils.book_append_sheet(wb, riepilogo, "Riepilogo");

  const giornaliero = XLSX.utils.json_to_sheet(
    d.giorni.map((g) => ({
      Data: g.data,
      Anno: g.anno,
      Mese: g.mese,
      AnnoSettimana: g.settimanaIso,
      Lavorativo: g.lavorativo ? "SI" : "NO",
      Budget: g.budget,
      BEP: g.bep,
    }))
  );
  XLSX.utils.book_append_sheet(wb, giornaliero, "Budget BEP Giornaliero");

  if (d.perBU.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        d.perBU.map((r) => ({ Data: r.data, Area: r.chiave, Budget: r.budget, BEP: r.bep }))
      ),
      "Per business unit"
    );
  }

  if (d.perAgente.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        d.perAgente.map((r) => ({ Data: r.data, Agente: r.chiave, Budget: r.budget, BEP: r.bep }))
      ),
      "Per commerciale"
    );
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Word
// ─────────────────────────────────────────────────────────────────────────────

function p(testo: string, opzioni: { grassetto?: boolean; size?: number; colore?: string } = {}) {
  return new Paragraph({
    children: [
      new TextRun({
        text: testo,
        bold: opzioni.grassetto,
        size: opzioni.size ?? 22,
        color: opzioni.colore,
        font: "Calibri",
      }),
    ],
    spacing: { after: 120 },
  });
}

function tabella(intestazioni: string[], righe: (string | number)[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: intestazioni.map(
          (h) =>
            new TableCell({
              children: [p(h, { grassetto: true, size: 20 })],
              shading: { fill: "E2E8F0" },
            })
        ),
      }),
      ...righe.map(
        (r) =>
          new TableRow({
            children: r.map(
              (c) => new TableCell({ children: [p(String(c), { size: 20 })] })
            ),
          })
      ),
    ],
  });
}

const NOME_MODIFICATORE: Record<string, string> = {
  corrente: "periodo richiesto",
  anno_precedente: "stesso periodo dell'anno precedente",
  progressivo: "progressivo da inizio anno",
  progressivo_ap: "progressivo da inizio anno precedente",
};

/** Prima colonna: dice per cosa sono spaccate le righe. */
function etichettaDimensione(spec: SpecQuery): string {
  const parti: string[] = [];
  if (spec.granularita) parti.push(spec.granularita.charAt(0).toUpperCase() + spec.granularita.slice(1));
  for (const d of spec.raggruppa ?? []) parti.push(DIMENSIONI[d]?.etichetta ?? d);
  return parti.join(" · ") || "Voce";
}

/**
 * Seconda colonna: il nome della metrica certificata, non un generico
 * "Valore". Quattro tabelle intitolate diversamente ma tutte con la colonna
 * "Ordinato (EUR)" si smascherano da sole.
 */
function intestazioneValore(spec: SpecQuery, res: RisultatoQuery): string {
  const nome = CATALOGO[spec.metrica]?.etichetta ?? spec.metrica;
  const unita =
    res.unita === "euro" ? " (€)" : res.unita === "percentuale" ? " (%)" : res.unita === "giorni" ? " (gg)" : "";
  const mod = spec.modificatore ?? "corrente";
  const coda = mod === "corrente" ? "" : ` — ${NOME_MODIFICATORE[mod] ?? mod}`;
  return `${nome}${unita}${coda}`;
}

/** Riga di provenienza sotto la tabella: metrica, periodo, filtri. */
function provenienzaSpec(spec: SpecQuery): string {
  const parti = [`Metrica certificata: ${CATALOGO[spec.metrica]?.etichetta ?? spec.metrica}`];
  const p = spec.periodo ?? {};
  if (p.anno) parti.push(`anno ${p.anno}`);
  else if (p.dal || p.al) parti.push(`dal ${p.dal ?? "inizio"} al ${p.al ?? "ultimo dato"}`);
  const filtri = (spec.filtri ?? []).map(
    (f) => `${f.campo} ${f.op} ${Array.isArray(f.valore) ? f.valore.join("/") : f.valore}`
  );
  if (filtri.length > 0) parti.push(`filtri: ${filtri.join("; ")}`);
  return `${parti.join(" · ")}.`;
}

/** Valore formattato secondo l'unita' della metrica. */
function formattaValore(valore: number, unita: RisultatoQuery["unita"]): string {
  if (unita === "euro") return formattaEuro(valore);
  if (unita === "percentuale") return `${valore.toFixed(1)}%`;
  if (unita === "giorni") return `${valore} gg`;
  return String(valore);
}

/**
 * Due blocchi finiscono nella stessa tabella solo se hanno la STESSA forma:
 * stessa granularita', stesse dimensioni, stesso periodo e **stessi filtri**.
 *
 * I filtri nella chiave non sono un dettaglio. «Ordinato BU SISTEMI per mese» e
 * «Ordinato BU COSTRUITO per mese» hanno la stessa forma ma non sono
 * confrontabili riga per riga: affiancarli darebbe due colonne intitolate
 * entrambe "Ordinato (€)" con dentro due cose diverse. Restano separati.
 *
 * Con i filtri nella chiave, invece, i blocchi di un gruppo differiscono solo
 * per metrica o modificatore — ed e' esattamente cio' che `intestazioneValore()`
 * sa gia' distinguere nell'intestazione di colonna.
 */
function chiaveForma(spec: SpecQuery): string {
  const p = spec.periodo ?? {};
  const filtri = (spec.filtri ?? [])
    .map((f) => `${f.campo}|${f.op}|${Array.isArray(f.valore) ? [...f.valore].sort().join(",") : f.valore}`)
    .sort()
    .join("&");
  return [
    spec.granularita ?? "",
    (spec.raggruppa ?? []).join(","),
    p.anno ?? "",
    p.dal ?? "",
    p.al ?? "",
    filtri,
  ].join("#");
}

interface BloccoCalcolato {
  titolo: string;
  spec: SpecQuery;
  res: RisultatoQuery;
}

/**
 * Raggruppa mantenendo l'ordine in cui l'analista ha chiesto i blocchi: il
 * gruppo prende la posizione del suo primo membro. Un documento che chiede
 * ordinato, fatturato, BEP e budget per mese esce come UNA tabella di quattro
 * colonne, che e' cio' che il titolo «Ordinato vs BEP e Budget» prometteva e
 * che quattro tabelle separate non davano.
 */
function raggruppaPerForma(blocchi: BloccoCalcolato[]): BloccoCalcolato[][] {
  const gruppi = new Map<string, BloccoCalcolato[]>();
  const ordine: string[] = [];

  for (const b of blocchi) {
    // Senza granularita' ne' raggruppamento la "tabella" e' un numero solo:
    // accostarne diversi in colonna non aiuta, e la riga unica ha etichette
    // che non combaciano. Ognuno per conto suo.
    const unico = !b.spec.granularita && (b.spec.raggruppa ?? []).length === 0;
    const k = unico ? `solo:${ordine.length}` : chiaveForma(b.spec);
    if (!gruppi.has(k)) {
      gruppi.set(k, []);
      ordine.push(k);
    }
    const gruppo = gruppi.get(k)!;
    // Stessa metrica e stesso modificatore due volte: sarebbe una colonna
    // duplicata. Si tiene la prima.
    const gia = gruppo.some(
      (g) =>
        g.spec.metrica === b.spec.metrica &&
        (g.spec.modificatore ?? "corrente") === (b.spec.modificatore ?? "corrente")
    );
    if (!gia) gruppo.push(b);
  }

  return ordine.map((k) => gruppi.get(k)!).filter((g) => g.length > 0);
}

/** Titolo di un gruppo: quello del blocco se e' solo, altrimenti composto. */
function titoloGruppo(gruppo: BloccoCalcolato[]): string {
  if (gruppo.length === 1) return gruppo[0].titolo;
  const nomi = gruppo.map((g) => CATALOGO[g.spec.metrica]?.etichetta ?? g.spec.metrica);
  const ultimo = nomi.pop();
  const elenco = nomi.length > 0 ? `${nomi.join(", ")} e ${ultimo}` : (ultimo ?? "");
  const per = etichettaDimensione(gruppo[0].spec);
  return `${elenco} per ${per.toLowerCase()}`;
}

/** Report direzionale in Word a partire dal briefing e da query certificate. */
export async function generaReportWord(opzioni: {
  briefing: Briefing;
  snapshot: Snapshot;
  approfondimenti?: { titolo: string; spec: SpecQuery }[];
  approfondimentiSql?: { titolo: string; righe: Record<string, unknown>[] }[];
  commento?: string | null;
}): Promise<Buffer> {
  const { briefing, snapshot } = opzioni;

  const figli: (Paragraph | Table)[] = [
    new Paragraph({
      children: [
        new TextRun({
          text: INTESTAZIONE_DOCUMENTO,
          bold: true,
          size: 16,
          color: "B91C1C",
          font: "Calibri",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
    new Paragraph({
      text: "Briefing direzionale",
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    }),
    p(
      `Destinatario: ${briefing.destinatario} · Dati aggiornati al ${briefing.dataRiferimento}` +
        (briefing.runRicevutoIl
          ? ` · Caricamento del ${new Date(briefing.runRicevutoIl).toLocaleString("it-IT")}`
          : ""),
      { size: 18, colore: "64748B" }
    ),
    p(
      `Segnali valutati: ${briefing.segnaliValutati} · selezionati: ${briefing.voci.length} · ` +
        `redazione: ${briefing.motoreAI === "openrouter" ? "assistita" : "deterministica"}`,
      { size: 18, colore: "64748B" }
    ),
  ];

  if (briefing.voci.length === 0) {
    figli.push(p("Nessun segnale rilevante nel periodo. Il silenzio è un risultato valido."));
  }

  for (const v of briefing.voci) {
    figli.push(
      new Paragraph({
        text: `${v.ordine}. ${v.famiglia.replace(/_/g, " ")}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 80 },
      })
    );
    figli.push(p(v.testo));
    if (v.azioneSuggerita) {
      figli.push(p(`Azione suggerita: ${v.azioneSuggerita}`, { grassetto: true }));
    }
    if (v.prove.length > 0) {
      figli.push(
        p(
          `Verificabile con: ${v.prove.map((pr) => pr.descrizione).join("; ")}`,
          { size: 18, colore: "64748B" }
        )
      );
    }
  }

  if (opzioni.commento) {
    figli.push(
      new Paragraph({ text: "Commento", heading: HeadingLevel.HEADING_2, spacing: { before: 240 } })
    );
    for (const riga of opzioni.commento.split("\n").filter(Boolean)) figli.push(p(riga));
  }

  const calcolati: BloccoCalcolato[] = (opzioni.approfondimenti ?? []).map((a) => ({
    titolo: a.titolo,
    spec: a.spec,
    res: esegui(a.spec, snapshot),
  }));

  for (const gruppo of raggruppaPerForma(calcolati)) {
    figli.push(
      new Paragraph({
        text: titoloGruppo(gruppo),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
      })
    );

    // Le righe sono l'unione delle etichette di tutti i blocchi del gruppo: un
    // mese presente nell'ordinato ma non nel budget deve comparire lo stesso,
    // con la cella vuota. Saltarlo disallineerebbe il confronto in silenzio.
    const etichette: string[] = [];
    const viste = new Set<string>();
    for (const b of gruppo) {
      for (const r of b.res.righe) {
        if (viste.has(r.etichetta)) continue;
        viste.add(r.etichetta);
        etichette.push(r.etichetta);
      }
    }
    // Con una granularita' temporale l'ordine cronologico e' l'unico leggibile.
    if (gruppo[0].spec.granularita) etichette.sort((x, y) => x.localeCompare(y));

    const mostrate = etichette.slice(0, 20);
    const valori = gruppo.map((b) => new Map(b.res.righe.map((r) => [r.etichetta, r.valore])));

    // Il titolo del blocco lo scrive l'analista, la colonna no: porta il nome
    // della metrica davvero calcolata. Se il titolo promette un confronto che
    // la tabella non contiene, il lettore se ne accorge dall'intestazione
    // invece di credere al titolo.
    figli.push(
      tabella(
        [etichettaDimensione(gruppo[0].spec), ...gruppo.map((b) => intestazioneValore(b.spec, b.res))],
        mostrate.map((et) => [
          et,
          ...gruppo.map((b, i) => {
            const v = valori[i].get(et);
            return v === undefined ? "—" : formattaValore(v, b.res.unita);
          }),
        ])
      )
    );

    if (etichette.length > mostrate.length) {
      figli.push(
        p(`Mostrate 20 voci su ${etichette.length}.`, { size: 18, colore: "64748B" })
      );
    }

    figli.push(
      p(
        `Totale: ${gruppo
          .map((b) => `${CATALOGO[b.spec.metrica]?.etichetta ?? b.spec.metrica} ${formattaValore(b.res.totale, b.res.unita)}`)
          .join(" · ")}`,
        { grassetto: true }
      )
    );

    for (const b of gruppo) {
      figli.push(p(provenienzaSpec(b.spec), { size: 16, colore: "64748B" }));
      for (const avviso of b.res.avvisi ?? []) {
        const nome = CATALOGO[b.spec.metrica]?.etichetta ?? b.spec.metrica;
        figli.push(p(`Avvertenza (${nome}): ${avviso}`, { size: 18, colore: "B45309" }));
      }
      if (b.res.righe.length === 0) {
        const nome = CATALOGO[b.spec.metrica]?.etichetta ?? b.spec.metrica;
        figli.push(
          p(`Nessun dato per "${nome}" nel periodo richiesto.`, { size: 18, colore: "B45309" })
        );
      }
    }
  }

  for (const a of opzioni.approfondimentiSql ?? []) {
    const intestazioni = Object.keys(a.righe[0] ?? {}).slice(0, 8);
    figli.push(
      new Paragraph({ text: a.titolo, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })
    );
    if (intestazioni.length === 0) {
      figli.push(p("La query non ha restituito righe."));
    } else {
      figli.push(
        tabella(
          intestazioni,
          a.righe.slice(0, 20).map((r) => intestazioni.map((h) => String(r[h] ?? "").slice(0, 90)))
        )
      );
      if (a.righe.length > 20) figli.push(p(`Mostrate 20 righe su ${a.righe.length}.`, { size: 18, colore: "64748B" }));
    }
    figli.push(p("Fonte: SQL esplorativo di sola lettura sulle viste BI autorizzate.", { size: 18, colore: "B45309" }));
  }

  figli.push(
    p(
      "Le metriche certificate e le eventuali query SQL esplorative sono indicate separatamente " +
        "e rieseguibili. Il documento è prodotto da un prototipo non ancora in produzione.",
      { size: 16, colore: "64748B" }
    )
  );

  const doc = new Document({ sections: [{ children: figli }] });
  return Packer.toBuffer(doc);
}
