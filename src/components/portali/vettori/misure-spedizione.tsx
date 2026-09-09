"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CONDIZIONI_CONTROLLO, MisureRiga, type MisuraRiga } from "@/lib/portali/vettori/misure";

const stile = "w-full min-w-20 rounded border border-border bg-bg px-2 py-1 text-base text-text";
export function MisureSpedizione({ numero, direzione, iniziale, condizioniAttuali = [], disabled, onApplica }: { numero: number; direzione: string | null; iniziale?: MisuraRiga; condizioniAttuali?: string[]; disabled: boolean; onApplica: (m: MisuraRiga) => void }) {
  const [verso, setVerso] = useState(iniziale?.direzione ?? direzione ?? "");
  const [peso, setPeso] = useState(String(iniziale?.pesoKg ?? ""));
  const [volume, setVolume] = useState(String(iniziale?.volumeMc ?? ""));
  const [colli, setColli] = useState(iniziale?.colli ?? []);
  const [condizioni, setCondizioni] = useState<string[] | undefined>(iniziale?.condizioni);
  const [errore, setErrore] = useState("");
  function applica() {
    const p = MisureRiga.safeParse({ riga: numero, direzione: verso || undefined, pesoKg: peso ? Number(peso.replace(",", ".")) : undefined, volumeMc: volume ? Number(volume.replace(",", ".")) : undefined, colli, condizioni });
    if (!p.success) { setErrore(p.error.issues.map((i) => i.message).join(" ")); return; }
    setErrore(""); onApplica(p.data);
  }
  return <details className="mt-2 text-left text-sm min-w-64"><summary className="cursor-pointer text-primary">Modifica misure e condizioni</summary>
    <fieldset disabled={disabled} className="mt-3 space-y-3">
      <label className="block">Direzione<select className={stile} value={verso} onChange={(e) => setVerso(e.target.value)}><option value="">Da classificare</option><option value="uscita">Invio a cliente</option><option value="entrata">Arrivo da fornitore</option></select></label>
      <label className="block">Peso reale totale (kg)<input aria-label={`Riga ${numero}, peso reale`} className={stile} inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} /></label>
      <label className="block">Volume totale (m³), alternativo alle misure<input aria-label={`Riga ${numero}, volume`} className={stile} inputMode="decimal" disabled={colli.length > 0} value={volume} onChange={(e) => setVolume(e.target.value)} /></label>
      <p className="text-xs text-text-muted">Dimensioni in cm per collo. Per colli uguali indica la quantità; per misure diverse aggiungi un gruppo.</p>
      {colli.map((c, i) => <div key={i} className="space-y-2 border-t border-border pt-2">
        {([['quantita', 'Quantità'], ['lunghezzaCm', 'Lunghezza'], ['larghezzaCm', 'Larghezza'], ['altezzaCm', 'Altezza']] as const).map(([k, label]) => <label className="block" key={k}>{label}<input className={stile} type="number" min="0.001" step={k === 'quantita' ? '1' : '0.1'} value={Number.isNaN(c[k]) ? "" : c[k]} onChange={(e) => setColli((prev) => prev.map((v, n) => n === i ? { ...v, [k]: e.target.valueAsNumber } : v))} /></label>)}
        <Button size="sm" variant="ghost" onClick={() => setColli((p) => p.filter((_, n) => n !== i))}>Rimuovi gruppo {i + 1}</Button>
      </div>)}
      <Button size="sm" variant="outline" disabled={Boolean(volume)} onClick={() => setColli((p) => [...p, { quantita: 1, lunghezzaCm: NaN, larghezzaCm: NaN, altezzaCm: NaN }])}>Aggiungi misure collo</Button>
      <fieldset className="space-y-2"><legend className="font-medium mb-2">Condizioni della spedizione</legend>
        <p className="text-xs text-text-muted">Seleziona solo le condizioni effettive. Gli importi dipendono dal listino del vettore.</p>
        {CONDIZIONI_CONTROLLO.map((c) => <label className="flex gap-2" key={c}><input type="checkbox" checked={(condizioni ?? condizioniAttuali).includes(c)} onChange={(e) => setCondizioni((p) => e.target.checked ? [...(p ?? condizioniAttuali), c] : (p ?? condizioniAttuali).filter((x) => x !== c))} />{{ bancale: "Bancale (verificare formato previsto dal listino)", non_sovrapponibile: "Non sovrapponibile", movimentazione_manuale: "Movimentazione manuale", oversized: "Fuori misura", ztl: "Zona a traffico limitato", etichetta_manuale: "Etichetta manuale", triangolazione: "Triangolazione", fuori_provincia: "Fuori provincia", giacenza: "Giacenza", assegno: "Assegno" }[c]}</label>)}
      </fieldset>
      {errore && <p role="alert" className="text-danger">{errore}</p>}
      <Button size="sm" onClick={applica}>Applica e ricalcola</Button>
    </fieldset>
  </details>;
}
