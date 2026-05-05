"use client";

import { useState, useTransition, useEffect } from "react";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  createRuolo,
  updateRuolo,
  deleteRuolo,
  createReparto,
  updateReparto,
  deleteReparto,
} from "./actions";

interface RuoloConfig {
  id: string;
  nome: string;
  slug: string;
  colore: string;
  ordine: number;
  is_system: boolean;
}

interface Reparto {
  id: string;
  nome: string;
  descrizione: string | null;
  ordine: number;
  attivo: boolean;
}

interface Props {
  ruoli: RuoloConfig[];
  reparti: Reparto[];
}

const inputClass =
  "w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-150";

export default function RuoliRepartiManager({ ruoli: initialRuoli, reparti: initialReparti }: Props) {
  const [isPending, startTransition] = useTransition();
  const [ruoli, setRuoli] = useState<RuoloConfig[]>(initialRuoli);
  const [reparti, setReparti] = useState<Reparto[]>(initialReparti);

  // Sync with server data when props change (after revalidatePath)
  useEffect(() => { setRuoli(initialRuoli); }, [initialRuoli]);
  useEffect(() => { setReparti(initialReparti); }, [initialReparti]);
  const [error, setError] = useState<string | null>(null);

  // ── Ruoli state ────────────────────────────────────────────────────────────
  const [showAddRuolo, setShowAddRuolo] = useState(false);
  const [editingRuoloId, setEditingRuoloId] = useState<string | null>(null);
  const [ruoloForm, setRuoloForm] = useState({ nome: "", slug: "", colore: "#00a1be", ordine: 0 });
  const [editRuoloForm, setEditRuoloForm] = useState({ nome: "", colore: "#00a1be", ordine: 0 });

  // ── Reparti state ──────────────────────────────────────────────────────────
  const [showAddReparto, setShowAddReparto] = useState(false);
  const [editingRepartoId, setEditingRepartoId] = useState<string | null>(null);
  const [repartoForm, setRepartoForm] = useState({ nome: "", descrizione: "", ordine: 0 });
  const [editRepartoForm, setEditRepartoForm] = useState({ nome: "", descrizione: "", ordine: 0, attivo: true });

  // ── Ruolo handlers ─────────────────────────────────────────────────────────
  const handleCreateRuolo = () => {
    if (!ruoloForm.nome.trim() || !ruoloForm.slug.trim()) {
      setError("Nome e slug sono obbligatori.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createRuolo({
        nome: ruoloForm.nome.trim(),
        slug: ruoloForm.slug.trim(),
        colore: ruoloForm.colore,
        ordine: ruoloForm.ordine,
      });
      if (res.error) { setError(res.error); return; }
      setRuoli((prev) => [
        ...prev,
        { id: crypto.randomUUID(), ...ruoloForm, nome: ruoloForm.nome.trim(), slug: ruoloForm.slug.trim(), is_system: false },
      ]);
      setRuoloForm({ nome: "", slug: "", colore: "#00a1be", ordine: 0 });
      setShowAddRuolo(false);
    });
  };

  const handleUpdateRuolo = (id: string) => {
    if (!editRuoloForm.nome.trim()) { setError("Il nome è obbligatorio."); return; }
    setError(null);
    startTransition(async () => {
      const res = await updateRuolo(id, editRuoloForm);
      if (res.error) { setError(res.error); return; }
      setRuoli((prev) =>
        prev.map((r) => r.id === id ? { ...r, ...editRuoloForm } : r)
      );
      setEditingRuoloId(null);
    });
  };

  const handleDeleteRuolo = (id: string) => {
    setError(null);
    startTransition(async () => {
      const res = await deleteRuolo(id);
      if (res.error) { setError(res.error); return; }
      setRuoli((prev) => prev.filter((r) => r.id !== id));
    });
  };

  const startEditRuolo = (r: RuoloConfig) => {
    setEditingRuoloId(r.id);
    setEditRuoloForm({ nome: r.nome, colore: r.colore, ordine: r.ordine });
    setError(null);
  };

  // ── Reparto handlers ───────────────────────────────────────────────────────
  const handleCreateReparto = () => {
    if (!repartoForm.nome.trim()) { setError("Il nome del reparto è obbligatorio."); return; }
    setError(null);
    startTransition(async () => {
      const res = await createReparto({
        nome: repartoForm.nome.trim(),
        descrizione: repartoForm.descrizione.trim() || undefined,
        ordine: repartoForm.ordine,
      });
      if (res.error) { setError(res.error); return; }
      setReparti((prev) => [
        ...prev,
        { id: crypto.randomUUID(), nome: repartoForm.nome.trim(), descrizione: repartoForm.descrizione.trim() || null, ordine: repartoForm.ordine, attivo: true },
      ]);
      setRepartoForm({ nome: "", descrizione: "", ordine: 0 });
      setShowAddReparto(false);
    });
  };

  const handleUpdateReparto = (id: string) => {
    if (!editRepartoForm.nome.trim()) { setError("Il nome è obbligatorio."); return; }
    setError(null);
    startTransition(async () => {
      const res = await updateReparto(id, editRepartoForm);
      if (res.error) { setError(res.error); return; }
      setReparti((prev) =>
        prev.map((r) => r.id === id ? { ...r, ...editRepartoForm } : r)
      );
      setEditingRepartoId(null);
    });
  };

  const handleDeleteReparto = (id: string) => {
    setError(null);
    startTransition(async () => {
      const res = await deleteReparto(id);
      if (res.error) { setError(res.error); return; }
      setReparti((prev) => prev.filter((r) => r.id !== id));
    });
  };

  const startEditReparto = (r: Reparto) => {
    setEditingRepartoId(r.id);
    setEditRepartoForm({ nome: r.nome, descrizione: r.descrizione ?? "", ordine: r.ordine, attivo: r.attivo });
    setError(null);
  };

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* ── Sezione Ruoli ── */}
      <section className="bg-bg rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-bg-page flex items-center justify-between">
          <div>
            <h2 className="font-tenorite text-base text-text">Ruoli</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Configura i ruoli disponibili nel sistema
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowAddRuolo(true); setError(null); }}
            className="inline-flex items-center gap-1.5 text-sm font-tenorite bg-primary hover:bg-primary-dark text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Aggiungi ruolo
          </button>
        </div>

        <div className="divide-y divide-border">
          {ruoli.length === 0 && !showAddRuolo && (
            <div className="py-8 text-center text-sm text-text-muted">
              Nessun ruolo configurato.
            </div>
          )}

          {ruoli.map((r) => (
            <div key={r.id} className="px-5 py-3">
              {editingRuoloId === r.id ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    type="text"
                    value={editRuoloForm.nome}
                    onChange={(e) => setEditRuoloForm((f) => ({ ...f, nome: e.target.value }))}
                    placeholder="Nome ruolo"
                    className="flex-1 min-w-[140px] border border-border rounded-lg px-3 py-1.5 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors"
                  />
                  <div className="min-w-[220px]">
                    <ColorPicker
                      value={editRuoloForm.colore}
                      onChange={(c) => setEditRuoloForm((f) => ({ ...f, colore: c }))}
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-text-muted font-tenorite">Ordine</label>
                    <input
                      type="number"
                      value={editRuoloForm.ordine}
                      onChange={(e) => setEditRuoloForm((f) => ({ ...f, ordine: parseInt(e.target.value) || 0 }))}
                      className="w-16 border border-border rounded-lg px-2 py-1.5 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleUpdateRuolo(r.id)}
                      disabled={isPending}
                      className="p-1.5 text-success hover:bg-success/10 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditingRuoloId(null)}
                      className="p-1.5 text-text-muted hover:text-text rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: r.colore }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-tenorite text-sm text-text">{r.nome}</span>
                      <span className="text-xs text-text-muted">({r.slug})</span>
                      <span className="text-xs text-text-muted">ord. {r.ordine}</span>
                      {r.is_system && (
                        <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-secondary-light text-text-muted border border-border">
                          sistema
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => startEditRuolo(r)}
                      className="p-1.5 text-text-muted hover:text-primary rounded-lg transition-colors"
                      title="Modifica"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteRuolo(r.id)}
                      disabled={r.is_system || isPending}
                      className="p-1.5 text-text-muted hover:text-danger rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title={r.is_system ? "Ruolo di sistema non eliminabile" : "Elimina"}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Add form inline */}
          {showAddRuolo && (
            <div className="px-5 py-4 bg-bg-page">
              <p className="font-tenorite text-xs text-text-muted mb-3">Nuovo ruolo</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Nome *</label>
                  <input
                    type="text"
                    value={ruoloForm.nome}
                    onChange={(e) => setRuoloForm((f) => ({ ...f, nome: e.target.value }))}
                    placeholder="Es. Responsabile"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Slug *</label>
                  <input
                    type="text"
                    value={ruoloForm.slug}
                    onChange={(e) => setRuoloForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, "_") }))}
                    placeholder="Es. responsabile"
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <ColorPicker
                    label="Colore"
                    value={ruoloForm.colore}
                    onChange={(c) => setRuoloForm((f) => ({ ...f, colore: c }))}
                  />
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-text-muted mb-1">Ordine</label>
                    <input
                      type="number"
                      value={ruoloForm.ordine}
                      onChange={(e) => setRuoloForm((f) => ({ ...f, ordine: parseInt(e.target.value) || 0 }))}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={handleCreateRuolo}
                  disabled={isPending}
                  className="px-4 py-2 text-sm font-tenorite bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {isPending ? "Salvataggio…" : "Salva"}
                </button>
                <button
                  onClick={() => { setShowAddRuolo(false); setError(null); }}
                  className="px-4 py-2 text-sm text-text-muted hover:text-text border border-border rounded-lg transition-colors"
                >
                  Annulla
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Sezione Reparti ── */}
      <section className="bg-bg rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-bg-page flex items-center justify-between">
          <div>
            <h2 className="font-tenorite text-base text-text">Reparti</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Gestisci i reparti aziendali
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowAddReparto(true); setError(null); }}
            className="inline-flex items-center gap-1.5 text-sm font-tenorite bg-primary hover:bg-primary-dark text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Aggiungi reparto
          </button>
        </div>

        <div className="divide-y divide-border">
          {reparti.length === 0 && !showAddReparto && (
            <div className="py-8 text-center text-sm text-text-muted">
              Nessun reparto configurato.
            </div>
          )}

          {reparti.map((r) => (
            <div key={r.id} className="px-5 py-3">
              {editingRepartoId === r.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Nome *</label>
                      <input
                        type="text"
                        value={editRepartoForm.nome}
                        onChange={(e) => setEditRepartoForm((f) => ({ ...f, nome: e.target.value }))}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Ordine</label>
                      <input
                        type="number"
                        value={editRepartoForm.ordine}
                        onChange={(e) => setEditRepartoForm((f) => ({ ...f, ordine: parseInt(e.target.value) || 0 }))}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Descrizione</label>
                    <input
                      type="text"
                      value={editRepartoForm.descrizione}
                      onChange={(e) => setEditRepartoForm((f) => ({ ...f, descrizione: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editRepartoForm.attivo}
                        onChange={(e) => setEditRepartoForm((f) => ({ ...f, attivo: e.target.checked }))}
                        className="rounded border-border"
                      />
                      <span className="font-tenorite text-xs">Attivo</span>
                    </label>
                    <button
                      onClick={() => handleUpdateReparto(r.id)}
                      disabled={isPending}
                      className="px-3 py-1.5 text-xs font-tenorite bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isPending ? "…" : "Salva"}
                    </button>
                    <button
                      onClick={() => setEditingRepartoId(null)}
                      className="px-3 py-1.5 text-xs text-text-muted hover:text-text border border-border rounded-lg transition-colors"
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-tenorite text-sm text-text">{r.nome}</span>
                      {r.descrizione && (
                        <span className="text-xs text-text-muted truncate">{r.descrizione}</span>
                      )}
                      <span className="text-xs text-text-muted">ord. {r.ordine}</span>
                      {!r.attivo && (
                        <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-secondary-light text-text-muted border border-border">
                          inattivo
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => startEditReparto(r)}
                      className="p-1.5 text-text-muted hover:text-primary rounded-lg transition-colors"
                      title="Modifica"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteReparto(r.id)}
                      disabled={isPending}
                      className="p-1.5 text-text-muted hover:text-danger rounded-lg transition-colors disabled:opacity-30"
                      title="Elimina"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Add form inline */}
          {showAddReparto && (
            <div className="px-5 py-4 bg-bg-page">
              <p className="font-tenorite text-xs text-text-muted mb-3">Nuovo reparto</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Nome *</label>
                  <input
                    type="text"
                    value={repartoForm.nome}
                    onChange={(e) => setRepartoForm((f) => ({ ...f, nome: e.target.value }))}
                    placeholder="Es. Amministrazione"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Ordine</label>
                  <input
                    type="number"
                    value={repartoForm.ordine}
                    onChange={(e) => setRepartoForm((f) => ({ ...f, ordine: parseInt(e.target.value) || 0 }))}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-text-muted mb-1">Descrizione (opzionale)</label>
                  <input
                    type="text"
                    value={repartoForm.descrizione}
                    onChange={(e) => setRepartoForm((f) => ({ ...f, descrizione: e.target.value }))}
                    placeholder="Breve descrizione del reparto"
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={handleCreateReparto}
                  disabled={isPending}
                  className="px-4 py-2 text-sm font-tenorite bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {isPending ? "Salvataggio…" : "Salva"}
                </button>
                <button
                  onClick={() => { setShowAddReparto(false); setError(null); }}
                  className="px-4 py-2 text-sm text-text-muted hover:text-text border border-border rounded-lg transition-colors"
                >
                  Annulla
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
