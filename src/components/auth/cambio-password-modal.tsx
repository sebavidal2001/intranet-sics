"use client";

import { useState } from "react";
import { Eye, EyeOff, X, KeyRound } from "lucide-react";

interface Props {
  /**
   * Username o email già noto (es. dopo il login, o digitato nel form).
   * Se assente, la modale mostra un campo per inserirlo.
   */
  identificativoIniziale?: string;
  /**
   * true = primo accesso: la modale non è chiudibile, l'utente DEVE cambiare
   * la password. false = cambio volontario: mostra la X di chiusura.
   */
  forzato: boolean;
  onClose?: () => void;
  onSuccess: () => void;
}

/**
 * Modale di cambio password. Usata in due scenari:
 *  - primo accesso (forzato): comparsa automatica dopo il login
 *  - volontario: dal pulsante "Cambia password" nella pagina di login
 *
 * Chiama POST /api/auth/cambio-password (verifica vecchia password lato server).
 */
export function CambioPasswordModal({
  identificativoIniziale,
  forzato,
  onClose,
  onSuccess,
}: Props) {
  const [identificativo, setIdentificativo] = useState(identificativoIniziale ?? "");
  const [vecchiaPassword, setVecchiaPassword] = useState("");
  const [nuovaPassword, setNuovaPassword] = useState("");
  const [confermaPassword, setConfermaPassword] = useState("");
  const [showVecchia, setShowVecchia] = useState(false);
  const [showNuova, setShowNuova] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Se l'identificativo è già noto, il campo non viene mostrato
  const identificativoNoto = Boolean(identificativoIniziale);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (nuovaPassword !== confermaPassword) {
      setError("Le nuove password non coincidono.");
      return;
    }
    if (nuovaPassword.length < 8) {
      setError("La nuova password deve essere di almeno 8 caratteri.");
      return;
    }
    if (!identificativo.trim()) {
      setError("Inserisci il tuo username.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/cambio-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identificativo: identificativo.trim(),
          vecchiaPassword,
          nuovaPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? "Errore cambio password");
      }
      setSuccess(true);
      setTimeout(() => onSuccess(), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore sconosciuto");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-bg rounded-2xl shadow-2xl border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-bg-page">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-text font-tenorite">
              {forzato ? "Imposta una nuova password" : "Cambia password"}
            </h2>
          </div>
          {!forzato && onClose && (
            <button onClick={onClose} className="text-text-muted hover:text-text">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5">
          {forzato && (
            <p className="text-sm text-text-muted mb-4">
              È il tuo primo accesso: per motivi di sicurezza devi sostituire la
              password che ti è stata assegnata con una personale.
            </p>
          )}

          {success ? (
            <div className="bg-success/10 border border-success/30 text-success px-4 py-4 rounded-lg text-sm text-center">
              Password aggiornata con successo.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username (solo se non già noto) */}
              {!identificativoNoto && (
                <div>
                  <label className="block font-tenorite text-sm font-medium text-text mb-1.5">
                    Username
                  </label>
                  <input
                    type="text"
                    value={identificativo}
                    onChange={(e) => setIdentificativo(e.target.value)}
                    required
                    autoComplete="username"
                    placeholder="nome.cognome"
                    className="w-full px-4 py-2.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-bg text-text"
                  />
                </div>
              )}

              {/* Password attuale */}
              <div>
                <label className="block font-tenorite text-sm font-medium text-text mb-1.5">
                  Password attuale
                </label>
                <div className="relative">
                  <input
                    type={showVecchia ? "text" : "password"}
                    value={vecchiaPassword}
                    onChange={(e) => setVecchiaPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full px-4 py-2.5 pr-11 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-bg text-text"
                  />
                  <button
                    type="button"
                    onClick={() => setShowVecchia(!showVecchia)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                  >
                    {showVecchia ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Nuova password */}
              <div>
                <label className="block font-tenorite text-sm font-medium text-text mb-1.5">
                  Nuova password
                </label>
                <div className="relative">
                  <input
                    type={showNuova ? "text" : "password"}
                    value={nuovaPassword}
                    onChange={(e) => setNuovaPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="Min. 8 caratteri"
                    className="w-full px-4 py-2.5 pr-11 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-bg text-text"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNuova(!showNuova)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                  >
                    {showNuova ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Conferma nuova password */}
              <div>
                <label className="block font-tenorite text-sm font-medium text-text mb-1.5">
                  Conferma nuova password
                </label>
                <input
                  type="password"
                  value={confermaPassword}
                  onChange={(e) => setConfermaPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-bg text-text"
                />
              </div>

              {error && (
                <div className="bg-danger/10 border border-danger/30 text-danger px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:bg-primary-dark text-white font-tenorite py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Salvataggio…" : "Aggiorna password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
