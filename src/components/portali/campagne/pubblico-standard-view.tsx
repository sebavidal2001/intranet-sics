"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Info, Layers, Loader2, RotateCcw, Save, Search, TriangleAlert, UserRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SENZA_AGENTE,
  SENZA_CATEGORIA,
  appartieneAlPubblico,
  contaPubblico,
  modoAgente,
  raggruppaCategorie,
  raggruppaPerAgente,
  type GruppoAgente,
  type ModoAgente,
  type RegolaPubblico,
} from "@/lib/portali/campagne/regola";
import type { PubblicoStandardResponse } from "@/lib/portali/campagne/tipi";
import { chiamaApi } from "./api-client";
import { Messaggio, Pannello, Passo, TitoloPagina } from "./ui";

const num = (n: number) => n.toLocaleString("it-IT");
const NOMI_MODO: Record<ModoAgente, string> = { tutti: "Tutti", scelti: "Scelti a mano", nessuno: "Nessuno" };
const PAGINA = 150;

/** Una casella con lo stato «alcune»: serve alle famiglie di categorie. */
function CasellaTriStato({ stato, onChange, etichetta }: { stato: "tutte" | "alcune" | "nessuna"; onChange: () => void; etichetta: string }) {
  const rif = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (rif.current) rif.current.indeterminate = stato === "alcune";
  }, [stato]);
  return (
    <input
      ref={rif}
      type="checkbox"
      checked={stato === "tutte"}
      onChange={onChange}
      aria-label={etichetta}
      className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[#00a1be]"
    />
  );
}

