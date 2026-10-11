"use client";

/**
 * Vista "Carico di lavoro": quanto lavorano le persone, in Vendite e in Acquisti.
 *
 * Due aree, un interruttore. Ognuna mostra il carico vero — i documenti creati
 * nel gestionale per utente, tipo, giorno e ora (`vista-carico.tsx`). Per le
 * Vendite, sotto, resta la parte sui PREVENTIVI: reattività (giorni fra
 * richiesta del cliente e registrazione) ed esito (conversione), che i
 * documenti per utente non sanno dire.
 *
 * ⚠️ ~50 documenti su 2.089 hanno una data di richiesta successiva alla
 * registrazione. Sono errori di inserimento e la vista li esclude dal calcolo
 * dei tempi invece di contarli come zero: senza questa pulizia un'addetta
 * risultava con una media di −496 giorni.
 */

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { KpiEroe, Scheda, useQueryBi } from "./primitivi";
import { BarreScostamento, Heatmap } from "./grafici-avanzati";
import { Anelli } from "./grafici-spettacolari";
import { TabellaAnalitica, type ColonnaAnalitica, type RigaAnalitica } from "./tabella-analitica";
import { PannelloDettaglio, type RichiestaPannello } from "./dettaglio-documenti";
import { VistaCarico } from "./vista-carico";
import type { AreaLavoro } from "@/lib/prototipo-bi/carico-lavoro";
import type { Dimensione, Periodo, SpecQuery, Filtro } from "@/lib/prototipo-bi/tipi";

const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

const AREE: { chiave: AreaLavoro; etichetta: string; nota: string }[] = [
  { chiave: "vendite", etichetta: "Vendite", nota: "preventivi, ordini, bolle e fatture ai clienti" },
  { chiave: "acquisti", etichetta: "Acquisti", nota: "ordini, DDT e fatture dei fornitori" },
];

export function VistaBackoffice({
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
  const [area, setArea] = useState<AreaLavoro>("vendite");

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Area di lavoro" className="flex items-center gap-2 flex-wrap">
        {AREE.map((a) => (
          <button
            key={a.chiave}
            role="tab"
            aria-selected={area === a.chiave}
            onClick={() => setArea(a.chiave)}
            className={`px-4 py-2 rounded-lg text-sm font-tenorite transition-colors ${
              area === a.chiave ? "bg-primary text-white" : "border border-border hover:bg-bg-page text-text"
            }`}
          >
            {a.etichetta}
          </button>
        ))}
        <span className="text-xs text-text-muted">{AREE.find((a) => a.chiave === area)?.nota}</span>
      </div>

      {/* I filtri di business unit e agente non toccano il carico: i documenti sono di persone. */}
      <VistaCarico area={area} anno={anno} periodo={periodo} />

      {area === "vendite" && (
        <SezionePreventivi
          anno={anno}
          periodo={periodo}
          filtriSpec={filtriSpec}
          alternaFiltro={alternaFiltro}
          filtroDi={filtroDi}
        />
      )}
    </div>
  );
}

