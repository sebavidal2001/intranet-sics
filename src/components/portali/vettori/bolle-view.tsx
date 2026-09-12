"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileLock2,
  History,
  Loader2,
  LockOpen,
  Pencil,
  Plus,
  Ruler,
  RotateCcw,
  Save,
  Trash2,
  TriangleAlert,
  X,
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
  BollaVettoreOpzione,
  BolleResponse,
  CampiBollaForzati,
  CampoBollaForzabile,
} from "@/lib/portali/vettori/tipi";

type Filtro = "tutte" | "da_misurare" | "congelate";

interface GruppoDraft {
  chiave: string;
  id: string | null;
  quantita: string;
  lunghezzaCm: string;
  larghezzaCm: string;
  altezzaCm: string;
  pesoRealeKg: string;
}

interface TestataDraft {
  direzione: "entrata" | "uscita";
  numeroRiferimento: string;
  dataDocumento: string;
  controparteNome: string;
  vettoreId: string;
  colli: string;
  pesoKg: string;
}

const numero = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 });
const dataBreve = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const dataOra = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const ETICHETTE_CAMPI: Record<CampoBollaForzabile, string> = {
  direzione: "Direzione",
  numero_riferimento: "Numero bolla",
  data_documento: "Data documento",
  controparte_nome: "Controparte",
  vettore_id: "Vettore",
  colli_bolla: "Colli",
  peso_bolla: "Peso",
};

function isRecord(valore: unknown): valore is Record<string, unknown> {
  return typeof valore === "object" && valore !== null;
}

function isBolleResponse(valore: unknown): valore is BolleResponse {
  return (
    isRecord(valore) &&
    Array.isArray(valore.documenti) &&
    Array.isArray(valore.vettori) &&
    typeof valore.puoScongelare === "boolean" &&
    typeof valore.pagina === "number" &&
    typeof valore.totale === "number" &&
    typeof valore.altrePagine === "boolean"
  );
}

function messaggioErrore(valore: unknown, fallback: string): string {
  return isRecord(valore) && typeof valore.error === "string" ? valore.error : fallback;
}

