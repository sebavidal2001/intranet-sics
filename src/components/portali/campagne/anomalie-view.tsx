"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  CheckCircle2,
  FilePlus2,
  Info,
  Lightbulb,
  Loader2,
  PackageSearch,
  SearchX,
  Shuffle,
  Tag,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { descriviAnomalia, ORDINE_TIPI, TITOLO_TIPO } from "@/lib/portali/campagne/anomalie-testi";
import type { Anomalia, TipoAnomalia } from "@/lib/portali/campagne/tipi";
import { chiamaApi, formattaDataOra } from "./api-client";
import { Copia } from "./copia";
import { Messaggio, Pannello } from "./ui";

interface Esito {
  tipo: "errore" | "ok";
  testo: string;
}

/** Icona e colore di ogni tipo: stessa tinta sul riepilogo, sull'intestazione del gruppo e sulle schede. */
const STILE: Record<TipoAnomalia, { icona: LucideIcon; colore: string; sfondo: string }> = {
  riga_mancante: { icona: FilePlus2, colore: "#b91c1c", sfondo: "#fee2e2" },
  ordine_invertito: { icona: ArrowLeftRight, colore: "#6d28d9", sfondo: "#ede9fe" },
  documentazione_senza_busta: { icona: PackageSearch, colore: "#92400e", sfondo: "#fef3c7" },
  ordine_non_trovato: { icona: SearchX, colore: "#b91c1c", sfondo: "#fee2e2" },
  campagna_incoerente: { icona: Shuffle, colore: "#c2410c", sfondo: "#ffedd5" },
  evasa_senza_ddt: { icona: Truck, colore: "#c2410c", sfondo: "#ffedd5" },
  riga_senza_campagna: { icona: Tag, colore: "#92400e", sfondo: "#fef3c7" },
};

const Pillola = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center rounded-md border border-border bg-bg-page px-2 py-0.5 text-[11px] font-medium text-text-muted">{children}</span>
);

/**
 * Una anomalia con quello che si puo' farne. Usata dalla pagina (sotto l'intestazione del suo
 * gruppo: il titolo e' il cliente) e dalla scheda cliente (`mostraCliente={false}`: il titolo e'
 * il tipo di problema).
 */
