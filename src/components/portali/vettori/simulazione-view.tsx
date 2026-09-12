"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, CheckCircle2, Info, Loader2, MapPin, PackagePlus, Plus, Save, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConfermaSimulazione, CondizioneSpedizione, EsitoCap, EsitoSimulazione, GruppoColli, RispostaSimulazione } from "@/lib/portali/vettori/tipi";

interface GruppoDraft { id: string; quantita: string; lunghezzaCm: string; larghezzaCm: string; altezzaCm: string }
interface DatiSimulazione {
  direzione: "uscita"; cap: string | null; provincia: string | null;
  controparteCodice: string | null; colli: number; pesoKg: number; gruppi: GruppoColli[];
  lunghezzaCm: null; larghezzaCm: null; altezzaCm: null; data: string;
  condizioni: CondizioneSpedizione[];
}

const CONDIZIONI: Array<{ slug: CondizioneSpedizione; etichetta: string }> = [
  { slug: "bancale", etichetta: "Su bancale" }, { slug: "non_sovrapponibile", etichetta: "Non sovrapponibile" },
  { slug: "oversized", etichetta: "Fuori sagoma" }, { slug: "ztl", etichetta: "Zona a traffico limitato" },
  { slug: "fuori_provincia", etichetta: "Fuori provincia" }, { slug: "movimentazione_manuale", etichetta: "Movimentazione manuale" },
];
const eur = (n: number) => n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const formato = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 });
const oggi = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10) };
const nuovoGruppo = (): GruppoDraft => ({ id: globalThis.crypto?.randomUUID?.() ?? `g-${Date.now()}-${Math.random()}`, quantita: "1", lunghezzaCm: "", larghezzaCm: "", altezzaCm: "" });
const num = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : 0 };
function errorePayload(v: unknown, fallback: string) { return typeof v === "object" && v !== null && "error" in v && typeof v.error === "string" ? v.error : fallback }

