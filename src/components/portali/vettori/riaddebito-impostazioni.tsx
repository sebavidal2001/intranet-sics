"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, ReceiptText, Save, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AccordoRiaddebitoCliente, BasePesoRiaddebito, ScaglioneRiaddebito, VersioneRiaddebito } from "@/lib/portali/vettori/tipi";

interface RispostaRiaddebito { versione: VersioneRiaddebito; accordi: AccordoRiaddebitoCliente[] }
interface ScaglioneDraft { pesoDa: string; pesoA: string; importo: string; nota: string }
interface AccordoDraft { codiceCliente: string; ragioneSociale: string; validoDal: string; validoAl: string; modalita: AccordoRiaddebitoCliente["modalita"]; importo: string; nota: string }

const nuovoScaglione = (): ScaglioneDraft => ({ pesoDa: "", pesoA: "", importo: "", nota: "" });
const oggi = () => new Date().toISOString().slice(0, 10);
const nuovoAccordo = (): AccordoDraft => ({ codiceCliente: "", ragioneSociale: "", validoDal: oggi(), validoAl: "", modalita: "tabella", importo: "", nota: "" });
const stringa = (n: number | null) => n === null ? "" : String(n);

/** Il minimo che deve esserci perche' la sezione sappia disegnarsi. */
function rispostaValida(body: unknown): body is RispostaRiaddebito {
  if (typeof body !== "object" || body === null) return false;
  const dati = body as Partial<RispostaRiaddebito>;
  const v = dati.versione;
  return (
    Array.isArray(dati.accordi) &&
    typeof v === "object" && v !== null &&
    typeof v.validoDal === "string" &&
    (v.basePeso === "reale" || v.basePeso === "tassabile") &&
    Array.isArray(v.scaglioni)
  );
}
const errorePayload = (v: unknown, fallback: string) => typeof v === "object" && v !== null && "error" in v && typeof v.error === "string" ? v.error : fallback;