/** Tre scelte mutuamente esclusive, una accanto all'altra: piu' chiare di un menu a tendina. */
function Segmentato({
  valore,
  opzioni,
  onChange,
  etichetta,
}: {
  valore: ModoAgente;
  opzioni: { valore: ModoAgente; disabilitata?: boolean }[];
  onChange: (v: ModoAgente) => void;
  etichetta: string;
}) {
  return (
    <div role="radiogroup" aria-label={etichetta} className="inline-flex rounded-lg border border-border bg-bg-page p-0.5">
      {opzioni.map((o) => {
        const attiva = o.valore === valore;
        return (
          <button
            key={o.valore}
            type="button"
            role="radio"
            aria-checked={attiva}
            disabled={o.disabilitata}
            onClick={() => onChange(o.valore)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              attiva ? "bg-primary text-white shadow-sm" : "text-text-muted hover:bg-white hover:text-text"
            }`}
          >
            {NOMI_MODO[o.valore]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Il pubblico standard: a chi si rivolge, di norma, una campagna. Si costruisce in
 * tre passi, e in basso si vede sempre a quanti clienti arriva, calcolato mentre si
 * sceglie. Vale per le campagne create DOPO: quelle esistenti hanno la loro fotografia.
 */
export function PubblicoStandardView({ iniziale }: { iniziale: PubblicoStandardResponse }) {
  const [dati, setDati] = useState(iniziale);
  const clienti = dati.clienti;

  const gruppi: GruppoAgente[] = useMemo(() => {
    const g = raggruppaPerAgente(clienti);
    // Un agente nella regola che non ha piu' clienti non deve sparire: resterebbe nascosto nella regola.
    for (const a of dati.config.agenti) if (!g.some((x) => x.agente.toUpperCase() === a.toUpperCase())) g.push({ agente: a, clienti: [] });
    return g;
  }, [clienti, dati.config.agenti]);

  const regolaSalvata: RegolaPubblico = useMemo(
    () => ({
      agenti: dati.config.agenti,
      categorie_commerciali: dati.config.categorie_commerciali,
      categorie_attivita: dati.config.categorie_attivita ?? [],
      clienti_extra: dati.config.clienti_extra,
    }),
    [dati.config]
  );

  const modiIniziali = (): Record<string, ModoAgente> =>
    Object.fromEntries(gruppi.map((g) => [g.agente, modoAgente(g.agente, regolaSalvata, g.clienti)]));

  const [modi, setModi] = useState<Record<string, ModoAgente>>(modiIniziali);
  const [extra, setExtra] = useState<Set<string>>(new Set(dati.config.clienti_extra));
  const [comm, setComm] = useState<string[]>(dati.config.categorie_commerciali);
  const [att, setAtt] = useState<string[]>(dati.config.categorie_attivita ?? []);
  const [apertoAgente, setApertoAgente] = useState<string | null>(null);
  const [apertaFamiglia, setApertaFamiglia] = useState<string | null>(null);
  const [filtroCat, setFiltroCat] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [esito, setEsito] = useState<{ tipo: "errore" | "ok"; testo: string } | null>(null);

  const agenteDi = useMemo(() => new Map(clienti.map((c) => [c.codice_cliente, c.agente_nome?.trim() || SENZA_AGENTE])), [clienti]);

  // La regola in modifica. Gli extra contano solo per gli agenti «scelti a mano»: se un agente
  // passa a «Tutti» o «Nessuno» le sue scelte singole non servono piu' (e non finiscono salvate).
  const regola: RegolaPubblico = useMemo(
    () => ({
      agenti: gruppi.filter((g) => modi[g.agente] === "tutti").map((g) => g.agente),
      categorie_commerciali: comm,
      categorie_attivita: att,
      clienti_extra: [...extra].filter((c) => modi[agenteDi.get(c) ?? ""] === "scelti"),
    }),
    [gruppi, modi, comm, att, extra, agenteDi]
  );

  const firma = (r: RegolaPubblico) =>
    JSON.stringify([[...r.agenti].sort(), [...r.categorie_commerciali].sort(), [...r.categorie_attivita].sort(), [...r.clienti_extra].sort()]);
  const modificato = firma(regola) !== firma(regolaSalvata);

  const totale = useMemo(() => contaPubblico(clienti, regola), [clienti, regola]);
  const perAgente = useMemo(
    () => Object.fromEntries(gruppi.map((g) => [g.agente, g.clienti.filter((c) => appartieneAlPubblico(c, regola)).length])),
    [gruppi, regola]
  );

  // Categorie commerciali presenti nei dati (Attivo, Potenziale...).
  const opzioniComm = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clienti) {
      const k = (c.cat_commerciale ?? "").trim();
      if (k && k !== "-") m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [clienti]);

  // Contesto delle categorie di attivita': quanti clienti ENTREREBBERO scegliendole, cioe' quelli
  // degli agenti presi «Tutti» che hanno le categorie commerciali scelte.
  const contestoAgenti = useMemo(() => new Set(regola.agenti.map((a) => a.toUpperCase())), [regola.agenti]);
  const contestoComm = useMemo(() => new Set(comm.map((k) => k.toUpperCase())), [comm]);
  const famiglie = useMemo(() => raggruppaCategorie(clienti), [clienti]);
  const entrerebbero = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clienti) {
      if (!contestoAgenti.has((c.agente_nome ?? "").trim().toUpperCase())) continue;
      if (!contestoComm.has((c.cat_commerciale ?? "").trim().toUpperCase())) continue;
      const k = (c.cat_attivita ?? "").trim() || SENZA_CATEGORIA;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [clienti, contestoAgenti, contestoComm]);
  const senzaCategoria = famiglie.find((f) => f.famiglia === SENZA_CATEGORIA)?.clienti ?? 0;
  const famiglieScegli = famiglie.filter((f) => f.famiglia !== SENZA_CATEGORIA);

  function impostaModo(agente: string, modo: ModoAgente) {
    setModi((m) => ({ ...m, [agente]: modo }));
    if (modo === "scelti") setApertoAgente(agente);
  }

  const alterna = (v: string[], valore: string) => (v.includes(valore) ? v.filter((x) => x !== valore) : [...v, valore]);

  function alternaFamiglia(categorie: string[], stato: "tutte" | "alcune" | "nessuna") {
    setAtt((a) => (stato === "tutte" ? a.filter((x) => !categorie.includes(x)) : [...new Set([...a, ...categorie])]));
  }

  function ripristina() {
    setModi(modiIniziali());
    setExtra(new Set(dati.config.clienti_extra));
    setComm(dati.config.categorie_commerciali);
    setAtt(dati.config.categorie_attivita ?? []);
    setEsito(null);
  }

  async function salva() {
    setOccupato(true);
    setEsito(null);
    const r = await chiamaApi<PubblicoStandardResponse>("/api/portali/campagne/pubblico-standard", {
      metodo: "PUT",
      corpo: {
        agenti: regola.agenti,
        categorie_commerciali: regola.categorie_commerciali,
        categorie_attivita: regola.categorie_attivita,
        clienti_extra: regola.clienti_extra,
      },
    });
    setOccupato(false);
    if (!r.ok) {
      setEsito({ tipo: "errore", testo: r.errore });
      return;
    }
    setDati(r.dati);
    const salvata: RegolaPubblico = {
      agenti: r.dati.config.agenti,
      categorie_commerciali: r.dati.config.categorie_commerciali,
      categorie_attivita: r.dati.config.categorie_attivita ?? [],
      clienti_extra: r.dati.config.clienti_extra,
    };
    const attesi = contaPubblico(r.dati.clienti, salvata);
    setEsito(
      attesi === r.dati.raggiunti
        ? { tipo: "ok", testo: `Salvato. Il pubblico standard raggiunge ${num(r.dati.raggiunti)} clienti.` }
        : { tipo: "errore", testo: `Salvato, ma il conteggio del server (${num(r.dati.raggiunti)}) è diverso da quello mostrato (${num(attesi)}): avvisa chi gestisce il portale.` }
    );
  }

  return (
    <div className="mx-auto max-w-4xl pb-24">
      <TitoloPagina
        icona={Users}
        titolo="Pubblico standard"
        sottotitolo="A chi si rivolge, di norma, ogni nuova campagna. Costruiscilo in tre passi: in basso vedi sempre a quanti clienti arriva. I rivenditori sono esclusi sempre."
      />

      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-text">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="leading-relaxed">
          Questa è la <strong>regola di partenza</strong>: quando crei una campagna puoi applicarla con un clic e poi ritoccarla.
          Cambiarla qui <strong>non modifica le campagne già create</strong>, che conservano i loro destinatari.
        </p>
      </div>

      {/* ─── PASSO 1: i commerciali ─── */}
      <Pannello className="mb-6">
        <Passo numero={1} titolo="Di quali commerciali sono i clienti?">
          Per ogni commerciale scegli se prenderli <strong>tutti</strong>, solo alcuni <strong>scelti a mano</strong>, oppure <strong>nessuno</strong>.
        </Passo>
        <ul className="mt-4 space-y-2.5">
          {gruppi.map((g) => (
            <AccordionAgente
              key={g.agente}
              gruppo={g}
              modo={modi[g.agente] ?? "nessuno"}
              inclusi={perAgente[g.agente] ?? 0}
              aperto={apertoAgente === g.agente}
              extra={extra}
              onApri={() => setApertoAgente((a) => (a === g.agente ? null : g.agente))}
              onModo={(m) => impostaModo(g.agente, m)}
              onExtra={setExtra}
            />
          ))}
        </ul>
      </Pannello>

      {/* ─── PASSO 2: stato commerciale ─── */}
      <Pannello className="mb-6">
        <Passo numero={2} titolo="Solo clienti, o anche potenziali?">
          Vale per i commerciali presi «Tutti». «Attivo» sono i clienti che comprano; «Potenziale» quelli che ancora non hanno comprato.
        </Passo>
        <div className="mt-4 flex flex-wrap gap-2.5">
          {opzioniComm.map(([nome, n]) => {
            const scelta = comm.some((k) => k.toUpperCase() === nome.toUpperCase());
            return (
              <button
                key={nome}
                type="button"
                aria-pressed={scelta}
                onClick={() => setComm((c) => alterna(c, nome))}
                className={`flex items-center gap-2.5 rounded-xl border-2 px-4 py-2.5 text-left transition-colors ${
                  scelta ? "border-primary bg-primary/5" : "border-border bg-white hover:border-primary/40"
                }`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-md border-2 ${scelta ? "border-primary bg-primary text-white" : "border-border"}`}>
                  {scelta ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-text">{nome}</span>
                  <span className="block text-xs text-text-muted">{num(n)} clienti</span>
                </span>
              </button>
            );
          })}
        </div>
        {comm.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-warning">
            <TriangleAlert className="h-4 w-4" aria-hidden /> Nessuna scelta: i commerciali presi «Tutti» non porteranno nessun cliente.
          </p>
        ) : null}
      </Pannello>

      {/* ─── PASSO 3: categorie di attivita' ─── */}
      <Pannello className="mb-6">
        <Passo numero={3} titolo="Che tipo di attività fanno?">
          Scegli le categorie (costruttori, impiantisti, riparatori…) oppure <strong>lascia tutto spento per prenderle tutte</strong>. Vale per i commerciali presi «Tutti»:
          i clienti scelti a mano restano dentro comunque.
        </Passo>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <Input value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)} placeholder="Cerca una categoria…" className="pl-9" aria-label="Cerca una categoria" />
          </div>
          <p className="text-sm">
            {att.length === 0 ? (
              <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">Tutte le categorie</span>
            ) : (
              <span className="flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary-dark">{num(att.length)} categorie scelte</span>
                <button type="button" onClick={() => setAtt([])} className="text-xs font-medium text-text-muted underline-offset-2 hover:text-primary hover:underline">
                  Togli tutte
                </button>
              </span>
            )}
          </p>
        </div>

        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {famiglieScegli.map((f) => {
            const filtro = filtroCat.trim().toLowerCase();
            const voci = f.categorie.filter((v) => !filtro || v.categoria.toLowerCase().includes(filtro) || f.nome.toLowerCase().includes(filtro));
            if (voci.length === 0) return null;
            const nomi = f.categorie.map((v) => v.categoria);
            const scelte = nomi.filter((n) => att.includes(n)).length;
            const stato = scelte === 0 ? "nessuna" : scelte === nomi.length ? "tutte" : "alcune";
            const aperta = apertaFamiglia === f.famiglia || filtro !== "";
            const entreranno = nomi.reduce((s, n) => s + (entrerebbero.get(n) ?? 0), 0);
            return (
              <li key={f.famiglia} className="bg-white">
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <CasellaTriStato stato={stato} onChange={() => alternaFamiglia(nomi, stato)} etichetta={`Seleziona tutte le categorie ${f.nome}`} />
                  <button
                    type="button"
                    onClick={() => setApertaFamiglia((x) => (x === f.famiglia ? null : f.famiglia))}
                    aria-expanded={aperta}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {aperta ? <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />}
                    <span className="truncate text-sm font-semibold text-text">{f.nome}</span>
                    <span className="shrink-0 rounded bg-bg-page px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{f.famiglia}</span>
                    <span className="shrink-0 text-xs text-text-muted">· {nomi.length} categorie</span>
                  </button>
                  <span className="shrink-0 text-right text-xs text-text-muted">
                    {scelte > 0 ? <strong className="text-primary-dark">{scelte}/{nomi.length} scelte · </strong> : null}
                    {num(entreranno)} clienti
                  </span>
                </div>
                {aperta ? (
                  <ul className="border-t border-border bg-bg-page/60 px-4 py-2">
                    {voci.map((v) => (
                      <li key={v.categoria}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-white">
                          <input
                            type="checkbox"
                            checked={att.includes(v.categoria)}
                            onChange={() => setAtt((a) => alterna(a, v.categoria))}
                            className="h-4 w-4 cursor-pointer rounded border-border accent-[#00a1be]"
                          />
                          <span className="min-w-0 flex-1 truncate">{v.categoria}</span>
                          <span className="shrink-0 text-xs text-text-muted">{num(entrerebbero.get(v.categoria) ?? 0)} clienti</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        {senzaCategoria > 0 ? (
          <p className="mt-2 text-xs text-text-muted">
            {num(senzaCategoria)} clienti non hanno una categoria di attività: rientrano solo se non scegli nessuna categoria.
          </p>
        ) : null}
      </Pannello>

      {/* ─── Barra fissa: il conto e il salvataggio ─── */}
      {/* Fissa in basso, accanto alla barra laterale (220px): `sticky` non va, il contenitore della pagina ha overflow senza altezza. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white/95 backdrop-blur md:left-[220px]" style={{ boxShadow: "0 -8px 24px rgba(15,23,32,0.06)" }}>
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-4">
            <div>
              <p className="font-tenorite text-2xl font-bold leading-none text-text" aria-live="polite">
                {num(totale)}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">clienti raggiunti</p>
            </div>
            <ul className="hidden flex-wrap gap-1.5 sm:flex">
              {gruppi
                .filter((g) => (perAgente[g.agente] ?? 0) > 0)
                .map((g) => (
                  <li key={g.agente} className="rounded-full bg-bg-page px-2.5 py-1 text-xs text-text-muted">
                    <UserRound className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden />
                    {g.agente} <strong className="text-text">{num(perAgente[g.agente] ?? 0)}</strong>
                  </li>
                ))}
            </ul>
          </div>
          <div className="flex items-center gap-3">
            {esito ? <div className="max-w-md text-xs"><Messaggio tipo={esito.tipo}>{esito.testo}</Messaggio></div> : null}
            {totale === 0 ? <span className="text-xs font-medium text-warning">Questa regola non raggiunge nessun cliente</span> : null}
            {modificato ? <span className="text-xs font-medium text-warning">Modifiche non salvate</span> : null}
            <Button variant="ghost" onClick={ripristina} disabled={!modificato || occupato}>
              <RotateCcw className="h-4 w-4" /> Annulla
            </Button>
            <Button onClick={salva} disabled={!modificato || occupato}>
              {occupato ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salva
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Un commerciale ────────────────────────────────────────────────────────
function AccordionAgente({
  gruppo,
  modo,
  inclusi,
  aperto,
  extra,
  onApri,
  onModo,
  onExtra,
}: {
  gruppo: GruppoAgente;
  modo: ModoAgente;
  inclusi: number;
  aperto: boolean;
  extra: Set<string>;
  onApri: () => void;
  onModo: (m: ModoAgente) => void;
  onExtra: (s: Set<string>) => void;
}) {
  const [q, setQ] = useState("");
  const [soloScelti, setSoloScelti] = useState(false);
  const [mostrati, setMostrati] = useState(PAGINA);

  const t = q.trim().toLowerCase();
  const visibili = useMemo(
    () =>
      gruppo.clienti.filter(
        (c) => (!t || `${c.ragione_sociale} ${c.codice_cliente} ${c.cat_attivita ?? ""}`.toLowerCase().includes(t)) && (!soloScelti || extra.has(c.codice_cliente))
      ),
    [gruppo.clienti, t, soloScelti, extra]
  );
  const sceltiQui = gruppo.clienti.filter((c) => extra.has(c.codice_cliente)).length;
  const senzaAgente = gruppo.agente === SENZA_AGENTE;

  function imposta(codici: string[], dentro: boolean) {
    const n = new Set(extra);
    for (const c of codici) dentro ? n.add(c) : n.delete(c);
    onExtra(n);
  }

  const riepilogo =
    modo === "tutti"
      ? `Tutti i clienti che rientrano nei passi 2 e 3`
      : modo === "scelti"
        ? `${num(sceltiQui)} scelti a mano`
        : "Nessun cliente";

  return (
    <li className={`overflow-hidden rounded-xl border transition-colors ${modo === "nessuno" ? "border-border bg-white" : "border-primary/30 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button type="button" onClick={onApri} aria-expanded={aperto} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {aperto ? <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserRound className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-text">{gruppo.agente}</span>
            <span className="block truncate text-xs text-text-muted">
              {num(gruppo.clienti.length)} clienti · {riepilogo}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${inclusi > 0 ? "bg-primary/10 text-primary-dark" : "bg-bg-page text-text-muted"}`}>
            {num(inclusi)} inclusi
          </span>
          <Segmentato
            etichetta={`Come prendere i clienti di ${gruppo.agente}`}
            valore={modo}
            onChange={onModo}
            opzioni={[{ valore: "tutti", disabilitata: senzaAgente }, { valore: "scelti" }, { valore: "nessuno" }]}
          />
        </div>
      </div>

      {aperto ? (
        <div className="border-t border-border bg-bg-page/50 px-4 py-4">
          {modo === "tutti" ? (
            <p className="flex items-start gap-2 text-sm text-text-muted">
              <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              Si prendono tutti i clienti di {gruppo.agente} che hanno lo stato scelto al passo 2 e le categorie scelte al passo 3 ({num(inclusi)} oggi).
              Per sceglierli uno per uno passa a «Scelti a mano».
            </p>
          ) : null}
          {modo === "nessuno" ? (
            <p className="text-sm text-text-muted">
              Nessun cliente di {gruppo.agente} entra nel pubblico. Passa a «Tutti» o «Scelti a mano» per includerli.
            </p>
          ) : null}
          {modo === "scelti" ? (
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
                  <Input
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setMostrati(PAGINA);
                    }}
                    placeholder="Cerca per nome, codice o categoria…"
                    aria-label={`Cerca fra i clienti di ${gruppo.agente}`}
                    className="pl-9"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted">
                  <input type="checkbox" checked={soloScelti} onChange={(e) => setSoloScelti(e.target.checked)} className="accent-[#00a1be]" />
                  Solo i scelti
                </label>
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => imposta(visibili.map((c) => c.codice_cliente), true)} disabled={visibili.length === 0}>
                    Scegli i {num(visibili.length)} visibili
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => imposta(visibili.map((c) => c.codice_cliente), false)} disabled={visibili.length === 0}>
                    Togli i visibili
                  </Button>
                </span>
              </div>
              <p className="mb-2 text-xs text-text-muted">
                <strong className="text-text">{num(sceltiQui)}</strong> scelti su {num(gruppo.clienti.length)}. I clienti scelti a mano entrano a prescindere dai passi 2 e 3.
              </p>
              <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-white">
                {visibili.slice(0, mostrati).map((c) => (
                  <li key={c.codice_cliente}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-bg-page/70">
                      <input
                        type="checkbox"
                        checked={extra.has(c.codice_cliente)}
                        onChange={(e) => imposta([c.codice_cliente], e.target.checked)}
                        className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[#00a1be]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-text">{c.ragione_sociale}</span>
                        <span className="block truncate text-xs text-text-muted">
                          {c.codice_cliente}
                          {c.cat_attivita ? ` · ${c.cat_attivita}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-text-muted">{c.cat_commerciale && c.cat_commerciale !== "-" ? c.cat_commerciale : ""}</span>
                    </label>
                  </li>
                ))}
                {visibili.length === 0 ? <li className="px-3 py-6 text-center text-sm text-text-muted">Nessun cliente corrisponde.</li> : null}
              </ul>
              {visibili.length > mostrati ? (
                <button type="button" onClick={() => setMostrati((m) => m + PAGINA)} className="mt-2 text-sm font-medium text-primary hover:underline">
                  Mostra altri {num(Math.min(PAGINA, visibili.length - mostrati))} (di {num(visibili.length - mostrati)})
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
