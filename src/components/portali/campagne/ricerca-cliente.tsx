"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Cliente } from "@/lib/portali/campagne/tipi";
import { chiamaApi } from "./api-client";

/**
 * "Cerco il cliente": per nome o per codice, risultati mentre si scrive. E' il
 * punto d'ingresso del lavoro del back office, quindi sta in cima alla home.
 */
export function RicercaCliente({ autoFocus = false }: { autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [risultati, setRisultati] = useState<Cliente[] | null>(null);
  const [caricamento, setCaricamento] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  // Una risposta lenta non deve sovrascrivere quella della digitazione successiva.
  const ultima = useRef(0);

  useEffect(() => {
    const termine = q.trim();
    if (termine.length < 2) {
      setRisultati(null);
      setErrore(null);
      setCaricamento(false);
      return;
    }
    const numero = ++ultima.current;
    setCaricamento(true);
    const t = setTimeout(async () => {
      const r = await chiamaApi<{ clienti: Cliente[] }>(`/api/portali/campagne/clienti?q=${encodeURIComponent(termine)}`);
      if (numero !== ultima.current) return;
      setCaricamento(false);
      if (r.ok) {
        setErrore(null);
        setRisultati(r.dati.clienti);
      } else {
        setRisultati(null);
        setErrore(r.errore);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <Input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nome o codice cliente…"
          aria-label="Cerca cliente per nome o codice"
          className="h-12 pl-10 text-base"
        />
        {caricamento ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-muted" />
        ) : null}
      </div>

      {errore ? <p className="mt-3 text-sm text-danger">{errore}</p> : null}

      {risultati ? (
        risultati.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">Nessun cliente trovato.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-white">
            {risultati.map((c) => (
              <li key={c.codice_cliente}>
                <Link
                  href={`/campagne/clienti/${encodeURIComponent(c.codice_cliente)}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-bg-page"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-text">{c.ragione_sociale}</span>
                    <span className="block text-xs text-text-muted">
                      {c.codice_cliente}
                      {c.agente_nome ? ` · ${c.agente_nome}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-text-muted">
                    {c.rivenditore ? "Rivenditore" : (c.cat_commerciale ?? "")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="mt-3 text-xs text-text-muted">Scrivi almeno due caratteri.</p>
      )}
    </div>
  );
}