export function RiaddebitoImpostazioni() {
  const [versione, setVersione] = useState<VersioneRiaddebito | null>(null);
  const [accordi, setAccordi] = useState<AccordoRiaddebitoCliente[]>([]);
  const [validoDal, setValidoDal] = useState(oggi);
  const [basePeso, setBasePeso] = useState<BasePesoRiaddebito>("tassabile");
  const [scaglioni, setScaglioni] = useState<ScaglioneDraft[]>([]);
  const [accordo, setAccordo] = useState<AccordoDraft>(nuovoAccordo);
  const [caricamento, setCaricamento] = useState(true);
  const [salvataggio, setSalvataggio] = useState<"tabella" | "accordo" | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [salvato, setSalvato] = useState<string | null>(null);

  const carica = useCallback(async () => {
    setCaricamento(true); setErrore(null);
    try {
      const res = await fetch("/api/portali/vettori/riaddebito", { cache: "no-store" });
      const body: unknown = await res.json();
      if (!res.ok) throw new Error(errorePayload(body, "Impostazioni di riaddebito non disponibili."));
      // La forma si controlla prima di scrivere qualunque stato. Senza, una
      // risposta inattesa lasciava `accordi` a undefined e faceva esplodere il
      // render: non un messaggio d'errore, ma l'intera pagina Impostazioni
      // bianca, listini compresi, per un guasto che riguarda solo il riaddebito.
      if (!rispostaValida(body)) {
        throw new Error("Impostazioni di riaddebito in un formato non riconosciuto.");
      }
      setVersione(body.versione); setAccordi(body.accordi);
      setValidoDal(body.versione.validoDal); setBasePeso(body.versione.basePeso);
      setScaglioni(body.versione.scaglioni.map((s) => ({ pesoDa: String(s.pesoDa), pesoA: stringa(s.pesoA), importo: stringa(s.importo), nota: s.nota ?? "" })));
    } catch (causa) { setErrore(causa instanceof Error ? causa.message : "Non è stato possibile contattare il server.") }
    finally { setCaricamento(false) }
  }, []);

  useEffect(() => { void carica() }, [carica]);

  function cambiaScaglione(indice: number, campo: keyof ScaglioneDraft, valore: string) {
    setScaglioni((correnti) => correnti.map((s, i) => i === indice ? { ...s, [campo]: valore } : s));
  }

  async function salvaTabella() {
    const normalizzati: ScaglioneRiaddebito[] = scaglioni.map((s) => ({ pesoDa: Number(s.pesoDa), pesoA: s.pesoA.trim() ? Number(s.pesoA) : null, importo: s.importo.trim() ? Number(s.importo.replace(",", ".")) : null, nota: s.nota.trim() || null }));
    if (!validoDal || !normalizzati.length || normalizzati.some((s) => !Number.isFinite(s.pesoDa) || s.pesoDa < 0 || (s.pesoA !== null && (!Number.isFinite(s.pesoA) || s.pesoA <= s.pesoDa)) || (s.importo !== null && (!Number.isFinite(s.importo) || s.importo < 0)))) { setErrore("Controlla decorrenza, limiti di peso e importi degli scaglioni."); return }
    setSalvataggio("tabella"); setErrore(null); setSalvato(null);
    try {
      const res = await fetch("/api/portali/vettori/riaddebito", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ validoDal, basePeso, scaglioni: normalizzati }) });
      const body: unknown = await res.json(); if (!res.ok) throw new Error(errorePayload(body, "Salvataggio non riuscito."));
      setSalvato("Nuova versione della tabella di riaddebito salvata."); await carica();
    } catch (causa) { setErrore(causa instanceof Error ? causa.message : "Non è stato possibile contattare il server.") }
    finally { setSalvataggio(null) }
  }

  async function salvaAccordo() {
    if (!accordo.codiceCliente.trim() || !accordo.validoDal || (accordo.modalita === "importo_fisso" && (!accordo.importo.trim() || Number(accordo.importo.replace(",", ".")) < 0))) { setErrore("Completa codice cliente, decorrenza e importo dell’accordo."); return }
    setSalvataggio("accordo"); setErrore(null); setSalvato(null);
    try {
      const res = await fetch("/api/portali/vettori/riaddebito", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codiceCliente: accordo.codiceCliente.trim(), ragioneSociale: accordo.ragioneSociale.trim() || null, validoDal: accordo.validoDal, validoAl: accordo.validoAl || null, modalita: accordo.modalita, importo: accordo.modalita === "importo_fisso" ? Number(accordo.importo.replace(",", ".")) : null, nota: accordo.nota.trim() || null }) });
      const body: unknown = await res.json(); if (!res.ok) throw new Error(errorePayload(body, "Accordo non salvato."));
      setAccordo(nuovoAccordo()); setSalvato("Accordo cliente salvato."); await carica();
    } catch (causa) { setErrore(causa instanceof Error ? causa.message : "Non è stato possibile contattare il server.") }
    finally { setSalvataggio(null) }
  }

  return <section aria-labelledby="riaddebito-titolo" className="mb-6 overflow-hidden rounded-xl border border-border bg-bg">
    <div className="flex items-start gap-3 border-b border-border px-5 py-4"><ReceiptText className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><h2 id="riaddebito-titolo" className="font-tenorite text-lg font-bold text-text">Riaddebito ai clienti</h2><p className="mt-1 max-w-[72ch] text-xs leading-5 text-text-muted">Definisci quanto addebitare per fascia. Un importo lasciato vuoto significa “chiedere offerta”, non zero.</p></div></div>
    {caricamento ? <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin text-primary" />Caricamento riaddebito…</div> : <>
      <div className="grid gap-5 px-5 py-5 lg:grid-cols-[14rem_1fr]">
        <label htmlFor="riaddebito-decorrenza" className="text-xs font-medium text-text-muted">Data di decorrenza<Input id="riaddebito-decorrenza" type="date" value={validoDal} onChange={(e) => setValidoDal(e.target.value)} className="mt-1" /><span className="mt-1 block text-[11px] font-normal">In vigore: {versione?.validoDal ?? "—"}{versione?.validoAl ? ` – ${versione.validoAl}` : ""}</span></label>
        <fieldset><legend className="text-xs font-medium text-text-muted">Base di peso</legend><div className="mt-1 grid gap-2 sm:grid-cols-2"><BaseOption valore="reale" corrente={basePeso} onChange={setBasePeso} titolo="Peso reale" testo="Usa sempre il peso della bilancia: il riaddebito è uguale per tutti i vettori." /><BaseOption valore="tassabile" corrente={basePeso} onChange={setBasePeso} titolo="Peso tassabile" testo="Usa il maggiore fra reale, volumetrico e minimo: può cambiare in base al vettore." /></div></fieldset>
      </div>
      <div className="border-t border-border px-5 py-5"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-tenorite font-bold text-text">Scaglioni</h3><Button type="button" size="sm" variant="outline" onClick={() => setScaglioni((v) => [...v, nuovoScaglione()])}><Plus className="h-4 w-4" />Aggiungi scaglione</Button></div><div className="space-y-2">{scaglioni.map((s, i) => <div key={i} role="group" aria-label={`Scaglione ${i + 1}`} className="grid gap-3 rounded-lg bg-bg-page p-3 sm:grid-cols-[1fr_1fr_1fr_1.5fr_auto] sm:items-end"><Campo label="Peso da (kg)" value={s.pesoDa} onChange={(v) => cambiaScaglione(i, "pesoDa", v)} /><Campo label="Peso a (kg)" value={s.pesoA} onChange={(v) => cambiaScaglione(i, "pesoA", v)} placeholder="Oltre" /><Campo label="Importo (€)" value={s.importo} onChange={(v) => cambiaScaglione(i, "importo", v)} placeholder="Chiedere offerta" /><label className="text-xs font-medium text-text-muted">Nota<Input className="mt-1" value={s.nota} onChange={(e) => cambiaScaglione(i, "nota", e.target.value)} /></label><Button type="button" size="icon" variant="ghost" aria-label={`Rimuovi scaglione ${i + 1}`} onClick={() => setScaglioni((v) => v.filter((_, x) => x !== i))}><Trash2 className="h-4 w-4 text-text-muted" /></Button></div>)}</div><div className="mt-4 flex justify-end"><Button type="button" disabled={salvataggio !== null} onClick={() => void salvaTabella()}>{salvataggio === "tabella" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salva nuova versione</Button></div></div>
      <Accordi accordi={accordi} draft={accordo} setDraft={setAccordo} salvataggio={salvataggio} salva={salvaAccordo} />
    </>}
    {errore ? <div role="alert" className="flex gap-2 border-t border-border bg-danger/10 px-5 py-3 text-sm text-red-800"><TriangleAlert className="mt-0.5 h-4 w-4" />{errore}</div> : null}{salvato ? <div role="status" className="flex gap-2 border-t border-border bg-success/10 px-5 py-3 text-sm text-green-900"><CheckCircle2 className="mt-0.5 h-4 w-4" />{salvato}</div> : null}
  </section>;
}

