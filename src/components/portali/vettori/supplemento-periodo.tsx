"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ListinoRiepilogo } from "@/lib/portali/vettori/letture";
import { NuovoSupplemento } from "@/lib/portali/vettori/listini-config";

const inputClass = "w-full rounded-lg border border-border bg-bg px-2 py-2 text-base text-text focus-visible:outline-primary tabular-nums";

const TIPI: Array<{ valore: string; etichetta: string }> = [
  { valore: "fisso_spedizione", etichetta: "Importo fisso a spedizione (€)" },
  { valore: "per_collo", etichetta: "Importo a collo (€)" },
  { valore: "per_kg", etichetta: "Importo a chilogrammo (€)" },
  { valore: "percentuale_nolo", etichetta: "Percentuale sul nolo (%)" },
];

const data = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("it-IT");

/** Il periodo scritto per esteso, per la tabella dei supplementi. */
export function periodoSupplemento(s: { valido_dal?: string | null; valido_al?: string | null }): string | null {
  if (!s.valido_dal && !s.valido_al) return null;
  if (s.valido_dal && s.valido_al) return `dal ${data(s.valido_dal)} al ${data(s.valido_al)}`;
  return s.valido_dal ? `dal ${data(s.valido_dal)}` : `fino al ${data(s.valido_al!)}`;
}

/**
 * Aggiunge e toglie i supplementi a periodo — quelli che un vettore comunica a
 * tempo, come il supplemento alta domanda di FedEx. Il periodo si misura sulla
 * data di spedizione: le spedizioni già controllate non cambiano.
 */
export function SupplementoPeriodo({ l }: { l: ListinoRiepilogo }) {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("fisso_spedizione");
  const [valore, setValore] = useState("");
  const [dal, setDal] = useState("");
  const [al, setAl] = useState("");
  const [baseNolo, setBaseNolo] = useState(false);
  const [errore, setErrore] = useState("");
  const [esito, setEsito] = useState("");
  const [busy, setBusy] = useState(false);
  if (!l.listino) return null;
  const listino = l.listino;
  const aPeriodo = l.supplementi.filter((s) => s.valido_dal || s.valido_al);

  async function aggiungi(e: React.FormEvent) {
    e.preventDefault();
    setErrore(""); setEsito("");
    const numero = Number(valore.replace(",", "."));
    const parsed = NuovoSupplemento.safeParse({
      listino_id: listino.id, nome, tipo_calcolo: tipo,
      valore: tipo === "percentuale_nolo" ? numero / 100 : numero,
      base_nolo: baseNolo, condizione: "sempre", valido_dal: dal, valido_al: al || null,
    });
    if (!parsed.success || Number.isNaN(numero)) {
      setErrore(parsed.success ? "Il valore deve essere un numero." : parsed.error.issues.map((i) => i.message).join(". "));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/portali/vettori/listini/supplementi", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const risposta = await res.json();
      if (!res.ok) { setErrore(risposta.error ?? "Salvataggio non riuscito."); return; }
      setEsito(`«${nome}» aggiunto ${periodoSupplemento({ valido_dal: dal, valido_al: al || null })}.`);
      setNome(""); setValore(""); setDal(""); setAl(""); setBaseNolo(false); setAperto(false);
      router.refresh();
    } catch { setErrore("Connessione interrotta. Riprova."); }
    finally { setBusy(false); }
  }

  async function togli(codice: string) {
    setErrore(""); setEsito(""); setBusy(true);
    try {
      const res = await fetch("/api/portali/vettori/listini/supplementi", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listino_id: listino.id, codice }),
      });
      const risposta = await res.json();
      if (!res.ok) { setErrore(risposta.error ?? "Rimozione non riuscita."); return; }
      setEsito("Supplemento tolto."); router.refresh();
    } catch { setErrore("Connessione interrotta. Riprova."); }
    finally { setBusy(false); }
  }

  return <div className="px-5 pb-4">
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" onClick={() => { setAperto(!aperto); setErrore(""); }}>
        {aperto ? "Chiudi" : "Aggiungi supplemento a periodo"}
      </Button>
      <p className="text-[11px] text-text-muted max-w-md leading-snug">
        Per i supplementi comunicati a tempo dal vettore (es. alta domanda): vale solo per le spedizioni
        nel periodo indicato, i mesi già controllati non cambiano.
      </p>
    </div>
    {esito && <p role="status" className="mt-3 text-sm text-success">{esito}</p>}
    {errore && !aperto && <p role="alert" className="mt-3 text-sm text-danger">{errore}</p>}

    {aPeriodo.length > 0 && <ul className="mt-3 space-y-1 text-[13px] text-text">
      {aPeriodo.map((s) => <li key={s.codice} className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span><strong>{s.nome}</strong> · {s.tipo_calcolo === "percentuale_nolo"
          ? `${(s.valore * 100).toLocaleString("it-IT", { maximumFractionDigits: 3 })}%`
          : s.valore.toLocaleString("it-IT", { style: "currency", currency: "EUR" })} · {periodoSupplemento(s)}</span>
        <button type="button" disabled={busy} onClick={() => void togli(s.codice)}
          className="text-xs text-danger underline underline-offset-2 disabled:opacity-50">Togli</button>
      </li>)}
    </ul>}

    {aperto && <form onSubmit={aggiungi} className="mt-4 space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-text">Nome (come lo chiama il vettore)
            <input required maxLength={150} className={inputClass} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="es. Diritto fisso (alta domanda)" /></label>
          <label className="text-sm text-text">Come si calcola
            <select className={inputClass} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPI.map((t) => <option key={t.valore} value={t.valore}>{t.etichetta}</option>)}
            </select></label>
          <label className="text-sm text-text">Valore
            <input required inputMode="decimal" className={inputClass} value={valore} onChange={(e) => setValore(e.target.value)} placeholder="es. 0,85" /></label>
          <span />
          <label className="text-sm text-text">Spedizioni dal
            <input required type="date" className={inputClass} value={dal} onChange={(e) => setDal(e.target.value)} /></label>
          <label className="text-sm text-text">Spedizioni fino al (vuoto = senza fine)
            <input type="date" className={inputClass} value={al} onChange={(e) => setAl(e.target.value)} /></label>
        </div>
        <label className="flex items-start gap-2 text-sm text-text">
          <input type="checkbox" className="mt-1" checked={baseNolo} onChange={(e) => setBaseNolo(e.target.checked)} />
          <span>Fa base per il carburante <span className="text-text-muted">(di solito no: lasciare vuoto se in fattura è una voce a parte, come il «Diritto fisso»)</span></span>
        </label>
      </fieldset>
      {errore && <p role="alert" className="text-sm text-danger">{errore}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Salvataggio…" : "Aggiungi supplemento"}</Button>
    </form>}
  </div>;
}
