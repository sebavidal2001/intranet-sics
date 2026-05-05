"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Calendar, AlertCircle, Check, Briefcase, Layers, Clock, History, Loader2, CheckCircle2, GripVertical } from "lucide-react";
import { createSessioneUtente, updateSessioneUtente } from "@/app/(intranet)/(portale-valutazioni)/admin/calendario/actions";
import { saveUtenteMansioni, saveSessioneSkills, cloneSchedaAnnoPrecedente, saveOrdineProfili } from "./actions";

// ── Shared types (re-exported so the parent can import from one place) ──

export interface Utente {
  id: string;
  nome: string;
  cognome: string;
  ruolo: string;
  reparto: string | null;
}

export interface Scala {
  id: string;
  nome: string;
  min: number;
  max: number;
}

export interface AllSkill {
  id: string;
  nome: string;
  descrizione: string | null;
  ordine: number;
  parametro_radar_id: string | null;
  // Supabase join can return single object or array depending on cardinality
  parametro_radar: { id: string; nome: string; colore: string } | { id: string; nome: string; colore: string }[] | null;
}

export interface SessioneUtente {
  id: string;
  utente_id: string;
  scala_id: string;
  anno: number;
  data_programmata: string | null;
  orario: string | null;
  tipo_valutazione: string | null;
  stato: string;
  note_admin: string | null;
  ordine_profili?: string[] | null;
}

export interface UtenteMansione {
  id: string;
  utente_id: string;
  mansione_id: string;
  // Supabase join can return single object or array depending on cardinality
  mansione: { id: string; testo: string } | { id: string; testo: string }[] | null;
}

export interface MansioneLight {
  id: string;
  testo: string;
  ordine: number;
}

export interface RuoloProfessionale {
  id: string;
  nome: string;
  mansioni: MansioneLight[];
}

export interface SessioneSkill {
  sessione_id: string;
  skill_id: string;
}

// ── Constants ──

export const TIPO_VALUTAZIONE_OPTIONS = [
  { value: "mensile", label: "Mensile" },
  { value: "trimestrale", label: "Trimestrale" },
  { value: "quadrimestrale", label: "Quadrimestrale" },
  { value: "semestrale", label: "Semestrale" },
  { value: "annuale", label: "Annuale" },
  { value: "straordinaria", label: "Straordinaria" },
];

const inputClass =
  "w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors duration-150";

// ── Small UI helpers ──

function SectionHeader({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-primary" />
      <span className="font-tenorite text-sm text-text">{title}</span>
      {count !== undefined && (
        <span className="text-xs text-text-muted">({count} selezionate)</span>
      )}
    </div>
  );
}

function SaveFeedback({ saved, error }: { saved: boolean; error: string | null }) {
  if (error) {
    return (
      <div className="flex items-start gap-2 text-danger text-xs">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        {error}
      </div>
    );
  }
  if (saved) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-success">
        <Check className="w-3.5 h-3.5" />
        Salvato
      </span>
    );
  }
  return null;
}

// ── DipendentRow ──

