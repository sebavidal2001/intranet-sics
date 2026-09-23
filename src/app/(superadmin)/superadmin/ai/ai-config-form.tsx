"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, AlertTriangle, Loader2 } from "lucide-react";
import { salvaConfigAi } from "./actions";

export interface ModelloScelta {
  id: string;
  nome: string;
  prezzoIngresso: number | null;
  prezzoUscita: number | null;
}

export interface VoceConfig {
  chiave: string;
  descrizione: string;
  modelloPrimario: string;
  modelloRiserva: string | null;
  attivo: boolean;
  dpi: number;
  massimoPagine: number;
  timeoutSecondi: number;
  massimoTokenRisposta: number;
  aggiornatoIl: string | null;
}

const inputClass =
  "w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg " +
  "focus:outline-none focus:border-primary transition-colors duration-150";

/** Mezzo centesimo a fattura è un numero più parlante di «0,30 $/Mtok». */
function costoStimato(m: ModelloScelta | undefined): string | null {
  if (!m || m.prezzoIngresso == null || m.prezzoUscita == null) return null;
  // Consumo medio misurato sulle fatture vere: 4.000 token letti, 1.500 scritti.
  const euro = (4000 * m.prezzoIngresso + 1500 * m.prezzoUscita) / 1_000_000;
  return euro < 0.01 ? "meno di un centesimo a fattura" : `circa ${euro.toFixed(2)} $ a fattura`;
}

export function AiConfigForm({
  voce,
  modelli,
}: {
  voce: VoceConfig;
  modelli: ModelloScelta[];
}) {
  const [primario, setPrimario] = useState(voce.modelloPrimario);
  const [riserva, setRiserva] = useState(voce.modelloRiserva ?? "");
  const [attivo, setAttivo] = useState(voce.attivo);
  const [dpi, setDpi] = useState(voce.dpi);
  const [massimoPagine, setMassimoPagine] = useState(voce.massimoPagine);
  const [timeoutSecondi, setTimeoutSecondi] = useState(voce.timeoutSecondi);
  const [massimoToken, setMassimoToken] = useState(voce.massimoTokenRisposta);
  const [esito, setEsito] = useState<{ tipo: "ok" | "errore" | "avviso"; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();

  const perId = useMemo(() => new Map(modelli.map((m) => [m.id, m])), [modelli]);

  // Il modello configurato potrebbe non essere più nell'elenco: si tiene
  // comunque nella tendina, altrimenti salvare lo cambierebbe di nascosto.
  const opzioni = useMemo(() => {
    const ids = new Set(modelli.map((m) => m.id));
    const extra = [primario, riserva].filter((id) => id && !ids.has(id));
    return [...extra.map((id) => ({ id, nome: `${id} (non più in elenco)`, prezzoIngresso: null, prezzoUscita: null })), ...modelli];
  }, [modelli, primario, riserva]);

  function salva() {
    setEsito(null);
    avvia(async () => {
      const r = await salvaConfigAi({
        chiave: voce.chiave,
        modelloPrimario: primario,
        modelloRiserva: riserva || null,
        attivo,
        dpi,
        massimoPagine,
        timeoutSecondi,
        massimoTokenRisposta: massimoToken,
      });
      if (r.error) setEsito({ tipo: "errore", testo: r.error });
      else if (r.avviso) setEsito({ tipo: "avviso", testo: r.avviso });
      else setEsito({ tipo: "ok", testo: "Configurazione salvata." });
    });
  }

  return (
    <div className="bg-bg border border-border rounded-xl p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-tenorite text-lg text-text">{voce.chiave}</h2>
          <p className="text-sm text-text-muted mt-1">{voce.descrizione}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-text shrink-0">
          <input
            type="checkbox"
            checked={attivo}
            onChange={(e) => setAttivo(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          Attiva
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">
            Modello principale
          </label>
          <select value={primario} onChange={(e) => setPrimario(e.target.value)} className={inputClass}>
            {opzioni.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
          <p className="text-xs text-text-muted mt-1">
            {costoStimato(perId.get(primario)) ?? "prezzo non esposto da OpenRouter"}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-1.5">
            Modello di riserva
          </label>
          <select value={riserva} onChange={(e) => setRiserva(e.target.value)} className={inputClass}>
            <option value="">— nessuno: un tentativo solo —</option>
            {opzioni.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
          <p className="text-xs text-text-muted mt-1">
            Si usa <strong>solo</strong> se la lettura del principale non quadra con i totali
            stampati sulla fattura.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">Risoluzione (dpi)</label>
          <input type="number" min={72} max={600} step={50} value={dpi}
                 onChange={(e) => setDpi(Number(e.target.value))} className={inputClass} />
          <p className="text-xs text-text-muted mt-1">
            200 basta: alzarla non compensa un modello meno capace.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">Pagine massime</label>
          <input type="number" min={1} max={50} value={massimoPagine}
                 onChange={(e) => setMassimoPagine(Number(e.target.value))} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">Attesa massima (s)</label>
          <input type="number" min={10} max={600} step={10} value={timeoutSecondi}
                 onChange={(e) => setTimeoutSecondi(Number(e.target.value))} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">Tetto risposta (token)</label>
          <input type="number" min={500} max={64000} step={500} value={massimoToken}
                 onChange={(e) => setMassimoToken(Number(e.target.value))} className={inputClass} />
          <p className="text-xs text-text-muted mt-1">
            OpenRouter blocca la chiamata se il credito non copre il tetto, anche quando la
            risposta vera sarà molto più corta.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={salva}
          disabled={inCorso}
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white
                     rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-150
                     disabled:opacity-60"
        >
          {inCorso ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Salva
        </button>
        {voce.aggiornatoIl && (
          <span className="text-xs text-text-muted">
            Ultima modifica: {new Date(voce.aggiornatoIl).toLocaleString("it-IT")}
          </span>
        )}
      </div>

      {esito && (
        <div
          className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${
            esito.tipo === "errore"
              ? "bg-danger/10 text-danger"
              : esito.tipo === "avviso"
                ? "bg-warning/10 text-warning"
                : "bg-success/10 text-success"
          }`}
        >
          {esito.tipo === "ok" ? (
            <Check className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          )}
          <span>{esito.testo}</span>
        </div>
      )}
    </div>
  );
}