export function CartaAnomalia({ anomalia, mostraCliente = true }: { anomalia: Anomalia; mostraCliente?: boolean }) {
  const router = useRouter();
  const d = descriviAnomalia(anomalia);
  const stile = STILE[anomalia.tipo];
  const Icona = stile.icona;
  const [modo, setModo] = useState<"ignora" | null>(null);
  const [nota, setNota] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [esito, setEsito] = useState<Esito | null>(null);

  const scambiabile = anomalia.tipo === "ordine_invertito" && anomalia.stato === "aperta";
  const aperta = anomalia.stato === "aperta";
  const campagna = typeof anomalia.dettaglio.campagna_codice === "string" ? anomalia.dettaglio.campagna_codice : "";
  const ordine = anomalia.ordine_numero ? `${anomalia.ordine_numero}${anomalia.ordine_anno ? `/${anomalia.ordine_anno}` : ""}` : "";

  async function agisci(corpo: Record<string, unknown>, ok: string) {
    setOccupato(true);
    setEsito(null);
    const r = await chiamaApi(`/api/portali/campagne/anomalie/${anomalia.id}`, { metodo: "PATCH", corpo });
    setOccupato(false);
    if (!r.ok) {
      setEsito({ tipo: "errore", testo: r.errore });
      return;
    }
    setModo(null);
    setEsito({ tipo: "ok", testo: ok });
    router.refresh();
  }

  return (
    <li className="relative px-5 py-4 transition-colors hover:bg-bg-page/40">
      <span className="absolute inset-y-3 left-0 w-1 rounded-r" style={{ background: stile.colore }} aria-hidden />
      <div className="flex items-start gap-3.5">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: stile.sfondo, color: stile.colore }}
          aria-hidden
        >
          <Icona className="h-[18px] w-[18px]" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="font-tenorite text-sm font-bold text-text">
              {mostraCliente ? (anomalia.ragione_sociale ?? anomalia.codice_cliente) : d.titolo}
              {mostraCliente ? <span className="ml-2 font-mono text-[11px] font-normal text-text-muted">{anomalia.codice_cliente}</span> : null}
            </h3>
            <span className="text-xs text-text-muted">
              Rilevata {formattaDataOra(anomalia.aperta_il)}
              {anomalia.gravita === "avviso" ? " · avviso" : ""}
            </span>
          </div>

          {ordine || campagna ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ordine ? <Pillola>Ordine {ordine}</Pillola> : null}
              {campagna ? <Pillola>Campagna {campagna}</Pillola> : null}
            </div>
          ) : null}

          <p className="mt-2 text-sm leading-relaxed text-text">{d.cosa}</p>

          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5">
            <p className="flex items-start gap-2 text-sm text-text">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <span>
                <span className="font-semibold">Cosa fare: </span>
                {d.azione}
              </span>
            </p>
            {d.da_copiare.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2 pl-6">
                {d.da_copiare.map((c) => (
                  <Copia key={c.etichetta} etichetta={c.etichetta} valore={c.valore} />
                ))}
              </div>
            ) : null}
          </div>

          <details className="group mt-2.5 text-xs text-text-muted" data-testid="perche-anomalia">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-medium text-text-muted hover:text-primary [&::-webkit-details-marker]:hidden">
              <Info className="h-3.5 w-3.5" aria-hidden />
              <span className="font-semibold">Perché è qui</span>
              <span className="text-[10px] transition-transform group-open:rotate-90" aria-hidden>
                ▸
              </span>
            </summary>
            <p className="mt-1.5 rounded-lg bg-bg-page px-3 py-2 leading-relaxed">{d.perche}</p>
          </details>

          {anomalia.stato === "ignorata" ? <p className="mt-2 text-xs text-text-muted">Lasciata così: {anomalia.nota ?? ""}</p> : null}

          {aperta && modo === null ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {scambiabile ? (
                <Button
                  size="sm"
                  disabled={occupato}
                  onClick={() => {
                    if (window.confirm("Hai scambiato le buste fisiche? Il programma assegnerà gli ordini come indicato."))
                      void agisci({ azione: "applica_scambio" }, "Scambio applicato.");
                  }}
                >
                  {occupato ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Applica scambio
                </Button>
              ) : null}
              <Link
                href={`/campagne/clienti/${encodeURIComponent(anomalia.codice_cliente)}`}
                className="inline-flex h-8 items-center rounded-lg border border-border bg-white px-3 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-bg-page"
              >
                Apri il cliente
              </Link>
              <Button size="sm" variant="ghost" onClick={() => setModo("ignora")}>
                Lascia così
              </Button>
            </div>
          ) : null}

          {modo === "ignora" ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-text">Perché la lasci così?</span>
                  <Input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} />
                </label>
              </div>
              <Button size="sm" disabled={occupato || nota.trim().length < 3} onClick={() => agisci({ azione: "ignora", nota }, "Anomalia lasciata così.")}>
                Conferma
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setModo(null)}>
                Chiudi
              </Button>
            </div>
          ) : null}

          {esito ? (
            <div className="mt-2">
              <Messaggio tipo={esito.tipo}>{esito.testo}</Messaggio>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Le anomalie raggruppate per tipo, dalle piu' urgenti, con un riepilogo in alto. */
export function AnomalieView({ anomalie }: { anomalie: Anomalia[] }) {
  if (anomalie.length === 0) {
    return (
      <Pannello>
        <div className="flex items-center gap-4 py-2">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success" aria-hidden>
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <div>
            <p className="font-tenorite text-sm font-bold text-text">Nessuna anomalia</p>
            <p className="mt-0.5 text-sm text-text-muted">Gli ordini e le buste in lavorazione sono coerenti con i dati di Impresa.</p>
          </div>
        </div>
      </Pannello>
    );
  }

  const gruppi = ORDINE_TIPI.map((tipo) => ({ tipo, lista: anomalie.filter((a) => a.tipo === tipo) })).filter((g) => g.lista.length > 0);

  return (
    <div className="space-y-6">
      <nav aria-label="Riepilogo per tipo" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {gruppi.map(({ tipo, lista }) => {
          const { icona: Icona, colore, sfondo } = STILE[tipo];
          return (
            <a
              key={tipo}
              href={`#anomalie-${tipo}`}
              className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,32,0.04)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,161,190,0.12)]"
            >
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: colore }} aria-hidden />
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: sfondo, color: colore }} aria-hidden>
                <Icona className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-tenorite text-xl font-bold leading-none text-text">{lista.length}</span>
                <span className="mt-1 block truncate text-xs text-text-muted" title={TITOLO_TIPO[tipo]}>
                  {TITOLO_TIPO[tipo]}
                </span>
              </span>
            </a>
          );
        })}
      </nav>

      {gruppi.map(({ tipo, lista }) => {
        const { icona: Icona, colore, sfondo } = STILE[tipo];
        return (
          <section
            key={tipo}
            id={`anomalie-${tipo}`}
            className="scroll-mt-4 overflow-hidden rounded-2xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,32,0.04),0_4px_16px_rgba(15,23,32,0.04)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3" style={{ background: sfondo }}>
              <div className="flex min-w-0 items-center gap-3">
                <Icona className="h-5 w-5 shrink-0" style={{ color: colore }} aria-hidden />
                <h2 className="font-tenorite text-sm font-bold" style={{ color: colore }}>
                  {TITOLO_TIPO[tipo]}
                </h2>
              </div>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold tabular-nums shadow-sm" style={{ color: colore }}>
                {lista.length}
              </span>
            </header>
            <ul className="divide-y divide-border">
              {lista.map((a) => (
                <CartaAnomalia key={a.id} anomalia={a} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
