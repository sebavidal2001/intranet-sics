"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ConfigMail } from "@/lib/portali/vettori/mail-config";
const stile = "w-full rounded-lg border border-border bg-bg px-3 py-2 text-base text-text";
export function MailImpostazioni({ vettori }: { vettori: Array<{ id: string; nome: string }> }) {
  const [modelli, setModelli] = useState<ConfigMail[]>([]);
  const [vettore, setVettore] = useState("");
  const [oggetto, setOggetto] = useState(""); const [corpo, setCorpo] = useState("");
  const [a, setA] = useState(""); const [cc, setCc] = useState("");
  const [busy, setBusy] = useState(true); const [errore, setErrore] = useState(""); const [messaggio, setMessaggio] = useState("");
  useEffect(() => { fetch("/api/portali/vettori/mail-config").then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setModelli(d.modelli); }).catch((e: Error) => setErrore(e.message)).finally(() => setBusy(false)); }, []);
  useEffect(() => { const m = modelli.find((x) => x.vettore_id === (vettore || null)) ?? modelli.find((x) => x.vettore_id === null); setOggetto(m?.oggetto ?? ""); setCorpo(m?.corpo ?? ""); setA(m?.destinatari.join("; ") ?? ""); setCc(m?.cc.join("; ") ?? ""); }, [vettore, modelli]);
  async function salva(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErrore(""); setMessaggio("");
    const split = (s: string) => s.split(/[;,\n]/).map((v) => v.trim()).filter(Boolean);
    const m = { vettore_id: vettore || null, oggetto, corpo, destinatari: split(a), cc: split(cc) };
    try { const r = await fetch("/api/portali/vettori/mail-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(m) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setModelli((p) => [...p.filter((x) => x.vettore_id !== m.vettore_id), m]); setMessaggio("Modello e indirizzi salvati."); }
    catch (e) { setErrore(e instanceof Error ? e.message : "Connessione interrotta. Riprovare."); } finally { setBusy(false); }
  }
  return <section className="mt-6 rounded-xl border border-border bg-bg p-5">
    <h2 className="font-tenorite text-lg font-bold">Email di contestazione</h2>
    <p className="mt-1 mb-4 text-sm text-text-muted">Configura il modello generale oppure una versione per vettore. Gli indirizzi del vettore sostituiscono quelli generali.</p>
    <form onSubmit={salva} className="space-y-4"><fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm">Modello<select className={stile} value={vettore} onChange={(e) => { setVettore(e.target.value); setMessaggio(""); }}><option value="">Generale</option>{vettori.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}</select></label>
      <label className="block text-sm">A — separa gli indirizzi con punto e virgola<input className={stile} value={a} onChange={(e) => setA(e.target.value)} /></label>
      <label className="block text-sm">Cc<input className={stile} value={cc} onChange={(e) => setCc(e.target.value)} /></label>
      <label className="block text-sm">Oggetto<input required className={stile} value={oggetto} onChange={(e) => setOggetto(e.target.value)} /></label>
      <label className="block text-sm">Testo<textarea required rows={9} className={stile} value={corpo} onChange={(e) => setCorpo(e.target.value)} /></label>
      <p className="text-sm text-text-muted">Segnaposto: {"{vettore}, {mese}, {anno}, {direzione}, {n_anomalie}, {totale_contestato}, {tabella}"}.</p>
    </fieldset>{errore && <p role="alert" className="text-danger text-sm">{errore}</p>}{messaggio && <p role="status" className="text-success text-sm">{messaggio}</p>}
    <Button disabled={busy} type="submit">{busy ? "Attendi…" : "Salva modello email"}</Button></form>
    <details className="mt-5 text-sm"><summary className="cursor-pointer text-primary">Collegamento a Outlook sul PC</summary><p className="mt-2">L’apertura tramite COM richiede Outlook classico e il collegamento locale SICS, da installare una volta su ogni PC. Il collegamento verifica la disponibilità di Outlook e apre solo bozze da rileggere.</p><a className="text-primary underline" href="/api/portali/vettori/outlook/installazione">Scarica il collegamento Outlook</a></details>
  </section>;
}