function mostraData(valore: string | null, conOra = false): string {
  if (!valore) return "Data non disponibile";
  const data = new Date(valore);
  return Number.isNaN(data.getTime())
    ? valore
    : (conOra ? dataOra : dataBreve).format(data);
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

function draftDaDocumento(documento: BollaDocumento): TestataDraft {
  return {
    direzione: documento.direzione,
    numeroRiferimento: documento.numeroDocumento ?? "",
    dataDocumento: documento.dataDocumento,
    controparteNome: documento.soggetto ?? "",
    vettoreId: documento.vettoreId ?? "",
    colli: documento.numColli === null ? "" : String(documento.numColli),
    pesoKg: documento.pesoLordoKg === null ? "" : String(documento.pesoLordoKg),
  };
}

function daNumerare(documento: BollaDocumento): boolean {
  const stato = (documento as unknown as { stato?: unknown }).stato;
  return stato === "da_numerare" || (documento.origine === "simulazione" && documento.numeroDocumento === null);
}

function nuovoDraft(vettori: BollaVettoreOpzione[]): TestataDraft {
  return {
    direzione: "entrata",
    numeroRiferimento: "",
    dataDocumento: new Date().toISOString().slice(0, 10),
    controparteNome: "",
    vettoreId: vettori[0]?.id ?? "",
    colli: "1",
    pesoKg: "",
  };
}

async function inviaComando(comando: unknown): Promise<unknown> {
  const response = await fetch("/api/portali/vettori/bolle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(comando),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(messaggioErrore(payload, "Salvataggio non riuscito."));
  return payload;
}

export function BolleView() {
  const [documenti, setDocumenti] = useState<BollaDocumento[]>([]);
  const [vettori, setVettori] = useState<BollaVettoreOpzione[]>([]);
  const [puoScongelare, setPuoScongelare] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [totale, setTotale] = useState(0);
  const [altrePagine, setAltrePagine] = useState(false);
  const [caricamento, setCaricamento] = useState(true);
  const [caricamentoAltri, setCaricamentoAltri] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("tutte");
  const [creazioneAperta, setCreazioneAperta] = useState(false);

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
      setVettori(payload.vettori);
      setPuoScongelare(payload.puoScongelare);
      setPagina(payload.pagina);
      setTotale(payload.totale);
      setAltrePagine(payload.altrePagine);
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Non e stato possibile caricare le bolle.");
    } finally {
      setCaricamento(false);
      setCaricamentoAltri(false);
    }
  }, []);

  useEffect(() => {
    void carica(1, false);
  }, [carica]);

  const incomplete = documenti.filter((documento) => documento.statoMisure === "da_misurare").length;
  const congelate = documenti.filter((documento) => documento.congelata).length;
  const visibili = documenti.filter((documento) => {
    if (filtro === "da_misurare") return documento.statoMisure === "da_misurare";
    if (filtro === "congelate") return documento.congelata;
    return true;
  }).sort((a, b) => Number(daNumerare(b)) - Number(daNumerare(a)));

  return (
    <div className="mx-auto max-w-[1500px] pb-12 text-text selection:bg-primary/20 selection:text-text">
      <header className="mb-6 flex flex-col gap-5 border-b border-border pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <h1 className="font-tenorite text-3xl font-bold tracking-[-0.02em] text-text sm:text-4xl">
            Bolle e misure
          </h1>
          <p className="mt-2 max-w-[68ch] text-sm leading-6 text-text-muted sm:text-base">
            Registra una bolla anche prima del gestionale, misura i colli sul banco e conserva
            ogni correzione fino al controllo della fattura.
          </p>
        </div>
        <Button type="button" onClick={() => setCreazioneAperta((aperta) => !aperta)}>
          {creazioneAperta ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {creazioneAperta ? "Chiudi inserimento" : "Nuova bolla manuale"}
        </Button>
      </header>

      {creazioneAperta ? (
        <NuovaBollaForm
          vettori={vettori}
          onAnnulla={() => setCreazioneAperta(false)}
          onCreata={async () => {
            setCreazioneAperta(false);
            await carica(1, false);
          }}
        />
      ) : null}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-bg p-1" aria-label="Filtra bolle">
          <FiltroButton attivo={filtro === "tutte"} onClick={() => setFiltro("tutte")}>Tutte</FiltroButton>
          <FiltroButton attivo={filtro === "da_misurare"} onClick={() => setFiltro("da_misurare")}>
            Da misurare · {incomplete}
          </FiltroButton>
          <FiltroButton attivo={filtro === "congelate"} onClick={() => setFiltro("congelate")}>
            Congelate · {congelate}
          </FiltroButton>
        </div>
        <p className="text-xs text-text-muted" aria-live="polite">
          {totale} bolle · aggiornate all’apertura della pagina
        </p>
      </div>

      {errore ? (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-danger/10 p-4 text-sm text-red-800">
          <span>{errore}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void carica(1, false)}>Riprova</Button>
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
            {documenti.length === 0 ? "Nessuna bolla disponibile" : "Nessuna bolla in questo filtro"}
          </h2>
          <p className="mt-1 max-w-md text-sm text-text-muted">
            {documenti.length === 0
              ? "Puoi inserire subito la prima bolla manuale, senza aspettare il gestionale."
              : "Scegli un altro filtro per tornare all’elenco operativo."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibili.map((documento) => (
            <BollaCard
              key={documento.idSpedizione}
              documento={documento}
              vettori={vettori}
              puoScongelare={puoScongelare}
              onAggiornata={() => carica(1, false)}
            />
          ))}
        </div>
      )}

      {altrePagine ? (
        <div className="mt-6 flex justify-center">
          <Button type="button" variant="outline" disabled={caricamentoAltri} onClick={() => void carica(pagina + 1, true)}>
            {caricamentoAltri ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Carica altre bolle
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FiltroButton({ attivo, onClick, children }: { attivo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        attivo ? "bg-primary text-white" : "text-text-muted hover:bg-bg-page hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function NuovaBollaForm({ vettori, onAnnulla, onCreata }: { vettori: BollaVettoreOpzione[]; onAnnulla: () => void; onCreata: () => Promise<void> }) {
  const [draft, setDraft] = useState<TestataDraft>(() => nuovoDraft(vettori));
  const [misura, setMisura] = useState<GruppoDraft>(() => nuovoGruppo(1));
  const [salvataggio, setSalvataggio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    if (!draft.vettoreId && vettori[0]) setDraft((corrente) => ({ ...corrente, vettoreId: vettori[0].id }));
  }, [draft.vettoreId, vettori]);

  const salva = async () => {
    const valoriMisura = valoriDraft(misura);
    const comando = {
      operazione: "crea_bolla",
      ...draft,
      colli: Number(draft.colli),
      pesoKg: Number(draft.pesoKg),
      misure: [valoriMisura],
    };
    if (
      !draft.numeroRiferimento.trim() || !draft.controparteNome.trim() || !draft.vettoreId ||
      !Number.isFinite(comando.colli) || comando.colli <= 0 ||
      !Number.isFinite(comando.pesoKg) || comando.pesoKg <= 0 ||
      !MutazioneBollaMisura.safeParse({ operazione: "crea", spedizioneId: "00000000-0000-4000-8000-000000000000", ...valoriMisura }).success
    ) {
      setErrore("Completa tutti i campi e inserisci dimensioni maggiori di zero.");
      return;
    }
    setSalvataggio(true);
    setErrore(null);
    try {
      await inviaComando(comando);
      await onCreata();
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Creazione non riuscita.");
    } finally {
      setSalvataggio(false);
    }
  };

  return (
    <section aria-labelledby="nuova-bolla-titolo" className="mb-7 rounded-xl border border-primary/40 bg-bg p-5 shadow-[0_8px_24px_rgba(0,161,190,0.10)] sm:p-6">
      <div className="mb-5">
        <h2 id="nuova-bolla-titolo" className="font-tenorite text-xl font-bold text-text">Inserisci la bolla che hai davanti</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">La spedizione resta valida anche se il documento gestionale non arriverà mai. Se arriverà, i dati verranno fusi senza perdere queste dimensioni.</p>
      </div>
      <TestataFields draft={draft} vettori={vettori} onChange={setDraft} prefisso="nuova" />
      <div className="mt-5 border-t border-border pt-5">
        <h3 className="font-tenorite text-base font-bold text-text">Dimensioni dei colli</h3>
        <p className="mb-3 mt-1 text-xs text-text-muted">Inserisci il primo gruppo omogeneo; altri gruppi potranno essere aggiunti dalla scheda.</p>
        <GruppoFields prefisso="nuova-misura" gruppo={misura} onChange={setMisura} />
      </div>
      {errore ? <p role="alert" className="mt-4 text-sm font-medium text-danger">{errore}</p> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onAnnulla}>Annulla</Button>
        <Button type="button" disabled={salvataggio} onClick={() => void salva()}>
          {salvataggio ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
          Crea bolla e salva misure
        </Button>
      </div>
    </section>
  );
}

function TestataFields({ draft, vettori, onChange, prefisso, forzati, onRipristina }: { draft: TestataDraft; vettori: BollaVettoreOpzione[]; onChange: (draft: TestataDraft) => void; prefisso: string; forzati?: CampiBollaForzati; onRipristina?: (campo: CampoBollaForzabile) => void }) {
  const cambia = <K extends keyof TestataDraft>(campo: K, valore: TestataDraft[K]) => onChange({ ...draft, [campo]: valore });
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <CampoTestata label="Direzione" campo="direzione" forzati={forzati} onRipristina={onRipristina}>
        <select id={`${prefisso}-direzione`} value={draft.direzione} onChange={(evento) => cambia("direzione", evento.target.value as TestataDraft["direzione"])} className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-3 text-base text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
          <option value="entrata">Entrata</option><option value="uscita">Uscita</option>
        </select>
      </CampoTestata>
      <CampoTestata label="Numero bolla" campo="numero_riferimento" forzati={forzati} onRipristina={onRipristina}>
        <Input id={`${prefisso}-numero`} value={draft.numeroRiferimento} maxLength={100} onChange={(evento) => cambia("numeroRiferimento", evento.target.value)} />
      </CampoTestata>
      <CampoTestata label="Data documento" campo="data_documento" forzati={forzati} onRipristina={onRipristina}>
        <Input id={`${prefisso}-data`} type="date" value={draft.dataDocumento} onChange={(evento) => cambia("dataDocumento", evento.target.value)} />
      </CampoTestata>
      <CampoTestata label="Controparte" campo="controparte_nome" forzati={forzati} onRipristina={onRipristina} className="sm:col-span-2 xl:col-span-1">
        <Input id={`${prefisso}-controparte`} value={draft.controparteNome} maxLength={240} onChange={(evento) => cambia("controparteNome", evento.target.value)} />
      </CampoTestata>
      <CampoTestata label="Vettore" campo="vettore_id" forzati={forzati} onRipristina={onRipristina}>
        <select id={`${prefisso}-vettore`} value={draft.vettoreId} onChange={(evento) => cambia("vettoreId", evento.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-3 text-base text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
          <option value="">Scegli il vettore</option>
          {vettori.map((vettore) => <option key={vettore.id} value={vettore.id}>{vettore.nome}</option>)}
        </select>
      </CampoTestata>
      <CampoTestata label="Colli" campo="colli_bolla" forzati={forzati} onRipristina={onRipristina}>
        <Input id={`${prefisso}-colli`} type="number" min="1" max="999999" step="1" inputMode="numeric" value={draft.colli} onChange={(evento) => cambia("colli", evento.target.value)} />
      </CampoTestata>
      <CampoTestata label="Peso totale (kg)" campo="peso_bolla" forzati={forzati} onRipristina={onRipristina}>
        <Input id={`${prefisso}-peso`} type="number" min="0.001" max="100000000" step="0.001" inputMode="decimal" value={draft.pesoKg} onChange={(evento) => cambia("pesoKg", evento.target.value)} />
      </CampoTestata>
    </div>
  );
}

function CampoTestata({ label, campo, forzati, onRipristina, className = "", children }: { label: string; campo: CampoBollaForzabile; forzati?: CampiBollaForzati; onRipristina?: (campo: CampoBollaForzabile) => void; className?: string; children: React.ReactNode }) {
  const forzato = forzati?.[campo];
  return (
    <label className={`min-w-0 text-xs font-medium text-text-muted ${className}`}>
      <span className="flex min-h-5 flex-wrap items-center gap-1.5">
        {label}
        {forzato ? <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-amber-800"><Pencil className="h-3 w-3" aria-hidden="true" />Forzato</span> : null}
      </span>
      {children}
      {forzato ? (
        <span className="mt-1.5 flex items-start justify-between gap-2 text-[11px] leading-4 text-amber-800">
          <span className="min-w-0 break-words">Gestionale: {String(forzato.valorePrecedente ?? "vuoto")} · {mostraData(forzato.forzatoIl, true)}</span>
          {onRipristina ? <button type="button" className="shrink-0 underline underline-offset-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={(evento) => { evento.preventDefault(); onRipristina(campo); }}>Ripristina</button> : null}
        </span>
      ) : null}
    </label>
  );
}

function BollaCard({ documento, vettori, puoScongelare, onAggiornata }: { documento: BollaDocumento; vettori: BollaVettoreOpzione[]; puoScongelare: boolean; onAggiornata: () => Promise<void> }) {
  const [aperta, setAperta] = useState(false);
  const [modificaTestata, setModificaTestata] = useState(false);
  const [gruppi, setGruppi] = useState<GruppoDraft[]>(() => documento.misure.length > 0 ? documento.misure.map(daMisura) : [nuovoGruppo(Math.max(1, Math.round(documento.numColli ?? 1)))]);

  useEffect(() => {
    setGruppi(documento.misure.length > 0 ? documento.misure.map(daMisura) : [nuovoGruppo(Math.max(1, Math.round(documento.numColli ?? 1)))]);
  }, [documento.misure, documento.numColli]);

  const misureValide = useMemo(() => gruppi.flatMap((gruppo) => {
    const valori = valoriDraft(gruppo);
    const parsed = MutazioneBollaMisura.safeParse({ operazione: "crea", spedizioneId: documento.idSpedizione, ...valori });
    return parsed.success ? [valori] : [];
  }), [documento.idSpedizione, gruppi]);
  const riepilogo = riepilogoMisureBolla(misureValide, documento.divisoreVolumetrico, null);
  const colliMisurati = misureValide.reduce((somma, misura) => somma + misura.quantita, 0);
  const numeroBolla = documento.numeroDocumento ?? `spedizione ${documento.idSpedizione.slice(0, 8)}`;
  const richiedeNumero = daNumerare(documento);

  return (
    <article aria-label={richiedeNumero ? "Bolla da numerare" : `Bolla ${numeroBolla}`} className={`overflow-hidden rounded-xl bg-bg ${richiedeNumero ? "border border-primary shadow-[0_8px_24px_rgba(0,161,190,0.12)]" : documento.congelata ? "border border-slate-400" : documento.statoMisure === "da_misurare" ? "border border-warning/60 shadow-[0_6px_20px_rgba(245,158,11,0.10)]" : "border border-border"}`}>
      {richiedeNumero ? <NumeroDaAssegnare documento={documento} onAggiornata={onAggiornata} /> : null}
      <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(16rem,1.5fr)_minmax(11rem,1fr)_8rem_11rem_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words font-tenorite text-lg font-bold text-text">Bolla {numeroBolla}</h2>
            <StatoBadge documento={documento} />
            <OrigineBadge origine={documento.origine} />
          </div>
          <p className="mt-1 break-words text-sm font-medium text-text">{documento.soggetto ?? "Controparte non indicata"}</p>
          <p className="mt-0.5 text-xs text-text-muted">{documento.direzione === "entrata" ? "Entrata" : "Uscita"} · {mostraData(documento.dataDocumento)}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-sm lg:block">
          <div className="min-w-0"><dt className="text-xs text-text-muted">Vettore</dt><dd className="break-words font-medium text-text">{documento.vettore ?? "Non indicato"}</dd></div>
          <div className="min-w-0 lg:mt-1"><dt className="text-xs text-text-muted">Documenti collegati</dt><dd className="text-text">{documento.idDocumenti.length || "Nessuno"}</dd></div>
        </dl>
        <div><p className="text-xs text-text-muted">Colli</p><p className="font-tenorite text-xl font-bold tabular-nums text-text">{documento.numColli === null ? "—" : numero.format(documento.numColli)}</p></div>
        <div><p className="text-xs text-text-muted">Peso volumetrico</p><p className="font-tenorite text-xl font-bold tabular-nums text-primary-dark">{riepilogo.pesoVolumetricoKg === null ? "Coeff. assente" : riepilogo.volumeM3 > 0 ? `${numero.format(riepilogo.pesoVolumetricoKg)} kg` : "Da calcolare"}</p><p className="text-xs text-text-muted">{documento.divisoreVolumetrico ? `${documento.divisoreVolumetrico} kg/m³` : "Vettore da scegliere"}</p></div>
        <Button type="button" size="sm" variant="outline" aria-expanded={aperta} onClick={() => setAperta((valore) => !valore)} className="justify-self-start lg:justify-self-end">
          <Ruler className="h-4 w-4" aria-hidden="true" />Dettagli e misure{aperta ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {documento.congelata ? <CongelamentoBanner documento={documento} puoScongelare={puoScongelare} onAggiornata={onAggiornata} /> : null}
      {documento.scostamenti.length > 0 ? <Scostamenti documento={documento} /> : null}

      {aperta ? (
        <div className="border-t border-border bg-bg-page px-4 py-5 sm:px-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="font-tenorite text-base font-bold text-text">Dati della spedizione</h3><p className="mt-1 text-xs text-text-muted">{documento.idDocumenti.length > 0 ? "Ogni modifica ai dati gestionali viene marcata e conserva il valore originale." : "Finche non arriva il gestionale, questi dati sono liberamente modificabili."}</p></div>
            {!documento.congelata ? <Button type="button" size="sm" variant="outline" onClick={() => setModificaTestata((valore) => !valore)}>{modificaTestata ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}{modificaTestata ? "Annulla modifica" : "Modifica dati"}</Button> : null}
          </div>
          {modificaTestata && !documento.congelata ? <ModificaBollaForm documento={documento} vettori={vettori} onAggiornata={async () => { setModificaTestata(false); await onAggiornata(); }} /> : <RiepilogoTestata documento={documento} vettori={vettori} />}

          <div className="mb-4 mt-7 flex flex-wrap items-end justify-between gap-3 border-t border-border pt-5">
            <div><h3 className="font-tenorite text-base font-bold text-text">Gruppi di colli omogenei</h3><p className="mt-1 text-xs text-text-muted">Un gruppo per ogni combinazione di lunghezza, larghezza e altezza.</p></div>
            <div className="text-right"><p className="text-xs text-text-muted">Volume rilevato</p><p className="font-tenorite text-lg font-bold tabular-nums text-text">{numero.format(riepilogo.volumeM3)} m³</p></div>
          </div>
          <div className="space-y-3">
            {gruppi.map((gruppo, indice) => <GruppoMisuraForm key={gruppo.chiave} indice={indice} spedizioneId={documento.idSpedizione} gruppo={gruppo} congelata={documento.congelata} onChange={(prossimo) => setGruppi((correnti) => correnti.map((riga) => riga.chiave === gruppo.chiave ? prossimo : riga))} onRimuoviLocale={() => setGruppi((correnti) => correnti.filter((riga) => riga.chiave !== gruppo.chiave))} onAggiornata={onAggiornata} />)}
          </div>
          {documento.numColli !== null && colliMisurati > 0 && colliMisurati !== documento.numColli ? <p className="mt-3 text-xs font-medium text-amber-800" role="status">I gruppi validi coprono {colliMisurati} colli, mentre la bolla ne dichiara {numero.format(documento.numColli)}.</p> : null}
          {!documento.congelata ? <Button type="button" size="sm" variant="outline" className="mt-4" onClick={() => setGruppi((correnti) => [...correnti, nuovoGruppo(correnti.length === 0 ? Math.round(documento.numColli ?? 1) : 1)])}><Plus className="h-4 w-4" aria-hidden="true" />Aggiungi gruppo</Button> : null}
        </div>
      ) : null}
    </article>
  );
}

function StatoBadge({ documento }: { documento: BollaDocumento }) {
  if (daNumerare(documento)) return <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-white">Da numerare</span>;
  if (documento.congelata) return <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-800"><FileLock2 className="h-3 w-3" />Congelata</span>;
  if (documento.statoMisure === "da_misurare") return <span className="rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-amber-800">Da misurare</span>;
  return <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary-dark">Misurata</span>;
}

function NumeroDaAssegnare({ documento, onAggiornata }: { documento: BollaDocumento; onAggiornata: () => Promise<void> }) {
  const [numeroBolla, setNumeroBolla] = useState("");
  const [salvataggio, setSalvataggio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const salva = async () => {
    if (!numeroBolla.trim()) { setErrore("Inserisci il numero della bolla."); return; }
    setSalvataggio(true); setErrore(null);
    const draft = draftDaDocumento(documento);
    try {
      await inviaComando({ operazione: "aggiorna_bolla", spedizioneId: documento.idSpedizione, ...draft, numeroRiferimento: numeroBolla.trim(), colli: Number(draft.colli), pesoKg: Number(draft.pesoKg) });
      await onAggiornata();
    } catch (causa) { setErrore(causa instanceof Error ? causa.message : "Numero non salvato."); }
    finally { setSalvataggio(false); }
  };
  return <div className="flex flex-col gap-3 border-b border-primary/30 bg-primary/10 px-4 py-3 sm:flex-row sm:items-end sm:justify-between sm:px-5"><div><p className="font-tenorite font-bold text-primary-dark">Da numerare</p><p className="mt-0.5 text-xs text-text-muted">La spedizione è stata creata dalla simulazione senza numero: completala qui.</p></div><div className="flex flex-wrap items-end gap-2"><label htmlFor={`numero-da-assegnare-${documento.idSpedizione}`} className="text-xs font-medium text-text-muted">Numero bolla<Input id={`numero-da-assegnare-${documento.idSpedizione}`} value={numeroBolla} onChange={(e) => setNumeroBolla(e.target.value)} className="mt-1 w-48 bg-bg" /></label><Button type="button" size="sm" disabled={salvataggio} onClick={() => void salva()}>{salvataggio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salva numero</Button>{errore ? <p role="alert" className="w-full text-xs font-medium text-danger">{errore}</p> : null}</div></div>;
}

function OrigineBadge({ origine }: { origine: BollaDocumento["origine"] }) {
  const label = origine === "excel_storico" ? "Excel storico" : origine === "gestionale" ? "Gestionale" : "Manuale";
  return <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-text-muted">{label}</span>;
}

function CongelamentoBanner({ documento, puoScongelare, onAggiornata }: { documento: BollaDocumento; puoScongelare: boolean; onAggiornata: () => Promise<void> }) {
  const [mostraScongela, setMostraScongela] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [salvataggio, setSalvataggio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const salva = async () => {
    if (motivo.trim().length < 3) { setErrore("Indica il motivo dello scongelamento."); return; }
    setSalvataggio(true); setErrore(null);
    try { await inviaComando({ operazione: "scongela", spedizioneId: documento.idSpedizione, motivo }); await onAggiornata(); }
    catch (causa) { setErrore(causa instanceof Error ? causa.message : "Scongelamento non riuscito."); }
    finally { setSalvataggio(false); }
  };
  return (
    <div className="border-t border-slate-300 bg-slate-100 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3"><FileLock2 className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" aria-hidden="true" /><div><p className="font-tenorite font-bold text-slate-900">Modifiche bloccate dalla fattura</p><p className="mt-0.5 break-words text-sm text-slate-700">{documento.fattura ? `Agganciata alla fattura ${documento.fattura.numero} del ${mostraData(documento.fattura.data)}. Anche le misure sono congelate.` : "Esiste un controllo fattura per questa spedizione. Anche le misure sono congelate."}</p></div></div>
        {puoScongelare ? <Button type="button" size="sm" variant="outline" onClick={() => setMostraScongela((valore) => !valore)}><LockOpen className="h-4 w-4" />Scongela con motivo</Button> : null}
      </div>
      {mostraScongela ? <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"><label className="text-xs font-medium text-slate-700">Motivo dello scongelamento<Input className="mt-1 bg-white" value={motivo} maxLength={500} onChange={(evento) => setMotivo(evento.target.value)} /></label><Button type="button" disabled={salvataggio} onClick={() => void salva()}>{salvataggio ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}Conferma scongelamento</Button>{errore ? <p role="alert" className="text-sm font-medium text-danger sm:col-span-2">{errore}</p> : null}</div> : null}
    </div>
  );
}

function Scostamenti({ documento }: { documento: BollaDocumento }) {
  return (
    <div className="border-t border-amber-300 bg-amber-50 px-4 py-4 sm:px-5" role="status">
      <div className="flex items-start gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" /><div className="min-w-0"><p className="font-tenorite font-bold text-amber-950">Gestionale e valori congelati non coincidono</p><p className="mt-0.5 text-sm text-amber-900">Il documento arrivato dopo la fattura è stato collegato senza sovrascrivere la spedizione.</p><ul className="mt-2 space-y-1 text-xs text-amber-950">{documento.scostamenti.flatMap((scostamento) => Object.entries(scostamento.differenze).map(([campo, valori]) => <li key={`${scostamento.id}-${campo}`} className="break-words"><span className="font-semibold">{campo === "arrivo_documento" ? "Collegamento tardivo" : ETICHETTE_CAMPI[campo as CampoBollaForzabile] ?? campo}:</span> congelato “{String(valori.spedizione ?? "vuoto")}”, gestionale “{String(valori.gestionale ?? "vuoto")}”</li>))}</ul></div></div>
    </div>
  );
}

function RiepilogoTestata({ documento, vettori }: { documento: BollaDocumento; vettori: BollaVettoreOpzione[] }) {
  const valori: Array<{ campo: CampoBollaForzabile; valore: string }> = [
    { campo: "direzione", valore: documento.direzione === "entrata" ? "Entrata" : "Uscita" },
    { campo: "numero_riferimento", valore: documento.numeroDocumento ?? "—" },
    { campo: "data_documento", valore: mostraData(documento.dataDocumento) },
    { campo: "controparte_nome", valore: documento.soggetto ?? "—" },
    { campo: "vettore_id", valore: documento.vettore ?? "—" },
    { campo: "colli_bolla", valore: documento.numColli === null ? "—" : numero.format(documento.numColli) },
    { campo: "peso_bolla", valore: documento.pesoLordoKg === null ? "—" : `${numero.format(documento.pesoLordoKg)} kg` },
  ];
  const nomeVettoreOriginale = (id: string | number | boolean | null) => typeof id === "string" ? vettori.find((vettore) => vettore.id === id)?.nome ?? id : String(id ?? "vuoto");
  return <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">{valori.map(({ campo, valore }) => { const forzato = documento.campiForzati[campo]; return <div key={campo} className="min-w-0"><dt className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">{ETICHETTE_CAMPI[campo]}{forzato ? <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-amber-800"><History className="h-3 w-3" />Forzato</span> : null}</dt><dd className="mt-0.5 break-words text-sm font-medium text-text">{valore}</dd>{forzato ? <dd className="mt-1 break-words text-[11px] text-amber-800">Gestionale: {campo === "vettore_id" ? nomeVettoreOriginale(forzato.valorePrecedente) : String(forzato.valorePrecedente ?? "vuoto")}</dd> : null}</div>; })}</dl>;
}

function ModificaBollaForm({ documento, vettori, onAggiornata }: { documento: BollaDocumento; vettori: BollaVettoreOpzione[]; onAggiornata: () => Promise<void> }) {
  const [draft, setDraft] = useState<TestataDraft>(() => draftDaDocumento(documento));
  const [salvataggio, setSalvataggio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const salva = async () => {
    setSalvataggio(true); setErrore(null);
    try { await inviaComando({ operazione: "aggiorna_bolla", spedizioneId: documento.idSpedizione, ...draft, colli: Number(draft.colli), pesoKg: Number(draft.pesoKg) }); await onAggiornata(); }
    catch (causa) { setErrore(causa instanceof Error ? causa.message : "Salvataggio non riuscito."); }
    finally { setSalvataggio(false); }
  };
  const ripristina = async (campo: CampoBollaForzabile) => {
    setSalvataggio(true); setErrore(null);
    try { await inviaComando({ operazione: "ripristina_campo", spedizioneId: documento.idSpedizione, campo }); await onAggiornata(); }
    catch (causa) { setErrore(causa instanceof Error ? causa.message : "Ripristino non riuscito."); }
    finally { setSalvataggio(false); }
  };
  return <div><TestataFields draft={draft} vettori={vettori} onChange={setDraft} prefisso={`modifica-${documento.idSpedizione}`} forzati={documento.campiForzati} onRipristina={(campo) => void ripristina(campo)} />{errore ? <p role="alert" className="mt-3 text-sm font-medium text-danger">{errore}</p> : null}<div className="mt-4 flex justify-end"><Button type="button" size="sm" disabled={salvataggio} onClick={() => void salva()}>{salvataggio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salva modifiche</Button></div></div>;
}

function GruppoMisuraForm({ indice, spedizioneId, gruppo, congelata, onChange, onRimuoviLocale, onAggiornata }: { indice: number; spedizioneId: string; gruppo: GruppoDraft; congelata: boolean; onChange: (gruppo: GruppoDraft) => void; onRimuoviLocale: () => void; onAggiornata: () => Promise<void> }) {
  const [salvataggio, setSalvataggio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [confermaElimina, setConfermaElimina] = useState(false);
  const prefisso = `gruppo-${spedizioneId}-${indice}`;
  const invia = async (elimina = false) => {
    const valori = valoriDraft(gruppo);
    const comando = elimina ? { operazione: "elimina" as const, id: gruppo.id, spedizioneId } : gruppo.id ? { operazione: "aggiorna" as const, id: gruppo.id, spedizioneId, ...valori } : { operazione: "crea" as const, spedizioneId, ...valori };
    const parsed = MutazioneBollaMisura.safeParse(comando);
    if (!parsed.success) { setErrore("Completa quantità e dimensioni con valori maggiori di zero."); return; }
    setSalvataggio(true); setErrore(null);
    try { await inviaComando(parsed.data); await onAggiornata(); }
    catch (causa) { setErrore(causa instanceof Error ? causa.message : "Salvataggio non riuscito."); }
    finally { setSalvataggio(false); setConfermaElimina(false); }
  };
  return (
    <div className="rounded-xl border border-border bg-bg p-4">
      <GruppoFields prefisso={prefisso} gruppo={gruppo} disabled={congelata} onChange={onChange} azioni={<div className="flex gap-2 sm:col-span-2 xl:col-span-1">{!congelata ? <><Button type="button" size="sm" disabled={salvataggio} onClick={() => void invia()}>{salvataggio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Salva</Button>{gruppo.id ? (confermaElimina ? <Button type="button" size="sm" variant="danger" disabled={salvataggio} onClick={() => void invia(true)}>Conferma</Button> : <Button type="button" size="icon" variant="ghost" aria-label={`Elimina gruppo ${indice + 1}`} onClick={() => setConfermaElimina(true)}><Trash2 className="h-4 w-4 text-danger" /></Button>) : <Button type="button" size="icon" variant="ghost" aria-label={`Rimuovi gruppo ${indice + 1}`} onClick={onRimuoviLocale}><Trash2 className="h-4 w-4 text-text-muted" /></Button>}</> : <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600"><FileLock2 className="h-4 w-4" />Sola lettura</span>}</div>} />
      {errore ? <p className="mt-2 text-xs font-medium text-danger" role="alert">{errore}</p> : null}
    </div>
  );
}

function GruppoFields({ prefisso, gruppo, onChange, disabled = false, azioni }: { prefisso: string; gruppo: GruppoDraft; onChange: (gruppo: GruppoDraft) => void; disabled?: boolean; azioni?: React.ReactNode }) {
  const cambia = (campo: keyof Omit<GruppoDraft, "chiave" | "id">, valore: string) => onChange({ ...gruppo, [campo]: valore });
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[5.5rem_repeat(4,minmax(7rem,1fr))_auto] xl:items-end"><CampoMisura id={`${prefisso}-quantita`} label="Quantità" value={gruppo.quantita} step="1" disabled={disabled} onChange={(v) => cambia("quantita", v)} /><CampoMisura id={`${prefisso}-lunghezza`} label="Lunghezza (cm)" value={gruppo.lunghezzaCm} disabled={disabled} onChange={(v) => cambia("lunghezzaCm", v)} /><CampoMisura id={`${prefisso}-larghezza`} label="Larghezza (cm)" value={gruppo.larghezzaCm} disabled={disabled} onChange={(v) => cambia("larghezzaCm", v)} /><CampoMisura id={`${prefisso}-altezza`} label="Altezza (cm)" value={gruppo.altezzaCm} disabled={disabled} onChange={(v) => cambia("altezzaCm", v)} /><CampoMisura id={`${prefisso}-peso`} label="Peso reale (kg)" value={gruppo.pesoRealeKg} min="0.1" max="100000" optional disabled={disabled} onChange={(v) => cambia("pesoRealeKg", v)} />{azioni}</div>;
}

function CampoMisura({ id, label, value, onChange, optional = false, disabled = false, step = "0.1", min = "1", max = "2000" }: { id: string; label: string; value: string; onChange: (value: string) => void; optional?: boolean; disabled?: boolean; step?: string; min?: string; max?: string }) {
  return <label htmlFor={id} className="block text-xs font-medium text-text-muted">{label}{optional ? " · opz." : ""}<Input id={id} className="mt-1 font-tenorite tabular-nums" type="number" min={min} max={step === "1" ? "999" : max} step={step} inputMode="decimal" disabled={disabled} value={value} onChange={(evento) => onChange(evento.target.value)} /></label>;
}
