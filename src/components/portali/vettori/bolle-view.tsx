"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Ruler,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MutazioneBollaMisura,
  riepilogoMisureBolla,
} from "@/lib/portali/vettori/misure";
import type {
  BollaDocumento,
  BollaMisura,
  BolleResponse,
} from "@/lib/portali/vettori/tipi";

type Filtro = "tutte" | "da_misurare";

interface GruppoDraft {
  chiave: string;
  id: string | null;
  quantita: string;
  lunghezzaCm: string;
  larghezzaCm: string;
  altezzaCm: string;
  pesoRealeKg: string;
}

const numero = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 });
const dataOra = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function isRecord(valore: unknown): valore is Record<string, unknown> {
  return typeof valore === "object" && valore !== null;
}

function isBolleResponse(valore: unknown): valore is BolleResponse {
  return (
    isRecord(valore) &&
    Array.isArray(valore.documenti) &&
    typeof valore.pagina === "number" &&
    typeof valore.totale === "number" &&
    typeof valore.altrePagine === "boolean"
  );
}

function messaggioErrore(valore: unknown, fallback: string): string {
  return isRecord(valore) && typeof valore.error === "string"
    ? valore.error
    : fallback;
}

function mostraData(valore: string | null): string {
  if (!valore) return "Data non disponibile";
  const data = new Date(valore);
  return Number.isNaN(data.getTime()) ? valore : dataOra.format(data);
}

function daMisura(misura: BollaMisura): GruppoDraft {
  return {
    chiave: misura.id,
    id: misura.id,
    quantita: String(misura.quantita),
    lunghezzaCm: String(misura.lunghezzaCm),
    larghezzaCm: String(misura.larghezzaCm),
    altezzaCm: String(misura.altezzaCm),
    pesoRealeKg: misura.pesoRealeKg === null ? "" : String(misura.pesoRealeKg),
  };
}

