"use client";

import { useState, useTransition, useMemo } from "react";
import { Search, ChevronDown } from "lucide-react";
import { upsertPermessoUtente } from "@/app/(superadmin)/superadmin/portali/actions";

interface Utente {
  id: string;
  nome: string;
  cognome: string;
  ruolo: string;
  reparto?: string | null;
}

interface PermessoUtente {
  utente_id: string;
  can_access: boolean;
}

interface Props {
  portaleId: string;
  utenti: Utente[];
  permessiEsistenti: PermessoUtente[];
}

const RUOLO_COLORI: Record<string, string> = {
  superadmin: "#c82381",
  amministratore: "#00a1be",
  admin: "#00a1be",
  responsabile: "#f59e0b",
  responsabile_intermedio: "#ee7326",
  collaboratore: "#22c55e",
};

function RuoloBadge({ ruolo }: { ruolo: string }) {
  const color = RUOLO_COLORI[ruolo] ?? "#747373";
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white capitalize"
      style={{ backgroundColor: color }}
    >
      {ruolo.replace(/_/g, " ")}
    </span>
  );
}

export default function PermessiDipendentiAccordion({ portaleId, utenti, permessiEsistenti }: Props) {
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [accesses, setAccesses] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const p of permessiEsistenti) {
      map[p.utente_id] = p.can_access;
    }
    return map;
  });
  const [openReparti, setOpenReparti] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Group by reparto
  const grouped = useMemo(() => {
    const filtered = utenti.filter((u) => {
      const q = search.toLowerCase();
      return (
        !q ||
        u.nome.toLowerCase().includes(q) ||
        u.cognome.toLowerCase().includes(q) ||
        u.ruolo.toLowerCase().includes(q)
      );
    });

    const map = new Map<string, Utente[]>();
    for (const u of filtered) {
      const reparto = u.reparto ?? "Senza reparto";
      if (!map.has(reparto)) map.set(reparto, []);
      map.get(reparto)?.push(u);
    }
    return map;
  }, [utenti, search]);

  const toggleReparto = (reparto: string) => {
    setOpenReparti((prev) => {
      const next = new Set(prev);
      if (next.has(reparto)) next.delete(reparto);
      else next.add(reparto);
      return next;
    });
  };

  const handleToggle = (utenteId: string, value: boolean) => {
    setAccesses((prev) => ({ ...prev, [utenteId]: value }));
    setError(null);
    startTransition(async () => {
      try {
        await upsertPermessoUtente({
          portaleId,
          utenteId,
          override_access: value,
          override_export: null,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore durante il salvataggio");
        setAccesses((prev) => ({ ...prev, [utenteId]: !value }));
      }
    });
  };

  return (
    <div className="space-y-1">
      {/* Search */}
      <div className="px-5 py-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca dipendente per nome, cognome o ruolo…"
            className="w-full border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-3 bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-2.5 text-sm">
          {error}
        </div>
      )}

      {grouped.size === 0 ? (
        <div className="py-10 text-center text-sm text-text-muted">
          Nessun dipendente trovato.
        </div>
      ) : (
        Array.from(grouped.entries()).map(([reparto, dipendenti]) => {
          const isOpen = openReparti.has(reparto);
          const countAttivi = dipendenti.filter((u) => accesses[u.id]).length;

          return (
            <div key={reparto} className="border-b border-border last:border-0">
              {/* Accordion header */}
              <button
                type="button"
                onClick={() => toggleReparto(reparto)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-bg-page transition-colors"
              >
                <div className="flex items-center gap-3">
                  <ChevronDown
                    className={`w-4 h-4 text-text-muted transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
                  />
                  <span className="font-tenorite text-sm text-text">{reparto}</span>
                  <span className="text-xs text-text-muted">
                    {dipendenti.length} dipendenti · {countAttivi} con accesso
                  </span>
                </div>
              </button>

              {/* Accordion body */}
              {isOpen && (
                <div className="divide-y divide-border bg-bg-page/40">
                  {dipendenti.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center gap-4 px-8 py-2.5"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-text font-medium">
                            {u.cognome} {u.nome}
                          </span>
                          <RuoloBadge ruolo={u.ruolo} />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer shrink-0">
                        <span className="text-xs text-text-muted">
                          {accesses[u.id] ? "Accesso" : "Nessun accesso"}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={!!accesses[u.id]}
                          onClick={() => handleToggle(u.id, !accesses[u.id])}
                          disabled={isPending}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                            accesses[u.id] ? "bg-primary" : "bg-border"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                              accesses[u.id] ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      {isPending && (
        <p className="text-xs text-text-muted px-5 py-2">Salvataggio…</p>
      )}
    </div>
  );
}
