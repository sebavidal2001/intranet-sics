"use client";

import { useState, useTransition, useMemo } from "react";
import { Pencil, Trash2, X, Check, AlertCircle, Merge, Search } from "lucide-react";
import Link from "next/link";
import {
  updateMansioneGlobal,
  deleteMansioneGlobal,
  mergeMansioneDuplicates,
} from "./actions";

interface Mansione {
  id: string;
  testo: string;
  ordine: number;
  parametro_radar_id: string | null;
  ruolo_professionale_id: string;
}
interface Ruolo { id: string; nome: string }
interface Parametro { id: string; nome: string; colore: string }

interface Props {
  mansioni: Mansione[];
  ruoli: Ruolo[];
  parametri: Parametro[];
}

const inputClass =
  "w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-150";

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export default function MansioniGlobalManager({ mansioni: initialMansioni, ruoli, parametri }: Props) {
  const [mansioni, setMansioni] = useState<Mansione[]>(initialMansioni);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filterRuolo, setFilterRuolo] = useState<string>("all");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ testo: "", ordine: 0, parametro_radar_id: "" });

  const ruoliById = useMemo(() => new Map(ruoli.map((r) => [r.id, r])), [ruoli]);
  const parametriById = useMemo(() => new Map(parametri.map((p) => [p.id, p])), [parametri]);

  // Duplicati: stesso testo+ruolo_professionale_id
  const duplicateGroups = useMemo(() => {
    const buckets = new Map<string, Mansione[]>();
    for (const m of mansioni) {
      const key = `${m.ruolo_professionale_id}::${normalize(m.testo)}`;
      const arr = buckets.get(key) ?? [];
      arr.push(m);
      buckets.set(key, arr);
    }
    return Array.from(buckets.entries())
      .filter(([, arr]) => arr.length > 1)
      .map(([key, arr]) => ({ key, items: arr }));
  }, [mansioni]);

  const filtered = useMemo(() => {
    const q = normalize(search);
    return mansioni
      .filter((m) => (filterRuolo === "all" ? true : m.ruolo_professionale_id === filterRuolo))
      .filter((m) => (q ? normalize(m.testo).includes(q) : true))
      .sort((a, b) => {
        const ra = ruoliById.get(a.ruolo_professionale_id)?.nome ?? "";
        const rb = ruoliById.get(b.ruolo_professionale_id)?.nome ?? "";
        return ra.localeCompare(rb) || a.testo.localeCompare(b.testo);
      });
  }, [mansioni, search, filterRuolo, ruoliById]);

  const startEdit = (m: Mansione) => {
    setEditingId(m.id);
    setEditForm({ testo: m.testo, ordine: m.ordine, parametro_radar_id: m.parametro_radar_id ?? "" });
    setError(null);
    setInfo(null);
  };

  const handleUpdate = (id: string) => {
    if (!editForm.testo.trim()) { setError("Il testo è obbligatorio."); return; }
    setError(null);
    startTransition(async () => {
      const res = await updateMansioneGlobal(id, {
        testo: editForm.testo.trim(),
        ordine: editForm.ordine,
        parametro_radar_id: editForm.parametro_radar_id || null,
      });
      if (res.error) { setError(res.error); return; }
      setMansioni((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, testo: editForm.testo.trim(), ordine: editForm.ordine, parametro_radar_id: editForm.parametro_radar_id || null }
            : m
        )
      );
      setEditingId(null);
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Eliminare questa mansione? Le assegnazioni agli utenti verranno rimosse.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteMansioneGlobal(id);
      if (res.error) { setError(res.error); return; }
      setMansioni((prev) => prev.filter((m) => m.id !== id));
    });
  };

  const handleMergeGroup = (items: Mansione[]) => {
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
    const keep = sorted[0];
    const remove = sorted.slice(1).map((m) => m.id);
    if (!confirm(`Unire ${items.length} mansioni "${keep.testo}"?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await mergeMansioneDuplicates(keep.id, remove);
      if (res.error) { setError(res.error); return; }
      setMansioni((prev) => prev.filter((m) => !remove.includes(m.id)));
      setInfo(`Unite ${res.merged} mansioni in "${keep.testo}".`);
    });
  };

  const handleMergeAll = () => {
    if (duplicateGroups.length === 0) return;
    if (!confirm(`Unire automaticamente tutti i ${duplicateGroups.length} gruppi di mansioni duplicate?`)) return;
    setError(null);
    startTransition(async () => {
      let total = 0;
      const removed: string[] = [];
      for (const g of duplicateGroups) {
        const sorted = [...g.items].sort((a, b) => a.id.localeCompare(b.id));
        const keep = sorted[0];
        const remove = sorted.slice(1).map((m) => m.id);
        const res = await mergeMansioneDuplicates(keep.id, remove);
        if (res.error) { setError(res.error); return; }
        total += res.merged ?? 0;
        removed.push(...remove);
      }
      setMansioni((prev) => prev.filter((m) => !removed.includes(m.id)));
      setInfo(`Unite ${total} mansioni duplicate.`);
    });
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
        </div>
      )}
      {info && (
        <div className="flex items-start gap-2 bg-success/10 border border-success/30 text-success rounded-lg px-4 py-3 text-sm">
          <Check className="w-4 h-4 mt-0.5 shrink-0" />{info}
        </div>
      )}

      {duplicateGroups.length > 0 && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="font-tenorite text-base text-text flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-warning" />
                {duplicateGroups.length} gruppi di mansioni duplicate
              </h2>
              <p className="text-sm text-text-muted mt-0.5">
                Stesso testo nello stesso profilo professionale.
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
            {duplicateGroups.map((group) => {
              const ruolo = ruoliById.get(group.items[0].ruolo_professionale_id);
              return (
                <div key={group.key} className="bg-bg rounded-lg border border-border px-4 py-2.5 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <span className="font-tenorite text-sm text-text">{group.items[0].testo}</span>
                    <span className="text-xs text-text-muted ml-2">
                      ({group.items.length} copie · {ruolo?.nome ?? "Profilo eliminato"})
                    </span>
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
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cerca mansione…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-9`}
          />
        </div>
        <select
          value={filterRuolo}
          onChange={(e) => setFilterRuolo(e.target.value)}
          className={`${inputClass} w-auto`}
        >
          <option value="all">Tutti i profili</option>
          {ruoli.map((r) => (
            <option key={r.id} value={r.id}>{r.nome}</option>
          ))}
        </select>
      </div>

      <div className="bg-bg rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-bg-page">
          <h2 className="font-tenorite text-sm text-text">
            {filtered.length} mansion{filtered.length === 1 ? "e" : "i"}
            {(search || filterRuolo !== "all") && ` (filtro attivo, totale ${mansioni.length})`}
          </h2>
        </div>
        <div className="divide-y divide-border">
          {filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-text-muted">Nessuna mansione trovata.</div>
          )}
          {filtered.map((m) => {
            const ruolo = ruoliById.get(m.ruolo_professionale_id);
            const param = m.parametro_radar_id ? parametriById.get(m.parametro_radar_id) : null;
            return (
              <div key={m.id} className="px-5 py-3">
                {editingId === m.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div className="sm:col-span-3">
                        <label className="block text-xs text-text-muted mb-1">Testo *</label>
                        <input
                          type="text"
                          value={editForm.testo}
                          onChange={(e) => setEditForm((f) => ({ ...f, testo: e.target.value }))}
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
                      <div className="sm:col-span-4">
                        <label className="block text-xs text-text-muted mb-1">Parametro radar</label>
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
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdate(m.id)}
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
                        <span className="font-tenorite text-sm text-text">{m.testo}</span>
                        {ruolo ? (
                          <Link
                            href={`/admin/config/profili/${m.ruolo_professionale_id}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-primary-light text-primary hover:underline"
                          >
                            {ruolo.nome}
                          </Link>
                        ) : (
                          <span className="text-[11px] text-danger">Profilo eliminato</span>
                        )}
                        {param && (
                          <span
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px]"
                            style={{ backgroundColor: `${param.colore}20`, color: param.colore }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: param.colore }} />
                            {param.nome}
                          </span>
                        )}
                        <span className="text-xs text-text-muted">#{m.ordine}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => startEdit(m)}
                        className="p-1.5 text-text-muted hover:text-primary rounded-lg transition-colors"
                        title="Modifica"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(m.id)}
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
