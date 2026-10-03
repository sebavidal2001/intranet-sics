"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  Layers,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Trash2,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";
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
  type ClientePubblico,
  type GruppoAgente,
  type ModoAgente,
  type RegolaPubblico,
} from "@/lib/portali/campagne/regola";
import type { PubblicoResponse } from "@/lib/portali/campagne/tipi";
import { chiamaApi } from "./api-client";
import { ListaClientiSceglibili } from "./lista-clienti-sceglibili";
import { Campo, Messaggio, Pannello, Passo, StatoCampagnaChip, TitoloPagina } from "./ui";

const num = (n: number) => n.toLocaleString("it-IT");
const NOMI_MODO: Record<ModoAgente, string> = { tutti: "Tutti", scelti: "Scelti a mano", nessuno: "Nessuno" };

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

const normCat = (c: ClientePubblico) => (c.cat_attivita ?? "").trim() || SENZA_CATEGORIA;

/**
 * Un pubblico (target) di campagna: lo standard, oppure uno costruito per una campagna
 * diversa. Si costruisce in tre passi e in basso si vede sempre a quanti clienti arriva,
 * calcolato mentre si sceglie. Cambiarlo non modifica i destinatari delle campagne già
 * create: ogni campagna ha la sua fotografia, e dalla sua scheda si aggiungono i nuovi.
 */
