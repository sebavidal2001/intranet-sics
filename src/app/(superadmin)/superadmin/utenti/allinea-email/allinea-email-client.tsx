"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Check, Mail, Play } from "lucide-react";
import { allineaEmailUtenti } from "../actions";

interface Row {
  id: string;
  nome: string;
  cognome: string;
  username: string | null;
  email: string | null;
}

interface Props {
  utenti: Row[];
  totaleUtenti: number;
}

export default function AllineaEmailClient({ utenti, totaleUtenti }: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    updated: number;
    skipped: { id: string; username: string | null; email: string | null; motivo: string }[];
    error?: string;
  } | null>(null);

  const senzaUsername = utenti.filter((u) => !u.username || !u.username.trim()).length;
  const allineabili = utenti.length - senzaUsername;

  const handleRun = () => {
    if (utenti.length === 0) return;
    if (!confirm(`Allineare l'email di ${allineabili} utenti? L'operazione aggiorna sia Supabase Auth sia la tabella utenti. Non è reversibile.`)) return;
    setResult(null);
    startTransition(async () => {
      const res = await allineaEmailUtenti();
      if (!res.success) {
        setResult({ updated: 0, skipped: [], error: res.error });
        return;
      }
      setResult({ updated: res.updated, skipped: res.skipped });
      // Ricarico la pagina così la lista delle "da allineare" si aggiorna
      setTimeout(() => window.location.reload(), 2000);
    });
  };

  if (utenti.length === 0) {
    return (
      <div className="bg-success/10 border border-success/30 rounded-xl p-6 flex items-start gap-3">
        <Check className="w-5 h-5 text-success mt-0.5 shrink-0" />
        <div>
          <p className="font-tenorite text-text">Tutti gli utenti sono già allineati.</p>
          <p className="text-sm text-text-muted mt-1">
            {totaleUtenti} utenti totali, nessuno con email legacy o mancante.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {result?.error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {result.error}
        </div>
      )}

      {result && !result.error && (
        <div className="bg-success/10 border border-success/30 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <Check className="w-5 h-5 text-success mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-tenorite text-text">
                Allineati {result.updated} utenti su {allineabili}.
              </p>
              {result.skipped.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm text-text-muted mb-2">
                    {result.skipped.length} utenti saltati:
                  </p>
                  <ul className="text-xs text-text-muted space-y-1">
                    {result.skipped.map((s) => (
                      <li key={s.id} className="font-mono">
                        {s.username ?? "(no username)"} — {s.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-bg rounded-xl border border-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-tenorite text-base text-text">
              {utenti.length} utent{utenti.length === 1 ? "e" : "i"} da allineare
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Totale in DB: {totaleUtenti}
              {senzaUsername > 0 && (
                <span className="text-warning"> · {senzaUsername} senza username (verranno saltati)</span>
              )}
            </p>
          </div>
          <button
            onClick={handleRun}
            disabled={isPending || allineabili === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-tenorite bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {isPending ? "Allineamento…" : `Allinea ${allineabili} email`}
          </button>
        </div>

        <div className="bg-bg-page rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left font-tenorite text-text-muted px-4 py-2.5">Utente</th>
                <th className="text-left font-tenorite text-text-muted px-4 py-2.5">Username</th>
                <th className="text-left font-tenorite text-text-muted px-4 py-2.5">Email attuale</th>
                <th className="text-left font-tenorite text-text-muted px-4 py-2.5">Nuova email</th>
              </tr>
            </thead>
            <tbody>
              {utenti.map((u) => {
                const newEmail = u.username
                  ? `${u.username.toLowerCase()}@s-ics.com`
                  : null;
                return (
                  <tr key={u.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 text-text">{u.cognome} {u.nome}</td>
                    <td className="px-4 py-2.5 text-text-muted font-mono text-xs">
                      {u.username ?? <span className="text-warning italic">— mancante —</span>}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted font-mono text-xs">
                      {u.email ?? <span className="italic">vuota</span>}
                    </td>
                    <td className="px-4 py-2.5 text-text font-mono text-xs">
                      {newEmail ? (
                        <span className="inline-flex items-center gap-1.5 text-primary">
                          <Mail className="w-3.5 h-3.5" />
                          {newEmail}
                        </span>
                      ) : (
                        <span className="text-text-muted italic">— skip —</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
