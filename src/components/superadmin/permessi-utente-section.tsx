"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, ShieldCheck } from "lucide-react";
import {
  upsertPermessoUtente,
  eliminaPermessoUtente,
} from "@/app/(superadmin)/superadmin/portali/actions";

interface PermessoUtente {
  id: string;
  portale_id: string;
  utente_id: string;
  override_access: boolean | null;
  override_export: boolean | null;
  is_portal_admin: boolean;
  utenti: {
    nome: string;
    cognome: string;
    ruolo: string;
  } | null;
}

interface UtenteOption {
  id: string;
  nome: string;
  cognome: string;
  ruolo: string;
}

interface Props {
  portaleId: string;
  permessiUtente: PermessoUtente[];
  utenti: UtenteOption[];
}

const NULL_LABEL = "— default ruolo —";

function triStateToValue(val: boolean | null): string {
  if (val === null) return "null";
  return val ? "true" : "false";
}

function valueToTriState(val: string): boolean | null {
  if (val === "null") return null;
  return val === "true";
}

export function PermessiUtenteSection({
  portaleId,
  permessiUtente,
  utenti,
}: Props) {
  const [localPermessi, setLocalPermessi] =
    useState<PermessoUtente[]>(permessiUtente);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedUtenteId, setSelectedUtenteId] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const utentiDisponibili = utenti.filter(
    (u) => !localPermessi.find((p) => p.utente_id === u.id)
  );

  const handleUpdate = (
    utenteId: string,
    campo: "override_access" | "override_export",
    val: string
  ) => {
    const current = localPermessi.find((p) => p.utente_id === utenteId);
    if (!current) return;

    // Se è admin portale, non permettere di cambiare accesso/export manualmente
    if (current.is_portal_admin) return;

    const updated: PermessoUtente = {
      ...current,
      [campo]: valueToTriState(val),
    };

    setLocalPermessi((prev) =>
      prev.map((p) => (p.utente_id === utenteId ? updated : p))
    );

    setError(null);
    startTransition(async () => {
      try {
        await upsertPermessoUtente({
          portaleId,
          utenteId,
          override_access: updated.override_access,
          override_export: updated.override_export,
          is_portal_admin: false,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore durante il salvataggio");
        setLocalPermessi(permessiUtente);
      }
    });
  };

  const handleToggleAdmin = (utenteId: string) => {
    const current = localPermessi.find((p) => p.utente_id === utenteId);
    if (!current) return;

    const nuovoAdmin = !current.is_portal_admin;
    const updated: PermessoUtente = {
      ...current,
      is_portal_admin: nuovoAdmin,
      override_access: nuovoAdmin ? true : null,
      override_export: nuovoAdmin ? true : null,
    };

    setLocalPermessi((prev) =>
      prev.map((p) => (p.utente_id === utenteId ? updated : p))
    );

    setError(null);
    startTransition(async () => {
      try {
        await upsertPermessoUtente({
          portaleId,
          utenteId,
          override_access: updated.override_access,
          override_export: updated.override_export,
          is_portal_admin: nuovoAdmin,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore durante il salvataggio");
        setLocalPermessi(permessiUtente);
      }
    });
  };

  const handleAggiungi = () => {
    if (!selectedUtenteId) return;
    const utente = utenti.find((u) => u.id === selectedUtenteId);
    if (!utente) return;

    const newEntry: PermessoUtente = {
      id: "",
      portale_id: portaleId,
      utente_id: selectedUtenteId,
      override_access: null,
      override_export: null,
      is_portal_admin: false,
      utenti: { nome: utente.nome, cognome: utente.cognome, ruolo: utente.ruolo },
    };

    setLocalPermessi((prev) => [...prev, newEntry]);
    setShowAddForm(false);
    setSelectedUtenteId("");

    setError(null);
    startTransition(async () => {
      try {
        await upsertPermessoUtente({
          portaleId,
          utenteId: selectedUtenteId,
          override_access: null,
          override_export: null,
          is_portal_admin: false,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore durante il salvataggio");
        setLocalPermessi(permessiUtente);
      }
    });
  };

  const handleElimina = (utenteId: string) => {
    setLocalPermessi((prev) => prev.filter((p) => p.utente_id !== utenteId));
    setError(null);
    startTransition(async () => {
      try {
        await eliminaPermessoUtente(portaleId, utenteId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore durante l'eliminazione");
        setLocalPermessi(permessiUtente);
      }
    });
  };

  return (
    <div>
      {error && (
        <div className="mx-5 mt-4 bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-2.5 text-sm">
          {error}
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left font-tenorite text-text-muted px-5 py-3">Utente</th>
            <th className="text-left font-tenorite text-text-muted px-5 py-3">Ruolo</th>
            <th className="text-center font-tenorite text-text-muted px-5 py-3">Accesso</th>
            <th className="text-center font-tenorite text-text-muted px-5 py-3">Export</th>
            <th className="text-center font-tenorite text-text-muted px-5 py-3">
              <span className="flex items-center justify-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Admin portale
              </span>
            </th>
            <th className="text-right font-tenorite text-text-muted px-5 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {localPermessi.length === 0 && (
            <tr>
              <td colSpan={6} className="px-5 py-8 text-center text-text-muted text-xs">
                Nessun override per singolo utente.
              </td>
            </tr>
          )}
          {localPermessi.map((p) => (
            <tr
              key={p.utente_id}
              className={`border-b border-border last:border-0 hover:bg-bg-page transition-colors ${
                p.is_portal_admin ? "bg-primary-light/30" : ""
              }`}
            >
              <td className="px-5 py-3 font-tenorite text-text">
                {p.utenti
                  ? `${p.utenti.cognome} ${p.utenti.nome}`
                  : p.utente_id}
                {p.is_portal_admin && (
                  <span className="ml-2 text-xs bg-primary text-white px-1.5 py-0.5 rounded-full font-tenorite">
                    Admin
                  </span>
                )}
              </td>
              <td className="px-5 py-3 text-text-muted text-xs capitalize">
                {p.utenti?.ruolo ?? "—"}
              </td>
              <td className="px-5 py-3 text-center">
                {p.is_portal_admin ? (
                  <span className="text-xs text-primary font-tenorite">Sì (admin)</span>
                ) : (
                  <select
                    value={triStateToValue(p.override_access)}
                    onChange={(e) =>
                      handleUpdate(p.utente_id, "override_access", e.target.value)
                    }
                    disabled={isPending}
                    className="text-xs border border-border rounded-lg px-2 py-1.5 bg-bg text-text focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
                  >
                    <option value="null">{NULL_LABEL}</option>
                    <option value="true">Sì</option>
                    <option value="false">No</option>
                  </select>
                )}
              </td>
              <td className="px-5 py-3 text-center">
                {p.is_portal_admin ? (
                  <span className="text-xs text-primary font-tenorite">Sì (admin)</span>
                ) : (
                  <select
                    value={triStateToValue(p.override_export)}
                    onChange={(e) =>
                      handleUpdate(p.utente_id, "override_export", e.target.value)
                    }
                    disabled={isPending}
                    className="text-xs border border-border rounded-lg px-2 py-1.5 bg-bg text-text focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
                  >
                    <option value="null">{NULL_LABEL}</option>
                    <option value="true">Sì</option>
                    <option value="false">No</option>
                  </select>
                )}
              </td>
              <td className="px-5 py-3 text-center">
                <button
                  type="button"
                  onClick={() => handleToggleAdmin(p.utente_id)}
                  disabled={isPending}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-tenorite transition-colors disabled:opacity-50 ${
                    p.is_portal_admin
                      ? "bg-primary text-white hover:bg-primary-dark"
                      : "border border-border text-text-muted hover:border-primary hover:text-primary"
                  }`}
                >
                  <ShieldCheck className="w-3 h-3" />
                  {p.is_portal_admin ? "Rimuovi" : "Assegna"}
                </button>
              </td>
              <td className="px-5 py-3 text-right">
                <button
                  type="button"
                  onClick={() => handleElimina(p.utente_id)}
                  disabled={isPending}
                  className="text-danger hover:text-danger/70 transition-colors disabled:opacity-50"
                  aria-label="Rimuovi override utente"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Aggiungi utente */}
      <div className="px-5 py-4 border-t border-border">
        {!showAddForm ? (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            disabled={utentiDisponibili.length === 0}
            className="inline-flex items-center gap-1.5 text-sm font-tenorite text-primary hover:text-primary-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            Aggiungi override utente
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <select
              value={selectedUtenteId}
              onChange={(e) => setSelectedUtenteId(e.target.value)}
              className="flex-1 border border-border rounded-lg px-3 py-2 text-sm text-text bg-bg focus:outline-none focus:border-primary transition-colors"
            >
              <option value="">— Seleziona utente —</option>
              {utentiDisponibili.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.cognome} {u.nome} ({u.ruolo})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAggiungi}
              disabled={!selectedUtenteId || isPending}
              className="px-4 py-2 rounded-lg text-sm font-tenorite bg-primary hover:bg-primary-dark text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Aggiungi
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setSelectedUtenteId("");
              }}
              className="px-4 py-2 rounded-lg text-sm font-tenorite text-text-muted hover:text-text border border-border hover:bg-bg-page transition-colors"
            >
              Annulla
            </button>
          </div>
        )}
      </div>

      {isPending && (
        <p className="text-xs text-text-muted px-5 pb-3">Salvataggio…</p>
      )}
    </div>
  );
}
