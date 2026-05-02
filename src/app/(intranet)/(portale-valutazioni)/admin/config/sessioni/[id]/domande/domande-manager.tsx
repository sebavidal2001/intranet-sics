"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { creaDomanda, eliminaDomanda } from "../../../actions";
import { Trash2, Plus, GripVertical, AlertCircle } from "lucide-react";

interface Parametro {
  id: string;
  nome: string;
  colore: string;
}

interface Domanda {
  id: string;
  testo: string;
  ordine: number;
  parametro: { nome: string; colore: string } | null;
  parametro_id: string;
}

interface Props {
  sessioneId: string;
  domande: Domanda[];
  parametri: Parametro[];
  isAperta: boolean;
}

export default function DomandeManager({
  sessioneId,
  domande: initialDomande,
  parametri,
  isAperta,
}: Props) {
  const router = useRouter();
  const [domande, setDomande] = useState(initialDomande);
  const [testo, setTesto] = useState("");
  const [parametroId, setParametroId] = useState(parametri[0]?.id || "");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleAdd = () => {
    if (!testo.trim()) {
      setError("Inserisci il testo della domanda.");
      return;
    }
    if (!parametroId) {
      setError("Seleziona un parametro.");
      return;
    }
    setError("");

    startTransition(async () => {
      const fd = new FormData();
      fd.set("sessione_id", sessioneId);
      fd.set("testo", testo.trim());
      fd.set("parametro_id", parametroId);
      fd.set("ordine", String(domande.length));
      const result = await creaDomanda(fd);
      if (!result.success) {
        setError(result.error);
        return;
      }
      // Optimistic: aggiungi localmente e refresh
      const param = parametri.find((p) => p.id === parametroId);
      setDomande((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          testo: testo.trim(),
          ordine: prev.length,
          parametro: param ? { nome: param.nome, colore: param.colore } : null,
          parametro_id: parametroId,
        },
      ]);
      setTesto("");
      router.refresh();
    });
  };

  const handleDelete = (domandaId: string) => {
    startTransition(async () => {
      const result = await eliminaDomanda(domandaId, sessioneId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setDomande((prev) => prev.filter((d) => d.id !== domandaId));
      router.refresh();
    });
  };

  const inputClass =
    "w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors";

  return (
    <div className="space-y-6">
      {/* Lista domande esistenti */}
      <div className="bg-bg rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-bg-page flex items-center justify-between">
          <h2 className="font-tenorite text-sm text-text">
            Domande ({domande.length})
          </h2>
          {isAperta && (
            <span className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-full px-2.5 py-0.5">
              Sessione aperta — le modifiche sono visibili agli utenti
            </span>
          )}
        </div>

        {domande.length === 0 ? (
          <div className="py-10 text-center text-text-muted text-sm">
            Nessuna domanda ancora. Aggiungine una qui sotto.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {domande.map((d, idx) => (
              <div
                key={d.id}
                className="flex items-start gap-3 px-4 py-3 hover:bg-bg-page transition-colors group"
              >
                <GripVertical className="w-4 h-4 text-text-muted mt-0.5 shrink-0 opacity-30" />
                <span className="text-xs font-tenorite text-text-muted w-5 shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text leading-snug">{d.testo}</p>
                  {d.parametro && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: d.parametro.colore }}
                      />
                      <span className="text-xs text-text-muted">
                        {d.parametro.nome}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(d.id)}
                  disabled={isPending}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-text-muted hover:text-danger transition-all rounded-lg hover:bg-danger/5"
                  title="Elimina domanda"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form aggiunta nuova domanda */}
      <div className="bg-bg rounded-xl border border-border p-5">
        <h2 className="font-tenorite text-sm text-text mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" />
          Aggiungi domanda
        </h2>

        {error && (
          <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 text-danger rounded-lg px-3 py-2.5 text-sm mb-4">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-3">
          {/* Testo domanda */}
          <div>
            <label className="block font-tenorite text-xs text-text-muted mb-1">
              Testo della domanda <span className="text-danger">*</span>
            </label>
            <textarea
              value={testo}
              onChange={(e) => setTesto(e.target.value)}
              rows={2}
              placeholder="Es. Il collaboratore dimostra padronanza degli strumenti informatici?"
              className={`${inputClass} resize-none`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleAdd();
              }}
            />
          </div>

          {/* Parametro */}
          <div>
            <label className="block font-tenorite text-xs text-text-muted mb-1">
              Parametro radar <span className="text-danger">*</span>
            </label>
            <select
              value={parametroId}
              onChange={(e) => setParametroId(e.target.value)}
              className={inputClass}
            >
              {parametri.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleAdd}
              disabled={isPending || !testo.trim()}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white font-tenorite px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {isPending ? "Aggiunta…" : "Aggiungi"}
            </button>
            <span className="text-xs text-text-muted">
              Ctrl+Invio per aggiungere rapidamente
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
