"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  AlertCircle,
  Calendar,
} from "lucide-react";
import {
  createSessioneUtente,
  updateSessioneUtente,
  deleteSessioneUtente,
} from "./actions";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

type StatoSessione =
  | "programmata"
  | "resp_in_corso"
  | "resp_completata"
  | "collab_in_corso"
  | "completata"
  | "certificata";

interface Utente {
  id: string;
  nome: string;
  cognome: string;
  ruolo: string;
}

interface Scala {
  id: string;
  nome: string;
}

interface SessioneUtente {
  id: string;
  utente_id: string;
  scala_id: string;
  anno: number;
  data_programmata: string | null;
  orario: string | null;
  tipo_valutazione: string | null;
  stato: StatoSessione;
  note_admin: string | null;
  utente: { nome: string; cognome: string } | null;
}

interface Props {
  sessioni: SessioneUtente[];
  utenti: Utente[];
  scale: Scala[];
  anno: number;
  mese: number;
}

// ─── Colori stato ─────────────────────────────────────────────────────────────

const STATO_COLORI: Record<StatoSessione, string> = {
  programmata: "#747373",
  resp_in_corso: "#f59e0b",
  resp_completata: "#00a1be",
  collab_in_corso: "#f59e0b",
  completata: "#22c55e",
  certificata: "#c82381",
};

const STATO_LABEL: Record<StatoSessione, string> = {
  programmata: "Programmata",
  resp_in_corso: "Resp. in corso",
  resp_completata: "Resp. completata",
  collab_in_corso: "Collab. in corso",
  completata: "Completata",
  certificata: "Certificata",
};

const STATI_DISPONIBILI: StatoSessione[] = [
  "programmata",
  "resp_in_corso",
  "resp_completata",
  "collab_in_corso",
  "completata",
  "certificata",
];

const GIORNI_SETTIMANA = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const MESI_NOMI = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function iniziali(nome: string, cognome: string) {
  return `${nome[0] ?? ""}${cognome[0] ?? ""}`.toUpperCase();
}

