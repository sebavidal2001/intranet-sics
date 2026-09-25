"use client";

/**
 * Il personale nel suo insieme: chi prepara i preventivi e chi ordina ai
 * fornitori, nella stessa tabella e nello stesso grafico di carico.
 *
 * Le due fonti non si parlano: i preventivi scrivono il nome in maiuscolo
 * ("LUCIA RODA"), gli ordini a fornitore come nel gestionale ("Claudio
 * Dalsass"). Si uniscono per nome normalizzato, cosi' chi fa entrambe le cose
 * (Erika Livreri, per esempio) compare una volta sola con i due lavori affiancati.
 *
 * L'unita' di lavoro comune e' la RIGA: un articolo preventivato o un articolo
 * ordinato. Non sono lo stesso sforzo, e la tabella li tiene in colonne
 * separate; il totale serve solo a vedere come si distribuisce il carico.
 */

import { useEffect, useMemo, useState } from "react";
import { Scheda, Scheletro, numero, percentuale } from "./primitivi";
import { AreeImpilate } from "./grafici-spettacolari";
import type { CruscottoAcquisti } from "@/lib/prototipo-bi/acquisti";
import type { Periodo, RisultatoQuery } from "@/lib/prototipo-bi/tipi";

const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

export interface PersonaPreventivi {
  nome: string;
  documenti: number;
  righe: number;
}

export interface Persona {
  chiave: string;
  nome: string;
  aree: ("vendite" | "acquisti")[];
  preventivi: number;
  righePreventivi: number;
  ordiniFornitore: number;
  righeOrdini: number;
  righeTotali: number;
  quotaPct: number;
  righeScadute: number;
  condiviso: boolean;
}

/** Stessa persona anche se scritta in modo diverso nelle due fonti. */
export function chiavePersona(nome: string): string {
  return nome.normalize("NFKD").replace(/\s+/g, " ").trim().toUpperCase();
}

/** "LUCIA RODA" → "Lucia Roda"; un nome gia' misto resta com'e'. */
function nomeLeggibile(nome: string): string {
  if (nome !== nome.toUpperCase()) return nome;
  return nome.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, l: string) => sep + l.toUpperCase());
}

export function unisciPersonale(
  preventivi: PersonaPreventivi[],
  acquisti: CruscottoAcquisti["perBuyer"]
): Persona[] {
  const m = new Map<string, Persona>();
  const prendi = (nome: string) => {
    const k = chiavePersona(nome);
    let p = m.get(k);
    if (!p) {
      p = {
        chiave: k,
        nome: nomeLeggibile(nome),
        aree: [],
        preventivi: 0,
        righePreventivi: 0,
        ordiniFornitore: 0,
        righeOrdini: 0,
        righeTotali: 0,
        quotaPct: 0,
        righeScadute: 0,
        condiviso: k === "ACQUISTI",
      };
      m.set(k, p);
    }
    return p;
  };
  for (const x of preventivi) {
    if (!x.nome || (x.documenti === 0 && x.righe === 0)) continue;
    const p = prendi(x.nome);
    p.preventivi += x.documenti;
    p.righePreventivi += x.righe;
    if (!p.aree.includes("vendite")) p.aree.push("vendite");
  }
  for (const b of acquisti) {
    if (b.righe === 0 && b.righeAperte === 0) continue;
    const p = prendi(b.nome);
    // Il nome del gestionale acquisti e' gia' leggibile: ha la precedenza.
    if (b.nome !== b.nome.toUpperCase()) p.nome = b.nome;
    p.ordiniFornitore += b.ordini;
    p.righeOrdini += b.righe;
    p.righeScadute += b.righeScadute;
    if (!p.aree.includes("acquisti")) p.aree.push("acquisti");
  }
  const persone = [...m.values()];
  const totale = persone.reduce((t, p) => t + p.righePreventivi + p.righeOrdini, 0);
  for (const p of persone) {
    p.righeTotali = p.righePreventivi + p.righeOrdini;
    p.quotaPct = totale > 0 ? Math.round((1000 * p.righeTotali) / totale) / 10 : 0;
  }
  return persone.sort((a, b) => b.righeTotali - a.righeTotali);
}