export function SimulazioneView() {
  const [cap, setCap] = useState("");
  const [esitoCap, setEsitoCap] = useState<EsitoCap | null>(null);
  const [capNonRisolto, setCapNonRisolto] = useState(false);
  const [capInCorso, setCapInCorso] = useState(false);
  const [provinciaScelta, setProvinciaScelta] = useState("");
  const [provinciaManuale, setProvinciaManuale] = useState("");
  const [peso, setPeso] = useState("");
  const [codiceCliente, setCodiceCliente] = useState("");
  const [gruppi, setGruppi] = useState<GruppoDraft[]>([nuovoGruppo()]);
  const [condizioni, setCondizioni] = useState<CondizioneSpedizione[]>([]);
  const [risposta, setRisposta] = useState<RispostaSimulazione | null>(null);
  const [datiInviati, setDatiInviati] = useState<DatiSimulazione | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [vettoreId, setVettoreId] = useState("");
  const [confermaAperta, setConfermaAperta] = useState(false);
  const [numeroBolla, setNumeroBolla] = useState("");
  const [numeroDopo, setNumeroDopo] = useState(false);
  const [dataDocumento, setDataDocumento] = useState(oggi);
  const [controparte, setControparte] = useState("");
  const [salvataggio, setSalvataggio] = useState(false);
  const [conferma, setConferma] = useState<ConfermaSimulazione | null>(null);

  useEffect(() => {
    setEsitoCap(null); setCapNonRisolto(false); setProvinciaScelta("");
    if (!/^\d{5}$/.test(cap)) { setCapInCorso(false); return }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCapInCorso(true);
      try {
        const res = await fetch(`/api/portali/vettori/cap/${cap}`, { signal: controller.signal, cache: "no-store" });
        if (res.status === 404) { setCapNonRisolto(true); return }
        const body: unknown = await res.json();
        if (!res.ok) throw new Error(errorePayload(body, "CAP non verificabile."));
        setEsitoCap(body as EsitoCap);
      } catch (causa) {
        if (!(causa instanceof DOMException && causa.name === "AbortError")) setCapNonRisolto(true);
      } finally { if (!controller.signal.aborted) setCapInCorso(false) }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort() };
  }, [cap]);

  const gruppiValidi = useMemo<GruppoColli[]>(() => gruppi.flatMap((g) => {
    const valori = { quantita: Math.round(num(g.quantita)), lunghezzaCm: num(g.lunghezzaCm), larghezzaCm: num(g.larghezzaCm), altezzaCm: num(g.altezzaCm) };
    return Object.values(valori).every((v) => v > 0) ? [valori] : [];
  }), [gruppi]);
  const colli = gruppiValidi.reduce((s, g) => s + g.quantita, 0);
  const volume = gruppiValidi.reduce((s, g) => s + g.quantita * g.lunghezzaCm * g.larghezzaCm * g.altezzaCm / 1_000_000, 0);
  const provincia = provinciaScelta || (esitoCap?.certo && esitoCap.province.length === 1 ? esitoCap.province[0] : "") || provinciaManuale.trim().toUpperCase();

  function prepara(): DatiSimulazione | null {
    if (num(peso) <= 0) { setErrore("Inserisci un peso totale maggiore di zero."); return null }
    if (gruppiValidi.length !== gruppi.length) { setErrore("Completa quantità e dimensioni di tutti i gruppi con valori maggiori di zero."); return null }
    if (esitoCap?.estero) { setErrore("La destinazione è internazionale: serve una quotazione a parte."); return null }
    if (esitoCap && esitoCap.province.length > 1 && !provinciaScelta) { setErrore("Scegli la provincia corretta per questo CAP."); return null }
    if (!provincia) { setErrore("Indica un CAP risolto oppure la provincia di destinazione."); return null }
    return { direzione: "uscita", cap: /^\d{5}$/.test(cap) ? cap : null, provincia, controparteCodice: codiceCliente.trim() || null, colli, pesoKg: num(peso), gruppi: gruppiValidi, lunghezzaCm: null, larghezzaCm: null, altezzaCm: null, data: oggi(), condizioni };
  }

  async function simula(e: React.FormEvent) {
    e.preventDefault(); setErrore(null); setConferma(null);
    const dati = prepara(); if (!dati) return;
    setInCorso(true);
    try {
      const res = await fetch("/api/portali/vettori/simula", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dati) });
      const body: unknown = await res.json();
      if (!res.ok) throw new Error(errorePayload(body, "Simulazione non riuscita."));
      const prossima = body as RispostaSimulazione;
      setRisposta(prossima); setDatiInviati(dati); setVettoreId(""); setConfermaAperta(false);
      if (prossima.capDaChiarire?.province.length) { setEsitoCap(prossima.capDaChiarire); setErrore("Il CAP comprende più province: scegline una e ricalcola.") }
    } catch (causa) { setErrore(causa instanceof Error ? causa.message : "Non è stato possibile contattare il server."); setRisposta(null) }
    finally { setInCorso(false) }
  }

  const disponibili = risposta?.risultati.filter((r) => r.disponibile) ?? [];
  const esclusi = risposta?.risultati.filter((r) => !r.disponibile) ?? [];
  const scelto = disponibili.find((r) => r.vettoreId === vettoreId);

  async function salvaBolla() {
    if (!datiInviati || !scelto?.calcolo) return;
    if (!numeroDopo && !numeroBolla.trim()) { setErrore("Inserisci il numero bolla oppure scegli “Lo inserisco dopo”."); return }
    if (!dataDocumento || !controparte.trim()) { setErrore("Inserisci data e controparte della bolla."); return }
    setSalvataggio(true); setErrore(null);
    try {
      const res = await fetch("/api/portali/vettori/simulazioni", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ simulazione: { ...datiInviati, vettoreSceltoId: scelto.vettoreId, costoPrevisto: scelto.calcolo.totale, riaddebitoPrevisto: scelto.riaddebito?.importo ?? null, esiti: risposta?.risultati ?? [] }, bolla: { numeroRiferimento: numeroDopo ? null : numeroBolla.trim(), dataDocumento, controparteNome: controparte.trim(), controparteCodice: codiceCliente.trim() || null } }) });
      const body: unknown = await res.json(); if (!res.ok) throw new Error(errorePayload(body, "Creazione della bolla non riuscita."));
      setConferma(body as ConfermaSimulazione); setConfermaAperta(false);
    } catch (causa) { setErrore(causa instanceof Error ? causa.message : "Non è stato possibile contattare il server.") }
    finally { setSalvataggio(false) }
  }

  return (
    <div className="mx-auto max-w-[1380px] pb-12 text-text selection:bg-primary/20">
      <header className="mb-7 border-b border-border pb-6"><h1 className="font-tenorite text-3xl font-bold tracking-[-0.02em] text-text sm:text-4xl">Simula, scegli, prepara la bolla</h1><p className="mt-2 max-w-[72ch] text-sm leading-6 text-text-muted sm:text-base">Descrivi la spedizione come si presenta sul banco: il confronto usa tutti i gruppi di colli e mostra insieme costo, riaddebito al cliente e margine.</p></header>
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1.05fr)_minmax(28rem,0.95fr)]">
        <form onSubmit={simula} className="space-y-7">
          <Destinazione cap={cap} setCap={setCap} inCorso={capInCorso} esito={esitoCap} provinciaScelta={provinciaScelta} setProvinciaScelta={setProvinciaScelta} nonRisolto={capNonRisolto} provinciaManuale={provinciaManuale} setProvinciaManuale={setProvinciaManuale} codiceCliente={codiceCliente} setCodiceCliente={setCodiceCliente} />
          <Colli gruppi={gruppi} setGruppi={setGruppi} peso={peso} setPeso={setPeso} colli={colli} volume={volume} />
          <section aria-labelledby="condizioni-titolo"><h2 id="condizioni-titolo" className="font-tenorite text-sm font-bold text-text">Condizioni particolari</h2><div className="mt-2 flex flex-wrap gap-2">{CONDIZIONI.map((c) => { const attiva = condizioni.includes(c.slug); return <button key={c.slug} type="button" aria-pressed={attiva} onClick={() => setCondizioni((v) => attiva ? v.filter((x) => x !== c.slug) : [...v, c.slug])} className={`rounded-full border px-3 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-primary ${attiva ? "border-primary bg-primary/10 text-primary-dark" : "border-border bg-bg text-text-muted"}`}>{c.etichetta}</button> })}</div></section>
          <Button type="submit" disabled={inCorso || esitoCap?.estero === true}>{inCorso ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}{inCorso ? "Calcolo in corso…" : "Confronta i vettori"}</Button>
          {errore ? <p role="alert" className="flex items-start gap-2 text-sm font-medium text-danger"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{errore}</p> : null}
        </form>
        <div className="space-y-4 xl:sticky xl:top-4">
          {!risposta ? <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-bg px-8 text-center"><Calculator className="mb-3 h-8 w-8 text-border" /><h2 className="font-tenorite text-lg font-bold text-text">Il confronto comparirà qui</h2><p className="mt-1 text-sm text-text-muted">Completa destinazione, peso e dimensioni dei gruppi.</p></div> : null}
          {disponibili.map((r, i) => <RisultatoCard key={r.vettoreId} risultato={r} migliore={i === 0} scelto={vettoreId === r.vettoreId} onScegli={() => { setVettoreId(r.vettoreId); setConfermaAperta(false); setConferma(null) }} />)}
          {esclusi.length ? <section className="rounded-xl border border-border bg-bg-page p-4"><h2 className="font-tenorite text-sm font-bold text-text">Vettori non disponibili</h2><ul className="mt-2 space-y-1 text-sm text-text-muted">{esclusi.map((r) => <li key={r.vettoreId}><strong className="text-text">{r.vettoreNome}</strong> — {r.motivoIndisponibilita}</li>)}</ul></section> : null}
          {scelto ? <Conferma scelto={scelto} aperta={confermaAperta} setAperta={setConfermaAperta} numero={numeroBolla} setNumero={setNumeroBolla} dopo={numeroDopo} setDopo={setNumeroDopo} data={dataDocumento} setData={setDataDocumento} controparte={controparte} setControparte={setControparte} salvataggio={salvataggio} salva={salvaBolla} /> : null}
          {conferma ? <div role="status" className="flex gap-3 rounded-xl bg-success/10 p-4 text-sm text-green-900"><CheckCircle2 className="h-5 w-5" /><div><p className="font-tenorite font-bold">Bolla creata</p><p>{conferma.daNumerare ? "È nella coda “Da numerare”: potrai completare il numero dalla pagina Bolle." : "Numero e misure sono stati salvati."}</p></div></div> : null}
        </div>
      </div>
    </div>
  );
}

