"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Search, UserCheck, X } from "lucide-react";

/**
 * Assegnazione di una dashboard ai dipendenti (solo direzione).
 *
 * Tre scelte per persona: se la riceve, che parte dei dati vede (perimetro) e,
 * implicitamente, l'accesso al portale, che il server concede da solo se manca.
 * Il perimetro è obbligatorio per chi non ne ha già uno: senza, il BI non
 * mostra niente e la dashboard arriverebbe vuota senza una spiegazione.
 */

interface UtenteElenco {
  id: string;
  nome: string;
  username: string | null;
  ruolo: string;
  livello: "superadmin" | "admin" | "exporter" | "viewer" | "negato" | null;
  perimetro: { tipo: string; valori: string[] } | null;
  assegnata_il: string | null;
}

interface Agente {
  codice: string;
  nome: string;
}

type TipoScelto = "esistente" | "tutto" | "agente";

interface Scelta {
  assegnato: boolean;
  tipo: TipoScelto;
  agenti: string[];
}

const ETICHETTA_LIVELLO: Record<string, string> = {
  superadmin: "Superadmin",
  admin: "Direzione",
  exporter: "Responsabile",
  viewer: "Solo dashboard",
  negato: "Accesso negato",
};

function descriviPerimetro(p: { tipo: string; valori: string[] } | null): string {
  if (!p) return "nessuno";
  if (p.tipo === "tutto") return "tutta l'azienda";
  if (p.tipo === "agente") return `agente ${p.valori.join(", ")}`;
  if (p.tipo === "business_unit") return `BU ${p.valori.join(", ")}`;
  return "nessun dato";
}

