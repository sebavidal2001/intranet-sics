"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createMansione,
  updateMansione,
  deleteMansione,
} from "../actions";
import {
  Trash2,
  Plus,
  GripVertical,
  AlertCircle,
  Check,
  X,
  Pencil,
} from "lucide-react";

interface Parametro {
  id: string;
  nome: string;
  colore: string;
}

interface Mansione {
  id: string;
  testo: string;
  ordine: number;
  parametro_radar_id: string;
  parametro: { id: string; nome: string; colore: string } | null;
}

interface Props {
  ruoloId: string;
  ruoloNome: string;
  mansioni: Mansione[];
  parametri: Parametro[];
}

export default function MansioniManager({
  ruoloId,
  mansioni: initialMansioni,
  parametri,
}: Props) {
  const router = useRouter();
  const [mansioni, setMansioni] = useState<Mansione[]>(initialMansioni);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Stato form aggiunta nuova mansione
  const [nuovoTesto, setNuovoTesto] = useState("");
  const [nuovoParametroId, setNuovoParametroId] = useState(
    parametri[0]?.id || ""
  );

  // Stato modifica inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTesto, setEditTesto] = useState("");
  const [editParametroId, setEditParametroId] = useState("");

  // Stato conferma eliminazione
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const inputClass =
    "w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors";

  // ── Aggiungi mansione ─────────────────────────────────────────────────────
  const handleAdd = () => {
    if (!nuovoTesto.trim()) {
      setError("Inserisci il testo della mansione.");
      return;
    }
    if (!nuovoParametroId) {
      setError("Seleziona un parametro radar.");
      return;
    }
    setError("");

    startTransition(async () => {
      const result = await createMansione({
        ruolo_professionale_id: ruoloId,
        testo: nuovoTesto.trim(),
        parametro_radar_id: nuovoParametroId,
        ordine: mansioni.length,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      const param = parametri.find((p) => p.id === nuovoParametroId);
      setMansioni((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          testo: nuovoTesto.trim(),
          ordine: prev.length,
          parametro_radar_id: nuovoParametroId,
          parametro: param
            ? { id: param.id, nome: param.nome, colore: param.colore }
            : null,
        },
      ]);
      setNuovoTesto("");
      router.refresh();
    });
  };

  // ── Avvia modifica inline ─────────────────────────────────────────────────
  const startEdit = (m: Mansione) => {
    setEditingId(m.id);
    setEditTesto(m.testo);
    setEditParametroId(m.parametro_radar_id);
    setError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTesto("");
    setEditParametroId("");
  };

  // ── Salva modifica inline ─────────────────────────────────────────────────
  const handleSaveEdit = (m: Mansione) => {
    if (!editTesto.trim()) {
      setError("Il testo non può essere vuoto.");
      return;
    }
    setError("");

    startTransition(async () => {
      const result = await updateMansione(m.id, {
        testo: editTesto.trim(),
        parametro_radar_id: editParametroId,
        ordine: m.ordine,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      const param = parametri.find((p) => p.id === editParametroId);
      setMansioni((prev) =>
        prev.map((item) =>
          item.id === m.id
            ? {
                ...item,
                testo: editTesto.trim(),
                parametro_radar_id: editParametroId,
                parametro: param
                  ? { id: param.id, nome: param.nome, colore: param.colore }
                  : null,
              }
            : item
        )
      );
      setEditingId(null);
      router.refresh();
    });
  };

  // ── Elimina mansione ──────────────────────────────────────────────────────
  const handleDelete = (mansioneId: string) => {
    startTransition(async () => {
      const result = await deleteMansione(mansioneId, ruoloId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setMansioni((prev) => prev.filter((m) => m.id !== mansioneId));
      setDeletingId(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {/* Lista mansioni */}
      <div className="bg-bg rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-bg-page">
          <h2 className="font-tenorite text-sm text-text">
            Mansioni ({mansioni.length})
          </h2>
        </div>

        {mansioni.length === 0 ? (
          <div className="py-10 text-center text-text-muted text-sm">
            Nessuna mansione ancora. Aggiungine una qui sotto.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {mansioni.map((m, idx) => (
              <div
                key={m.id}
                className="px-4 py-3 hover:bg-bg-page transition-colors group"
              >
                {editingId === m.id ? (
                  /* ── Modalità modifica inline ── */
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editTesto}
                      onChange={(e) => setEditTesto(e.target.value)}
                      className={inputClass}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit(m);
                        if (e.key === "Escape") cancelEdit();
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <select
                        value={editParametroId}
                        onChange={(e) => setEditParametroId(e.target.value)}
                        className={`${inputClass} flex-1`}
                      >
                        {parametri.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleSaveEdit(m)}
                        disabled={isPending}
                        className="p-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
                        title="Salva"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-2 border border-border text-text-muted hover:text-text rounded-lg transition-colors"
                        title="Annulla"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : deletingId === m.id ? (
                  /* ── Conferma eliminazione ── */
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-danger">
                      Eliminare &ldquo;{m.testo}&rdquo;?
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDelete(m.id)}
                        disabled={isPending}
                        className="px-3 py-1.5 bg-danger hover:bg-danger/80 text-white text-xs font-tenorite rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isPending ? "Eliminazione…" : "Elimina"}
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        className="px-3 py-1.5 border border-border text-text-muted hover:text-text text-xs rounded-lg transition-colors"
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Vista normale ── */
                  <div className="flex items-start gap-3">
                    <GripVertical className="w-4 h-4 text-text-muted mt-0.5 shrink-0 opacity-30" />
                    <span className="text-xs font-tenorite text-text-muted w-5 shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text leading-snug">
                        {m.testo}
                      </p>
                      {m.parametro && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: m.parametro.colore }}
                          />
                          <span className="text-xs text-text-muted">
                            {m.parametro.nome}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(m)}
                        className="p-1.5 text-text-muted hover:text-primary rounded-lg hover:bg-primary-light transition-colors"
                        title="Modifica"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeletingId(m.id)}
                        className="p-1.5 text-text-muted hover:text-danger rounded-lg hover:bg-danger/5 transition-colors"
                        title="Elimina"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form aggiunta nuova mansione */}
      <div className="bg-bg rounded-xl border border-border p-5">
        <h2 className="font-tenorite text-sm text-text mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" />
          Aggiungi mansione
        </h2>

        {error && (
          <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 text-danger rounded-lg px-3 py-2.5 text-sm mb-4">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block font-tenorite text-xs text-text-muted mb-1">
              Testo della mansione <span className="text-danger">*</span>
            </label>
            <textarea
              value={nuovoTesto}
              onChange={(e) => setNuovoTesto(e.target.value)}
              rows={2}
              placeholder="Es. Gestione degli ordini in entrata e uscita…"
              className={`${inputClass} resize-none`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleAdd();
              }}
            />
          </div>

          <div>
            <label className="block font-tenorite text-xs text-text-muted mb-1">
              Parametro radar <span className="text-danger">*</span>
            </label>
            <select
              value={nuovoParametroId}
              onChange={(e) => setNuovoParametroId(e.target.value)}
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
              disabled={isPending || !nuovoTesto.trim()}
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