function nuovoGruppo(quantita = 1): GruppoDraft {
  return {
    chiave: `nuovo-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    id: null,
    quantita: String(quantita),
    lunghezzaCm: "",
    larghezzaCm: "",
    altezzaCm: "",
    pesoRealeKg: "",
  };
}

function valoriDraft(gruppo: GruppoDraft) {
  return {
    quantita: Number(gruppo.quantita),
    lunghezzaCm: Number(gruppo.lunghezzaCm),
    larghezzaCm: Number(gruppo.larghezzaCm),
    altezzaCm: Number(gruppo.altezzaCm),
    pesoRealeKg: gruppo.pesoRealeKg.trim() ? Number(gruppo.pesoRealeKg) : null,
  };
}

export function BolleView() {
  const [documenti, setDocumenti] = useState<BollaDocumento[]>([]);
  const [pagina, setPagina] = useState(1);
  const [totale, setTotale] = useState(0);
  const [altrePagine, setAltrePagine] = useState(false);
  const [caricamento, setCaricamento] = useState(true);
  const [caricamentoAltri, setCaricamentoAltri] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("tutte");

  const carica = useCallback(async (paginaRichiesta: number, aggiungi: boolean) => {
    aggiungi ? setCaricamentoAltri(true) : setCaricamento(true);
    setErrore(null);
    try {
      const response = await fetch(
        `/api/portali/vettori/bolle?pagina=${paginaRichiesta}&perPagina=80`,
        { cache: "no-store" }
      );
      const payload: unknown = await response.json();
      if (!response.ok || !isBolleResponse(payload)) {
        throw new Error(messaggioErrore(payload, "Risposta non valida dal server."));
      }
      setDocumenti((correnti) =>
        aggiungi ? [...correnti, ...payload.documenti] : payload.documenti
      );
      setPagina(payload.pagina);
      setTotale(payload.totale);
      setAltrePagine(payload.altrePagine);
    } catch (causa) {
      setErrore(
        causa instanceof Error
          ? causa.message
          : "Non è stato possibile caricare le bolle."
      );
    } finally {
      setCaricamento(false);
      setCaricamentoAltri(false);
    }
  }, []);

  useEffect(() => {
    void carica(1, false);
  }, [carica]);

  const incomplete = documenti.filter(
    (documento) => documento.statoMisure === "da_misurare"
  ).length;
  const visibili = filtro === "da_misurare"
    ? documenti.filter((documento) => documento.statoMisure === "da_misurare")
    : documenti;

  return (
    <div className="mx-auto max-w-[1500px] pb-12 text-text selection:bg-primary/20 selection:text-text">
      <header className="mb-7 flex flex-col gap-5 border-b border-border pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <h1 className="font-tenorite text-3xl font-bold tracking-[-0.02em] text-text sm:text-4xl">
            Bolle da misurare
          </h1>
          <p className="mt-2 max-w-[68ch] text-sm leading-6 text-text-muted sm:text-base">
            Completa i colli mentre la spedizione è ancora sul banco. Il peso volumetrico
            si aggiorna durante la digitazione e usa il coefficiente del vettore.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm" aria-live="polite">
          <span className="inline-flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 font-tenorite font-semibold text-amber-800">
            <TriangleAlert className="h-4 w-4" aria-hidden="true" />
            {incomplete} da completare tra le {documenti.length} caricate
          </span>
          <span className="hidden text-text-muted sm:inline">{totale} totali</span>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-bg p-1" aria-label="Filtra bolle">
          <button
            type="button"
            onClick={() => setFiltro("tutte")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              filtro === "tutte" ? "bg-primary text-white" : "text-text-muted hover:bg-bg-page hover:text-text"
            }`}
          >
            Tutte
          </button>
          <button
            type="button"
            onClick={() => setFiltro("da_misurare")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              filtro === "da_misurare" ? "bg-primary text-white" : "text-text-muted hover:bg-bg-page hover:text-text"
            }`}
          >
            Solo da completare
          </button>
        </div>
        <p className="text-xs text-text-muted">Aggiornate all’apertura della pagina · nessun polling</p>
      </div>

      {errore ? (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-danger/10 p-4 text-sm text-red-800">
          <span>{errore}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void carica(1, false)}>
            Riprova
          </Button>
        </div>
      ) : null}

      {caricamento ? (
        <div className="flex min-h-64 items-center justify-center gap-3 rounded-xl border border-border bg-bg text-sm text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          Caricamento delle bolle…
        </div>
      ) : visibili.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-bg px-6 text-center">
          <Check className="mb-3 h-8 w-8 text-success" aria-hidden="true" />
          <h2 className="font-tenorite text-xl font-bold text-text">
            {documenti.length === 0 ? "Nessuna bolla disponibile" : "Coda completata"}
          </h2>
          <p className="mt-1 max-w-md text-sm text-text-muted">
            {documenti.length === 0
              ? "Le bolle compariranno qui quando la pipeline del gestionale avrà caricato i documenti."
              : "Nelle bolle caricate non mancano misure. Puoi tornare all’elenco completo."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibili.map((documento) => (
            <BollaCard
              key={documento.idDocumento}
              documento={documento}
              onAggiornata={() => carica(1, false)}
            />
          ))}
        </div>
      )}

      {altrePagine ? (
        <div className="mt-6 flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={caricamentoAltri}
            onClick={() => void carica(pagina + 1, true)}
          >
            {caricamentoAltri ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {filtro === "da_misurare" ? "Cerca nelle bolle successive" : "Carica altre bolle"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function BollaCard({
  documento,
  onAggiornata,
}: {
  documento: BollaDocumento;
  onAggiornata: () => Promise<void>;
}) {
  const [aperta, setAperta] = useState(false);
  const [gruppi, setGruppi] = useState<GruppoDraft[]>(() =>
    documento.misure.length > 0
      ? documento.misure.map(daMisura)
      : documento.statoMisure === "da_misurare"
        ? [nuovoGruppo(Math.max(1, Math.round(documento.numColli ?? 1)))]
        : []
  );

  useEffect(() => {
    setGruppi(
      documento.misure.length > 0
        ? documento.misure.map(daMisura)
        : documento.statoMisure === "da_misurare"
          ? [nuovoGruppo(Math.max(1, Math.round(documento.numColli ?? 1)))]
          : []
    );
  }, [documento.misure, documento.numColli, documento.statoMisure]);

  const misureValide = useMemo(
    () =>
      gruppi.flatMap((gruppo) => {
        const valori = valoriDraft(gruppo);
        const parsed = MutazioneBollaMisura.safeParse({
          operazione: "crea",
          idDocumento: documento.idDocumento,
          ...valori,
        });
        return parsed.success ? [valori] : [];
      }),
    [documento.idDocumento, gruppi]
  );
  const riepilogo = riepilogoMisureBolla(
    misureValide.map((misura) => ({
      quantita: misura.quantita,
      lunghezzaCm: misura.lunghezzaCm,
      larghezzaCm: misura.larghezzaCm,
      altezzaCm: misura.altezzaCm,
    })),
    documento.divisoreVolumetrico,
    documento.volumeGestionaleM3
  );
  const colliMisurati = misureValide.reduce((somma, misura) => somma + misura.quantita, 0);
  const numeroBolla = documento.numeroDocumento ?? `#${documento.idDocumento}`;
  const senzaMisure = documento.statoMisure === "da_misurare";

  const aggiornaGruppo = (chiave: string, prossimo: GruppoDraft) => {
    setGruppi((correnti) =>
      correnti.map((gruppo) => (gruppo.chiave === chiave ? prossimo : gruppo))
    );
  };

  return (
    <article
      aria-label={`Bolla ${numeroBolla}`}
      className={`overflow-hidden rounded-xl bg-bg ${
        senzaMisure
          ? "border border-warning/60 shadow-[0_6px_20px_rgba(245,158,11,0.10)]"
          : "border border-border"
      }`}
    >
      <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(15rem,1.4fr)_minmax(10rem,1fr)_9rem_11rem_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-tenorite text-lg font-bold text-text">Bolla {numeroBolla}</h2>
            <StatoBadge stato={documento.statoMisure} />
          </div>
          <p className="mt-1 truncate text-sm font-medium text-text">
            {documento.soggetto ?? "Soggetto non indicato"}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">Creata {mostraData(documento.dataCreazione)}</p>
        </div>

        <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-sm lg:block">
          <div className="min-w-0">
            <dt className="text-xs text-text-muted">Vettore</dt>
            <dd className="truncate font-medium text-text">{documento.vettore ?? documento.vettoreCodice ?? "Non indicato"}</dd>
          </div>
          <div className="min-w-0 lg:mt-1">
            <dt className="text-xs text-text-muted">Destinazione</dt>
            <dd className="truncate text-text">{documento.destinazione ?? "Non indicata"}</dd>
          </div>
        </dl>

        <div>
          <p className="text-xs text-text-muted">Colli</p>
          <p className="font-tenorite text-xl font-bold tabular-nums text-text">
            {documento.numColli === null ? "—" : numero.format(documento.numColli)}
          </p>
        </div>

        <div>
          <p className="text-xs text-text-muted">Peso volumetrico</p>
          <p className="font-tenorite text-xl font-bold tabular-nums text-primary-dark">
            {riepilogo.pesoVolumetricoKg === null
              ? "Coeff. assente"
              : riepilogo.volumeM3 > 0
                ? `${numero.format(riepilogo.pesoVolumetricoKg)} kg`
                : "Da calcolare"}
          </p>
          <p className="text-xs text-text-muted">
            {documento.divisoreVolumetrico
              ? `${documento.divisoreVolumetrico} kg/m³`
              : "Vettore da riconoscere"}
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          variant={senzaMisure && documento.statoMisure !== "volume_gestionale" ? "default" : "outline"}
          aria-expanded={aperta}
          onClick={() => setAperta((valore) => !valore)}
          className="justify-self-start lg:justify-self-end"
        >
          <Ruler className="h-4 w-4" aria-hidden="true" />
          {documento.statoMisure === "volume_gestionale"
            ? "Misura comunque"
            : senzaMisure
              ? "Inserisci misure"
              : "Modifica misure"}
          {aperta ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {documento.statoMisure === "volume_gestionale" ? (
        <div className="border-t border-border bg-success/5 px-4 py-3 text-sm text-text-muted sm:px-5">
          Il gestionale dichiara {numero.format(documento.volumeGestionaleM3 ?? 0)} m³ e viene
          usato al posto delle dimensioni. È un dato dichiarato, non una verifica: se non
          corrisponde al collo che hai davanti, misuralo comunque.
        </div>
      ) : null}

      {aperta ? (
        <div className="border-t border-border bg-bg-page px-4 py-5 sm:px-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-tenorite text-base font-bold text-text">Gruppi di colli omogenei</h3>
              <p className="mt-1 text-xs text-text-muted">Un gruppo per ogni combinazione di lunghezza, larghezza e altezza.</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-text-muted">Volume rilevato</p>
              <p className="font-tenorite text-lg font-bold tabular-nums text-text">{numero.format(riepilogo.volumeM3)} m³</p>
            </div>
          </div>

          <div className="space-y-3">
            {gruppi.map((gruppo, indice) => (
              <GruppoMisuraForm
                key={gruppo.chiave}
                indice={indice}
                idDocumento={documento.idDocumento}
                gruppo={gruppo}
                onChange={(prossimo) => aggiornaGruppo(gruppo.chiave, prossimo)}
                onRimuoviLocale={() =>
                  setGruppi((correnti) => correnti.filter((riga) => riga.chiave !== gruppo.chiave))
                }
                onAggiornata={onAggiornata}
              />
            ))}
          </div>

          {documento.numColli !== null && colliMisurati > 0 && colliMisurati !== documento.numColli ? (
            <p className="mt-3 text-xs font-medium text-amber-800" role="status">
              I gruppi validi coprono {colliMisurati} colli, mentre la bolla ne dichiara {numero.format(documento.numColli)}.
            </p>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() =>
              setGruppi((correnti) => [
                ...correnti,
                nuovoGruppo(correnti.length === 0 ? Math.round(documento.numColli ?? 1) : 1),
              ])
            }
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Aggiungi gruppo
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function StatoBadge({ stato }: { stato: BollaDocumento["statoMisure"] }) {
  if (stato === "da_misurare") {
    return <span className="rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-amber-800">Da misurare</span>;
  }
  if (stato === "volume_gestionale") {
    return <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-green-800">Volume gestionale</span>;
  }
  return <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary-dark">Misurata</span>;
}

function GruppoMisuraForm({
  indice,
  idDocumento,
  gruppo,
  onChange,
  onRimuoviLocale,
  onAggiornata,
}: {
  indice: number;
  idDocumento: number;
  gruppo: GruppoDraft;
  onChange: (gruppo: GruppoDraft) => void;
  onRimuoviLocale: () => void;
  onAggiornata: () => Promise<void>;
}) {
  const [salvataggio, setSalvataggio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [confermaElimina, setConfermaElimina] = useState(false);
  const prefisso = `gruppo-${idDocumento}-${indice}`;

  const cambia = (campo: keyof Omit<GruppoDraft, "chiave" | "id">, valore: string) => {
    onChange({ ...gruppo, [campo]: valore });
    setErrore(null);
  };

  const invia = async (elimina = false) => {
    const valori = valoriDraft(gruppo);
    const comando = elimina
      ? { operazione: "elimina" as const, id: gruppo.id, idDocumento }
      : gruppo.id
        ? { operazione: "aggiorna" as const, id: gruppo.id, idDocumento, ...valori }
        : { operazione: "crea" as const, idDocumento, ...valori };
    const parsed = MutazioneBollaMisura.safeParse(comando);
    if (!parsed.success) {
      setErrore("Completa quantità e dimensioni con valori maggiori di zero.");
      return;
    }

    setSalvataggio(true);
    setErrore(null);
    try {
      const response = await fetch("/api/portali/vettori/bolle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(messaggioErrore(payload, "Salvataggio non riuscito."));
      await onAggiornata();
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Salvataggio non riuscito.");
    } finally {
      setSalvataggio(false);
      setConfermaElimina(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-bg p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[5.5rem_repeat(4,minmax(7rem,1fr))_auto] xl:items-end">
        <CampoMisura id={`${prefisso}-quantita`} label="Quantità" value={gruppo.quantita} step="1" onChange={(v) => cambia("quantita", v)} />
        <CampoMisura id={`${prefisso}-lunghezza`} label="Lunghezza (cm)" value={gruppo.lunghezzaCm} onChange={(v) => cambia("lunghezzaCm", v)} />
        <CampoMisura id={`${prefisso}-larghezza`} label="Larghezza (cm)" value={gruppo.larghezzaCm} onChange={(v) => cambia("larghezzaCm", v)} />
        <CampoMisura id={`${prefisso}-altezza`} label="Altezza (cm)" value={gruppo.altezzaCm} onChange={(v) => cambia("altezzaCm", v)} />
        <CampoMisura id={`${prefisso}-peso`} label="Peso reale (kg)" value={gruppo.pesoRealeKg} min="0.1" max="100000" optional onChange={(v) => cambia("pesoRealeKg", v)} />
        <div className="flex gap-2 sm:col-span-2 xl:col-span-1">
          <Button type="button" size="sm" disabled={salvataggio} onClick={() => void invia()}>
            {salvataggio ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            Salva
          </Button>
          {gruppo.id ? (
            confermaElimina ? (
              <Button type="button" size="sm" variant="danger" disabled={salvataggio} onClick={() => void invia(true)}>
                Conferma
              </Button>
            ) : (
              <Button type="button" size="icon" variant="ghost" aria-label={`Elimina gruppo ${indice + 1}`} onClick={() => setConfermaElimina(true)}>
                <Trash2 className="h-4 w-4 text-danger" aria-hidden="true" />
              </Button>
            )
          ) : (
            <Button type="button" size="icon" variant="ghost" aria-label={`Rimuovi gruppo ${indice + 1}`} onClick={onRimuoviLocale}>
              <Trash2 className="h-4 w-4 text-text-muted" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      {errore ? <p className="mt-2 text-xs font-medium text-danger" role="alert">{errore}</p> : null}
    </div>
  );
}

function CampoMisura({
  id,
  label,
  value,
  onChange,
  optional = false,
  step = "0.1",
  min = "1",
  max = "2000",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  step?: string;
  min?: string;
  max?: string;
}) {
  return (
    <label htmlFor={id} className="block text-xs font-medium text-text-muted">
      {label}{optional ? " · opz." : ""}
      <Input
        id={id}
        className="mt-1 font-tenorite tabular-nums"
        type="number"
        min={min}
        max={step === "1" ? "999" : max}
        step={step}
        inputMode="decimal"
        value={value}
        onChange={(evento) => onChange(evento.target.value)}
      />
    </label>
  );
}