function BaseOption({ valore, corrente, onChange, titolo, testo }: { valore: BasePesoRiaddebito; corrente: BasePesoRiaddebito; onChange: (v: BasePesoRiaddebito) => void; titolo: string; testo: string }) { return <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${corrente === valore ? "border-primary bg-primary/5" : "border-border"}`}><input type="radio" name="base-peso" value={valore} checked={corrente === valore} onChange={() => onChange(valore)} className="mt-1 accent-primary" /><span><strong className="text-sm text-text">{titolo}</strong><span className="mt-0.5 block text-xs leading-5 text-text-muted">{testo}</span></span></label> }
function Campo({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) { return <label className="text-xs font-medium text-text-muted">{label}<Input className="mt-1 font-tenorite tabular-nums" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></label> }

function Accordi({ accordi, draft, setDraft, salvataggio, salva }: { accordi: AccordoRiaddebitoCliente[]; draft: AccordoDraft; setDraft: React.Dispatch<React.SetStateAction<AccordoDraft>>; salvataggio: "tabella" | "accordo" | null; salva: () => Promise<void> }) {
  const cambia = <K extends keyof AccordoDraft>(campo: K, valore: AccordoDraft[K]) => setDraft((v) => ({ ...v, [campo]: valore }));
  return <div className="border-t border-border px-5 py-5"><h3 className="font-tenorite font-bold text-text">Accordi per cliente</h3><p className="mt-1 text-xs text-text-muted">Gli accordi prevalgono sulla tabella generale nel loro periodo di validità.</p>{accordi.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="text-text-muted"><tr><th className="pb-2">Cliente</th><th className="pb-2">Validità</th><th className="pb-2">Regola</th><th className="pb-2">Nota</th></tr></thead><tbody>{accordi.map((a) => <tr key={a.id} className="border-t border-border"><td className="py-2 font-medium text-text">{a.ragioneSociale ?? a.codiceCliente}<span className="block font-normal text-text-muted">{a.codiceCliente}</span></td><td className="py-2 text-text-muted">{a.validoDal} – {a.validoAl ?? "in corso"}</td><td className="py-2 text-text">{a.modalita === "nessun_addebito" ? "Nessun addebito" : a.modalita === "importo_fisso" ? `${a.importo?.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}` : "Tabella generale"}</td><td className="py-2 text-text-muted">{a.nota ?? "—"}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-text-muted">Nessun accordo cliente configurato.</p>}
    <div className="mt-5 grid gap-3 rounded-lg bg-bg-page p-4 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-medium text-text-muted">Codice cliente<Input className="mt-1" value={draft.codiceCliente} onChange={(e) => cambia("codiceCliente", e.target.value)} /></label><label className="text-xs font-medium text-text-muted">Ragione sociale<Input className="mt-1" value={draft.ragioneSociale} onChange={(e) => cambia("ragioneSociale", e.target.value)} /></label><label className="text-xs font-medium text-text-muted">Valido dal<Input type="date" className="mt-1" value={draft.validoDal} onChange={(e) => cambia("validoDal", e.target.value)} /></label><label className="text-xs font-medium text-text-muted">Valido al · opzionale<Input type="date" className="mt-1" value={draft.validoAl} onChange={(e) => cambia("validoAl", e.target.value)} /></label><label className="text-xs font-medium text-text-muted">Modalità<select className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text" value={draft.modalita} onChange={(e) => cambia("modalita", e.target.value as AccordoDraft["modalita"])}><option value="tabella">Tabella generale</option><option value="importo_fisso">Importo fisso</option><option value="nessun_addebito">Nessun addebito</option></select></label>{draft.modalita === "importo_fisso" ? <Campo label="Importo fisso (€)" value={draft.importo} onChange={(v) => cambia("importo", v)} /> : null}<label className="text-xs font-medium text-text-muted lg:col-span-2">Nota<Input className="mt-1" value={draft.nota} onChange={(e) => cambia("nota", e.target.value)} /></label><div className="flex items-end lg:col-start-4"><Button type="button" className="w-full" disabled={salvataggio !== null} onClick={() => void salva()}>{salvataggio === "accordo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Salva accordo</Button></div></div>
  </div>;
}