function Destinazione({ cap, setCap, inCorso, esito, provinciaScelta, setProvinciaScelta, nonRisolto, provinciaManuale, setProvinciaManuale, codiceCliente, setCodiceCliente }: {
  cap: string; setCap: (v: string) => void; inCorso: boolean; esito: EsitoCap | null;
  provinciaScelta: string; setProvinciaScelta: (v: string) => void; nonRisolto: boolean;
  provinciaManuale: string; setProvinciaManuale: (v: string) => void;
  codiceCliente: string; setCodiceCliente: (v: string) => void;
}) {
  return <section role="article" aria-label="Destinazione della spedizione" className="rounded-xl border border-border bg-bg p-5 sm:p-6">
    <div className="mb-5 flex items-start gap-3"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><h2 className="font-tenorite text-lg font-bold text-text">Destinazione</h2><p className="mt-1 text-xs leading-5 text-text-muted">Il CAP individua la zona tariffaria. Se non basta, la scelta resta a te.</p></div></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label htmlFor="cap-destinazione" className="text-xs font-medium text-text-muted">CAP di destinazione<div className="relative mt-1"><Input id="cap-destinazione" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} placeholder="es. 20121" className="pr-10 font-tenorite tabular-nums" />{inCorso ? <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-primary" aria-label="Verifica CAP in corso" /> : null}</div></label>
      <label htmlFor="codice-cliente" className="text-xs font-medium text-text-muted">Codice cliente · opzionale<Input id="codice-cliente" className="mt-1" value={codiceCliente} onChange={(e) => setCodiceCliente(e.target.value)} placeholder="Attiva un eventuale accordo" /></label>
    </div>
    {esito ? <EsitoCapView esito={esito} provinciaScelta={provinciaScelta} onProvincia={setProvinciaScelta} /> : null}
    {nonRisolto ? <div className="mt-4 grid gap-3 rounded-lg bg-warning/10 p-4 sm:grid-cols-[1fr_8rem] sm:items-end"><p className="text-sm text-amber-900">CAP non risolto. Indica la provincia per continuare.</p><label htmlFor="provincia-manuale" className="text-xs font-medium text-amber-900">Provincia<Input id="provincia-manuale" maxLength={2} value={provinciaManuale} onChange={(e) => setProvinciaManuale(e.target.value.toUpperCase())} className="mt-1 bg-bg uppercase" placeholder="MI" /></label></div> : null}
  </section>;
}

