"use client";

/**
 *
 * Vista "Conversione": che fine fanno i preventivi, e da quanto sono fermi.
 *
 * ⚠️ Due note sul dato, gestite dal database ma utili a chi legge:
 *  · Nel gestionale la colonna `importo_evaso` contiene il valore TOTALE della
 *    riga, non l'evaso. Il convertito è `valore totale − inevaso`, ed è la
 *    vista `bi_preventivi_backoffice` a calcolarlo.
 *  · Le business unit sono già riconciliate con ordinato e budget: SISTEMI è
 *    spezzata in COSTRUITO e STRUTTURE secondo la categoria.
 */

import { useMemo, useState } from "react";
import { GraficoTorta, KpiEroe, Scheda, useQueryBi } from "./primitivi";
import { BarreScostamento, Heatmap, Pareto } from "./grafici-avanzati";
import { Anelli, Composizione, Imbuto } from "./grafici-spettacolari";
import { TabellaAnalitica, type ColonnaAnalitica, type RigaAnalitica } from "./tabella-analitica";
import { PannelloDettaglio, type RichiestaPannello } from "./dettaglio-documenti";
import type { Dimensione, Periodo, SpecQuery, Filtro } from "@/lib/prototipo-bi/tipi";

const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/** Fasce di anzianità, nell'ordine in cui vanno lette. */
const ORDINE_FASCE = [
  "0-30 giorni",
  "31-60 giorni",
  "61-90 giorni",
  "91-180 giorni",
  "6-12 mesi",
  "oltre 1 anno",
];

