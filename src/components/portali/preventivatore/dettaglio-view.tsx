"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Package, Hammer, StickyNote, Tag, Sparkles, ExternalLink, Wand2, Loader2, Pencil, TrendingUp, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentoWordDialog } from "./documento-word-dialog";
import { MarkdownLight } from "./markdown-light";
import { CorreggiTotaliDialog } from "./correggi-totali-dialog";
import { WorkflowActions } from "./workflow-actions";
import {
  TOTAL_LABELS,
  TOTAL_ORDER,
  type PreventivoDettaglio,
  type PreventivoChunkRaw,
  type PreventivoRigaRaw,
  type PreventivoBloccoRaw,
  type TotaleValore,
  type LavorazioneVoce,
} from "./dettaglio-view-types";

// ─── Utils ────────────────────────────────────────────────────────────────────

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtEuro(v: number | string | null | undefined): string {
  const n = toNum(v);
  if (n == null) return "—";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
}

function fmtNum(v: number | string | null | undefined, decimals = 2): string {
  const n = toNum(v);
  if (n == null) return "—";
  return new Intl.NumberFormat("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(n);
}

// ─── Sanity check sui totals estratti ────────────────────────────────────────
// L'ingestion può aver catturato valori sbagliati (es. ultima cella della riga
// invece di quella giusta) per fogli con layout non standard. Queste funzioni
// validano i valori prima del display, restituendo null quando non plausibili.

interface TotalsView {
  totale_materiale?: number | null;
  totale_manodopera?: number | null;
  totale_costi?: number | null;
  totale?: number | null;
  prezzo_finale?: number | null;
  margine_pct?: number | null; // espresso in % (0-100)
  margine_implausible?: boolean;
  prezzo_finale_implausible?: boolean;
}

function num(v: { raw: number; ceil_2: number } | undefined): number | null {
  if (!v) return null;
  const n = typeof v.ceil_2 === "number" ? v.ceil_2 : null;
  return n;
}

function buildTotalsView(totals: Record<string, { raw: number; ceil_2: number }> | null | undefined): TotalsView {
  const t: TotalsView = {};
  if (!totals) return t;
  t.totale_materiale = num(totals.totale_materiale);
  t.totale_manodopera = num(totals.totale_manodopera);
  t.totale_costi = num(totals.totale_costi);
  t.totale = num(totals.totale);
  t.prezzo_finale = num(totals.prezzo_finale);

  // Margine: lo script ha salvato il valore "raw" estratto dalla cella.
  //   - coefficiente: 0.08 → 8%
  //   - percentuale già intera: 8 → 8%
  //   - valore monetario per errore: 2877.96 → IMPLAUSIBLE
  const margineRaw = num(totals.margine_trattativa);
  if (margineRaw == null) {
    t.margine_pct = null;
  } else if (margineRaw > 0 && margineRaw <= 1) {
    t.margine_pct = margineRaw * 100; // coefficiente
  } else if (margineRaw > 1 && margineRaw <= 200) {
    t.margine_pct = margineRaw; // già % (con tolleranza fino a 200%)
  } else {
    t.margine_pct = null;
    t.margine_implausible = true;
  }

  // Prezzo finale: deve essere >= totale_costi e >= totale (di solito >= totale × (1 + margine)).
  // Se è troppo piccolo → implausibile (es. catturato 6.00 invece di 5471).
  if (t.prezzo_finale != null) {
    const soglieMin: number[] = [];
    if (t.totale != null) soglieMin.push(t.totale * 0.7);
    if (t.totale_costi != null) soglieMin.push(t.totale_costi * 0.7);
    if (t.totale_materiale != null) soglieMin.push(t.totale_materiale * 0.5);
    const sogliaMin = soglieMin.length ? Math.max(...soglieMin) : 0;
    if (t.prezzo_finale < sogliaMin) {
      t.prezzo_finale_implausible = true;
    }
  }

  // Se prezzo_finale è implausibile ma abbiamo totale + margine_pct, lo deduciamo
  if (t.prezzo_finale_implausible && t.totale != null && t.margine_pct != null) {
    t.prezzo_finale = +(t.totale * (1 + t.margine_pct / 100)).toFixed(2);
    t.prezzo_finale_implausible = false; // ora è ricalcolato
  }

  return t;
}

const STATO_BADGE: Record<string, { label: string; className: string }> = {
  // legacy (compat con vecchi import)
  pending:   { label: "In attesa",  className: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  ordinato:  { label: "Ordinato",   className: "bg-green-100 text-green-800 border-green-200" },
  rifiutato: { label: "Rifiutato",  className: "bg-red-100 text-red-800 border-red-200" },
  // workflow nuovo (migration 039)
  storico:          { label: "Archivio storico",   className: "bg-slate-100 text-slate-700 border-slate-200" },
  aperta:           { label: "Aperta",             className: "bg-slate-100 text-slate-700 border-slate-200" },
  presa_in_carico:  { label: "Presa in carico",    className: "bg-blue-100 text-blue-800 border-blue-200" },
  completato:       { label: "Pronto per offerta", className: "bg-violet-100 text-violet-800 border-violet-200" },
  inviata:          { label: "Offerta inviata",    className: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  ordinata:         { label: "Ordinata",           className: "bg-green-100 text-green-800 border-green-200" },
  fallita:          { label: "Fallita",            className: "bg-red-100 text-red-800 border-red-200" },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function DettaglioPreventivoView({ dettaglio }: { dettaglio: PreventivoDettaglio }) {
  const { documento, chunks, righe_distinta, motivo_rifiuto_label } = dettaglio;
  const blocchiTable = dettaglio.blocchi ?? [];

  // Preventivo generato dal builder: la distinta vive nelle tabelle blocchi +
  // righe_distinta (non nei chunk excel). Lo rendiamo con un percorso dedicato
  // che mostra costo "vergine", prezzo di vendita e margine.
  const isGenerato = documento.tipo === "generato" && blocchiTable.length > 0;

  // Calcoli economici del progetto (solo per generati). Convenzione SICS:
  //   costo_vergine_riga = quantità × prezzo_unitario   (prezzo_unitario = ult_costo o tariffa/h)
  //   prezzo_vendita_riga = totale_riga  (già = costo / coeff_ricarico)
  //   margine% = (prezzo − costo) / costo × 100   ← ricarico sul costo
  const progetto = useMemo(() => {
    if (!isGenerato) return null;
    let costoMat = 0, costoMano = 0, prezzoMat = 0, prezzoMano = 0;
    for (const r of righe_distinta) {
      const qty = toNum(r.quantita) ?? 0;
      const pu = toNum(r.prezzo_unitario) ?? 0;
      const vendita = toNum(r.totale_riga) ?? qty * pu;
      const costo = qty * pu;
      if (r.tipo_riga === "manodopera") {
        costoMano += costo; prezzoMano += vendita;
      } else {
        costoMat += costo; prezzoMat += vendita;
      }
    }
    const costoTot = costoMat + costoMano;
    const prezzoTot = prezzoMat + prezzoMano;
    const margineEuro = prezzoTot - costoTot;
    const marginePct = costoTot > 0 ? (margineEuro / costoTot) * 100 : null;
    return { costoMat, costoMano, costoTot, prezzoMat, prezzoMano, prezzoTot, margineEuro, marginePct };
  }, [isGenerato, righe_distinta]);

  // Righe raggruppate per codice_blocco (per i generati)
  const righePerBlocco = useMemo(() => {
    const m = new Map<string, PreventivoRigaRaw[]>();
    for (const r of righe_distinta) {
      const key = r.codice_blocco ?? r.sheet_name ?? "—";
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return m;
  }, [righe_distinta]);

  // Raggruppa righe distinta per sheet_name (fallback su codice_blocco se sheet vuoto)
  const righePerSheet = useMemo(() => {
    const m = new Map<string, PreventivoRigaRaw[]>();
    for (const r of righe_distinta) {
      const key = r.sheet_name ?? r.codice_blocco ?? "—";
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return m;
  }, [righe_distinta]);

  // Chunks Excel (ogni chunk = un blocco di preventivo)
  const blocchiExcel = useMemo(
    () => chunks.filter((c) => c.metadata?.source_type === "excel"),
    [chunks]
  );
  // Chunks Word (testo commerciale + note)
  const chunksWord = useMemo(
    () => chunks.filter((c) => c.metadata?.source_type === "word"),
    [chunks]
  );

  const stato = STATO_BADGE[documento.stato] ?? STATO_BADGE.pending;

  // Statistiche aggregate per header
  const nArticoli = isGenerato
    ? righe_distinta.filter((r) => r.tipo_riga !== "manodopera").length
    : righe_distinta.length;
  const nBlocchi = isGenerato ? blocchiTable.length : blocchiExcel.length;
  const nOreTot = isGenerato
    ? righe_distinta
        .filter((r) => r.tipo_riga === "manodopera")
        .reduce((tot, r) => tot + (toNum(r.quantita) ?? 0), 0)
    : blocchiExcel.reduce((tot, c) => {
        const lav = c.metadata?.lavorazioni ?? [];
        return tot + lav.reduce((s, l) => s + (toNum(l.ore) ?? 0), 0);
      }, 0);

  // Stato per dialog "Apri documento" e per riassunto AI
  const [docOpen, setDocOpen] = useState<string | null>(null); // id chunk aperto
  const [riassunto, setRiassunto] = useState<string | null>(null);
  const [riassuntoLoading, setRiassuntoLoading] = useState(false);
  const [riassuntoError, setRiassuntoError] = useState<string | null>(null);
  const [correggiOpen, setCorreggiOpen] = useState(false);

  // Chunks word commerciale (non note) per il pulsante "Apri documento" e per il riassunto AI
  const wordCommerciali = useMemo(
    () => chunksWord.filter((c) => c.metadata?.ruolo_file !== "note_preventivo"),
    [chunksWord]
  );
  const haDocumenti = wordCommerciali.length > 0;

  const richiediRiassunto = async () => {
    if (riassuntoLoading) return;
    setRiassuntoLoading(true);
    setRiassuntoError(null);
    setRiassunto(null);
    try {
      const res = await fetch(`/api/portali/preventivatore/${documento.id}/riassumi`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Errore riassunto");
      setRiassunto(data.riassunto ?? "");
    } catch (err) {
      setRiassuntoError(err instanceof Error ? err.message : "Errore di rete");
    } finally {
      setRiassuntoLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* ── Back + breadcrumb ── */}
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href="/preventivatore/archivio">
            <ArrowLeft className="w-4 h-4" />
            Archivio
          </Link>
        </Button>
        <span className="text-text-muted text-sm">/</span>
        <span className="text-sm font-mono text-text">{documento.codice ?? documento.id.slice(0, 8)}</span>
        <Button
          asChild
          variant="outline"
          size="sm"
          className="ml-auto gap-1.5 text-emerald-700 border-emerald-300/60 hover:bg-emerald-50"
          title="Crea un nuovo preventivo usando questo come base (prezzi aggiornati ai valori correnti)"
        >
          <Link href={`/preventivatore/nuovo?base=${documento.id}`}>
            <Copy className="w-3.5 h-3.5" />
            Crea preventivo da questa base
          </Link>
        </Button>
        <Button
          onClick={() => setCorreggiOpen(true)}
          variant="outline"
          size="sm"
          className="gap-1.5 text-[#007a91] border-[#00a1be]/30 hover:bg-[#00a1be]/5"
          title="Correggi totali (richiede livello admin/exporter)"
        >
          <Pencil className="w-3.5 h-3.5" />
          Correggi totali
        </Button>
      </div>

      <CorreggiTotaliDialog
        open={correggiOpen}
        onOpenChange={setCorreggiOpen}
        documentoId={documento.id}
        codice={documento.codice}
        chunks={chunks}
        importoCorrente={typeof documento.importo_preventivo === "number" ? documento.importo_preventivo : null}
        onSaved={() => window.location.reload()}
      />

      {/* ── Header card ── */}
      <div className="border border-border rounded-xl bg-bg p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-tenorite text-text font-mono">{documento.codice ?? "—"}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${stato.className}`}>
                {stato.label}
              </span>
              {documento.tipo === "generato" && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#00a1be]/10 text-[#007a91]">
                  Generato
                </span>
              )}
            </div>
            <p className="text-base text-text">
              {documento.cliente ?? "Cliente non specificato"}
              {documento.numero_offerta && (
                <span className="text-text-muted text-sm ml-2">
                  · Offerta nr. <span className="font-mono">{documento.numero_offerta}</span>
                </span>
              )}
              {documento.data_offerta && (
                <span className="text-text-muted text-sm ml-2">· {documento.data_offerta}</span>
              )}
            </p>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {documento.categoria && (
                <span className="text-[11px] text-text-muted px-1.5 py-0.5 rounded-full bg-bg-page border border-border">
                  {documento.categoria}
                </span>
              )}
              {documento.tipo_prodotto && documento.tipo_prodotto !== "altro" && (
                <span className="text-[11px] text-text-muted px-1.5 py-0.5 rounded-full bg-bg-page border border-border">
                  {documento.tipo_prodotto}
                </span>
              )}
              {documento.anno && (
                <span className="text-[11px] text-text-muted px-1.5 py-0.5 rounded-full bg-bg-page border border-border">
                  {documento.anno}
                </span>
              )}
              {documento.versione_ingest && (
                <span className="text-[11px] text-text-muted/70 px-1.5 py-0.5 rounded-full">
                  ingest {documento.versione_ingest}
                </span>
              )}
            </div>
          </div>

          {/* Importi */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="text-[10px] uppercase tracking-wide text-text-muted">Prezzo preventivo</div>
            <div className="text-2xl font-bold" style={{ color: "#00a1be" }}>
              {fmtEuro(documento.importo_preventivo)}
            </div>
            {documento.importo_ordinato != null && documento.stato === "ordinato" && (
              <div className="text-sm text-green-700 font-medium">
                → ordinato {fmtEuro(documento.importo_ordinato)}
              </div>
            )}
            {documento.importo_source && (
              <div className="text-[10px] text-text-muted/70">fonte: {documento.importo_source}</div>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex gap-6 pt-3 border-t border-border flex-wrap">
          <Stat label="Blocchi" value={String(nBlocchi)} />
          <Stat label="Articoli" value={String(nArticoli)} />
          <Stat label="Ore tot." value={fmtNum(nOreTot, 1)} />
          {documento.codici_articolo && documento.codici_articolo.length > 0 && (
            <Stat label="Codici unici" value={String(documento.codici_articolo.length)} />
          )}
        </div>

        {/* Workflow actions (solo per preventivi 'generato' con stato workflow attivo) */}
        <WorkflowActions
          documentoId={documento.id}
          statoCorrente={documento.stato}
          tipo={documento.tipo}
          importoCorrente={
            documento.importo_preventivo != null
              ? Number(documento.importo_preventivo)
              : null
          }
        />

        {/* Stato note + motivo rifiuto */}
        {(documento.stato_note || motivo_rifiuto_label) && (
          <div className="bg-bg-page rounded-lg p-3 border border-border space-y-1">
            {motivo_rifiuto_label && (
              <div className="text-sm">
                <span className="text-text-muted">Motivo rifiuto:</span>{" "}
                <span className="font-medium text-text">{motivo_rifiuto_label}</span>
              </div>
            )}
            {documento.stato_note && (
              <div className="text-sm whitespace-pre-wrap text-text leading-relaxed">
                {documento.stato_note}
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        {documento.tags && documento.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Tag className="w-3.5 h-3.5 text-text-muted" />
            {documento.tags.map((t) => (
              <span key={t} className="text-[11px] text-text-muted px-1.5 py-0.5 rounded-full bg-bg-page border border-border">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Documenti commerciali + AI ── */}
      {chunksWord.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-text uppercase tracking-wide flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Documenti ({chunksWord.length})
            </h2>
            {haDocumenti && (
              <Button
                onClick={richiediRiassunto}
                disabled={riassuntoLoading}
                size="sm"
                variant="outline"
                className="gap-1.5 border-[#00a1be]/30 text-[#007a91] hover:bg-[#00a1be]/5"
              >
                {riassuntoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {riassuntoLoading ? "Generazione…" : "Riassumi con AI"}
              </Button>
            )}
          </div>

          {/* Pannello riassunto AI */}
          {(riassunto || riassuntoError) && (
            <div className="border rounded-xl p-4 bg-gradient-to-br from-[#00a1be]/5 to-bg border-[#00a1be]/30">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-[#00a1be]" />
                <span className="text-xs font-semibold uppercase tracking-wide text-[#007a91]">
                  Riassunto AI
                </span>
                <button
                  onClick={() => { setRiassunto(null); setRiassuntoError(null); }}
                  className="ml-auto text-xs text-text-muted hover:text-text"
                >
                  chiudi
                </button>
              </div>
              {riassuntoError ? (
                <p className="text-sm text-red-700">{riassuntoError}</p>
              ) : (
                <div className="text-sm text-text">
                  <MarkdownLight text={riassunto ?? ""} />
                </div>
              )}
            </div>
          )}

          {chunksWord.map((c) => (
            <WordChunkCard
              key={c.id}
              chunk={c}
              onOpenDocumento={() => setDocOpen(c.id)}
            />
          ))}
        </section>
      )}

      {/* Dialog "Apri documento" — render una sola volta, mostrato per il chunk attivo */}
      {docOpen && (() => {
        const c = chunks.find((x) => x.id === docOpen);
        if (!c) return null;
        return (
          <DocumentoWordDialog
            open={Boolean(docOpen)}
            onOpenChange={(v) => !v && setDocOpen(null)}
            testo={c.contenuto}
            intestazioneFallback={documento.cliente}
            codice={documento.codice}
          />
        );
      })()}

      {/* ── Preventivo generato dal builder: riepilogo + distinta ── */}
      {isGenerato && progetto && (
        <>
          <RiepilogoProgetto p={progetto} />
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-text uppercase tracking-wide flex items-center gap-2">
              <Package className="w-4 h-4" />
              Blocchi progetto ({blocchiTable.length})
            </h2>
            {blocchiTable.map((b, idx) => {
              const key = b.codice_blocco ?? b.sheet_name ?? "—";
              const righe = righePerBlocco.get(key) ?? [];
              return <BloccoBuilderCard key={b.id} blocco={b} indice={idx} righe={righe} />;
            })}
          </section>
        </>
      )}

      {/* ── Excel: blocchi del preventivo ── */}
      {blocchiExcel.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide flex items-center gap-2">
            <Package className="w-4 h-4" />
            Blocchi progetto ({blocchiExcel.length})
          </h2>
          {blocchiExcel.map((c, idx) => {
            // Cerca le righe per questo sheet/blocco
            const key = c.metadata?.sheet_name ?? c.metadata?.codice_blocco ?? "—";
            const righe = righePerSheet.get(key) ?? [];
            return <BloccoExcelCard key={c.id} chunk={c} indice={idx} righe={righe} />;
          })}
        </section>
      )}

      {/* ── Note testuali documento ── */}
      {documento.note && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide flex items-center gap-2">
            <StickyNote className="w-4 h-4" />
            Note testuali
          </h2>
          <div className="border border-border rounded-xl bg-bg p-4">
            <pre className="text-sm text-text whitespace-pre-wrap font-sans leading-relaxed">{documento.note}</pre>
          </div>
        </section>
      )}

      {/* Footer */}
      <div className="text-[11px] text-text-muted text-right">
        Inserito il {new Date(documento.created_at).toLocaleString("it-IT")} ·
        Aggiornato il {new Date(documento.updated_at).toLocaleString("it-IT")}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ProgettoTotali {
  costoMat: number; costoMano: number; costoTot: number;
  prezzoMat: number; prezzoMano: number; prezzoTot: number;
  margineEuro: number; marginePct: number | null;
}

// Riepilogo economico del progetto (preventivi generati): costo "vergine" vs
// prezzo di vendita + card margine (ricarico sul costo).
function RiepilogoProgetto({ p }: { p: ProgettoTotali }) {
  const rows: { label: string; costo: number; prezzo: number; sub?: boolean }[] = [
    { label: "Materiale", costo: p.costoMat, prezzo: p.prezzoMat, sub: true },
    { label: "Manodopera", costo: p.costoMano, prezzo: p.prezzoMano, sub: true },
  ];
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-text uppercase tracking-wide flex items-center gap-2">
        <TrendingUp className="w-4 h-4" />
        Riepilogo economico
      </h2>
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        {/* Tabella costo vs prezzo */}
        <div className="border border-border rounded-xl bg-bg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-page">
              <tr className="text-[10px] uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2.5 text-left font-medium">Voce</th>
                <th className="px-4 py-2.5 text-right font-medium">Costo (vergine)</th>
                <th className="px-4 py-2.5 text-right font-medium">Prezzo (vendita)</th>
                <th className="px-4 py-2.5 text-right font-medium">Ricarico</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ric = r.costo > 0 ? ((r.prezzo - r.costo) / r.costo) * 100 : null;
                return (
                  <tr key={r.label} className="border-t border-border">
                    <td className="px-4 py-2 text-text-muted">{r.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-muted">{fmtEuro(r.costo)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-text">{fmtEuro(r.prezzo)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-muted">
                      {ric != null ? `+${ric.toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border bg-bg-page/40 font-semibold">
                <td className="px-4 py-2.5 text-text">Totale</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text">{fmtEuro(p.costoTot)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: "#00a1be" }}>{fmtEuro(p.prezzoTot)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text-muted">
                  {p.marginePct != null ? `+${p.marginePct.toFixed(0)}%` : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Card margine progetto */}
        <div className="relative overflow-hidden rounded-xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-bg p-5 flex flex-col justify-center min-w-[200px]">
          <div aria-hidden className="pointer-events-none absolute -top-8 -right-8 w-32 h-32 rounded-full bg-emerald-300/20 blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">
              <TrendingUp className="w-3.5 h-3.5" />
              Margine progetto
            </div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-emerald-700">
              {fmtEuro(p.margineEuro)}
            </div>
            {p.marginePct != null && (
              <div className="mt-1 text-sm text-emerald-600/90 tabular-nums">
                +{p.marginePct.toFixed(1)}% sul costo
              </div>
            )}
            <div className="mt-2 text-[11px] text-text-muted leading-snug">
              Differenza tra prezzo di vendita e costo vergine (materiale + manodopera).
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Card di un blocco per preventivi generati: materiali + manodopera con costo
// e prezzo di vendita, lette da righe_distinta (tipo_riga).
function BloccoBuilderCard({
  blocco,
  indice,
  righe,
}: {
  blocco: PreventivoBloccoRaw;
  indice: number;
  righe: PreventivoRigaRaw[];
}) {
  const materiali = righe.filter((r) => r.tipo_riga !== "manodopera");
  const manodopera = righe.filter((r) => r.tipo_riga === "manodopera");
  const titolo = blocco.codice_blocco || blocco.sheet_name || `Blocco ${indice + 1}`;

  const prezzoBlocco = righe.reduce((s, r) => {
    const qty = toNum(r.quantita) ?? 0;
    const pu = toNum(r.prezzo_unitario) ?? 0;
    return s + (toNum(r.totale_riga) ?? qty * pu);
  }, 0);
  const costoBlocco = righe.reduce((s, r) => {
    const qty = toNum(r.quantita) ?? 0;
    const pu = toNum(r.prezzo_unitario) ?? 0;
    return s + qty * pu;
  }, 0);

  return (
    <div className="border border-border rounded-xl bg-bg p-5 space-y-4">
      {/* Header blocco */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-text-muted">Blocco {indice + 1}</div>
          <h3 className="text-base font-medium text-text">{titolo}</h3>
          {blocco.incluso_offerta === false && (
            <span className="text-[10px] text-yellow-700 bg-yellow-50 border border-yellow-200 px-1.5 py-0.5 rounded-full mt-1 inline-block">
              escluso dall&apos;offerta
            </span>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wide text-text-muted">Prezzo blocco</div>
          <div className="text-lg font-bold" style={{ color: "#00a1be" }}>{fmtEuro(prezzoBlocco)}</div>
          <div className="text-[10px] text-text-muted">costo {fmtEuro(costoBlocco)}</div>
        </div>
      </div>

      {/* Materiali */}
      {materiali.length > 0 && (
        <RigheTable
          titolo="Distinta materiali"
          icon={<Package className="w-3.5 h-3.5 text-text-muted" />}
          colCodice
          colQtaLabel="Qtà"
          colCostoLabel="Costo unit."
          righe={materiali}
        />
      )}

      {/* Manodopera */}
      {manodopera.length > 0 && (
        <RigheTable
          titolo="Lavorazioni e manodopera"
          icon={<Hammer className="w-3.5 h-3.5 text-text-muted" />}
          colCodice={false}
          colQtaLabel="Ore"
          colCostoLabel="Tariffa €/h"
          righe={manodopera}
        />
      )}

      {blocco.note && (
        <p className="text-[11px] text-text-muted italic">{blocco.note}</p>
      )}
    </div>
  );
}

// Tabella righe riusabile (materiali o manodopera) per i preventivi generati.
function RigheTable({
  titolo,
  icon,
  colCodice,
  colQtaLabel,
  colCostoLabel,
  righe,
}: {
  titolo: string;
  icon: ReactNode;
  colCodice: boolean;
  colQtaLabel: string;
  colCostoLabel: string;
  righe: PreventivoRigaRaw[];
}) {
  const somma = righe.reduce((s, r) => {
    const qty = toNum(r.quantita) ?? 0;
    const pu = toNum(r.prezzo_unitario) ?? 0;
    return s + (toNum(r.totale_riga) ?? qty * pu);
  }, 0);
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-semibold text-text uppercase tracking-wide">{titolo}</span>
        <span className="text-xs text-text-muted">({righe.length} voci)</span>
        <span className="ml-auto text-xs font-medium text-text">{fmtEuro(somma)}</span>
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-page">
            <tr className="text-left text-[10px] uppercase tracking-wide text-text-muted">
              {colCodice && <th className="px-3 py-2 font-medium">Codice</th>}
              <th className="px-3 py-2 font-medium">Descrizione</th>
              <th className="px-3 py-2 font-medium text-right">{colQtaLabel}</th>
              <th className="px-3 py-2 font-medium text-right">{colCostoLabel}</th>
              <th className="px-3 py-2 font-medium text-right">Coeff.</th>
              <th className="px-3 py-2 font-medium text-right">Prezzo vendita</th>
            </tr>
          </thead>
          <tbody>
            {righe.map((r) => {
              const qty = toNum(r.quantita) ?? 0;
              const pu = toNum(r.prezzo_unitario) ?? 0;
              const coeff = toNum(r.ricarico_coefficiente) ?? toNum(r.ricarico_pct);
              const vendita = toNum(r.totale_riga) ?? qty * pu;
              return (
                <tr key={r.id} className="border-t border-border hover:bg-bg-page/50">
                  {colCodice && (
                    <td className="px-3 py-1.5 font-mono text-xs text-[#00a1be]">{r.codice_articolo ?? "—"}</td>
                  )}
                  <td className="px-3 py-1.5 text-text">{r.descrizione}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(r.quantita, 3)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtEuro(r.prezzo_unitario)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">
                    {coeff != null ? coeff.toFixed(2) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmtEuro(vendita)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-text-muted">{label}</div>
      <div className="text-lg font-semibold text-text">{value}</div>
    </div>
  );
}

function WordChunkCard({
  chunk,
  onOpenDocumento,
}: {
  chunk: PreventivoChunkRaw;
  onOpenDocumento?: () => void;
}) {
  const isNote = chunk.metadata?.ruolo_file === "note_preventivo";
  return (
    <div className="border border-border rounded-xl bg-bg p-4 space-y-2">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        {isNote ? (
          <>
            <Sparkles className="w-3.5 h-3.5" />
            <span className="font-medium">Note / appunti</span>
          </>
        ) : (
          <>
            <FileText className="w-3.5 h-3.5" />
            <span className="font-medium">Preventivo commerciale</span>
          </>
        )}
        {!isNote && onOpenDocumento && (
          <Button
            onClick={onOpenDocumento}
            variant="ghost"
            size="sm"
            className="h-7 px-2 ml-2 text-xs gap-1 text-[#007a91] hover:bg-[#00a1be]/10"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Apri documento
          </Button>
        )}
        {chunk.metadata?.embedding_provider && (
          <span className="ml-auto text-[10px] text-text-muted/70">
            via {chunk.metadata.embedding_provider}
          </span>
        )}
      </div>
      <p className="text-sm text-text leading-relaxed whitespace-pre-wrap line-clamp-4">
        {chunk.contenuto}
      </p>
      {!isNote && (
        <p className="text-[11px] text-text-muted italic">
          Anteprima compatta — clicca &quot;Apri documento&quot; per la versione formattata.
        </p>
      )}
    </div>
  );
}

function BloccoExcelCard({
  chunk,
  indice,
  righe,
}: {
  chunk: PreventivoChunkRaw;
  indice: number;
  righe: PreventivoRigaRaw[];
}) {
  const meta = chunk.metadata ?? {};
  const titolo =
    meta.titolo_voce ||
    meta.codice_blocco ||
    (meta.sheet_name && meta.sheet_name !== "---" ? meta.sheet_name : null) ||
    `Blocco ${indice + 1}`;
  const totals = meta.totals ?? {};
  const totalsView = buildTotalsView(totals);
  const lavorazioni = meta.lavorazioni ?? [];

  // Coefficiente di ricarico "del blocco" (fallback per le righe senza ricarico per riga)
  const ricaricoBloccoRaw = (totals as Record<string, { coefficiente_raw?: number } | undefined>)
    ?.ricarico_materiale?.coefficiente_raw;
  const ricaricoBlocco = typeof ricaricoBloccoRaw === "number" ? ricaricoBloccoRaw : null;

  // Calcoli per riga (puro + con ricarico)
  type RigaCalc = {
    raw: PreventivoRigaRaw;
    costoPuro: number | null;        // qty × prezzo_unit
    ricaricoCoeff: number | null;    // coefficiente normalizzato 0-1
    totaleConRicarico: number | null;
  };
  const righeCalc: RigaCalc[] = righe.map((r) => {
    const qty = toNum(r.quantita);
    const pu = toNum(r.prezzo_unitario);
    // Preferisci totale_riga del DB se popolato (è qty × prezzo già calcolato da Excel),
    // altrimenti ricalcola.
    const dbTot = toNum(r.totale_riga);
    const costoPuro = dbTot != null ? dbTot : qty != null && pu != null ? qty * pu : null;

    // Coefficiente ricarico: preferisci quello della riga, altrimenti quello del blocco.
    // Il coefficiente SICS è un numero in [0,1] che rappresenta la frazione del costo
    // nel prezzo di vendita. Es: coeff 0.5 → prezzo = costo × 2; coeff 0.65 → prezzo = costo × 1.538.
    let coeff: number | null = null;
    const rigaRic = toNum(r.ricarico_pct);
    if (rigaRic != null && rigaRic > 0) {
      coeff = rigaRic;
    } else if (ricaricoBlocco != null && ricaricoBlocco > 0) {
      coeff = ricaricoBlocco;
    }

    let totaleConRicarico: number | null = null;
    if (costoPuro != null) {
      if (coeff != null && coeff > 0 && coeff <= 1) {
        // Convenzione SICS: prezzo_vendita = costo_puro / coefficiente
        totaleConRicarico = costoPuro / coeff;
      } else {
        totaleConRicarico = costoPuro;
      }
    }
    return { raw: r, costoPuro, ricaricoCoeff: coeff, totaleConRicarico };
  });

  const sommaArticoli = righeCalc.reduce((s, r) => s + (r.totaleConRicarico ?? 0), 0);
  const haRicarico = righeCalc.some((r) => r.ricaricoCoeff != null);

  // Scegli il valore "best" da mostrare in header
  const headerPrice = (() => {
    if (totalsView.prezzo_finale != null && !totalsView.prezzo_finale_implausible) {
      return { label: "Prezzo finale", value: totalsView.prezzo_finale };
    }
    if (totalsView.totale != null) {
      return { label: "Totale", value: totalsView.totale };
    }
    if (totalsView.totale_costi != null) {
      return { label: "Totale costi", value: totalsView.totale_costi };
    }
    return null;
  })();

  return (
    <div className="border border-border rounded-xl bg-bg p-5 space-y-4">
      {/* Header blocco */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-text-muted">Blocco {indice + 1}</div>
          <h3 className="text-base font-medium text-text">{titolo}</h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {meta.codice_blocco && meta.codice_blocco !== titolo && (
              <span className="text-[11px] font-mono text-text-muted">{meta.codice_blocco}</span>
            )}
            {meta.sheet_name && meta.sheet_name !== "---" && meta.sheet_name !== titolo && (
              <span className="text-[11px] text-text-muted">foglio: {meta.sheet_name}</span>
            )}
            {meta.tipo_prodotto && meta.tipo_prodotto !== "altro" && (
              <span className="text-[11px] text-text-muted px-1.5 py-0.5 rounded-full bg-bg-page border border-border">
                {meta.tipo_prodotto}
              </span>
            )}
            {meta.ingest_mode && meta.ingest_mode !== "standard" && (
              <span className="text-[10px] text-yellow-700 bg-yellow-50 border border-yellow-200 px-1.5 py-0.5 rounded-full">
                {meta.ingest_mode}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          {headerPrice && (
            <>
              <div className="text-[10px] uppercase tracking-wide text-text-muted">
                {headerPrice.label}
              </div>
              <div className="text-lg font-bold" style={{ color: "#00a1be" }}>
                {fmtEuro(headerPrice.value)}
              </div>
              {totalsView.prezzo_finale_implausible && (
                <div className="text-[10px] text-yellow-700 mt-0.5">
                  prezzo finale Excel anomalo
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Articoli */}
      {righe.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-text uppercase tracking-wide">
              Distinta materiali
            </span>
            <span className="text-xs text-text-muted">({righe.length} voci)</span>
            {haRicarico && (
              <span className="text-[10px] text-text-muted">
                · totali con ricarico applicato
              </span>
            )}
            <span className="ml-auto text-xs font-medium text-text">
              {fmtEuro(sommaArticoli)}
            </span>
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-page">
                <tr className="text-left text-[10px] uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-2 font-medium">Codice</th>
                  <th className="px-3 py-2 font-medium">Descrizione</th>
                  <th className="px-3 py-2 font-medium text-right">Qtà</th>
                  <th className="px-3 py-2 font-medium text-right">Costo unit.</th>
                  {haRicarico && (
                    <th className="px-3 py-2 font-medium text-right">Coeff. ricarico</th>
                  )}
                  <th className="px-3 py-2 font-medium text-right">
                    {haRicarico ? "Totale (con ricarico)" : "Totale riga"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {righeCalc.map(({ raw: r, ricaricoCoeff, totaleConRicarico }) => (
                  <tr key={r.id} className="border-t border-border hover:bg-bg-page/50">
                    <td className="px-3 py-1.5 font-mono text-xs text-[#00a1be]">
                      {r.codice_articolo ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-text">{r.descrizione}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(r.quantita, 3)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtEuro(r.prezzo_unitario)}</td>
                    {haRicarico && (
                      <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">
                        {ricaricoCoeff != null
                          ? new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(ricaricoCoeff)
                          : "—"}
                      </td>
                    )}
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                      {fmtEuro(totaleConRicarico)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lavorazioni */}
      {lavorazioni.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Hammer className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-xs font-semibold text-text uppercase tracking-wide">
              Lavorazioni e manodopera
            </span>
            <span className="text-xs text-text-muted">({lavorazioni.length} voci)</span>
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-page">
                <tr className="text-left text-[10px] uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-2 font-medium">Voce</th>
                  <th className="px-3 py-2 font-medium text-right">Ore</th>
                  <th className="px-3 py-2 font-medium text-right">Tariffa €/h</th>
                  <th className="px-3 py-2 font-medium text-right">Totale</th>
                </tr>
              </thead>
              <tbody>
                {lavorazioni.map((l: LavorazioneVoce, i) => (
                  <tr key={`${l.voce}-${i}`} className="border-t border-border hover:bg-bg-page/50">
                    <td className="px-3 py-1.5 text-text">{l.voce}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(l.ore, 1)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtEuro(l.tariffa_oraria)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                      {fmtEuro(l.totale_ceil_2 ?? l.totale_raw)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Totali del blocco */}
      {Object.keys(totals).length > 0 && (
        <div className="bg-bg-page rounded-lg p-3 border border-border">
          <div className="text-xs font-semibold text-text uppercase tracking-wide mb-2">Totali</div>
          <div className="space-y-1">
            {TOTAL_ORDER.map((key) => {
              const v = totals[key] as TotaleValore | undefined;
              if (!v || v.ceil_2 == null) return null;

              // Skip valori sospetti/ricalcolati: li mostriamo a parte sotto
              if (key === "margine_trattativa" && totalsView.margine_implausible) return null;
              if (key === "prezzo_finale" && totalsView.prezzo_finale_implausible) return null;

              const isFinale = key === "prezzo_finale" || key === "totale";
              const isMargine = key === "margine_trattativa";

              // Display margine: usa margine_pct normalizzato se disponibile
              const displayValue = isMargine
                ? (totalsView.margine_pct != null ? `${totalsView.margine_pct.toFixed(1)}%` : "—")
                : fmtEuro(v.ceil_2);

              return (
                <div
                  key={key}
                  className={`flex items-center justify-between text-sm ${isFinale ? "border-t border-border pt-2 mt-2 font-semibold" : ""}`}
                >
                  <span className={isFinale ? "text-text" : "text-text-muted"}>
                    {TOTAL_LABELS[key] ?? key}
                  </span>
                  <span className={`tabular-nums ${isFinale ? "text-[#00a1be]" : "text-text"}`}>
                    {displayValue}
                  </span>
                </div>
              );
            })}

            {/* Avvisi su valori anomali catturati dall'ingestion */}
            {totalsView.margine_implausible && (
              <div className="text-[11px] text-yellow-700 mt-1 italic">
                Margine trattativa nel foglio Excel non riconosciuto (cella ambigua).
              </div>
            )}
            {totalsView.prezzo_finale_implausible && totalsView.totale == null && (
              <div className="text-[11px] text-yellow-700 mt-1 italic">
                Prezzo finale nel foglio Excel anomalo.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
