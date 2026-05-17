"use client";

import { useState, useTransition, useMemo } from "react";
import { Pencil, Trash2, X, Check, AlertCircle, Plus, Merge, Search } from "lucide-react";
import {
  createSkillGlobal,
  updateSkillGlobal,
  deleteSkillGlobal,
  mergeSkillDuplicates,
} from "./actions";

interface Skill {
  id: string;
  nome: string;
  descrizione: string | null;
  ordine: number;
  parametro_radar_id: string | null;
}

interface Parametro {
  id: string;
  nome: string;
  colore: string;
}

interface Props {
  skills: Skill[];
  parametri: Parametro[];
}

const inputClass =
  "w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-150";

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export default function SkillsGlobalManager({ skills: initialSkills, parametri }: Props) {
  const [skills, setSkills] = useState<Skill[]>(initialSkills);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterParam, setFilterParam] = useState<string>("all");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ nome: "", descrizione: "", ordine: 0, parametro_radar_id: "" });

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ nome: "", descrizione: "", ordine: 0, parametro_radar_id: "" });

  const parametriById = useMemo(() => {
    const m = new Map<string, Parametro>();
    for (const p of parametri) m.set(p.id, p);
    return m;
  }, [parametri]);

  // Gruppi di duplicati: skills con stesso nome normalizzato
  const duplicateGroups = useMemo(() => {
    const buckets = new Map<string, Skill[]>();
    for (const s of skills) {
      const key = normalizeName(s.nome);
      const arr = buckets.get(key) ?? [];
      arr.push(s);
      buckets.set(key, arr);
    }
    return Array.from(buckets.entries())
      .filter(([, arr]) => arr.length > 1)
      .map(([key, arr]) => ({ key, items: arr }));
  }, [skills]);

  const filteredSkills = useMemo(() => {
    const q = normalizeName(search);
    return skills
      .filter((s) => (filterParam === "all" ? true : (s.parametro_radar_id ?? "none") === filterParam))
      .filter((s) => (q ? normalizeName(s.nome).includes(q) : true))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [skills, search, filterParam]);

  const startEdit = (s: Skill) => {
    setEditingId(s.id);
    setEditForm({
      nome: s.nome,
      descrizione: s.descrizione ?? "",
      ordine: s.ordine,
      parametro_radar_id: s.parametro_radar_id ?? "",
    });
    setError(null);
    setInfo(null);
  };

  const handleUpdate = (id: string) => {
    if (!editForm.nome.trim()) { setError("Il nome è obbligatorio."); return; }
    setError(null);
    startTransition(async () => {
      const res = await updateSkillGlobal(id, {
        nome: editForm.nome.trim(),
        descrizione: editForm.descrizione.trim() || undefined,
        ordine: editForm.ordine,
        parametro_radar_id: editForm.parametro_radar_id || null,
      });
      if (res.error) { setError(res.error); return; }
      setSkills((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                nome: editForm.nome.trim(),
                descrizione: editForm.descrizione.trim() || null,
                ordine: editForm.ordine,
                parametro_radar_id: editForm.parametro_radar_id || null,
              }
            : s
        )
      );
      setEditingId(null);
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Eliminare questa skill? Le risposte di valutazione collegate verranno mantenute, ma la skill non sarà più disponibile per nuove sessioni.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteSkillGlobal(id);
      if (res.error) { setError(res.error); return; }
      setSkills((prev) => prev.filter((s) => s.id !== id));
    });
  };

  const handleCreate = () => {
    if (!addForm.nome.trim()) { setError("Il nome è obbligatorio."); return; }
    setError(null);
    startTransition(async () => {
      const res = await createSkillGlobal({
        nome: addForm.nome.trim(),
        descrizione: addForm.descrizione.trim() || undefined,
        ordine: addForm.ordine,
        parametro_radar_id: addForm.parametro_radar_id || null,
      });
      if (res.error) { setError(res.error); return; }
      // Per pulizia, ricarico la pagina
      window.location.reload();
    });
  };

  const handleMergeGroup = (items: Skill[]) => {
    if (items.length < 2) return;
    // Tengo quello con id "minore" (deterministico). Idealmente l'utente sceglierebbe, ma diamo un default.
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
    const keep = sorted[0];
    const remove = sorted.slice(1).map((s) => s.id);
    if (!confirm(`Unire ${items.length} skills "${keep.nome}"? Verrà mantenuta una sola voce e i collegamenti delle sessioni verranno spostati su di essa.`)) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await mergeSkillDuplicates(keep.id, remove);
      if (res.error) { setError(res.error); return; }
      setSkills((prev) => prev.filter((s) => !remove.includes(s.id)));
      setInfo(`Unite ${res.merged} skills duplicate in "${keep.nome}".`);
    });
  };

  const handleMergeAll = () => {
    if (duplicateGroups.length === 0) return;
    if (!confirm(`Unire automaticamente tutti i ${duplicateGroups.length} gruppi di duplicati? Per ogni nome verrà mantenuta una sola skill.`)) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      let totalMerged = 0;
      const removedIds: string[] = [];
      for (const group of duplicateGroups) {
        const sorted = [...group.items].sort((a, b) => a.id.localeCompare(b.id));
        const keep = sorted[0];
        const remove = sorted.slice(1).map((s) => s.id);
        const res = await mergeSkillDuplicates(keep.id, remove);
        if (res.error) { setError(`Errore durante il merge: ${res.error}`); return; }
        totalMerged += res.merged ?? 0;
        removedIds.push(...remove);
      }
      setSkills((prev) => prev.filter((s) => !removedIds.includes(s.id)));
      setInfo(`Unite ${totalMerged} skills duplicate.`);
    });
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      {info && (
        <div className="flex items-start gap-2 bg-success/10 border border-success/30 text-success rounded-lg px-4 py-3 text-sm">
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          {info}
        </div>
      )}

      {/* Sezione duplicati */}
      {duplicateGroups.length > 0 && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="font-tenorite text-base text-text flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-warning" />
                {duplicateGroups.length} gruppi di skills duplicate
              </h2>
              <p className="text-sm text-text-muted mt-0.5">
                Sono presenti skills con lo stesso nome. Puoi unirle: una sola verrà mantenuta e i riferimenti spostati.
              </p>
            </div>
            <button
              onClick={handleMergeAll}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-tenorite bg-warning hover:bg-warning/90 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Merge className="w-4 h-4" />
              Unisci tutti
            </button>
          </div>
          <div className="space-y-2">
            {duplicateGroups.map((group) => (
              <div key={group.key} className="bg-bg rounded-lg border border-border px-4 py-2.5 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <span className="font-tenorite text-sm text-text">{group.items[0].nome}</span>
                  <span className="text-xs text-text-muted ml-2">({group.items.length} copie)</span>
                </div>
                <button
                  onClick={() => handleMergeGroup(group.items)}
                  disabled={isPending}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-warning hover:bg-warning/10 rounded-md transition-colors disabled:opacity-50"
                >
                  <Merge className="w-3.5 h-3.5" />
                  Unisci
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtri + ricerca */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cerca skill per nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-9`}
          />
        </div>
        <select
          value={filterParam}
          onChange={(e) => setFilterParam(e.target.value)}
          className={`${inputClass} w-auto`}
        >
          <option value="all">Tutti i parametri</option>
          {parametri.map((p) => (
            <option key={p.id} value={p.id}>{p.nome}</option>
          ))}
          <option value="none">Senza parametro</option>
        </select>
        <button
          type="button"
          onClick={() => { setShowAdd(true); setAddForm({ nome: "", descrizione: "", ordine: skills.length, parametro_radar_id: "" }); }}
          className="inline-flex items-center gap-1.5 text-sm font-tenorite bg-primary hover:bg-primary-dark text-white px-3 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuova skill
        </button>
      </div>

      {/* Form aggiunta */}
      {showAdd && (
        <div className="bg-bg-page border border-border rounded-xl p-5">
          <p className="font-tenorite text-sm text-text mb-3">Nuova skill</p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs text-text-muted mb-1">Nome *</label>
              <input
                type="text"
                value={addForm.nome}
                onChange={(e) => setAddForm((f) => ({ ...f, nome: e.target.value }))}
                className={inputClass}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Parametro radar</label>
              <select
                value={addForm.parametro_radar_id}
                onChange={(e) => setAddForm((f) => ({ ...f, parametro_radar_id: e.target.value }))}
                className={inputClass}
              >
                <option value="">— Nessuno —</option>
                {parametri.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
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
            <div className="sm:col-span-4">
              <label className="block text-xs text-text-muted mb-1">Descrizione</label>
              <input
                type="text"
                value={addForm.descrizione}
                onChange={(e) => setAddForm((f) => ({ ...f, descrizione: e.target.value }))}
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={handleCreate}
              disabled={isPending}
              className="px-4 py-2 text-sm font-tenorite bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {isPending ? "Salvataggio…" : "Salva"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-sm text-text-muted hover:text-text border border-border rounded-lg transition-colors"
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* Tabella skills */}
      <div className="bg-bg rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-bg-page">
          <h2 className="font-tenorite text-sm text-text">
            {filteredSkills.length} skill{filteredSkills.length === 1 ? "" : "s"}
            {(search || filterParam !== "all") && ` (filtro attivo, totale ${skills.length})`}
          </h2>
        </div>

        <div className="divide-y divide-border">
          {filteredSkills.length === 0 && (
            <div className="py-8 text-center text-sm text-text-muted">
              Nessuna skill trovata.
            </div>
          )}

          {filteredSkills.map((s) => {
            const param = s.parametro_radar_id ? parametriById.get(s.parametro_radar_id) : null;
            return (
              <div key={s.id} className="px-5 py-3">
                {editingId === s.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-text-muted mb-1">Nome *</label>
                        <input
                          type="text"
                          value={editForm.nome}
                          onChange={(e) => setEditForm((f) => ({ ...f, nome: e.target.value }))}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Parametro</label>
                        <select
                          value={editForm.parametro_radar_id}
                          onChange={(e) => setEditForm((f) => ({ ...f, parametro_radar_id: e.target.value }))}
                          className={inputClass}
                        >
                          <option value="">— Nessuno —</option>
                          {parametri.map((p) => (
                            <option key={p.id} value={p.id}>{p.nome}</option>
                          ))}
                        </select>
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
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Descrizione</label>
                      <input
                        type="text"
                        value={editForm.descrizione}
                        onChange={(e) => setEditForm((f) => ({ ...f, descrizione: e.target.value }))}
                        className={inputClass}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdate(s.id)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-success hover:bg-success/90 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" /> Salva
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-text-muted hover:text-text border border-border rounded-lg transition-colors"
                      >
                        <X className="w-3.5 h-3.5" /> Annulla
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-tenorite text-sm text-text">{s.nome}</span>
                        {param && (
                          <span
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px]"
                            style={{ backgroundColor: `${param.colore}20`, color: param.colore }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: param.colore }} />
                            {param.nome}
                          </span>
                        )}
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
            );
          })}
        </div>
      </div>
    </div>
  );
}
