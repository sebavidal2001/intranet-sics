"use client";

/**
 * Carico di lavoro di un'area — Vendite o Acquisti — per persona.
 *
 * La fonte e' `documenti_utente`: ogni documento creato nel gestionale, con
 * l'utente, il giorno e l'ora. Risponde a cinque domande, nell'ordine:
 *  1. quanto lavoro c'e' nell'area, e com'e' cambiato rispetto all'anno prima?
 *  2. chi fa cosa: documenti per tipo, righe, giorni lavorati, righe al giorno
 *  3. come si e' distribuito nei mesi?
 *  4. in quali giorni e a che ora si lavora?
 *  5. (solo Acquisti) il lavoro dei buyer e' andato a buon fine? puntualita'
 *     dei fornitori e righe da sollecitare, accanto al volume.
 *
 * Un clic su una persona porta il focus sui grafici di ritmo (calendario,
 * giorni della settimana, ore): serve a vedere QUANDO lavora, non solo quanto.
 * Gli utenti condivisi («vendite», «segreteria», «acquisti»…) sono ruoli e la
 * vista lo dice: il loro lavoro non e' attribuibile a una persona.
 */

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiEroe, PALETTE, Scheda, Scheletro, Vuoto, useQueryBi } from "./primitivi";
import { Heatmap } from "./grafici-avanzati";
import { AreeImpilate, CalendarioAttivita, Composizione } from "./grafici-spettacolari";
import { TabellaAnalitica, type ColonnaAnalitica, type RigaAnalitica } from "./tabella-analitica";
import type { CruscottoAcquisti } from "@/lib/prototipo-bi/acquisti";
import {
  AREE_LAVORO,
  chiavePersona,
  costruisciPersone,
  mappaOre,
  mixDocumenti,
  perGiornoSettimana,
  perOra,
  serieMensili,
  sintetizza,
  soloPersona,
  type AreaLavoro,
} from "@/lib/prototipo-bi/carico-lavoro";
import type { Periodo, SpecQuery } from "@/lib/prototipo-bi/tipi";

const ASSE = { fontSize: 11, fill: "#64748b" };

