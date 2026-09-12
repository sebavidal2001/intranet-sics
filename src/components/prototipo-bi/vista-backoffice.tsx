"use client";

/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Vista "Back office": quanto lavorano gli addetti e con che tempi.
 *
 * Misura il volume (documenti e righe), la reattività (giorni fra richiesta
 * del cliente e registrazione) e l'esito del lavoro.
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
import { Anelli, AreeImpilate, CalendarioAttivita } from "./grafici-spettacolari";
import { TabellaAnalitica, type ColonnaAnalitica, type RigaAnalitica } from "./tabella-analitica";
import { PannelloDettaglio, type RichiestaPannello } from "./dettaglio-documenti";
import type { Dimensione, Periodo, SpecQuery } from "@/lib/prototipo-bi/tipi";

const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

export function VistaBackoffice({
  anno,
  periodo,
  filtriSpec,
  alternaFiltro,
  filtroDi,
}: {
  anno: number;
  periodo: Periodo;
  filtriSpec: { campo: Dimensione; op: "eq"; valore: string }[];
  alternaFiltro: (campo: Dimensione, valore: string) => void;
  filtroDi: (campo: Dimensione) => string | null;
}) {
  const [normalizzato, setNormalizzato] = useState(false);
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

      righeGiorno: { metrica: "righe_preventivo", granularita: "giorno", ...base, ordina: "etichetta" },
      righeMeseAddetto: { metrica: "righe_preventivo", granularita: "mese", raggruppa: ["creatore"], ...base, ordina: "etichetta" },
      giorniMeseAddetto: { metrica: "giorni_risposta", granularita: "mese", raggruppa: ["creatore"], ...base, ordina: "etichetta" },
    };
  }, [periodo, filtriSpec]);

  const { risultati, errori } = useQueryBi(specs);
  const r = (k: string) => risultati[k];
  const tot = (k: string) => risultati[k]?.totale ?? 0;

  const valoriCalendario = useMemo(() => {
    const s = r("righeGiorno");
    const out: Record<string, number> = {};
    for (const x of s?.righe ?? []) {
      const g = x.chiavi.periodo;
      if (g) out[g] = x.valore;
    }
    return out;
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  const carico = useMemo(() => {
    const s = r("righeMeseAddetto");
    if (!s) return { periodi: [], serie: [] };
    const periodi = [...new Set(s.righe.map((x) => x.chiavi.periodo).filter(Boolean))].sort() as string[];
    const nomi = [...new Set(s.righe.map((x) => x.chiavi.creatore).filter(Boolean))] as string[];

    // Ordine per volume complessivo: chi lavora di più sta in basso nella
    // pila, dove la lettura è più stabile.
    const volume = new Map<string, number>();
    for (const x of s.righe) {
      const n = x.chiavi.creatore;
      if (n) volume.set(n, (volume.get(n) ?? 0) + x.valore);
    }
    nomi.sort((a, b) => (volume.get(b) ?? 0) - (volume.get(a) ?? 0));

    const etichetta = (p: string) => MESI_BREVI[Number(p.slice(5, 7)) - 1] ?? p;
    return {
      periodi: periodi.map(etichetta),
      serie: nomi.map((n) => ({
        nome: n,
        valori: Object.fromEntries(
          periodi.map((p) => [
            etichetta(p),
            s.righe.find((x) => x.chiavi.creatore === n && x.chiavi.periodo === p)?.valore ?? 0,
          ])
        ),
      })),
    };
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

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
          titolo="Il ritmo di lavoro, giorno per giorno"
          className="lg:col-span-3"
          sottotitolo="righe di preventivo lavorate — le caselle vuote sono chiusure, weekend o giorni senza richieste"
          info="Ogni casella è un giorno dell'anno, più intensa quanto più si è lavorato. Serve a vedere i picchi e i vuoti che una serie mensile appiattisce: le due settimane bianche di agosto sono la chiusura aziendale, non un calo di domanda."
        >
          <CalendarioAttivita valori={valoriCalendario} anno={anno} unita="numero" />
        </Scheda>

        <Scheda
          titolo="Come si distribuisce il carico"
          className="lg:col-span-2"
          sottotitolo={
            normalizzato
              ? "quota di ciascun addetto sul totale del mese"
              : "righe lavorate per mese, impilate per addetto"
          }
          info="In modalità volumi l'altezza totale è il lavoro complessivo del mese; in modalità quote ogni mese vale 100% e si legge solo come il carico si ripartisce fra le persone. La seconda è utile per capire se qualcuno è cresciuto di peso relativo anche quando il volume totale cala."
          azione={
            <button
              onClick={() => setNormalizzato((v) => !v)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-border hover:bg-bg-page"
            >
              {normalizzato ? "Mostra volumi" : "Mostra quote %"}
            </button>
          }
        >
          <AreeImpilate
            periodi={carico.periodi}
            serie={carico.serie}
            unita="numero"
            normalizzato={normalizzato}
            altezza={300}
            onClick={(n) => alternaFiltro("creatore", n)}
          />
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
