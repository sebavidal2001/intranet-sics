"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ListinoRiepilogo } from "@/lib/portali/vettori/letture";
import { NuovoListino } from "@/lib/portali/vettori/listini-config";

const inputClass = "w-full min-w-24 rounded-lg border border-border bg-bg px-2 py-2 text-base text-text focus-visible:outline-primary tabular-nums";

export function ListinoEditor({ l }: { l: ListinoRiepilogo }) {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [fasce, setFasce] = useState(l.dettaglioFasce);
  const [supplementi, setSupplementi] = useState(l.supplementi.map((s) => ({ codice: s.codice, valore: s.valore })));
  const [etichetta, setEtichetta] = useState(l.listino?.etichetta ?? "");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [errore, setErrore] = useState("");
  const [salvato, setSalvato] = useState("");
  const [busy, setBusy] = useState(false);
  if (!l.listino) return null;
  async function salva(e: React.FormEvent) {
    e.preventDefault();
    setErrore("");
    const parsed = NuovoListino.safeParse({ listino_id: l.listino!.id, etichetta, valido_dal: data, fasce, supplementi });
    if (!parsed.success) { setErrore(parsed.error.issues.map((i) => i.message).join(" ")); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/portali/vettori/listini", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await res.json();
      if (!res.ok) { setErrore(result.error ?? "Salvataggio non riuscito. Riprovare."); return; }
      setAperto(false);
      setSalvato(`Tariffe salvate con decorrenza ${new Date(data + "T12:00:00").toLocaleDateString("it-IT")}.`);
      router.refresh();
    } catch { setErrore("Connessione interrotta. Le modifiche sono ancora qui: riprova il salvataggio."); }
    finally { setBusy(false); }
  }
  return <div className="px-5 pb-4">
    <Button variant="outline" onClick={() => { setAperto(!aperto); setErrore(""); }}> {aperto ? "Chiudi modifica" : "Modifica tariffe"} </Button>
    {salvato && <p role="status" className="mt-3 text-sm text-success">{salvato}</p>}
    {aperto && <form onSubmit={salva} className="mt-4 space-y-4">
      <p className="text-sm text-text-muted">Salva una nuova versione dalla data indicata. Le tariffe precedenti e i controlli già acquisiti restano conservati.</p>
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-text">Nome del listino<input required maxLength={150} className={inputClass} value={etichetta} onChange={(e) => setEtichetta(e.target.value)} /></label>
          <label className="text-sm text-text">In vigore dal<input required type="date" className={inputClass} value={data} onChange={(e) => setData(e.target.value)} /></label>
        </div>
        {l.zone.map((zona) => <div key={zona.id}>
          <h3 className="mb-2 font-semibold text-text">{zona.nome}</h3>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr>{["Da kg", "Fino a kg", "Tariffa €", "Tipo", "Scatto kg", "Scatto €"].map((s) => <th key={s} className="text-left px-1 py-2">{s}</th>)}</tr></thead>
            <tbody>{fasce.map((f, i) => f.zona_id !== zona.id ? null : <tr key={i}>
              {(["peso_da", "peso_a", "importo"] as const).map((key) => <td className="p-1" key={key}><input aria-label={`${zona.nome}, fascia ${i + 1}, ${key}`} type="number" min="0" step="0.001" required={key !== "peso_a"} placeholder="Oltre" className={inputClass} value={f[key] ?? ""} onChange={(e) => setFasce((prev) => prev.map((x, n) => n === i ? { ...x, [key]: e.target.value === "" && key === "peso_a" ? null : e.target.valueAsNumber } : x))} /></td>)}
              <td className="p-1"><select aria-label={`${zona.nome}, fascia ${i + 1}, tipo`} className={inputClass} value={f.tipo} onChange={(e) => setFasce((prev) => prev.map((x, n) => n === i ? { ...x, tipo: e.target.value as "fisso" | "quintale" } : x))}><option value="fisso">Fisso</option><option value="quintale">€/quintale</option></select></td>
              {(["scatto_kg", "scatto_importo"] as const).map((key) => <td className="p-1" key={key}><input aria-label={`${zona.nome}, fascia ${i + 1}, ${key}`} type="number" min="0" step="0.001" className={inputClass} value={f[key] ?? ""} onChange={(e) => setFasce((prev) => prev.map((x, n) => n === i ? { ...x, [key]: e.target.value === "" ? null : e.target.valueAsNumber } : x))} /></td>)}
            </tr>)}</tbody>
          </table></div>
        </div>)}
        {supplementi.length > 0 && <div><h3 className="mb-2 font-semibold text-text">Supplementi</h3><div className="grid gap-3 sm:grid-cols-2">{supplementi.map((s, i) => {
          const voce = l.supplementi.find((v) => v.codice === s.codice)!;
          const percentuale = voce.tipo_calcolo === "percentuale_nolo";
          return <label key={s.codice} className="text-sm text-text">{voce.nome} ({percentuale ? "%" : "€"})<input type="number" min="0" step="0.0001" required className={inputClass} value={percentuale ? Number((s.valore * 100).toFixed(6)) : s.valore} onChange={(e) => setSupplementi((prev) => prev.map((x, n) => n === i ? { ...x, valore: e.target.valueAsNumber / (percentuale ? 100 : 1) } : x))} /></label>;
        })}</div></div>}
      </fieldset>
      {errore && <p role="alert" className="text-sm text-danger">{errore}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Salvataggio…" : "Salva nuova versione"}</Button>
    </form>}
  </div>;
}