export function PubblicoView({ iniziale }: { iniziale: PubblicoResponse }) {
  const router = useRouter();
  const [dati, setDati] = useState(iniziale);
  const clienti = dati.clienti;
  const standard = dati.config.standard;

  const [nome, setNome] = useState(dati.config.nome);
  const [descrizione, setDescrizione] = useState(dati.config.descrizione ?? "");

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
  const [apertaCategoria, setApertaCategoria] = useState<string | null>(null);
  const [filtroCat, setFiltroCat] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [esito, setEsito] = useState<{ tipo: "errore" | "ok"; testo: string } | null>(null);

  const agenteDi = useMemo(() => new Map(clienti.map((c) => [c.codice_cliente, c.agente_nome?.trim() || SENZA_AGENTE])), [clienti]);

  // La regola in modifica. I clienti scelti a mano contano sempre: li si puo' spuntare sia sotto un
  // commerciale sia sotto una categoria, e restano dentro a prescindere dai filtri.
  const regola: RegolaPubblico = useMemo(
    () => ({
      agenti: gruppi.filter((g) => modi[g.agente] === "tutti").map((g) => g.agente),
      categorie_commerciali: comm,
      categorie_attivita: att,
      clienti_extra: [...extra],
    }),
    [gruppi, modi, comm, att, extra]
  );
  // La stessa regola senza le scelte a mano: dice chi e' dentro «per regola».
  const soloRegola: RegolaPubblico = useMemo(() => ({ ...regola, clienti_extra: [] }), [regola]);
  const daRegola = (c: ClientePubblico) => appartieneAlPubblico(c, soloRegola);

  const firma = (r: RegolaPubblico, n: string, d: string) =>
    JSON.stringify([n.trim(), d.trim(), [...r.agenti].sort(), [...r.categorie_commerciali].sort(), [...r.categorie_attivita].sort(), [...r.clienti_extra].sort()]);
  const modificato = firma(regola, nome, descrizione) !== firma(regolaSalvata, dati.config.nome, dati.config.descrizione ?? "");

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
      const k = normCat(c);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [clienti, contestoAgenti, contestoComm]);
  const clientiPerCategoria = useMemo(() => {
    const m = new Map<string, ClientePubblico[]>();
    for (const c of clienti) {
      const k = normCat(c);
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    for (const lista of m.values()) lista.sort((a, b) => a.ragione_sociale.localeCompare(b.ragione_sociale));
    return m;
  }, [clienti]);
  const senzaCategoria = famiglie.find((f) => f.famiglia === SENZA_CATEGORIA)?.clienti ?? 0;
  const famiglieScegli = famiglie.filter((f) => f.famiglia !== SENZA_CATEGORIA);
  const sceltiInCategoria = (categoria: string) => (clientiPerCategoria.get(categoria) ?? []).filter((c) => extra.has(c.codice_cliente)).length;

  function impostaModo(agente: string, modo: ModoAgente) {
    setModi((m) => ({ ...m, [agente]: modo }));
    if (modo === "scelti") setApertoAgente(agente);
    // «Nessuno» e' una scelta esplicita: le scelte a mano di quel commerciale non servono piu'.
    if (modo === "nessuno") {
      const suoi = new Set(clienti.filter((c) => (c.agente_nome?.trim() || SENZA_AGENTE) === agente).map((c) => c.codice_cliente));
      setExtra((e) => new Set([...e].filter((c) => !suoi.has(c))));
    }
  }

  // Cosa mostrare sul commutatore di un commerciale: se ha clienti scelti a mano (anche da una categoria)
  // il suo modo e' «Scelti a mano», qualunque cosa fosse prima.
  const modoVisto = (g: GruppoAgente): ModoAgente => {
    const m = modi[g.agente] ?? "nessuno";
    if (m === "nessuno" && g.clienti.some((c) => extra.has(c.codice_cliente))) return "scelti";
    return m;
  };

  const alterna = (v: string[], valore: string) => (v.includes(valore) ? v.filter((x) => x !== valore) : [...v, valore]);

  function alternaFamiglia(categorie: string[], stato: "tutte" | "alcune" | "nessuna") {
    setAtt((a) => (stato === "tutte" ? a.filter((x) => !categorie.includes(x)) : [...new Set([...a, ...categorie])]));
  }

  function ripristina() {
    setModi(modiIniziali());
    setExtra(new Set(dati.config.clienti_extra));
    setComm(dati.config.categorie_commerciali);
    setAtt(dati.config.categorie_attivita ?? []);
    setNome(dati.config.nome);
    setDescrizione(dati.config.descrizione ?? "");
    setEsito(null);
  }

  async function salva() {
    setOccupato(true);
    setEsito(null);
    const r = await chiamaApi<PubblicoResponse>(`/api/portali/campagne/pubblici/${dati.config.id}`, {
      metodo: "PUT",
      corpo: {
        nome: nome.trim(),
        descrizione: descrizione.trim() || null,
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
        ? { tipo: "ok", testo: `Salvato. Questo pubblico raggiunge ${num(r.dati.raggiunti)} clienti.` }
        : { tipo: "errore", testo: `Salvato, ma il conteggio del server (${num(r.dati.raggiunti)}) è diverso da quello mostrato (${num(attesi)}): avvisa chi gestisce il portale.` }
    );
  }

  async function elimina() {
    if (!window.confirm(`Eliminare il pubblico «${dati.config.nome}»? Non si può annullare.`)) return;
    setOccupato(true);
    const r = await chiamaApi<{ ok: true }>(`/api/portali/campagne/pubblici/${dati.config.id}`, { metodo: "DELETE" });
    setOccupato(false);
    if (!r.ok) {
      setEsito({ tipo: "errore", testo: r.errore });
      return;
    }
    router.push("/campagne/pubblico");
    router.refresh();
  }

  const usatoDa = dati.campagne;

  return (
    <div className="mx-auto max-w-4xl pb-24">
      <Link href="/campagne/pubblico" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Tutti i pubblici
      </Link>
      <TitoloPagina
        icona={Users}
        titolo={standard ? "Pubblico standard" : dati.config.nome}
        sottotitolo={
          standard
            ? "A chi si rivolge, di norma, ogni nuova campagna. Costruiscilo in tre passi: in basso vedi sempre a quanti clienti arriva. I rivenditori sono esclusi sempre."
            : "Un pubblico per le campagne che non seguono lo standard. Costruiscilo in tre passi: in basso vedi sempre a quanti clienti arriva. I rivenditori sono esclusi sempre."
        }
        azioni={
          standard ? (
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary-dark">Predefinito per le nuove campagne</span>
          ) : (
            <Button variant="ghost" onClick={elimina} disabled={occupato || usatoDa.length > 0} title={usatoDa.length > 0 ? "È usato da almeno una campagna" : undefined}>
              <Trash2 className="h-4 w-4" /> Elimina
            </Button>
          )
        }
      />

      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-text">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="leading-relaxed">
          <p>
            {standard ? (
              <>Ogni campagna nuova riceve questo pubblico, se non ne scegli un altro. </>
            ) : (
              <>Si assegna a una campagna dalla sua scheda (o alla creazione). </>
            )}
            Cambiarlo <strong>non modifica i destinatari delle campagne già create</strong>: dalla scheda di ogni campagna potrai aggiungere i clienti che nel frattempo rientrano.
          </p>
          {usatoDa.length > 0 ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-text-muted">Lo usano:</span>
              {usatoDa.map((c) => (
                <Link key={c.id} href={`/campagne/gestione/${c.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-0.5 text-xs font-medium text-text hover:border-primary/50">
                  {c.codice} <StatoCampagnaChip stato={c.stato} />
                </Link>
              ))}
            </p>
          ) : (
            <p className="mt-1.5 text-text-muted">Nessuna campagna lo usa per ora.</p>
          )}
        </div>
      </div>

      {/* ─── Nome ─── */}
      <Pannello className="mb-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etichetta="Nome del pubblico" aiuto={standard ? "Il nome dello standard si può cambiare, ma resta lo standard." : "Lo vedi nel menu quando crei una campagna."}>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} aria-label="Nome del pubblico" />
          </Campo>
          <Campo etichetta="Descrizione" aiuto="Facoltativa: a chi serve, perché.">
            <Input value={descrizione} onChange={(e) => setDescrizione(e.target.value)} maxLength={300} aria-label="Descrizione del pubblico" />
          </Campo>
        </div>
      </Pannello>

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
              modo={modoVisto(g)}
              inclusi={perAgente[g.agente] ?? 0}
              aperto={apertoAgente === g.agente}
              extra={extra}
              daRegola={daRegola}
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
          {opzioniComm.map(([nomeComm, n]) => {
            const scelta = comm.some((k) => k.toUpperCase() === nomeComm.toUpperCase());
            return (
              <button
                key={nomeComm}
                type="button"
                aria-pressed={scelta}
                onClick={() => setComm((c) => alterna(c, nomeComm))}
                className={`flex items-center gap-2.5 rounded-xl border-2 px-4 py-2.5 text-left transition-colors ${
                  scelta ? "border-primary bg-primary/5" : "border-border bg-white hover:border-primary/40"
                }`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-md border-2 ${scelta ? "border-primary bg-primary text-white" : "border-border"}`}>
                  {scelta ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-text">{nomeComm}</span>
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
          Spunta le categorie (costruttori, impiantisti, riparatori…) oppure <strong>lascia tutto spento per prenderle tutte</strong>. Vale per i commerciali presi «Tutti».
          Apri una categoria con la freccia per <strong>scegliere anche i singoli clienti</strong>: quelli scelti a mano entrano comunque.
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
            const aMano = nomi.reduce((s, n) => s + sceltiInCategoria(n), 0);
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
                    {aMano > 0 ? <strong className="text-primary-dark">{num(aMano)} a mano · </strong> : null}
                    {num(entreranno)} clienti
                  </span>
                </div>
                {aperta ? (
                  <ul className="border-t border-border bg-bg-page/60 px-4 py-2">
                    {voci.map((v) => (
                      <CategoriaRiga
                        key={v.categoria}
                        categoria={v.categoria}
                        filtrata={att.includes(v.categoria)}
                        entrerebbero={entrerebbero.get(v.categoria) ?? 0}
                        clienti={clientiPerCategoria.get(v.categoria) ?? []}
                        aMano={sceltiInCategoria(v.categoria)}
                        aperta={apertaCategoria === v.categoria}
                        onApri={() => setApertaCategoria((x) => (x === v.categoria ? null : v.categoria))}
                        onFiltro={() => setAtt((a) => alterna(a, v.categoria))}
                        extra={extra}
                        daRegola={daRegola}
                        onExtra={setExtra}
                      />
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
          {senzaCategoria > 0 && !filtroCat.trim() ? (
            <li className="bg-white">
              <ul className="px-4 py-2">
                <CategoriaRiga
                  categoria={SENZA_CATEGORIA}
                  filtrata={false}
                  senzaFiltro
                  entrerebbero={entrerebbero.get(SENZA_CATEGORIA) ?? 0}
                  clienti={clientiPerCategoria.get(SENZA_CATEGORIA) ?? []}
                  aMano={sceltiInCategoria(SENZA_CATEGORIA)}
                  aperta={apertaCategoria === SENZA_CATEGORIA}
                  onApri={() => setApertaCategoria((x) => (x === SENZA_CATEGORIA ? null : SENZA_CATEGORIA))}
                  onFiltro={() => undefined}
                  extra={extra}
                  daRegola={daRegola}
                  onExtra={setExtra}
                />
              </ul>
            </li>
          ) : null}
        </ul>
        {senzaCategoria > 0 ? (
          <p className="mt-2 text-xs text-text-muted">
            {num(senzaCategoria)} clienti non hanno una categoria di attività: rientrano solo se non scegli nessuna categoria, oppure scegliendoli uno per uno.
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
            {totale === 0 ? <span className="text-xs font-medium text-warning">Questo pubblico non raggiunge nessun cliente</span> : null}
            {modificato ? <span className="text-xs font-medium text-warning">Modifiche non salvate</span> : null}
            <Button variant="ghost" onClick={ripristina} disabled={!modificato || occupato}>
              <RotateCcw className="h-4 w-4" /> Annulla
            </Button>
            <Button onClick={salva} disabled={!modificato || occupato || !nome.trim()}>
              {occupato ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salva
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Una categoria di attivita' ────────────────────────────────────────────
/**
 * Una categoria: la casella la mette nel filtro del passo 3; la freccia ne apre i clienti,
 * da spuntare uno per uno. Sono due cose diverse e tutte e due servono: «tutti i costruttori»
 * oppure «solo questi tre costruttori».
 */
function CategoriaRiga({
  categoria,
  filtrata,
  senzaFiltro = false,
  entrerebbero,
  clienti,
  aMano,
  aperta,
  onApri,
  onFiltro,
  extra,
  daRegola,
  onExtra,
}: {
  categoria: string;
  filtrata: boolean;
  /** «Senza categoria» non si puo' mettere nel filtro: i suoi clienti si scelgono solo uno per uno. */
  senzaFiltro?: boolean;
  entrerebbero: number;
  clienti: ClientePubblico[];
  aMano: number;
  aperta: boolean;
  onApri: () => void;
  onFiltro: () => void;
  extra: Set<string>;
  daRegola: (c: ClientePubblico) => boolean;
  onExtra: (s: Set<string>) => void;
}) {
  return (
    <li>
      <div className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-white">
        {senzaFiltro ? (
          <span className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <input
            type="checkbox"
            checked={filtrata}
            onChange={onFiltro}
            aria-label={`Includi la categoria ${categoria}`}
            className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[#00a1be]"
          />
        )}
        <button type="button" onClick={onApri} aria-expanded={aperta} aria-label={`Clienti della categoria ${categoria}`} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {aperta ? <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />}
          <span className="min-w-0 flex-1 truncate">{categoria}</span>
        </button>
        <span className="shrink-0 text-xs text-text-muted">
          {aMano > 0 ? <strong className="text-primary-dark">{num(aMano)} a mano · </strong> : null}
          {num(entrerebbero)} / {num(clienti.length)} clienti
        </span>
      </div>
      {aperta ? (
        <div className="mb-2 ml-9 mr-2 mt-1">
          <ListaClientiSceglibili
            clienti={clienti}
            extra={extra}
            daRegola={daRegola}
            onExtra={onExtra}
            etichetta={`Cerca fra i clienti della categoria ${categoria}`}
            mostraAgente
            mostraCategoria={false}
          />
        </div>
      ) : null}
    </li>
  );
}

// ─── Un commerciale ────────────────────────────────────────────────────────
function AccordionAgente({
  gruppo,
  modo,
  inclusi,
  aperto,
  extra,
  daRegola,
  onApri,
  onModo,
  onExtra,
}: {
  gruppo: GruppoAgente;
  modo: ModoAgente;
  inclusi: number;
  aperto: boolean;
  extra: Set<string>;
  daRegola: (c: ClientePubblico) => boolean;
  onApri: () => void;
  onModo: (m: ModoAgente) => void;
  onExtra: (s: Set<string>) => void;
}) {
  const sceltiQui = gruppo.clienti.filter((c) => extra.has(c.codice_cliente)).length;
  const senzaAgente = gruppo.agente === SENZA_AGENTE;

  const riepilogo =
    modo === "tutti" ? `Tutti i clienti che rientrano nei passi 2 e 3` : modo === "scelti" ? `${num(sceltiQui)} scelti a mano` : "Nessun cliente";

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
            <ListaClientiSceglibili
              clienti={gruppo.clienti}
              extra={extra}
              daRegola={daRegola}
              onExtra={onExtra}
              etichetta={`Cerca fra i clienti di ${gruppo.agente}`}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