function MiniBarre({ dati, altezza = 180 }: { dati: { etichetta: string; valore: number }[]; altezza?: number }) {
  if (dati.length === 0 || dati.every((d) => d.valore === 0)) return <Vuoto altezza={altezza} />;
  return (
    <ResponsiveContainer width="100%" height={altezza}>
      <BarChart data={dati} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="etichetta" tick={ASSE} interval={0} />
        <YAxis tick={ASSE} allowDecimals={false} width={40} />
        <Tooltip formatter={(v) => [Number(v).toLocaleString("it-IT"), "Righe"]} />
        <Bar dataKey="valore" fill={PALETTE[0]} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VistaCarico({ area, anno, periodo }: { area: AreaLavoro; anno: number; periodo: Periodo }) {
  const def = AREE_LAVORO[area];
  const [focus, setFocus] = useState<string | null>(null);
  const [normalizzato, setNormalizzato] = useState(false);

  // Cambiando area, il focus non ha piu' senso: la persona puo' non esserci.
  useEffect(() => setFocus(null), [area]);

  const specs = useMemo<Record<string, SpecQuery | null>>(() => {
    const base = { periodo };
    return {
      documentiPerPersona: { metrica: def.metricaDocumenti, raggruppa: ["creatore"], ...base, ordina: "valore_desc" },
      righePerPersona: { metrica: def.metricaRighe, raggruppa: ["creatore"], ...base, ordina: "valore_desc" },
      documentiPerProfilo: { metrica: def.metricaDocumenti, raggruppa: ["creatore", "profilo"], ...base },
      documentiPerGiorno: { metrica: def.metricaDocumenti, granularita: "giorno", raggruppa: ["creatore"], ...base },
      righePerGiorno: { metrica: def.metricaRighe, granularita: "giorno", raggruppa: ["creatore"], ...base },
      righePerMese: { metrica: def.metricaRighe, granularita: "mese", raggruppa: ["creatore"], ...base, ordina: "etichetta" },
      righePerOra: { metrica: def.metricaRighe, raggruppa: ["creatore", "ora_creazione"], ...base },
      documentiAP: { metrica: def.metricaDocumenti, modificatore: "anno_precedente", ...base },
      righeAP: { metrica: def.metricaRighe, modificatore: "anno_precedente", ...base },
    };
  }, [def, periodo]);

  const { risultati, errori, caricamento } = useQueryBi(specs);
  const r = (k: string) => risultati[k];

  // Gli acquisti si leggono anche dall'esito: puntualita' e righe da sollecitare.
  const dal = periodo.dal ?? `${anno}-01-01`;
  const al = periodo.al ?? `${anno}-12-31`;
  const [esitoBuyer, setEsitoBuyer] = useState<CruscottoAcquisti | null>(null);
  useEffect(() => {
    if (area !== "acquisti") return;
    let annullato = false;
    setEsitoBuyer(null);
    fetch(`/api/bi/acquisti?dal=${dal}&al=${al}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        if (!annullato) setEsitoBuyer((await res.json()) as CruscottoAcquisti);
      })
      .catch(() => {
        // L'esito e' un di piu': senza, la tabella resta quella del volume.
      });
    return () => {
      annullato = true;
    };
  }, [area, dal, al]);

  const persone = useMemo(
    () =>
      risultati.documentiPerPersona
        ? costruisciPersone(def, {
            documentiPerPersona: r("documentiPerPersona"),
            righePerPersona: r("righePerPersona"),
            documentiPerProfilo: r("documentiPerProfilo"),
            documentiPerGiorno: r("documentiPerGiorno"),
          })
        : null,
    [risultati, def] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const sintesi = useMemo(() => (persone ? sintetizza(persone) : null), [persone]);
  const personaFocus = persone?.find((p) => p.chiave === focus) ?? null;

  const calendario = useMemo(() => {
    const out: Record<string, number> = {};
    for (const x of soloPersona(r("righePerGiorno"), focus)?.righe ?? []) {
      const g = x.chiavi.periodo;
      if (g) out[g] = (out[g] ?? 0) + x.valore;
    }
    return out;
  }, [risultati, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const giorniSettimana = useMemo(
    () => perGiornoSettimana(soloPersona(r("righePerGiorno"), focus)),
    [risultati, focus] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const ore = useMemo(
    () => perOra(soloPersona(r("righePerOra"), focus)),
    [risultati, focus] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const mappa = useMemo(
    () => (persone ? mappaOre(r("righePerOra"), persone) : null),
    [risultati, persone] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const mensile = useMemo(
    () => serieMensili(r("righePerMese"), anno),
    [risultati, anno] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const mix = useMemo(() => (persone ? mixDocumenti(def, persone) : []), [persone, def]);

  const buyer = useMemo(
    () => new Map((esitoBuyer?.perBuyer ?? []).map((b) => [chiavePersona(b.nome), b])),
    [esitoBuyer]
  );

  const colonne = useMemo<ColonnaAnalitica[]>(() => {
    const base: ColonnaAnalitica[] = [
      { chiave: "documenti", etichetta: "Documenti", tipo: "barra", unita: "numero" },
      ...def.gruppi.map<ColonnaAnalitica>((g) => ({
        chiave: g.chiave,
        etichetta: g.etichetta,
        tipo: "numero",
        unita: "numero",
        titolo: `Documenti ${g.etichetta.toLowerCase()} creati (${g.profili.join(", ")})`,
      })),
      { chiave: "righe", etichetta: "Righe", tipo: "numero", unita: "numero", titolo: "Righe inserite nei documenti: il lavoro di inserimento" },
      {
        chiave: "righePerDoc",
        etichetta: "Righe/doc.",
        tipo: "numero",
        unita: "numero",
        decimali: 1,
        titolo: "Righe medie per documento: indica la complessità del lavoro",
        totale: { tipo: "rapporto", numeratore: "righe", denominatore: "documenti", percentuale: false },
      },
      {
        chiave: "giorni",
        etichetta: "Giorni",
        tipo: "numero",
        unita: "numero",
        titolo: "Giorni in cui ha creato almeno un documento",
        totale: { tipo: "nessuno" },
      },
      {
        chiave: "righePerGiorno",
        etichetta: "Righe/giorno",
        tipo: "numero",
        unita: "numero",
        decimali: 1,
        titolo: "Righe inserite per giorno lavorato",
        totale: { tipo: "nessuno" },
      },
      { chiave: "quota", etichetta: "Quota", tipo: "percentuale", titolo: "Quota delle righe dell'area" },
    ];
    if (area === "acquisti") {
      base.push(
        {
          chiave: "puntualita",
          etichetta: "Puntualità",
          tipo: "raggiungimento",
          titolo: "Righe arrivate nel periodo entro la data promessa dal fornitore (ordini emessi da questa persona)",
          totale: { tipo: "nessuno" },
        },
        {
          chiave: "scadute",
          etichetta: "Da sollecitare",
          tipo: "numero",
          unita: "numero",
          titolo: "Righe d'ordine con la promessa passata e la merce non arrivata",
        }
      );
    }
    return base;
  }, [def, area]);

  const righeTabella = useMemo<RigaAnalitica[]>(
    () =>
      (persone ?? []).map((p) => {
        const b = buyer.get(p.chiave);
        return {
          chiave: p.nome,
          celle: {
            documenti: p.documenti,
            ...p.perGruppo,
            righe: p.righe,
            righePerDoc: p.righePerDocumento,
            giorni: p.giorniAttivi,
            righePerGiorno: p.righePerGiornoAttivo,
            quota: p.quotaPct,
            puntualita: b?.puntualitaPct ?? null,
            scadute: b ? b.righeScadute : null,
          },
        };
      }),
    [persone, buyer]
  );

  const confrontoDocumenti = (r("documentiAP")?.totale ?? 0) > 0 ? r("documentiAP")!.totale : null;
  const confrontoRighe = (r("righeAP")?.totale ?? 0) > 0 ? r("righeAP")!.totale : null;
  const conRuoli = persone?.some((p) => p.condiviso) ?? false;

  if (errori._generale) {
    return (
      <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">{errori._generale}</div>
    );
  }
  if (!persone || !sintesi) return <Scheletro altezza={420} />;
  if (persone.length === 0 && !caricamento) {
    return (
      <Scheda titolo={`Carico di lavoro — ${def.etichetta}`}>
        <Vuoto
          altezza={160}
          testo="Nessun documento nel periodo. Se manca anche per gli anni passati, i documenti per utente non sono stati ancora caricati (migration 151)."
        />
      </Scheda>
    );
  }

  const etichettaFocus = personaFocus?.nome;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Scheda
        titolo={`Il lavoro di ${def.etichetta.toLowerCase()}`}
        sottotitolo="documenti creati e righe inserite dalle persone nel gestionale, nel periodo"
        className="lg:col-span-3"
        info="Un documento è un preventivo, un ordine, una bolla o una fattura; una riga è un articolo al suo interno. Contano quando sono stati CREATI, non quando sono stati registrati: una fattura fornitore si registra a fine mese ma si lavora prima. Il confronto è con lo stesso periodo dell'anno precedente."
      >
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KpiEroe
            etichetta="Documenti creati"
            valore={sintesi.documenti}
            unita="numero"
            confronto={confrontoDocumenti ? { valore: confrontoDocumenti, etichetta: "anno prec." } : null}
          />
          <KpiEroe
            etichetta="Righe inserite"
            valore={sintesi.righe}
            unita="numero"
            confronto={confrontoRighe ? { valore: confrontoRighe, etichetta: "anno prec." } : null}
          />
          <KpiEroe
            etichetta="Persone attive"
            valore={sintesi.personeAttive}
            unita="numero"
            nota={conRuoli ? "esclusi gli utenti condivisi" : undefined}
          />
          <KpiEroe
            etichetta="Righe per documento"
            valore={sintesi.righePerDocumento}
            unita="numero"
            nota="complessità media del lavoro"
          />
          <KpiEroe
            etichetta="Righe al giorno"
            valore={sintesi.righePerGiornoAttivo}
            unita="numero"
            nota="per persona, nei giorni in cui lavora"
          />
        </div>
        {sintesi.quotaCondivisaPct >= 10 && (
          <p className="mt-3 text-xs text-text-muted flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden />
            Il {sintesi.quotaCondivisaPct.toLocaleString("it-IT", { maximumFractionDigits: 1 })}% delle righe è inserito da
            utenti condivisi (vendite, segreteria, amministrazione, acquisti, magazzino): sono uffici, non persone, e il loro
            lavoro non si può attribuire a nessuno in particolare.
          </p>
        )}
      </Scheda>

      <Scheda
        titolo="Chi fa cosa"
        className="lg:col-span-2"
        sottotitolo="una riga per utente: documenti per tipo, righe, giorni lavorati. Un clic porta il focus sul suo ritmo."
        info="«Righe/doc.» è la complessità media; «Righe/giorno» è la produttività nei giorni in cui l'utente ha creato almeno un documento (non include ferie o assenze). Le quote sommano le righe dell'area. I totali non sono somme cieche: i rapporti sono ricalcolati sui totali."
      >
        <TabellaAnalitica
          colonnaDimensione="Utente"
          colonne={colonne}
          righe={righeTabella}
          colonnaOrdinamentoIniziale="righe"
          ricercabile={false}
          onClickRiga={(nome) => {
            const p = persone.find((x) => x.nome === nome);
            setFocus((f) => (p && f !== p.chiave ? p.chiave : null));
          }}
          rigaEvidenziata={etichettaFocus ?? null}
        />
        {conRuoli && (
          <p className="mt-2 text-[11px] text-text-muted">
            Gli utenti condivisi ({persone.filter((p) => p.condiviso).map((p) => p.nome).join(", ")}) sono ruoli: contano
            nei totali ma non fra le persone attive.
          </p>
        )}
      </Scheda>

      <Scheda
        titolo="Di cosa è fatto il lavoro"
        sottotitolo="documenti per tipo, nel periodo"
        info="Quanto pesa ogni tipo di documento sul totale creato. Serve a capire se il carico viene dalla fase commerciale (preventivi, ordini) o da quella amministrativa (bolle, fatture)."
      >
        <Composizione dati={mix} unita="numero" altezza={260} />
      </Scheda>

      <Scheda
        titolo="Come si distribuisce il carico"
        className="lg:col-span-3"
        sottotitolo={normalizzato ? "quota di ciascuno sul totale del mese" : "righe inserite per mese, impilate per utente"}
        info="In modalità volumi l'altezza totale è il lavoro del mese; in modalità quote ogni mese vale 100% e si legge solo come il lavoro si ripartisce. Le persone oltre le sette più attive sono raccolte in «Altri»."
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
          periodi={mensile.periodi}
          serie={mensile.serie}
          unita="numero"
          normalizzato={normalizzato}
          altezza={300}
          onClick={(nome) => {
            const p = persone.find((x) => x.nome === nome);
            if (p) setFocus((f) => (f === p.chiave ? null : p.chiave));
          }}
        />
      </Scheda>

      <Scheda
        titolo="Il ritmo di lavoro, giorno per giorno"
        className="lg:col-span-3"
        sottotitolo={
          etichettaFocus
            ? `righe inserite da ${etichettaFocus} — clic sulla riga per tornare a tutti`
            : "righe inserite da tutta l'area — le caselle vuote sono chiusure, weekend o giorni senza lavoro"
        }
        info="Ogni casella è un giorno, più intensa quanto più si è lavorato. Serve a vedere i picchi e i vuoti che una serie mensile appiattisce: le settimane bianche di agosto sono la chiusura aziendale. Scegliendo una persona nella tabella il calendario mostra solo il suo."
      >
        <CalendarioAttivita valori={calendario} anno={anno} unita="numero" />
      </Scheda>

      <Scheda
        titolo="In che giorni si lavora"
        sottotitolo={etichettaFocus ? `righe di ${etichettaFocus}, per giorno della settimana` : "righe per giorno della settimana"}
        info="Somma delle righe inserite in ogni giorno della settimana nel periodo. Un sabato o una domenica alti segnalano straordinari o lavoro arretrato."
      >
        <MiniBarre dati={giorniSettimana} />
      </Scheda>

      <Scheda
        titolo="A che ora si lavora"
        className="lg:col-span-2"
        sottotitolo={etichettaFocus ? `righe di ${etichettaFocus}, per ora di creazione` : "righe per ora di creazione del documento"}
        info="L'ora è quella in cui il documento è stato creato nel gestionale. Un picco prima delle 8 o dopo le 18 dice che il carico non entra nell'orario; la pausa pranzo si vede come un avvallamento."
      >
        <MiniBarre dati={ore} />
      </Scheda>

      {mappa && mappa.righe.length > 0 && mappa.colonne.length > 0 && (
        <Scheda
          titolo="Chi lavora quando"
          className="lg:col-span-3"
          sottotitolo="righe per persona e ora di creazione — solo le dieci persone più attive, senza utenti condivisi"
          info="Le caselle sono righe inserite, più intense quanto più si è lavorato in quell'ora. Serve a vedere i turni reali: chi parte presto, chi chiude tardi, dove due persone coprono lo stesso orario."
        >
          <Heatmap
            righe={mappa.righe}
            colonne={mappa.colonne}
            valori={mappa.valori}
            formato="numero"
            onClick={(nome) => {
              const p = persone.find((x) => x.nome === nome);
              if (p) setFocus((f) => (f === p.chiave ? null : p.chiave));
            }}
          />
        </Scheda>
      )}
    </div>
  );
}