function formatDateDisplay(iso: string) {
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  return d.toLocaleDateString("it-IT", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// ─── Componente principale ────────────────────────────────────────────────────

export default function CalendarioClient({
  sessioni: initialSessioni,
  utenti,
  scale,
  anno,
  mese,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sessioni, setSessioni] = useState<SessioneUtente[]>(initialSessioni);
  // Sincronizza con i nuovi dati dal server dopo router.refresh()
  useEffect(() => {
    setSessioni(initialSessioni);
  }, [initialSessioni]);

  // ── Modal state ───────────────────────────────────────────────────────────
  const [modalNuova, setModalNuova] = useState(false);
  const [modalDettaglio, setModalDettaglio] = useState<SessioneUtente | null>(
    null
  );
  const [giornoSelezionato, setGiornoSelezionato] = useState<string>("");
  const [error, setError] = useState("");

  // ── Form nuova sessione ───────────────────────────────────────────────────
  const [formUtenteId, setFormUtenteId] = useState(utenti[0]?.id ?? "");
  const [formData, setFormData] = useState("");
  const [formScalaId, setFormScalaId] = useState(scale[0]?.id ?? "");
  const [formNote, setFormNote] = useState("");
  const [formOrario, setFormOrario] = useState("");
  const [formTipoValutazione, setFormTipoValutazione] = useState("annuale");

  // ── Dettaglio modifica ────────────────────────────────────────────────────
  const [editData, setEditData] = useState("");
  const [editStato, setEditStato] = useState<StatoSessione>("programmata");
  const [editOrario, setEditOrario] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Chiudi modal con Escape ───────────────────────────────────────────────
  const closeModals = useCallback(() => {
    setModalNuova(false);
    setModalDettaglio(null);
    setError("");
    setConfirmDelete(false);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModals();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeModals]);

  // ── Navigazione mese ──────────────────────────────────────────────────────
  const navigaMese = (delta: number) => {
    let nuovoMese = mese + delta;
    let nuovoAnno = anno;
    if (nuovoMese < 1) {
      nuovoMese = 12;
      nuovoAnno -= 1;
    } else if (nuovoMese > 12) {
      nuovoMese = 1;
      nuovoAnno += 1;
    }
    router.push(`/admin/calendario?anno=${nuovoAnno}&mese=${nuovoMese}`);
  };

  // ── Costruisci griglia ────────────────────────────────────────────────────
  const primoGiorno = new Date(anno, mese - 1, 1);
  // JS: 0=Dom, 1=Lun … adatta a Lun=0
  const primoGiornoSettimana = (primoGiorno.getDay() + 6) % 7;
  const giorniNelMese = new Date(anno, mese, 0).getDate();

  const celle: (number | null)[] = [
    ...Array(primoGiornoSettimana).fill(null),
    ...Array.from({ length: giorniNelMese }, (_, i) => i + 1),
  ];
  // Allinea a multiplo di 7
  while (celle.length % 7 !== 0) celle.push(null);

  // ── Sessioni del mese ─────────────────────────────────────────────────────
  // Normalizza data_programmata al solo formato YYYY-MM-DD (il DB può restituire timestamp completi)
  const normalizeDate = (d: string) => d.slice(0, 10);

  const sessioniMese = sessioni.filter((s) => {
    if (!s.data_programmata) return false;
    const dateStr = normalizeDate(s.data_programmata);
    const d = new Date(dateStr + "T00:00:00");
    return d.getFullYear() === anno && d.getMonth() + 1 === mese;
  });

  const sessioniPerGiorno = (giorno: number): SessioneUtente[] => {
    const iso = isoDate(anno, mese, giorno);
    return sessioniMese
      .filter((s) => normalizeDate(s.data_programmata ?? "") === iso)
      .sort((a, b) => (a.orario ?? "").localeCompare(b.orario ?? ""));
  };

  // ── Apri modal nuova sessione ─────────────────────────────────────────────
  const apriModalNuova = (giorno: number) => {
    const iso = isoDate(anno, mese, giorno);
    setGiornoSelezionato(iso);
    setFormData(iso);
    setFormUtenteId(utenti[0]?.id ?? "");
    setFormScalaId(scale[0]?.id ?? "");
    setFormNote("");
    setFormOrario("");
    setFormTipoValutazione("annuale");
    setError("");
    setModalNuova(true);
  };

  // ── Apri modal dettaglio ──────────────────────────────────────────────────
  const apriModalDettaglio = (s: SessioneUtente) => {
    setModalDettaglio(s);
    setEditData(s.data_programmata ?? "");
    setEditStato(s.stato);
    setEditOrario(s.orario ?? "");
    setConfirmDelete(false);
    setError("");
  };

  // ── Crea sessione ─────────────────────────────────────────────────────────
  const handleCreaSessione = () => {
    if (!formUtenteId) {
      setError("Seleziona un utente.");
      return;
    }
    if (!formData) {
      setError("Seleziona una data.");
      return;
    }
    if (!formScalaId) {
      setError("Seleziona una scala di valutazione.");
      return;
    }
    setError("");

    startTransition(async () => {
      const result = await createSessioneUtente({
        utente_id: formUtenteId,
        data_programmata: formData,
        scala_id: formScalaId,
        anno,
        note_admin: formNote || undefined,
        orario: formOrario || undefined,
        tipo_valutazione: formTipoValutazione,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      closeModals();
      router.refresh();
    });
  };

  // ── Aggiorna sessione ─────────────────────────────────────────────────────
  const handleAggiornaSessione = () => {
    if (!modalDettaglio) return;
    startTransition(async () => {
      const result = await updateSessioneUtente(modalDettaglio.id, {
        data_programmata: editData || undefined,
        stato: editStato,
        orario: editOrario || null,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      closeModals();
      router.refresh();
    });
  };

  // ── Elimina sessione ──────────────────────────────────────────────────────
  const handleEliminaSessione = () => {
    if (!modalDettaglio) return;
    startTransition(async () => {
      const result = await deleteSessioneUtente(modalDettaglio.id);

      if (result.error) {
        setError(result.error);
        return;
      }

      closeModals();
      router.refresh();
    });
  };

  // Tutti gli utenti possono ricevere una sessione di valutazione
  const utentiFiltrati = utenti;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Navigazione mese */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigaMese(-1)}
          className="p-2 rounded-lg border border-border text-text-muted hover:text-primary hover:border-primary transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h2 className="font-tenorite text-xl text-text">
          {MESI_NOMI[mese - 1]} {anno}
        </h2>
        <button
          onClick={() => navigaMese(1)}
          className="p-2 rounded-lg border border-border text-text-muted hover:text-primary hover:border-primary transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Griglia calendario ── */}
        <div className="flex-1 bg-bg rounded-xl border border-border overflow-hidden">
          {/* Header giorni settimana */}
          <div className="grid grid-cols-7 border-b border-border">
            {GIORNI_SETTIMANA.map((g) => (
              <div
                key={g}
                className="py-2 text-center text-xs font-tenorite text-text-muted"
              >
                {g}
              </div>
            ))}
          </div>

          {/* Celle */}
          <div className="grid grid-cols-7">
            {celle.map((giorno, idx) => {
              const oggiIso = new Date().toISOString().split("T")[0];
              const cellIso = giorno ? isoDate(anno, mese, giorno) : null;
              const isOggi = cellIso === oggiIso;
              const sessGiorno = giorno ? sessioniPerGiorno(giorno) : [];

              return (
                <div
                  key={idx}
                  className={`min-h-[90px] p-1.5 border-b border-r border-border relative ${
                    giorno
                      ? "cursor-pointer hover:bg-primary-light/30 transition-colors"
                      : "bg-bg-page"
                  } ${idx % 7 === 6 ? "border-r-0" : ""}`}
                  onClick={() => giorno && apriModalNuova(giorno)}
                >
                  {giorno && (
                    <>
                      <span
                        className={`text-xs font-tenorite inline-flex items-center justify-center w-6 h-6 rounded-full ${
                          isOggi
                            ? "bg-primary text-white"
                            : "text-text-muted"
                        }`}
                      >
                        {giorno}
                      </span>
                      <div className="mt-1 space-y-0.5">
                        {sessGiorno.map((s) => (
                          <button
                            key={s.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              apriModalDettaglio(s);
                            }}
                            className="w-full text-left"
                          >
                            <span
                              className="block rounded-md px-2 py-0.5 text-xs font-medium text-white truncate"
                              style={{
                                backgroundColor: STATO_COLORI[s.stato],
                              }}
                            >
                              {s.orario && (
                                <span className="opacity-80 mr-1">{s.orario}</span>
                              )}
                              {s.utente
                                ? `${s.utente.nome} ${s.utente.cognome}`
                                : "—"}
                            </span>
                          </button>
                        ))}
                        {sessGiorno.length === 0 && (
                          <div className="opacity-0 group-hover:opacity-100">
                            <Plus className="w-3 h-3 text-text-muted" />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Lista laterale sessioni del mese ── */}
        <div className="w-72 bg-bg rounded-xl border border-border overflow-hidden shrink-0">
          <div className="px-4 py-3 border-b border-border bg-bg-page">
            <h3 className="font-tenorite text-sm text-text">
              Sessioni del mese ({sessioniMese.length})
            </h3>
          </div>

          {sessioniMese.length === 0 ? (
            <div className="py-10 text-center">
              <Calendar className="w-8 h-8 text-text-muted mx-auto mb-2 opacity-40" />
              <p className="text-sm text-text-muted">Nessuna sessione</p>
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
              {[...sessioniMese]
                .sort((a, b) =>
                  (a.data_programmata ?? "").localeCompare(
                    b.data_programmata ?? ""
                  )
                )
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() => apriModalDettaglio(s)}
                    className="w-full px-4 py-3 hover:bg-bg-page transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary-light text-primary text-xs font-tenorite flex items-center justify-center shrink-0">
                        {s.utente
                          ? iniziali(s.utente.nome, s.utente.cognome)
                          : "??"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text font-medium truncate">
                          {s.utente
                            ? `${s.utente.nome} ${s.utente.cognome}`
                            : "Utente sconosciuto"}
                        </p>
                        <p className="text-xs text-text-muted">
                          {s.data_programmata
                            ? formatDateDisplay(s.data_programmata)
                            : "—"}
                          {s.orario && (
                            <span className="ml-1">· {s.orario}</span>
                          )}
                        </p>
                        {s.tipo_valutazione && (
                          <p className="text-xs text-text-muted capitalize mt-0.5">
                            {s.tipo_valutazione}
                          </p>
                        )}
                      </div>
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: STATO_COLORI[s.stato] }}
                      >
                        {STATO_LABEL[s.stato]}
                      </span>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: Nuova sessione ── */}
      {modalNuova && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeModals}
        >
          <div
            className="bg-bg rounded-xl border border-border max-w-md w-full mx-4 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-tenorite text-lg text-text">
                Nuova sessione
              </h3>
              <button
                onClick={closeModals}
                className="p-1.5 text-text-muted hover:text-text rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 text-danger rounded-lg px-3 py-2.5 text-sm mb-4">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                  Utente <span className="text-danger">*</span>
                </label>
                <select
                  value={formUtenteId}
                  onChange={(e) => setFormUtenteId(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors"
                >
                  {utentiFiltrati.length === 0 ? (
                    <option value="">Nessun utente disponibile</option>
                  ) : (
                    utentiFiltrati.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome} {u.cognome}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                  Data <span className="text-danger">*</span>
                </label>
                <input
                  type="date"
                  value={formData}
                  onChange={(e) => setFormData(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              <div>
                <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                  Scala di valutazione <span className="text-danger">*</span>
                </label>
                <select
                  value={formScalaId}
                  onChange={(e) => setFormScalaId(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors"
                >
                  {scale.length === 0 ? (
                    <option value="">Nessuna scala disponibile</option>
                  ) : (
                    scale.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                    Orario (opzionale)
                  </label>
                  <input
                    type="time"
                    value={formOrario}
                    onChange={(e) => setFormOrario(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors"
                  />
                </div>

                <div>
                  <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                    Tipo valutazione
                  </label>
                  <select
                    value={formTipoValutazione}
                    onChange={(e) => setFormTipoValutazione(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors"
                  >
                    <option value="mensile">Mensile</option>
                    <option value="trimestrale">Trimestrale</option>
                    <option value="quadrimestrale">Quadrimestrale</option>
                    <option value="semestrale">Semestrale</option>
                    <option value="annuale">Annuale</option>
                    <option value="straordinaria">Straordinaria</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                  Note admin (opzionale)
                </label>
                <textarea
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  rows={3}
                  placeholder="Note interne sulla sessione…"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={closeModals}
                className="px-4 py-2 text-sm border border-border text-text-muted hover:text-text rounded-lg transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={handleCreaSessione}
                disabled={isPending}
                className="px-4 py-2 text-sm bg-primary hover:bg-primary-dark text-white font-tenorite rounded-lg transition-colors disabled:opacity-50"
              >
                {isPending ? "Creazione…" : "Crea sessione"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Dettaglio/Modifica sessione ── */}
      {modalDettaglio && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeModals}
        >
          <div
            className="bg-bg rounded-xl border border-border max-w-md w-full mx-4 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-tenorite text-lg text-text">
                Dettaglio sessione
              </h3>
              <button
                onClick={closeModals}
                className="p-1.5 text-text-muted hover:text-text rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Info utente */}
            <div className="flex items-center gap-3 mb-5 p-3 bg-bg-page rounded-lg border border-border">
              <div className="w-10 h-10 rounded-full bg-primary-light text-primary text-sm font-tenorite flex items-center justify-center shrink-0">
                {modalDettaglio.utente
                  ? iniziali(
                      modalDettaglio.utente.nome,
                      modalDettaglio.utente.cognome
                    )
                  : "??"}
              </div>
              <div>
                <p className="font-tenorite text-text">
                  {modalDettaglio.utente
                    ? `${modalDettaglio.utente.nome} ${modalDettaglio.utente.cognome}`
                    : "Utente sconosciuto"}
                </p>
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white mt-1"
                  style={{ backgroundColor: STATO_COLORI[modalDettaglio.stato] }}
                >
                  {STATO_LABEL[modalDettaglio.stato]}
                </span>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 text-danger rounded-lg px-3 py-2.5 text-sm mb-4">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                  Data programmata
                </label>
                <input
                  type="date"
                  value={editData}
                  onChange={(e) => setEditData(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              <div>
                <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                  Orario
                </label>
                <input
                  type="time"
                  value={editOrario}
                  onChange={(e) => setEditOrario(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              <div>
                <label className="block font-tenorite text-xs text-text-muted mb-1.5">
                  Stato
                </label>
                <select
                  value={editStato}
                  onChange={(e) =>
                    setEditStato(e.target.value as StatoSessione)
                  }
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors"
                >
                  {STATI_DISPONIBILI.map((stato) => (
                    <option key={stato} value={stato}>
                      {STATO_LABEL[stato]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Azioni */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
              {/* Elimina - solo se programmata */}
              {modalDettaglio.stato === "programmata" && !confirmDelete && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-3 py-2 text-xs text-danger hover:bg-danger/10 rounded-lg transition-colors font-tenorite"
                >
                  Elimina
                </button>
              )}
              {confirmDelete && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-danger">Sei sicuro?</span>
                  <button
                    onClick={handleEliminaSessione}
                    disabled={isPending}
                    className="px-3 py-1.5 bg-danger hover:bg-danger/80 text-white text-xs font-tenorite rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isPending ? "…" : "Elimina"}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-3 py-1.5 border border-border text-text-muted hover:text-text text-xs rounded-lg transition-colors"
                  >
                    No
                  </button>
                </div>
              )}
              {!confirmDelete &&
                modalDettaglio.stato !== "programmata" && (
                  <span />
                )}

              <div className="flex gap-3">
                <button
                  onClick={closeModals}
                  className="px-4 py-2 text-sm border border-border text-text-muted hover:text-text rounded-lg transition-colors"
                >
                  Annulla
                </button>
                <button
                  onClick={handleAggiornaSessione}
                  disabled={isPending}
                  className="px-4 py-2 text-sm bg-primary hover:bg-primary-dark text-white font-tenorite rounded-lg transition-colors disabled:opacity-50"
                >
                  {isPending ? "Salvataggio…" : "Salva"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