export function PersonaleInsieme({
  anno,
  periodo,
  preventiviPerPersona,
  preventiviMensili,
}: {
  anno: number;
  periodo: Periodo;
  preventiviPerPersona: PersonaPreventivi[] | null;
  /** Righe di preventivo per mese e creatore (spec righe_preventivo × creatore × mese). */
  preventiviMensili?: RisultatoQuery;
}) {
  const dal = periodo.dal ?? `${anno}-01-01`;
  const al = periodo.al ?? `${anno}-12-31`;
  const [acquisti, setAcquisti] = useState<CruscottoAcquisti | null>(null);
  const [erroreAcquisti, setErroreAcquisti] = useState<string | null>(null);
  const [normalizzato, setNormalizzato] = useState(false);

  useEffect(() => {
    let annullato = false;
    setAcquisti(null);
    setErroreAcquisti(null);
    fetch(`/api/bi/acquisti?dal=${dal}&al=${al}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Errore");
        if (!annullato) setAcquisti(j as CruscottoAcquisti);
      })
      .catch((e) => !annullato && setErroreAcquisti(e instanceof Error ? e.message : "Errore"));
    return () => {
      annullato = true;
    };
  }, [dal, al]);

  const persone = useMemo(
    () => (preventiviPerPersona ? unisciPersonale(preventiviPerPersona, acquisti?.perBuyer ?? []) : null),
    [preventiviPerPersona, acquisti]
  );

  // Carico mensile: righe di preventivo + righe d'ordine, per persona.
  const carico = useMemo(() => {
    const perPersona = new Map<string, { nome: string; mesi: Map<string, number> }>();
    const aggiungi = (nome: string, mese: string, n: number) => {
      const k = chiavePersona(nome);
      const p = perPersona.get(k) ?? { nome: persone?.find((x) => x.chiave === k)?.nome ?? nomeLeggibile(nome), mesi: new Map() };
      p.mesi.set(mese, (p.mesi.get(mese) ?? 0) + n);
      perPersona.set(k, p);
    };
    for (const x of preventiviMensili?.righe ?? []) {
      const mese = x.chiavi.periodo;
      const nome = x.chiavi.creatore;
      if (mese && nome) aggiungi(nome, mese.slice(0, 7), x.valore);
    }
    for (const m of acquisti?.caricoMensile ?? []) {
      for (const [nome, n] of Object.entries(m.perBuyer)) aggiungi(nome, m.mese, n);
    }
    const mesi = [...new Set([...perPersona.values()].flatMap((p) => [...p.mesi.keys()]))].sort();
    const etichetta = (m: string) => `${MESI_BREVI[Number(m.slice(5, 7)) - 1] ?? m}${m.slice(0, 4) === String(anno) ? "" : ` ${m.slice(2, 4)}`}`;
    const serie = [...perPersona.values()]
      .map((p) => ({
        nome: p.nome,
        totale: [...p.mesi.values()].reduce((t, n) => t + n, 0),
        valori: Object.fromEntries(mesi.map((m) => [etichetta(m), p.mesi.get(m) ?? 0])),
      }))
      .sort((a, b) => b.totale - a.totale)
      .map(({ nome, valori }) => ({ nome, valori }));
    return { periodi: mesi.map(etichetta), serie };
  }, [preventiviMensili, acquisti, persone, anno]);

  return (
    <div className="lg:col-span-3 grid grid-cols-1 lg:grid-cols-5 gap-4">
      <Scheda
        titolo="Il personale nel suo insieme"
        sottotitolo="chi prepara i preventivi e chi ordina ai fornitori, una riga per persona"
        className="lg:col-span-3"
        info="Una riga è un articolo: preventivato al cliente o ordinato al fornitore. Non sono lo stesso sforzo e restano in colonne separate; il totale e la quota servono a vedere come si distribuisce il carico. «Da sollecitare» sono le righe d'ordine con la data promessa passata e la merce non arrivata."
      >
        {!persone ? (
          <Scheletro altezza={220} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-text-muted border-b border-border font-tenorite">
                  <th className="py-2 pr-3">Persona</th>
                  <th className="py-2 px-2 text-right">Preventivi</th>
                  <th className="py-2 px-2 text-right">Righe prev.</th>
                  <th className="py-2 px-2 text-right">Ordini forn.</th>
                  <th className="py-2 px-2 text-right">Righe ord.</th>
                  <th className="py-2 px-2 text-right">Quota</th>
                  <th className="py-2 pl-2 text-right">Da sollecitare</th>
                </tr>
              </thead>
              <tbody>
                {persone.map((p) => (
                  <tr key={p.chiave} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-3">
                      {p.nome}
                      {p.condiviso && <span className="ml-1 text-[11px] text-text-muted">(utente condiviso)</span>}
                      <span className="ml-2 inline-flex gap-1">
                        {p.aree.map((a) => (
                          <span
                            key={a}
                            className={`text-[10px] px-1.5 py-0.5 rounded ${
                              a === "vendite" ? "bg-primary/10 text-primary" : "bg-warning/15 text-warning"
                            }`}
                          >
                            {a}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{p.preventivi ? numero(p.preventivi) : "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{p.righePreventivi ? numero(p.righePreventivi) : "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{p.ordiniFornitore ? numero(p.ordiniFornitore) : "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{p.righeOrdini ? numero(p.righeOrdini) : "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums font-medium">{percentuale(p.quotaPct)}</td>
                    <td className={`py-1.5 pl-2 text-right tabular-nums ${p.righeScadute > 0 ? "text-danger font-medium" : "text-text-muted"}`}>
                      {p.aree.includes("acquisti") ? numero(p.righeScadute) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {erroreAcquisti && (
              <p className="mt-2 text-xs text-warning">Ordini a fornitore non disponibili: {erroreAcquisti}</p>
            )}
          </div>
        )}
      </Scheda>

      <Scheda
        titolo="Carico complessivo"
        className="lg:col-span-2"
        sottotitolo={normalizzato ? "quota di ciascuno sul totale del mese" : "righe per mese, preventivi + ordini a fornitore"}
        info="Somma delle righe di preventivo e delle righe d'ordine a fornitore, impilate per persona. In modalità quote ogni mese vale 100% e si legge solo come il lavoro si ripartisce."
        azione={
          <button
            onClick={() => setNormalizzato((v) => !v)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-border hover:bg-bg-page"
          >
            {normalizzato ? "Mostra volumi" : "Mostra quote %"}
          </button>
        }
      >
        {carico.serie.length === 0 ? (
          <Scheletro altezza={300} />
        ) : (
          <AreeImpilate periodi={carico.periodi} serie={carico.serie} unita="numero" normalizzato={normalizzato} altezza={300} />
        )}
      </Scheda>
    </div>
  );
}