export function AssegnaDashboard({
  dashboardId,
  titolo,
  onChiudi,
}: {
  dashboardId: string;
  titolo: string;
  onChiudi: () => void;
}) {
  const [utenti, setUtenti] = useState<UtenteElenco[]>([]);
  const [agenti, setAgenti] = useState<Agente[]>([]);
  const [scelte, setScelte] = useState<Record<string, Scelta>>({});
  const [ricerca, setRicerca] = useState("");
  const [caricamento, setCaricamento] = useState(true);
  const [salvataggio, setSalvataggio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [esito, setEsito] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/bi/dashboard/${dashboardId}/assegnazioni`)
      .then(async (r) => {
        const corpo = (await r.json()) as { utenti?: UtenteElenco[]; agenti?: Agente[]; error?: string };
        if (!r.ok) throw new Error(corpo.error ?? "Impossibile leggere gli utenti.");
        const elenco = corpo.utenti ?? [];
        setUtenti(elenco);
        setAgenti(corpo.agenti ?? []);
        setScelte(
          Object.fromEntries(
            elenco.map((u) => [
              u.id,
              { assegnato: u.assegnata_il !== null, tipo: u.perimetro ? "esistente" : "tutto", agenti: [] } as Scelta,
            ])
          )
        );
      })
      .catch((causa: unknown) => setErrore(causa instanceof Error ? causa.message : "Errore di lettura."))
      .finally(() => setCaricamento(false));
  }, [dashboardId]);

  const visibili = useMemo(() => {
    const q = ricerca.trim().toLowerCase();
    return utenti.filter((u) => !q || `${u.nome} ${u.username ?? ""}`.toLowerCase().includes(q));
  }, [utenti, ricerca]);

  function aggiorna(id: string, parziale: Partial<Scelta>) {
    setScelte((correnti) => ({ ...correnti, [id]: { ...correnti[id], ...parziale } }));
  }

  async function salva() {
    setSalvataggio(true);
    setErrore(null);
    setEsito(null);
    const voci = utenti
      .filter((u) => scelte[u.id]?.assegnato)
      .map((u) => {
        const s = scelte[u.id];
        if (s.tipo === "esistente") return { id: u.id };
        if (s.tipo === "tutto") return { id: u.id, perimetro: { tipo: "tutto" } };
        return { id: u.id, perimetro: { tipo: "agente", valori: s.agenti } };
      });
    const mancanti = utenti.filter(
      (u) => scelte[u.id]?.assegnato && scelte[u.id].tipo === "agente" && scelte[u.id].agenti.length === 0
    );
    if (mancanti.length > 0) {
      setErrore(`Scegli almeno un agente per: ${mancanti.map((u) => u.nome).join(", ")}.`);
      setSalvataggio(false);
      return;
    }
    try {
      const r = await fetch(`/api/bi/dashboard/${dashboardId}/assegnazioni`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utenti: voci }),
      });
      const corpo = (await r.json()) as {
        assegnati?: number;
        rimossi?: number;
        scartati?: { id: string; motivo: string }[];
        error?: string;
      };
      if (!r.ok) throw new Error(corpo.error ?? "Impossibile salvare.");
      const scartati = corpo.scartati ?? [];
      const nomi = (id: string) => utenti.find((u) => u.id === id)?.nome ?? id;
      setEsito(
        `Assegnata a ${corpo.assegnati ?? 0} persone${corpo.rimossi ? `, tolta a ${corpo.rimossi}` : ""}.` +
          (scartati.length ? ` Non assegnata a: ${scartati.map((s) => `${nomi(s.id)} (${s.motivo})`).join("; ")}` : "")
      );
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile salvare.");
    } finally {
      setSalvataggio(false);
    }
  }

  const totaleAssegnati = Object.values(scelte).filter((s) => s.assegnato).length;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Assegna ${titolo}`}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-bg shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="font-tenorite text-xl font-bold">Assegna “{titolo}”</h2>
            <p className="mt-1 text-xs text-text-muted">
              Chi la riceve la vede ricalcolata sui propri dati. Se non ha ancora accesso a Statistiche BI, lo ottiene
              con il livello “solo dashboard assegnate”.
            </p>
          </div>
          <button type="button" onClick={onChiudi} className="rounded-lg p-2 text-text-muted hover:bg-bg-page" aria-label="Chiudi">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="border-b border-border px-5 py-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" aria-hidden />
            <input
              value={ricerca}
              onChange={(e) => setRicerca(e.target.value)}
              placeholder="Cerca per nome o username"
              className="h-9 w-full rounded-lg border border-border bg-bg-page pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {caricamento ? (
            <div className="flex h-40 items-center justify-center text-sm text-text-muted">
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Carico gli utenti…
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {visibili.map((u) => {
                const s = scelte[u.id];
                if (!s) return null;
                const direzione = u.livello === "superadmin" || u.livello === "admin";
                const negato = u.livello === "negato";
                return (
                  <li key={u.id} className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-center">
                    <label className={`flex items-start gap-3 ${negato ? "opacity-50" : ""}`}>
                      <input
                        type="checkbox"
                        checked={s.assegnato}
                        disabled={negato}
                        onChange={(e) => aggiorna(u.id, { assegnato: e.target.checked })}
                        className="mt-1 h-4 w-4 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{u.nome}</span>
                        <span className="block text-xs text-text-muted">
                          {u.username} · {u.ruolo} ·{" "}
                          {u.livello ? ETICHETTA_LIVELLO[u.livello] : "nessun accesso al portale"}
                          {u.perimetro ? ` · dati: ${descriviPerimetro(u.perimetro)}` : ""}
                        </span>
                      </span>
                    </label>
                    {s.assegnato && !direzione && (
                      <div className="flex flex-col gap-1">
                        <select
                          value={s.tipo}
                          onChange={(e) => aggiorna(u.id, { tipo: e.target.value as TipoScelto })}
                          className="h-9 rounded-lg border border-border bg-bg-page px-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                          aria-label={`Dati visibili a ${u.nome}`}
                        >
                          {u.perimetro && <option value="esistente">Dati: {descriviPerimetro(u.perimetro)} (invariati)</option>}
                          <option value="tutto">Dati: tutta l&apos;azienda</option>
                          <option value="agente">Dati: solo uno o più agenti</option>
                        </select>
                        {s.tipo === "agente" && (
                          <select
                            multiple
                            value={s.agenti}
                            onChange={(e) => aggiorna(u.id, { agenti: Array.from(e.target.selectedOptions, (o) => o.value) })}
                            className="h-24 rounded-lg border border-border bg-bg-page px-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                            aria-label={`Agenti visibili a ${u.nome}`}
                          >
                            {agenti.map((a) => (
                              <option key={a.codice} value={a.codice}>
                                {a.nome} ({a.codice})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                    {s.assegnato && direzione && (
                      <span className="text-xs text-text-muted">Vede già tutta l&apos;azienda.</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          <div className="min-w-0 text-xs" aria-live="polite">
            {errore && <p role="alert" className="text-danger">{errore}</p>}
            {esito && <p className="text-success">{esito}</p>}
            {!errore && !esito && <p className="text-text-muted">{totaleAssegnati} persone selezionate</p>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onChiudi} className="h-10 rounded-lg px-4 text-sm text-text-muted hover:bg-bg-page">
              Chiudi
            </button>
            <button
              type="button"
              onClick={() => void salva()}
              disabled={salvataggio || caricamento}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {salvataggio ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <UserCheck className="h-4 w-4" aria-hidden />}
              Salva assegnazioni
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