function EsitoCapView({ esito, provinciaScelta, onProvincia }: { esito: EsitoCap; provinciaScelta: string; onProvincia: (v: string) => void }) {
  if (esito.estero) return <div role="status" className="mt-4 flex gap-2 rounded-lg bg-warning/10 p-4 text-sm text-amber-900"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Destinazione estera.</strong> Serve una quotazione internazionale a parte.</span></div>;
  if (esito.province.length > 1) return <fieldset className="mt-4 rounded-lg bg-warning/10 p-4"><legend className="px-1 font-tenorite text-sm font-bold text-amber-950">Questo CAP è a cavallo di più province</legend><p className="mb-3 mt-1 text-xs text-amber-900">Scegli la provincia della destinazione; non viene selezionata automaticamente.</p><div className="flex flex-wrap gap-3">{esito.province.map((p) => <label key={p} className="flex items-center gap-2 rounded-lg border border-amber-300 bg-bg px-3 py-2 text-sm font-medium text-text"><input type="radio" name="provincia-cap" value={p} checked={provinciaScelta === p} onChange={() => onProvincia(p)} className="accent-primary" />Provincia {p}</label>)}</div></fieldset>;
  const luogo = esito.comuni.length ? esito.comuni.join(", ") : "CAP riconosciuto";
  return <div role="status" className="mt-4 flex gap-2 rounded-lg bg-primary/10 p-4 text-sm text-primary-dark"><Info className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>{luogo}{esito.province[0] ? ` (${esito.province[0]})` : ""}</strong>{esito.fonte === "prefisso" ? " — provincia dedotta dal prefisso del CAP, non letta da un dato esatto." : " — destinazione riconosciuta dal CAP."}</span></div>;
}