export function VistaConversione({
  anno,
  periodo,
  filtriSpec,
  alternaFiltro,
  filtroDi,
}: {
  anno: number;
  periodo: Periodo;
  filtriSpec: Filtro[];
  alternaFiltro: (campo: Dimensione, valore: string) => void;
  filtroDi: (campo: Dimensione) => string | null;
}) {
  const [dettaglio, setDettaglio] = useState<RichiestaPannello | null>(null);

  const apriDettaglio = (campo: Dimensione, valore: string) =>
    setDettaglio({
      dataset: "preventivi_aperti",
      titolo: valore,
      filtri: [...filtriSpec.filter((f) => f.campo !== campo), { campo, op: "eq", valore }],
      periodo,
    });

  const specs = useMemo<Record<string, SpecQuery | null>>(() => {
    const base = { filtri: filtriSpec, periodo };
    // L'anzianità riguarda i preventivi ancora aperti oggi, non quelli emessi
    // in un certo periodo: le metriche di età ignorano quindi il filtro anno.
    const senzaPeriodo = { filtri: filtriSpec };
    return {
      valore: { metrica: "preventivi_valore", ...base },
      convertito: { metrica: "preventivi_convertito", ...base },
      aperto: { metrica: "preventivi_aperti", ...base },
      tasso: { metrica: "tasso_conversione", ...base },
      nPrev: { metrica: "preventivi_creati", ...base },
      medio: { metrica: "valore_medio_preventivo", ...base },

      esito: { metrica: "preventivi_valore", raggruppa: ["esito"], ...base, ordina: "valore_desc" },
      tassoBu: { metrica: "tasso_conversione", raggruppa: ["bu"], ...base, ordina: "valore_desc" },
      tassoAgente: { metrica: "tasso_conversione", raggruppa: ["agente"], ...base, ordina: "valore_desc" },
      tassoCreatore: { metrica: "tasso_conversione", raggruppa: ["creatore"], ...base, ordina: "valore_desc" },
      valoreBu: { metrica: "preventivi_valore", raggruppa: ["bu"], ...base, ordina: "valore_desc" },
      valoreCliente: { metrica: "preventivi_valore", raggruppa: ["cliente"], ...base, ordina: "valore_desc", limite: 200 },
      convertitoCliente: { metrica: "preventivi_convertito", raggruppa: ["cliente"], ...base, ordina: "valore_desc", limite: 200 },
      tassoCliente: { metrica: "tasso_conversione", raggruppa: ["cliente"], ...base, ordina: "valore_desc", limite: 200 },
      tassoBuMese: { metrica: "tasso_conversione", granularita: "mese", raggruppa: ["bu"], ...base, ordina: "etichetta" },
      valoreMese: { metrica: "preventivi_valore", granularita: "mese", ...base, ordina: "etichetta" },

      // ── Anzianità del portafoglio preventivi ───────────────────────────
      etaMedia: { metrica: "giorni_apertura", ...senzaPeriodo },
      etaMassima: { metrica: "eta_massima_apertura", ...senzaPeriodo },
      oltre90: { metrica: "preventivi_aperti_oltre_90", ...senzaPeriodo },
      apertoTot: { metrica: "preventivi_aperti", ...senzaPeriodo },
      inevasoPerFascia: { metrica: "preventivi_aperti", raggruppa: ["fascia_eta"], ...senzaPeriodo },
      etaPerBu: { metrica: "giorni_apertura", raggruppa: ["bu"], ...senzaPeriodo, ordina: "valore_desc" },
      etaPerAgente: { metrica: "giorni_apertura", raggruppa: ["agente"], ...senzaPeriodo, ordina: "valore_desc" },
      inevasoPerAgente: { metrica: "preventivi_aperti", raggruppa: ["agente"], ...senzaPeriodo, ordina: "valore_desc" },
      oltre90PerAgente: { metrica: "preventivi_aperti_oltre_90", raggruppa: ["agente"], ...senzaPeriodo, ordina: "valore_desc" },
      etaFasciaBu: { metrica: "preventivi_aperti", raggruppa: ["bu", "fascia_eta"], ...senzaPeriodo },
    };
  }, [periodo, filtriSpec]);

  const { risultati, errori } = useQueryBi(specs);
  const r = (k: string) => risultati[k];
  const tot = (k: string) => risultati[k]?.totale ?? 0;

  const fasiImbuto = useMemo(
    () => [
      { etichetta: "Preventivato", valore: tot("valore") },
      {
        etichetta: "Convertito in ordine",
        valore: tot("convertito"),
        nota: `${tot("tasso").toFixed(1)}% del preventivato`,
      },
    ],
    [risultati] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const anelliBu = useMemo(
    () =>
      (r("tassoBu")?.righe ?? []).map((x) => ({
        etichetta: x.etichetta,
        percentuale: x.valore,
        nota: `${x.conteggio} righe`,
      })),
    [risultati] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Inevaso per fascia di anzianità, nell'ordine cronologico giusto. */
  const fasce = useMemo(() => {
    const s = r("inevasoPerFascia");
    if (!s) return [];
    return ORDINE_FASCE.map((f) => ({
      etichetta: f,
      valore: s.righe.find((x) => x.etichetta === f)?.valore ?? 0,
      righe: s.righe.find((x) => x.etichetta === f)?.conteggio ?? 0,
    })).filter((x) => x.valore > 0 || x.righe > 0);
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  const heatmap = useMemo(() => {
    const s = r("tassoBuMese");
    if (!s || s.righe.length === 0) return null;
    const bu = [...new Set(s.righe.map((x) => x.chiavi.bu).filter(Boolean))] as string[];
    const mesi = [...new Set(s.righe.map((x) => x.chiavi.periodo).filter(Boolean))].sort() as string[];
    const valori: Record<string, Record<string, number>> = {};
    for (const b of bu) {
      valori[b] = {};
      for (const m of mesi) {
        const riga = s.righe.find((x) => x.chiavi.bu === b && x.chiavi.periodo === m);
        valori[b][MESI_BREVI[Number(m.slice(5, 7)) - 1] ?? m] = riga?.valore ?? 0;
      }
    }
    return { righe: bu, colonne: mesi.map((m) => MESI_BREVI[Number(m.slice(5, 7)) - 1] ?? m), valori };
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Matrice anzianità × business unit: dove si è fermato l'inevaso. */
  const matriceEta = useMemo(() => {
    const s = r("etaFasciaBu");
    if (!s || s.righe.length === 0) return null;
    const bu = [...new Set(s.righe.map((x) => x.chiavi.bu).filter(Boolean))] as string[];
    const fasceViste = ORDINE_FASCE.filter((f) =>
      s.righe.some((x) => x.chiavi.fascia_eta === f)
    );
    if (bu.length === 0 || fasceViste.length === 0) return null;
    const valori: Record<string, Record<string, number>> = {};
    for (const b of bu) {
      valori[b] = {};
      for (const f of fasceViste) {
        valori[b][f] =
          s.righe.find((x) => x.chiavi.bu === b && x.chiavi.fascia_eta === f)?.valore ?? 0;
      }
    }
    return { righe: bu, colonne: fasceViste, valori };
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  const righeClienti = useMemo<RigaAnalitica[]>(() => {
    const val = r("valoreCliente");
    if (!val) return [];
    const conv = new Map((r("convertitoCliente")?.righe ?? []).map((x) => [x.etichetta, x.valore]));
    const tasso = new Map((r("tassoCliente")?.righe ?? []).map((x) => [x.etichetta, x.valore]));
    const totale = val.righe.reduce((s, x) => s + x.valore, 0);
    return val.righe.map((x) => ({
      chiave: x.etichetta,
      celle: {
        valore: x.valore,
        convertito: conv.get(x.etichetta) ?? 0,
        aperto: x.valore - (conv.get(x.etichetta) ?? 0),
        tasso: tasso.get(x.etichetta) ?? 0,
        quota: totale ? (x.valore / totale) * 100 : 0,
        righe: x.conteggio,
      },
    }));
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  const colonneClienti: ColonnaAnalitica[] = [
    { chiave: "valore", etichetta: "Preventivato", tipo: "barra", unita: "euro" },
    { chiave: "convertito", etichetta: "Convertito", tipo: "euro" },
    { chiave: "aperto", etichetta: "Ancora aperto", tipo: "euro" },
    {
      chiave: "tasso",
      etichetta: "Conversione",
      tipo: "raggiungimento",
      totale: { tipo: "rapporto", numeratore: "convertito", denominatore: "valore" },
    },
    { chiave: "quota", etichetta: "Quota", tipo: "percentuale" },
    { chiave: "righe", etichetta: "Righe", tipo: "numero", unita: "numero" },
  ];

  /** Agenti: inevaso fermo e quanto di quello è vecchio. */
  const righeAgenti = useMemo<RigaAnalitica[]>(() => {
    const inev = r("inevasoPerAgente");
    if (!inev) return [];
    const eta = new Map((r("etaPerAgente")?.righe ?? []).map((x) => [x.etichetta, x.valore]));
    const oltre = new Map((r("oltre90PerAgente")?.righe ?? []).map((x) => [x.etichetta, x.valore]));
    return inev.righe.map((x) => ({
      chiave: x.etichetta,
      celle: {
        inevaso: x.valore,
        oltre90: oltre.get(x.etichetta) ?? 0,
        quotaVecchia: x.valore > 0 ? ((oltre.get(x.etichetta) ?? 0) / x.valore) * 100 : 0,
        eta: eta.get(x.etichetta) ?? 0,
        righe: x.conteggio,
      },
    }));
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  const colonneAgenti: ColonnaAnalitica[] = [
    { chiave: "inevaso", etichetta: "Inevaso aperto", tipo: "barra", unita: "euro" },
    { chiave: "oltre90", etichetta: "Oltre 90 gg", tipo: "euro" },
    {
      chiave: "quotaVecchia",
      etichetta: "% vecchio",
      tipo: "raggiungimento",
      titolo: "Quota dell'inevaso che ha più di 90 giorni",
      totale: { tipo: "rapporto", numeratore: "oltre90", denominatore: "inevaso" },
    },
    {
      chiave: "eta",
      etichetta: "Età media",
      tipo: "numero",
      unita: "giorni",
      decimali: 0,
      totale: { tipo: "media_pesata", peso: "righe" },
    },
    { chiave: "righe", etichetta: "Righe", tipo: "numero", unita: "numero" },
  ];

  const quotaOltre90 = tot("apertoTot") > 0 ? (tot("oltre90") / tot("apertoTot")) * 100 : 0;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {errori._generale && (
          <div className="lg:col-span-3 p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">
            {errori._generale}
          </div>
        )}

        <Scheda
          titolo="Dal preventivo all'ordine"
          sottotitolo="la larghezza è proporzionale al valore: la perdita si vede nella forma"
          info="Confronta il valore totale preventivato con la parte già derivata in ordine. Attenzione: nel gestionale la colonna chiamata «importo evaso» contiene in realtà il valore totale della riga, quindi il convertito si ottiene per differenza dall'inevaso. Il conteggio comprende tutte le righe del periodo scelto, evase e non."
        >
          <Imbuto fasi={fasiImbuto} altezza={240} />
          <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-border">
            <KpiEroe etichetta="Tasso di conversione" valore={tot("tasso")} unita="percentuale" />
            <KpiEroe etichetta="Preventivi" valore={tot("nPrev")} unita="numero" />
          </div>
        </Scheda>

        <Scheda
          titolo="Conversione per business unit"
          sottotitolo="quota del preventivato diventata ordine"
          info="Ogni anello è il rapporto fra convertito e preventivato di una business unit, calcolato sui totali e non come media dei singoli preventivi. Cliccando un anello si filtra tutto il cruscotto su quella business unit."
        >
          <Anelli voci={anelliBu} onClick={(b) => alternaFiltro("bu", b)} />
          <div className="mt-4 pt-3 border-t border-border">
            <KpiEroe
              etichetta="Valore medio preventivo"
              valore={tot("medio")}
              nota={`${tot("nPrev")} documenti`}
            />
          </div>
        </Scheda>

        <Scheda
          titolo="Composizione per esito"
          sottotitolo="convertito, parziale, ancora aperto"
          info="«Convertito» sono le righe interamente derivate in ordine, «Aperto» quelle senza alcuna derivazione, «Parziale» quelle derivate solo in parte. Le percentuali sono sul valore, non sul numero di righe."
        >
          <GraficoTorta
            risultato={r("esito")}
            altezza={220}
            onClick={(e) => alternaFiltro("esito", e)}
            selezionata={filtroDi("esito")}
          />
          <div className="mt-2 pt-3 border-t border-border grid grid-cols-2 gap-3">
            <KpiEroe etichetta="Convertito" valore={tot("convertito")} />
            <KpiEroe etichetta="Ancora aperto" valore={tot("aperto")} />
          </div>
        </Scheda>

        {/* ── Anzianità ─────────────────────────────────────────────────── */}
        <Scheda
          titolo="Da quanto sono fermi"
          className="lg:col-span-2"
          sottotitolo="valore ancora inevaso, per anzianità del preventivo"
          info="Conta i giorni dalla data del documento all'ultimo giorno di dati, sulle sole righe che hanno ancora dell'inevaso: una riga già convertita non è «aperta da» nessun tempo. L'anzianità non risente del filtro anno, perché riguarda ciò che è aperto adesso. Cliccando una barra si vedono i documenti di quella fascia."
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <KpiEroe etichetta="Età media" valore={tot("etaMedia")} unita="giorni" />
            <KpiEroe etichetta="Il più vecchio" valore={tot("etaMassima")} unita="giorni" />
            <KpiEroe etichetta="Inevaso totale" valore={tot("apertoTot")} />
            <KpiEroe
              etichetta="Oltre 90 giorni"
              valore={tot("oltre90")}
              nota={`${quotaOltre90.toFixed(0)}% dell'inevaso`}
            />
          </div>
          <BarreScostamento
            dati={fasce.map((f) => ({ etichetta: f.etichetta, valore: f.valore }))}
            altezza={220}
            onClick={(f) => apriDettaglio("fascia_eta", f)}
          />
        </Scheda>

        <Scheda
          titolo="Età media per business unit"
          sottotitolo="giorni di attesa dell'inevaso"
          info="Media dei giorni di apertura delle righe ancora inevase, per business unit. Un valore alto segnala preventivi che restano in sospeso invece di chiudersi in un senso o nell'altro."
        >
          <BarreScostamento
            dati={(r("etaPerBu")?.righe ?? []).map((x) => ({
              etichetta: x.etichetta,
              valore: x.valore,
            }))}
            formato="percentuale"
            altezza={260}
            onClick={(b) => alternaFiltro("bu", b)}
          />
          <p className="mt-2 text-[11px] text-text-muted">I valori sono giorni.</p>
        </Scheda>

        {matriceEta && (
          <Scheda
            titolo="Dove si è fermato l'inevaso"
            className="lg:col-span-3"
            sottotitolo="valore aperto per business unit e fascia di anzianità — più intenso, più valore fermo"
            info="Incrocia business unit e anzianità: le colonne a destra sono i preventivi più vecchi. Una casella intensa in fondo a destra è valore che resta appeso da oltre un anno, cioè pipeline che difficilmente si chiude da sola. Cliccando una riga si filtra la business unit."
          >
            <Heatmap
              righe={matriceEta.righe}
              colonne={matriceEta.colonne}
              valori={matriceEta.valori}
              formato="euro"
              onClick={(bu) => alternaFiltro("bu", bu)}
            />
          </Scheda>
        )}

        <Scheda
          titolo="Agenti — inevaso fermo"
          className="lg:col-span-3"
          sottotitolo="quanto resta aperto e quanto di quello ha superato i 90 giorni"
          info="La colonna «% vecchio» è la parte dell'inevaso con più di 90 giorni: è il segnale più utile della tabella, perché distingue chi ha molta pipeline recente da chi ne ha molta ferma. L'età media del totale è pesata sul numero di righe. Cliccando una riga si aprono i documenti di quell'agente."
        >
          <TabellaAnalitica
            colonnaDimensione="Agente"
            colonne={colonneAgenti}
            righe={righeAgenti}
            colonnaOrdinamentoIniziale="oltre90"
            massimoIniziale={12}
            onClickRiga={(a) => apriDettaglio("agente", a)}
            rigaEvidenziata={filtroDi("agente")}
          />
        </Scheda>

        {/* ── Conversione ───────────────────────────────────────────────── */}
        <Scheda
          titolo="Conversione per agente"
          sottotitolo="chi trasforma di più il preventivato in ordini"
          info="Rapporto fra convertito e preventivato per agente, nel periodo scelto. Va letto insieme al valore assoluto: un tasso alto su pochi preventivi dice poco."
        >
          <BarreScostamento
            dati={(r("tassoAgente")?.righe ?? []).map((x) => ({
              etichetta: x.etichetta,
              valore: x.valore,
            }))}
            formato="percentuale"
            altezza={260}
            onClick={(a) => alternaFiltro("agente", a)}
          />
        </Scheda>

        <Scheda
          titolo="Conversione per addetto back office"
          sottotitolo="chi ha preparato il preventivo, non chi lo ha venduto"
          info="Stessa metrica raggruppata per chi ha materialmente creato il documento. Serve a distinguere il lavoro di preparazione da quello commerciale: un addetto che prepara soprattutto preventivi grandi e complessi avrà naturalmente una conversione più bassa."
        >
          <BarreScostamento
            dati={(r("tassoCreatore")?.righe ?? []).map((x) => ({
              etichetta: x.etichetta,
              valore: x.valore,
            }))}
            formato="percentuale"
            altezza={260}
            onClick={(c) => alternaFiltro("creatore", c)}
          />
        </Scheda>

        <Scheda
          titolo="Valore preventivato per business unit"
          info="Ogni rettangolo è una business unit, con area proporzionale al valore preventivato. Utile per cogliere in un colpo d'occhio se il preventivato è concentrato o distribuito."
        >
          <Composizione
            dati={(r("valoreBu")?.righe ?? []).map((x) => ({
              etichetta: x.etichetta,
              valore: x.valore,
            }))}
            altezza={260}
            onClick={(b) => alternaFiltro("bu", b)}
          />
        </Scheda>

        {heatmap && (
          <Scheda
            titolo="Tasso di conversione nel tempo"
            className="lg:col-span-3"
            sottotitolo="business unit per mese — più intenso significa conversione più alta"
            info="I mesi recenti tendono a mostrare una conversione più bassa semplicemente perché quei preventivi hanno avuto meno tempo per trasformarsi in ordini. Il confronto utile è fra business unit nello stesso mese, non fra mesi diversi."
          >
            <Heatmap
              righe={heatmap.righe}
              colonne={heatmap.colonne}
              valori={heatmap.valori}
              formato="percentuale"
              onClick={(bu) => alternaFiltro("bu", bu)}
            />
          </Scheda>
        )}

        <Scheda
          titolo="Concentrazione del preventivato"
          className="lg:col-span-2"
          sottotitolo="quanti clienti fanno la maggior parte del valore offerto"
          info="Le barre sono i clienti ordinati per valore, la linea è la percentuale cumulata. Il punto in cui la linea taglia l'80% dice da quanti clienti dipende la maggior parte del preventivato."
        >
          <Pareto
            dati={(r("valoreCliente")?.righe ?? []).map((x) => ({
              etichetta: x.etichetta,
              valore: x.valore,
            }))}
            onClick={(c) => apriDettaglio("cliente", c)}
          />
        </Scheda>

        <Scheda
          titolo="Valore preventivato per mese"
          info="Valore totale dei preventivi emessi in ciascun mese del periodo scelto. Le barre sono ordinate per valore, non cronologicamente."
        >
          <BarreScostamento
            dati={(r("valoreMese")?.righe ?? []).map((x) => ({
              etichetta: x.etichetta,
              valore: x.valore,
            }))}
            altezza={260}
          />
        </Scheda>

        <Scheda
          titolo="Clienti — preventivato contro convertito"
          className="lg:col-span-3"
          sottotitolo="ordinabile per tasso: in fondo ci sono i preventivi che non chiudono"
          info="Ogni riga confronta quanto è stato offerto a un cliente con quanto è diventato ordine. Cliccando una riga si aprono i suoi documenti, riga per riga, con quello che il cliente aveva chiesto."
        >
          <TabellaAnalitica
            colonnaDimensione="Cliente"
            colonne={colonneClienti}
            righe={righeClienti}
            colonnaOrdinamentoIniziale="valore"
            massimoIniziale={15}
            onClickRiga={(c) => apriDettaglio("cliente", c)}
            rigaEvidenziata={filtroDi("cliente")}
          />
        </Scheda>
      </div>

      <PannelloDettaglio richiesta={dettaglio} onChiudi={() => setDettaglio(null)} />
    </>
  );
}
