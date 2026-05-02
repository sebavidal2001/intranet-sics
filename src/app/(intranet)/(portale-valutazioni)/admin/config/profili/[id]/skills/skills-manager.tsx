"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, X, Check, AlertCircle } from "lucide-react";
import { createSkill, updateSkill, deleteSkill } from "@/app/(intranet)/(portale-valutazioni)/admin/config/profili/[id]/skills/actions";

interface Skill {
  id: string;
  nome: string;
  descrizione: string | null;
  ordine: number;
}

interface Props {
  ruoloProfessionaleId: string;
  skills: Skill[];
}

const inputClass =
  "w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-[120ms]";

export default function SkillsManager({ ruoloProfessionaleId, skills: initialSkills }: Props) {
  const [isPending, startTransition] = useTransition();
  const [skills, setSkills] = useState<Skill[]>(initialSkills);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ nome: "", descrizione: "", ordine: 0 });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ nome: "", descrizione: "", ordine: 0 });

  const handleCreate = () => {
    if (!addForm.nome.trim()) { setError("Il nome è obbligatorio."); return; }
    setError(null);
    startTransition(async () => {
      const res = await createSkill({
        ruolo_professionale_id: ruoloProfessionaleId,
        nome: addForm.nome.trim(),
        descrizione: addForm.descrizione.trim() || undefined,
        ordine: addForm.ordine,
      });
      if (res.error) { setError(res.error); return; }
      setSkills((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          nome: addForm.nome.trim(),
          descrizione: addForm.descrizione.trim() || null,
          ordine: addForm.ordine,
        },
      ]);
      setAddForm({ nome: "", descrizione: "", ordine: skills.length });
      setShowAdd(false);
    });
  };

  const handleUpdate = (id: string) => {
    if (!editForm.nome.trim()) { setError("Il nome è obbligatorio."); return; }
    setError(null);
    startTransition(async () => {
      const res = await updateSkill(id, ruoloProfessionaleId, editForm);
      if (res.error) { setError(res.error); return; }
      setSkills((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, nome: editForm.nome.trim(), descrizione: editForm.descrizione.trim() || null, ordine: editForm.ordine }
            : s
        )
      );
      setEditingId(null);
    });
  };

  const handleDelete = (id: string) => {
    setError(null);
    startTransition(async () => {
      const res = await deleteSkill(id, ruoloProfessionaleId);
      if (res.error) { setError(res.error); return; }
      setSkills((prev) => prev.filter((s) => s.id !== id));
    });
  };

  const startEdit = (s: Skill) => {
    setEditingId(s.id);
    setEditForm({ nome: s.nome, descrizione: s.descrizione ?? "", ordine: s.ordine });
    setError(null);
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="bg-bg rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-bg-page flex items-center justify-between">
          <h2 className="font-tenorite text-sm text-text">
            Skills ({skills.length})
          </h2>
          <button
            type="button"
            onClick={() => { setShowAdd(true); setError(null); setAddForm({ nome: "", descrizione: "", ordine: skills.length }); }}
            className="inline-flex items-center gap-1.5 text-sm font-tenorite bg-primary hover:bg-primary-dark text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Aggiungi skill
          </button>
        </div>

        <div className="divide-y divide-border">
          {skills.length === 0 && !showAdd && (
            <div className="py-8 text-center text-sm text-text-muted">
              Nessuna skill configurata per questo profilo.
            </div>
          )}

          {skills.map((s) => (
            <div key={s.id} className="px-5 py-3">
              {editingId === s.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs text-text-muted mb-1">Nome *</label>
                      <input
                        type="text"
                        value={editForm.nome}
                        onChange={(e) => setEditForm((f) => ({ ...f, nome: e.target.value }))}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Ordine</label>
                      <input
                        type="number"
                        value={editForm.ordine}
                        onChange={(e) => setEditForm((f) => ({ ...f, ordine: parseInt(e.target.value) || 0 }))}
                        className={inputClass}
                      />
                    </div>
                    <div className="flex items-end gap-2 pb-0.5">
                      <button
                        onClick={() => handleUpdate(s.id)}
                        disabled={isPending}
                        className="p-2 text-success hover:bg-success/10 rounded-lg transition-colors disabled:opacity-50"
                        title="Salva"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="p-2 text-text-muted hover:text-text rounded-lg transition-colors"
                        title="Annulla"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Descrizione</label>
                    <input
                      type="text"
                      value={editForm.descrizione}
                      onChange={(e) => setEditForm((f) => ({ ...f, descrizione: e.target.value }))}
                      placeholder="Descrizione breve della skill"
                      className={inputClass}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-tenorite text-sm text-text">{s.nome}</span>
                      <span className="text-xs text-text-muted">#{s.ordine}</span>
                    </div>
                    {s.descrizione && (
                      <p className="text-xs text-text-muted mt-0.5">{s.descrizione}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => startEdit(s)}
                      className="p-1.5 text-text-muted hover:text-primary rounded-lg transition-colors"
                      title="Modifica"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
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

          {showAdd && (
            <div className="px-5 py-4 bg-bg-page">
              <p className="font-tenorite text-xs text-text-muted mb-3">Nuova skill</p>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs text-text-muted mb-1">Nome *</label>
                    <input
                      type="text"
                      value={addForm.nome}
                      onChange={(e) => setAddForm((f) => ({ ...f, nome: e.target.value }))}
                      placeholder="Es. Problem Solving"
                      className={inputClass}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Ordine</label>
                    <input
                      type="number"
                      value={addForm.ordine}
                      onChange={(e) => setAddForm((f) => ({ ...f, ordine: parseInt(e.target.value) || 0 }))}
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Descrizione (opzionale)</label>
                  <input
                    type="text"
                    value={addForm.descrizione}
                    onChange={(e) => setAddForm((f) => ({ ...f, descrizione: e.target.value }))}
                    placeholder="Breve descrizione della skill"
                    className={inputClass}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCreate}
                    disabled={isPending}
                    className="px-4 py-2 text-sm font-tenorite bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isPending ? "Salvataggio…" : "Salva skill"}
                  </button>
                  <button
                    onClick={() => { setShowAdd(false); setError(null); }}
                    className="px-4 py-2 text-sm text-text-muted hover:text-text border border-border rounded-lg transition-colors"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