function Colli({ gruppi, setGruppi, peso, setPeso, colli, volume }: { gruppi: GruppoDraft[]; setGruppi: React.Dispatch<React.SetStateAction<GruppoDraft[]>>; peso: string; setPeso: (v: string) => void; colli: number; volume: number }) {
  const modifica = (id: string, campo: keyof Omit<GruppoDraft, "id">, valore: string) => setGruppi((correnti) => correnti.map((g) => g.id === id ? { ...g, [campo]: valore } : g));
  return <section role="article" aria-label="Gruppi di colli" className="overflow-hidden rounded-xl border border-border bg-bg">
    <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6"><div><div className="flex items-center gap-2"><PackagePlus className="h-5 w-5 text-primary" /><h2 className="font-tenorite text-lg font-bold text-text">Gruppi di colli</h2></div><p className="mt-1 text-xs leading-5 text-text-muted">Una riga per ogni formato: quantità × lunghezza × profondità × altezza.</p></div><label htmlFor="peso-totale" className="w-full text-xs font-medium text-text-muted sm:w-44">Peso totale (kg)<Input id="peso-totale" required inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} className="mt-1 font-tenorite tabular-nums" placeholder="es. 42,5" /></label></div>
    <div className="divide-y divide-border/70">{gruppi.map((g, i) => <GruppoRiga key={g.id} gruppo={g} indice={i} rimovibile={gruppi.length > 1} onChange={(c, v) => modifica(g.id, c, v)} onRimuovi={() => setGruppi((righe) => righe.filter((x) => x.id !== g.id))} />)}</div>
    <div className="flex flex-col gap-4 bg-bg-page px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><Button type="button" size="sm" variant="outline" onClick={() => setGruppi((v) => [...v, nuovoGruppo()])}><Plus className="h-4 w-4" />Aggiungi gruppo</Button><dl className="grid grid-cols-3 gap-5 text-right"><div><dt className="text-[11px] text-text-muted">Colli</dt><dd className="font-tenorite text-lg font-bold tabular-nums">{colli}</dd></div><div><dt className="text-[11px] text-text-muted">Volume</dt><dd className="font-tenorite text-lg font-bold tabular-nums">{formato.format(volume)} m³</dd></div><div><dt className="text-[11px] text-text-muted">Peso volumetrico</dt><dd className="font-tenorite text-lg font-bold tabular-nums text-primary-dark">{formato.format(volume * 300)} kg</dd><dd className="text-[10px] text-text-muted">a 300 kg/m³</dd></div></dl></div>
  </section>;
}

function GruppoRiga({ gruppo, indice, rimovibile, onChange, onRimuovi }: { gruppo: GruppoDraft; indice: number; rimovibile: boolean; onChange: (c: keyof Omit<GruppoDraft, "id">, v: string) => void; onRimuovi: () => void }) {
  const campi: Array<{ campo: keyof Omit<GruppoDraft, "id">; label: string; step: string }> = [{ campo: "quantita", label: "Quantità", step: "1" }, { campo: "lunghezzaCm", label: "Lunghezza (cm)", step: "0.1" }, { campo: "larghezzaCm", label: "Profondità (cm)", step: "0.1" }, { campo: "altezzaCm", label: "Altezza (cm)", step: "0.1" }];
  return <div role="group" aria-label={`Gruppo di colli ${indice + 1}`} className="grid gap-3 px-5 py-4 sm:grid-cols-[4rem_repeat(3,minmax(0,1fr))_2.5rem] sm:items-end sm:px-6"><p className="font-tenorite text-sm font-bold sm:col-span-5">Gruppo {indice + 1}</p>{campi.map(({ campo, label, step }) => <label key={campo} htmlFor={`gruppo-${indice}-${campo}`} className="text-xs font-medium text-text-muted">{label}<Input id={`gruppo-${indice}-${campo}`} aria-label={`${label} gruppo ${indice + 1}`} type="number" min={step === "1" ? "1" : "0.1"} step={step} inputMode="decimal" value={gruppo[campo]} onChange={(e) => onChange(campo, e.target.value)} className="mt-1 font-tenorite tabular-nums" /></label>)}<Button type="button" size="icon" variant="ghost" disabled={!rimovibile} aria-label={`Rimuovi gruppo ${indice + 1}`} onClick={onRimuovi}><Trash2 className="h-4 w-4 text-text-muted" /></Button></div>;
}

