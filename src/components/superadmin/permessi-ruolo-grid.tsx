"use client";

import { useState, useTransition } from "react";
import { upsertPermessoRuolo } from "@/app/(superadmin)/superadmin/portali/actions";

interface PermessoPortale {
  id: string;
  portale_id: string;
  ruolo: string;
  can_access: boolean;
  can_export: boolean;
  can_approve: boolean;
}

interface RuoloConfig {
  slug: string;
  nome: string;
}

interface Props {
  portaleId: string;
  permessiRuolo: PermessoPortale[];
  ruoli: RuoloConfig[];
}

const COLONNE: {
  key: keyof Omit<PermessoPortale, "id" | "portale_id" | "ruolo">;
  label: string;
  desc: string;
}[] = [
  { key: "can_access",  label: "Può vedere il portale", desc: "Il portale appare nella home e l'utente può accedervi" },
  { key: "can_export",  label: "Può esportare dati",    desc: "Può scaricare PDF, CSV e report" },
  { key: "can_approve", label: "Amministratore portale", desc: "Accesso completo: gestione, configurazione, approvazione" },
];

function getPermesso(
  permessi: PermessoPortale[],
  ruolo: string,
  portaleId: string
): PermessoPortale {
  return (
    permessi.find((p) => p.ruolo === ruolo) ?? {
      id: "",
      portale_id: portaleId,
      ruolo,
      can_access: false,
      can_export: false,
      can_approve: false,
    }
  );
}

export function PermessiRuoloGrid({ portaleId, permessiRuolo, ruoli }: Props) {
  const [localPermessi, setLocalPermessi] = useState<PermessoPortale[]>(permessiRuolo);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleToggle = (
    ruolo: string,
    campo: keyof Omit<PermessoPortale, "id" | "portale_id" | "ruolo">
  ) => {
    const current = getPermesso(localPermessi, ruolo, portaleId);
    const updated: PermessoPortale = {
      ...current,
      portale_id: portaleId,
      [campo]: !current[campo],
    };

    setLocalPermessi((prev) => {
      const exists = prev.find((p) => p.ruolo === ruolo);
      if (exists) return prev.map((p) => (p.ruolo === ruolo ? updated : p));
      return [...prev, updated];
    });

    setError(null);
    startTransition(async () => {
      try {
        await upsertPermessoRuolo({
          portaleId,
          ruolo,
          can_access: updated.can_access,
          can_export: updated.can_export,
          can_approve: updated.can_approve,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore durante il salvataggio");
        setLocalPermessi(permessiRuolo);
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
            <th className="text-left font-tenorite text-text-muted px-5 py-3 w-1/3">
              Ruolo
            </th>
            {COLONNE.map((c) => (
              <th key={c.key} className="text-center font-tenorite text-text-muted px-5 py-3">
                <span title={c.desc} className="cursor-help border-b border-dashed border-text-muted/50">
                  {c.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ruoli.map((ruolo) => {
            const perm = getPermesso(localPermessi, ruolo.slug, portaleId);
            return (
              <tr
                key={ruolo.slug}
                className="border-b border-border last:border-0 hover:bg-bg-page transition-colors"
              >
                <td className="px-5 py-3.5">
                  <span className="font-tenorite text-text">{ruolo.nome}</span>
                  <span className="ml-2 font-mono text-xs text-text-muted opacity-60">
                    {ruolo.slug}
                  </span>
                </td>
                {COLONNE.map((col) => (
                  <td key={col.key} className="px-5 py-3.5 text-center">
                    <input
                      type="checkbox"
                      checked={perm[col.key]}
                      onChange={() => handleToggle(ruolo.slug, col.key)}
                      disabled={isPending}
                      className="w-4 h-4 rounded accent-primary cursor-pointer disabled:opacity-50"
                    />
                  </td>
                ))}
              </tr>
            );
          })}
          {ruoli.length === 0 && (
            <tr>
              <td colSpan={4} className="px-5 py-8 text-center text-text-muted text-xs">
                Nessun ruolo configurato. Aggiungi ruoli in Ruoli & Reparti.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {isPending && (
        <p className="text-xs text-text-muted px-5 py-2">Salvataggio…</p>
      )}
    </div>
  );
}