export function DipendentRow({
  utente,
  sessione,
  scale,
  mansioni: initialMansioni,
  ruoliProfessionali,
  allSkills,
  initialSkillIds,
  anno,
  sessioneId,
}: {
  utente: Utente;
  sessione: SessioneUtente | undefined;
  scale: Scala[];
  mansioni: UtenteMansione[];
  ruoliProfessionali: RuoloProfessionale[];
  allSkills: AllSkill[];
  initialSkillIds: string[];
  anno: number;
  sessioneId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  // Mansioni state
  const initialMansioneIds = new Set(initialMansioni.filter((m) => m.utente_id === utente.id).map((m) => m.mansione_id));
  const [selectedMansioni, setSelectedMansioni] = useState<Set<string>>(initialMansioneIds);
  const [mansioniPending, startMansioniTransition] = useTransition();
  const [mansioniError, setMansioniError] = useState<string | null>(null);
  const [mansioniSaved, setMansioniSaved] = useState(false);

  // Skills state
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set(initialSkillIds));
  const [skillsPending, startSkillsTransition] = useTransition();
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skillsSaved, setSkillsSaved] = useState(false);

  // Appointment state
  const [appPending, startAppTransition] = useTransition();
  const [appError, setAppError] = useState<string | null>(null);
  const [appSaved, setAppSaved] = useState(false);

  // Scheda anno precedente state
  const [schedaPending, startSchedaTransition] = useTransition();
  const [schedaStato, setSchedaStato] = useState<"idle" | "done" | "error">("idle");
  const [schedaErrore, setSchedaErrore] = useState<string | null>(null);
  const [data, setData] = useState(sessione?.data_programmata ?? "");
  const [orario, setOrario] = useState(sessione?.orario ?? "");
  const [scalaId, setScalaId] = useState(sessione?.scala_id ?? (scale[0]?.id ?? ""));
  const [tipo, setTipo] = useState(sessione?.tipo_valutazione ?? "annuale");
  const [note, setNote] = useState(sessione?.note_admin ?? "");

  // Current session (may be created after save)
  const [currentSessione, setCurrentSessione] = useState(sessione);

  // ---- Profili accordion + drag ordering ----
  const [openProfili, setOpenProfili] = useState<Set<string>>(new Set());
  const [profiliOrdine, setProfiliOrdine] = useState<string[]>(
    Array.isArray(sessione?.ordine_profili) ? (sessione.ordine_profili as string[]) : []
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [, startOrdineTransition] = useTransition();

  const toggleProfilo = (id: string) => {
    setOpenProfili((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, ruoloId: string) => {
    setDraggedId(ruoloId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, ruoloId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (ruoloId !== draggedId) setDragOverId(ruoloId);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) { setDraggedId(null); setDragOverId(null); return; }
    const ruoliConMansioni_ = ruoliProfessionali.filter((r) => r.mansioni && r.mansioni.length > 0);
    const base = profiliOrdine.length > 0 ? profiliOrdine : ruoliConMansioni_.map((r) => r.id);
    const fromIdx = base.indexOf(draggedId);
    const toIdx = base.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) { setDraggedId(null); setDragOverId(null); return; }
    const next = [...base];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, draggedId);
    setProfiliOrdine(next);
    setDraggedId(null);
    setDragOverId(null);
    if (currentSessione) {
      startOrdineTransition(async () => {
        await saveOrdineProfili(currentSessione.id, next);
      });
    }
  };

  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null); };

  // ---- Mansioni helpers ----
  const toggleMansione = (id: string) => {
    setSelectedMansioni((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleRuolo = (mansioni: MansioneLight[]) => {
    const ids = mansioni.map((m) => m.id);
    const allSelected = ids.every((id) => selectedMansioni.has(id));
    setSelectedMansioni((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleSchedaAnnoPrecedente = () => {
    if (!currentSessione) return;
    setSchedaErrore(null);
    setSchedaStato("idle");
    startSchedaTransition(async () => {
      const res = await cloneSchedaAnnoPrecedente(currentSessione.id, sessioneId);
      if (res.error) { setSchedaErrore(res.error); setSchedaStato("error"); return; }
      setSchedaStato("done");
    });
  };

  const handleSaveMansioni = () => {
    setMansioniError(null);
    setMansioniSaved(false);
    startMansioniTransition(async () => {
      const res = await saveUtenteMansioni(utente.id, Array.from(selectedMansioni), sessioneId);
      if (res.error) { setMansioniError(res.error); return; }
      setMansioniSaved(true);
      setTimeout(() => setMansioniSaved(false), 2000);
    });
  };

  // ---- Skills helpers ----
  const toggleSkill = (id: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSaveSkills = () => {
    if (!currentSessione) { setSkillsError("Prima programma la sessione."); return; }
    setSkillsError(null);
    setSkillsSaved(false);
    startSkillsTransition(async () => {
      const res = await saveSessioneSkills(currentSessione.id, Array.from(selectedSkills), sessioneId);
      if (res.error) { setSkillsError(res.error); return; }
      setSkillsSaved(true);
      setTimeout(() => setSkillsSaved(false), 2000);
    });
  };

  // ---- Appointment helpers ----
  const handleSaveAppointment = () => {
    if (!data) { setAppError("La data è obbligatoria."); return; }
    if (!scalaId) { setAppError("Seleziona una scala."); return; }
    setAppError(null);
    setAppSaved(false);

    startAppTransition(async () => {
      if (currentSessione) {
        const res = await updateSessioneUtente(currentSessione.id, {
          data_programmata: data,
          stato: currentSessione.stato,
          note_admin: note || undefined,
        });
        if (res.error) { setAppError(res.error); return; }
      } else {
        const res = await createSessioneUtente({
          utente_id: utente.id,
          data_programmata: data,
          scala_id: scalaId,
          anno,
          note_admin: note || undefined,
          orario: orario || undefined,
          tipo_valutazione: tipo,
        });
        if (res.error) { setAppError(res.error); return; }
        // After creating, mark as having a session (for skills to become available)
        if (res.data) {
          setCurrentSessione(res.data as SessioneUtente);
        }
      }
      setAppSaved(true);
      setTimeout(() => setAppSaved(false), 2000);
    });
  };

  const utenteMansioni = initialMansioni.filter((m) => m.utente_id === utente.id);
  // Ruoli that actually have mansioni defined
  const ruoliConMansioni = ruoliProfessionali.filter((r) => r.mansioni && r.mansioni.length > 0);

  // Apply custom ordering
  const sortedRuoli = (() => {
    if (profiliOrdine.length === 0) return ruoliConMansioni;
    const inOrdine = profiliOrdine
      .map((id) => ruoliConMansioni.find((r) => r.id === id))
      .filter(Boolean) as typeof ruoliConMansioni;
    const rimanenti = ruoliConMansioni.filter((r) => !profiliOrdine.includes(r.id));
    return [...inOrdine, ...rimanenti];
  })();

  return (
    <div className="border-b border-border last:border-0">
      {/* Header row */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center gap-4 px-5 py-3 hover:bg-bg-page transition-colors text-left"
      >
        <div className="shrink-0">
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-muted" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-tenorite text-sm text-text">
              {utente.cognome} {utente.nome}
            </span>
            {utente.reparto && (
              <span className="text-xs text-text-muted">{utente.reparto}</span>
            )}
            <span className="text-xs text-text-muted capitalize">{utente.ruolo.replace(/_/g, " ")}</span>
          </div>
          {utenteMansioni.length > 0 && (
            <p className="text-xs text-text-muted mt-0.5 truncate">
              {utenteMansioni.map((m) => {
                const mans = Array.isArray(m.mansione) ? m.mansione[0] ?? null : m.mansione;
                return mans?.testo;
              }).filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {currentSessione ? (
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs text-primary font-tenorite">
                {currentSessione.data_programmata}
                {currentSessione.orario ? ` ${currentSessione.orario}` : ""}
              </span>
            </div>
          ) : (
            <span className="text-xs text-text-muted">Non programmata</span>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="px-5 pb-6 bg-bg-page/40 space-y-6 pt-4">

          {/* ── Section 1: Mansioni ─────────────────────────── */}
          <div className="bg-bg rounded-xl border border-border p-4">
            <SectionHeader icon={Briefcase} title="Mansioni" count={selectedMansioni.size} />

            {ruoliConMansioni.length === 0 ? (
              <p className="text-xs text-text-muted">
                Nessuna mansione configurata. Aggiungi mansioni nei{" "}
                <a href="/admin/config/profili" className="text-primary hover:underline">
                  profili professionali
                </a>.
              </p>
            ) : (
              <div className="space-y-2">
                {sortedRuoli.map((ruolo, idx) => {
                  const ids = ruolo.mansioni.map((m) => m.id);
                  const allSelected = ids.every((id) => selectedMansioni.has(id));
                  const someSelected = ids.some((id) => selectedMansioni.has(id));
                  const selectedCount = ids.filter((id) => selectedMansioni.has(id)).length;
                  const isProfiloOpen = openProfili.has(ruolo.id);

                  const isDragging = draggedId === ruolo.id;
                  const isDragOver = dragOverId === ruolo.id;

                  return (
                    <div
                      key={ruolo.id}
                      draggable={!!currentSessione}
                      onDragStart={(e) => handleDragStart(e, ruolo.id)}
                      onDragOver={(e) => handleDragOver(e, ruolo.id)}
                      onDrop={(e) => handleDrop(e, ruolo.id)}
                      onDragEnd={handleDragEnd}
                      className={`border rounded-lg overflow-hidden transition-all ${
                        isDragging
                          ? "opacity-40 border-primary"
                          : isDragOver
                          ? "border-primary border-dashed bg-primary/5"
                          : "border-border"
                      }`}
                    >
                      {/* Profilo accordion header */}
                      <div className="flex items-center gap-2 px-3 py-2 bg-bg-page">
                        {/* Drag handle */}
                        {currentSessione && (
                          <GripVertical className="w-3.5 h-3.5 text-text-muted shrink-0 cursor-grab active:cursor-grabbing" />
                        )}
                        <button
                          type="button"
                          onClick={() => toggleProfilo(ruolo.id)}
                          className="flex items-center gap-2 flex-1 text-left min-w-0"
                        >
                          {isProfiloOpen ? (
                            <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
                          )}
                          <span className="font-tenorite text-xs text-text truncate">{ruolo.nome}</span>
                          <span className="text-xs text-text-muted shrink-0">
                            {selectedCount}/{ids.length}
                          </span>
                        </button>
                        {/* Select all */}
                        <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = !allSelected && someSelected;
                            }}
                            onChange={() => toggleRuolo(ruolo.mansioni)}
                            className="w-3.5 h-3.5 accent-primary cursor-pointer"
                          />
                          <span className="text-xs text-text-muted">Tutti</span>
                        </label>
                      </div>
                      {/* Mansioni list — visible only when profilo is open */}
                      {isProfiloOpen && (
                        <div className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-2 gap-1 border-t border-border">
                          {ruolo.mansioni
                            .sort((a, b) => a.ordine - b.ordine)
                            .map((m) => (
                              <label key={m.id} className="flex items-start gap-2 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={selectedMansioni.has(m.id)}
                                  onChange={() => toggleMansione(m.id)}
                                  className="w-3.5 h-3.5 mt-0.5 accent-primary cursor-pointer"
                                />
                                <span className="text-xs text-text group-hover:text-primary transition-colors leading-snug">
                                  {m.testo}
                                </span>
                              </label>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {ruoliConMansioni.length > 0 && (
              <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border flex-wrap">
                <button
                  type="button"
                  onClick={handleSaveMansioni}
                  disabled={mansioniPending}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-tenorite bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {mansioniPending ? "Salvataggio…" : "Salva mansioni"}
                </button>
                <SaveFeedback saved={mansioniSaved} error={mansioniError} />
                {currentSessione && schedaStato !== "done" && (
                  <button
                    type="button"
                    onClick={handleSchedaAnnoPrecedente}
                    disabled={schedaPending}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-tenorite border border-border text-text-muted hover:text-primary hover:border-primary rounded-lg transition-colors disabled:opacity-50 ml-auto"
                  >
                    {schedaPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <History className="w-3 h-3" />}
                    Scheda anno precedente
                  </button>
                )}
                {schedaStato === "done" && (
                  <span className="flex items-center gap-1.5 text-xs text-success ml-auto">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Caricata — puoi modificarla
                  </span>
                )}
                {schedaStato === "error" && schedaErrore && (
                  <span className="flex items-center gap-1.5 text-xs text-danger ml-auto">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {schedaErrore}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── Section 2: Skills ───────────────────────────── */}
          <div className="bg-bg rounded-xl border border-border p-4">
            <SectionHeader icon={Layers} title="Skills" count={selectedSkills.size} />

            {allSkills.length === 0 ? (
              <p className="text-xs text-text-muted">
                Nessuna skill configurata. Aggiungile dai{" "}
                <a href="/admin/config/profili" className="text-primary hover:underline">
                  profili professionali
                </a>.
              </p>
            ) : (
              <>
                {!currentSessione && (
                  <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 mb-3 text-xs text-warning">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    Programma prima la sessione per salvare le skills.
                  </div>
                )}

                {/* Group skills by parametro_radar */}
                {(() => {
                  const grouped: Record<string, { nome: string; colore: string; skills: AllSkill[] }> = {};
                  const ungrouped: AllSkill[] = [];
                  for (const s of allSkills) {
                    const pr = Array.isArray(s.parametro_radar) ? s.parametro_radar[0] ?? null : s.parametro_radar;
                    if (pr) {
                      const pid = pr.id;
                      if (!grouped[pid]) grouped[pid] = { nome: pr.nome, colore: pr.colore, skills: [] };
                      grouped[pid].skills.push(s);
                    } else {
                      ungrouped.push(s);
                    }
                  }

                  const sections = [
                    ...Object.entries(grouped).map(([, v]) => v),
                    ...(ungrouped.length > 0 ? [{ nome: "Senza parametro", colore: "#747373", skills: ungrouped }] : []),
                  ];

                  return (
                    <div className="space-y-3">
                      {sections.map((section) => (
                        <div key={section.nome}>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: section.colore }}
                            />
                            <p className="font-tenorite text-xs text-text">{section.nome}</p>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pl-4">
                            {section.skills.map((s) => (
                              <label key={s.id} className="flex items-start gap-2 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={selectedSkills.has(s.id)}
                                  onChange={() => toggleSkill(s.id)}
                                  disabled={!currentSessione}
                                  className="w-3.5 h-3.5 mt-0.5 accent-primary cursor-pointer disabled:opacity-40"
                                />
                                <span className="text-xs text-text group-hover:text-primary transition-colors leading-snug" title={s.descrizione ?? undefined}>
                                  {s.nome}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={handleSaveSkills}
                    disabled={skillsPending || !currentSessione}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-tenorite bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {skillsPending ? "Salvataggio…" : "Salva skills"}
                  </button>
                  <SaveFeedback saved={skillsSaved} error={skillsError} />
                </div>
              </>
            )}
          </div>

          {/* ── Section 3: Appuntamento ─────────────────────── */}
          <div className="bg-bg rounded-xl border border-border p-4">
            <SectionHeader icon={Clock} title="Appuntamento" />

            {appError && (
              <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 text-danger rounded-lg px-3 py-2.5 text-sm mb-4">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {appError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                  Data <span className="text-danger">*</span>
                </label>
                <input
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                  Orario (opzionale)
                </label>
                <input
                  type="time"
                  value={orario}
                  onChange={(e) => setOrario(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                  Scala <span className="text-danger">*</span>
                </label>
                <select
                  value={scalaId}
                  onChange={(e) => setScalaId(e.target.value)}
                  disabled={!!currentSessione}
                  className={`${inputClass} disabled:opacity-60`}
                >
                  {scale.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome} ({s.min}–{s.max})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                  Tipo valutazione
                </label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                  disabled={!!currentSessione}
                  className={`${inputClass} disabled:opacity-60`}
                >
                  {TIPO_VALUTAZIONE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                  Note admin (opzionale)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Note interne…"
                  className={`${inputClass} resize-none`}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border">
              <button
                type="button"
                onClick={handleSaveAppointment}
                disabled={appPending}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-tenorite bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {appPending ? "Salvataggio…" : currentSessione ? "Aggiorna appuntamento" : "Programma sessione"}
              </button>
              <SaveFeedback saved={appSaved} error={null} />
              {appSaved && (
                <span className="flex items-center gap-1.5 text-xs text-success">
                  <Check className="w-3.5 h-3.5" />
                  Salvato
                </span>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