/** Reattività ed esito dei preventivi per addetto: la parte che i documenti per utente non coprono. */
function SezionePreventivi({
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
    return {
      documenti: { metrica: "preventivi_creati", ...base },
      righe: { metrica: "righe_preventivo", ...base },
      giorni: { metrica: "giorni_risposta", ...base },
      inGiornata: { metrica: "quota_stesso_giorno", ...base },
      valore: { metrica: "preventivi_valore", ...base },

      docPerAddetto: { metrica: "preventivi_creati", raggruppa: ["creatore"], ...base, ordina: "valore_desc" },
      righePerAddetto: { metrica: "righe_preventivo", raggruppa: ["creatore"], ...base, ordina: "valore_desc" },
      giorniPerAddetto: { metrica: "giorni_risposta", raggruppa: ["creatore"], ...base, ordina: "valore_desc" },
      giornataPerAddetto: { metrica: "quota_stesso_giorno", raggruppa: ["creatore"], ...base, ordina: "valore_desc" },
      valorePerAddetto: { metrica: "preventivi_valore", raggruppa: ["creatore"], ...base, ordina: "valore_desc" },
      convPerAddetto: { metrica: "tasso_conversione", raggruppa: ["creatore"], ...base, ordina: "valore_desc" },

      giorniMeseAddetto: { metrica: "giorni_risposta", granularita: "mese", raggruppa: ["creatore"], ...base, ordina: "etichetta" },
    };
  }, [periodo, filtriSpec]);

  const { risultati, errori } = useQueryBi(specs);
  const r = (k: string) => risultati[k];
  const tot = (k: string) => risultati[k]?.totale ?? 0;

  const heatmapTempi = useMemo(() => {
    const s = r("giorniMeseAddetto");
    if (!s || s.righe.length === 0) return null;
    const nomi = [...new Set(s.righe.map((x) => x.chiavi.creatore).filter(Boolean))] as string[];
    const mesi = [...new Set(s.righe.map((x) => x.chiavi.periodo).filter(Boolean))].sort() as string[];
    const valori: Record<string, Record<string, number>> = {};
    for (const n of nomi) {
      valori[n] = {};
      for (const m of mesi) {
        valori[n][MESI_BREVI[Number(m.slice(5, 7)) - 1] ?? m] =
          s.righe.find((x) => x.chiavi.creatore === n && x.chiavi.periodo === m)?.valore ?? 0;
      }
    }
    return { righe: nomi, colonne: mesi.map((m) => MESI_BREVI[Number(m.slice(5, 7)) - 1] ?? m), valori };
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  const anelliGiornata = useMemo(
    () =>
      (r("giornataPerAddetto")?.righe ?? [])
        .filter((x) => x.conteggio >= 10)
        .map((x) => ({ etichetta: x.etichetta, percentuale: x.valore, nota: "in giornata" })),
    [risultati] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const righeAddetti = useMemo<RigaAnalitica[]>(() => {
    const doc = r("docPerAddetto");
    if (!doc) return [];
    const m = (k: string) => new Map((r(k)?.righe ?? []).map((x) => [x.etichetta, x.valore]));
    const righe = m("righePerAddetto");
    const giorni = m("giorniPerAddetto");
    const giornata = m("giornataPerAddetto");
    const valore = m("valorePerAddetto");
    const conv = m("convPerAddetto");

    return doc.righe.map((x) => {
      const nDoc = x.valore;
      const nRighe = righe.get(x.etichetta) ?? 0;
      const val = valore.get(x.etichetta) ?? 0;
      return {
        chiave: x.etichetta,
        celle: {
          documenti: nDoc,
          righe: nRighe,
          righePerDoc: nDoc > 0 ? nRighe / nDoc : 0,
          valore: val,
          // Serve come numeratore per il totale della conversione.
          convertito: (val * (conv.get(x.etichetta) ?? 0)) / 100,
          conversione: conv.get(x.etichetta) ?? 0,
          giorni: giorni.get(x.etichetta) ?? 0,
          inGiornata: giornata.get(x.etichetta) ?? 0,
        },
      };
    });
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  const colonneAddetti: ColonnaAnalitica[] = [
    // `unita: "numero"` è indispensabile: senza, il conteggio dei preventivi
    // veniva stampato in euro ("418 €").
    { chiave: "documenti", etichetta: "Preventivi", tipo: "barra", unita: "numero" },
    { chiave: "righe", etichetta: "Righe", tipo: "numero", unita: "numero" },
    {
      chiave: "righePerDoc",
      etichetta: "Righe/prev.",
      tipo: "numero",
      unita: "numero",
      decimali: 1,
      titolo: "Righe medie per preventivo: indica la complessità del lavoro",
      // Sommare le medie dava 23 righe per preventivo: si ricalcola.
      totale: { tipo: "rapporto", numeratore: "righe", denominatore: "documenti", percentuale: false },
    },
    { chiave: "valore", etichetta: "Valore", tipo: "euro", unita: "euro" },
    {
      chiave: "conversione",
      etichetta: "Conversione",
      tipo: "raggiungimento",
      totale: { tipo: "rapporto", numeratore: "convertito", denominatore: "valore" },
    },
    {
      chiave: "giorni",
      etichetta: "Giorni",
      tipo: "numero",
      unita: "giorni",
      decimali: 2,
      titolo: "Giorni medi fra richiesta del cliente e registrazione",
      // Media pesata sui documenti: sommare i giorni non significa nulla.
      totale: { tipo: "media_pesata", peso: "documenti" },
    },
    {
      chiave: "inGiornata",
      etichetta: "In giornata",
      tipo: "raggiungimento",
      totale: { tipo: "media_pesata", peso: "documenti" },
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-3 pt-2">
          <h2 className="font-tenorite text-base font-semibold">Preventivi: reattività ed esito</h2>
          <p className="text-xs text-text-muted">
            quanto in fretta si risponde ai clienti e che fine fanno i preventivi, per addetto — i filtri di
            business unit e agente valgono qui
          </p>
        </div>
        {errori._generale && (
          <div className="lg:col-span-3 p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">
            {errori._generale}
          </div>
        )}

        <Scheda
          titolo="Volume di lavoro"
          sottotitolo={`anno ${anno}`}
          info="Il numero di preventivi conta i documenti distinti, le righe contano gli articoli preventivati. Guardarli insieme evita di scambiare per produttività quello che è solo un diverso tipo di lavoro: un documento da venti righe non è un documento da due."
        >
          <div className="grid grid-cols-2 gap-4">
            <KpiEroe etichetta="Preventivi creati" valore={tot("documenti")} unita="numero" />
            <KpiEroe etichetta="Righe lavorate" valore={tot("righe")} unita="numero" />
            <KpiEroe etichetta="Valore preventivato" valore={tot("valore")} />
            <KpiEroe
              etichetta="Righe per preventivo"
              valore={tot("documenti") > 0 ? tot("righe") / tot("documenti") : 0}
              unita="numero"
            />
          </div>
        </Scheda>

        <Scheda
          titolo="Reattività"
          sottotitolo="dalla richiesta del cliente alla registrazione"
          className="lg:col-span-2"
          info="Giorni fra la data in cui il cliente ha chiesto e quella in cui il preventivo è stato registrato. I documenti con date incoerenti (richiesta successiva alla registrazione: circa 50 su 2.089) sono esclusi dal calcolo, non contati come zero. Gli anelli mostrano solo gli addetti con almeno dieci documenti misurabili."
        >
          <div className="grid grid-cols-2 gap-6">
            <KpiEroe
              etichetta="Risposte in giornata"
              valore={tot("inGiornata")}
              unita="percentuale"
              nota="registrate lo stesso giorno della richiesta"
            />
            <KpiEroe
              etichetta="Attesa media"
              valore={tot("giorni")}
              unita="giorni"
              nota="date incoerenti escluse dal calcolo"
            />
          </div>
          <div className="mt-4 pt-3 border-t border-border">
            <Anelli voci={anelliGiornata} onClick={(c) => alternaFiltro("creatore", c)} />
          </div>
        </Scheda>

        <Scheda
          titolo="Preventivi per addetto"
          info="Numero di documenti distinti creati da ciascun addetto nel periodo. Cliccando una barra si aprono i suoi documenti."
        >
          <BarreScostamento
            dati={(r("docPerAddetto")?.righe ?? []).map((x) => ({
              etichetta: x.etichetta,
              valore: x.valore,
            }))}
            formato="percentuale"
            altezza={300}
            onClick={(c) => apriDettaglio("creatore", c)}
          />
          <p className="mt-2 text-[11px] text-text-muted">I valori sono documenti, non euro.</p>
        </Scheda>

        {heatmapTempi && (
          <Scheda
            titolo="Tempi di risposta nel tempo"
            className="lg:col-span-3"
            sottotitolo="giorni medi per addetto e per mese — più intenso significa più lento"
            info="Le caselle sono giorni medi di attesa, non percentuali. Le celle vuote sono mesi senza documenti misurabili per quella persona. Un mese improvvisamente scuro segnala un periodo di sovraccarico o un'assenza."
          >
            <Heatmap
              righe={heatmapTempi.righe}
              colonne={heatmapTempi.colonne}
              valori={heatmapTempi.valori}
              formato="percentuale"
              onClick={(c) => alternaFiltro("creatore", c)}
            />
            <p className="mt-2 text-[11px] text-text-muted flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden />
              I valori sono giorni, non percentuali: la casella mostra la media del mese.
            </p>
          </Scheda>
        )}

        <Scheda
          titolo="Addetti back office — quadro completo"
          className="lg:col-span-3"
          sottotitolo="volume, complessità, valore ed esito del lavoro, in una riga per persona"
          info="I totali non sono somme cieche: «Righe/prev.» è il rapporto fra i totali, «Giorni» e «In giornata» sono medie pesate sul numero di documenti, la conversione è il rapporto fra convertito e preventivato complessivi. Cliccando una riga si aprono i documenti di quella persona."
        >
          <TabellaAnalitica
            colonnaDimensione="Addetto"
            colonne={colonneAddetti}
            righe={righeAddetti}
            colonnaOrdinamentoIniziale="documenti"
            massimoIniziale={10}
            ricercabile={false}
            onClickRiga={(c) => apriDettaglio("creatore", c)}
            rigaEvidenziata={filtroDi("creatore")}
          />
          <p className="mt-3 text-[11px] text-text-muted">
            Il numero di preventivi da solo dice poco: un documento da venti righe non è un
            documento da due. La colonna «Righe/prev.» serve a leggere il volume insieme alla
            complessità, e la conversione a non confondere la quantità con il risultato.
          </p>
        </Scheda>
      </div>

      <PannelloDettaglio richiesta={dettaglio} onChiudi={() => setDettaglio(null)} />
    </>
  );
}