function RisultatoCard({ risultato, migliore, scelto, onScegli }: { risultato: EsitoSimulazione; migliore: boolean; scelto: boolean; onScegli: () => void }) {
  if (!risultato.calcolo) return null;
  const addebito = risultato.riaddebito?.importo; const margine = risultato.margine;
  return <article role="article" aria-label={`Vettore ${risultato.vettoreNome}`} className={`overflow-hidden rounded-xl border bg-bg ${scelto ? "border-primary shadow-[0_8px_24px_rgba(0,161,190,0.12)]" : "border-border"}`}><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div><div className="flex items-center gap-2"><h2 className="font-tenorite text-lg font-bold">{risultato.vettoreNome}</h2>{migliore ? <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary-dark">Più conveniente</span> : null}</div><p className="mt-0.5 text-xs text-text-muted">{risultato.listino?.etichetta ?? "Listino in vigore"} · {risultato.calcolo.fasciaDescrizione}</p></div><Button type="button" size="sm" variant={scelto ? "default" : "outline"} aria-pressed={scelto} onClick={onScegli}>{scelto ? "Scelto" : "Scegli"}</Button></div><dl className="grid grid-cols-3 divide-x divide-border px-3 py-5 text-center"><Valore label="Costo nostro" valore={eur(risultato.calcolo.totale)} /><Valore label="Da addebitare" valore={addebito == null ? "Chiedere offerta" : eur(addebito)} piccolo={addebito == null} /><Valore label="Margine" valore={margine == null ? "Non calcolabile" : eur(margine)} piccolo={margine == null} negativo={margine != null && margine < 0} positivo={margine != null && margine >= 0} /></dl>{risultato.riaddebito?.avvertenza ? <p className="border-t border-border bg-bg-page px-5 py-3 text-xs text-text-muted">{risultato.riaddebito.avvertenza}</p> : null}</article>;
}
function Valore({ label, valore, piccolo, negativo, positivo }: { label: string; valore: string; piccolo?: boolean; negativo?: boolean; positivo?: boolean }) { return <div className="px-2"><dt className="text-[11px] text-text-muted">{label}</dt><dd className={`mt-1 font-tenorite font-bold ${piccolo ? "text-sm" : "text-lg tabular-nums"} ${negativo ? "text-danger" : positivo ? "text-success" : "text-text"}`}>{valore}</dd></div> }

function Conferma({ scelto, aperta, setAperta, numero, setNumero, dopo, setDopo, data, setData, controparte, setControparte, salvataggio, salva }: { scelto: EsitoSimulazione; aperta: boolean; setAperta: (v: boolean) => void; numero: string; setNumero: (v: string) => void; dopo: boolean; setDopo: (v: boolean) => void; data: string; setData: (v: string) => void; controparte: string; setControparte: (v: string) => void; salvataggio: boolean; salva: () => Promise<void> }) {
  return <section role="article" aria-label="Conferma della simulazione" className="rounded-xl border border-primary/40 bg-bg p-5 shadow-[0_8px_24px_rgba(0,161,190,0.10)]">{!aperta ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-tenorite text-lg font-bold">Hai scelto {scelto.vettoreNome}</h2><p className="mt-1 text-xs text-text-muted">Trasforma il confronto in una bolla con le misure già compilate.</p></div><Button type="button" onClick={() => setAperta(true)}><Save className="h-4 w-4" />Conferma e crea la bolla</Button></div> : <div><h2 className="font-tenorite text-lg font-bold">Dati della bolla</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><label htmlFor="numero-bolla-conferma" className="text-xs font-medium text-text-muted">Numero bolla<Input id="numero-bolla-conferma" disabled={dopo} value={numero} onChange={(e) => setNumero(e.target.value)} className="mt-1" /></label><label htmlFor="data-bolla-conferma" className="text-xs font-medium text-text-muted">Data documento<Input id="data-bolla-conferma" type="date" value={data} onChange={(e) => setData(e.target.value)} className="mt-1" /></label><label htmlFor="controparte-conferma" className="text-xs font-medium text-text-muted sm:col-span-2">Controparte<Input id="controparte-conferma" value={controparte} onChange={(e) => setControparte(e.target.value)} className="mt-1" /></label></div><label className="mt-3 flex w-fit items-center gap-2 text-sm"><input type="checkbox" checked={dopo} onChange={(e) => setDopo(e.target.checked)} className="h-4 w-4 accent-primary" />Lo inserisco dopo</label><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setAperta(false)}>Annulla</Button><Button type="button" disabled={salvataggio} onClick={() => void salva()}>{salvataggio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{salvataggio ? "Salvataggio…" : "Crea bolla"}</Button></div></div>}</section>;
}
