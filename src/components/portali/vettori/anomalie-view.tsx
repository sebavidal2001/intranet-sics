"use client";

import { useCallback, useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Mail,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnomaliaElenco } from "@/lib/portali/vettori/letture";

/**
 * Le anomalie da decidere.
 *
 * La pagina è organizzata attorno a una domanda sola: **cosa devo guardare
 * adesso**. Per questo si apre sulle aperte e non su tutto lo storico, e per
 * questo ogni riga porta con sé il motivo per cui è lì — fatturato, atteso,
 * scarto, listino applicato — invece di rimandare a un dettaglio.
 *
 * Chiudere un'anomalia richiede una motivazione. Non è burocrazia: una riga
 * chiusa senza spiegazione, riletta a fine anno, non è una decisione presa.
 */

interface Props {
  iniziali: AnomaliaElenco[];
  vettori: Array<{ codice: string; nome: string }>;
  puoDecidere: boolean;
}

const ETICHETTA_TIPO: Record<string, string> = {
  importo_oltre_soglia: "Importo oltre soglia",
  peso_diverso_da_bolla: "Peso diverso dalla bolla",
  volumetrico_non_giustificato: "Volumetrico non giustificato",
  supplemento_non_previsto: "Supplemento non previsto",
  carburante_diverso: "Carburante diverso",
  fattura_senza_bolla: "Fatturata senza bolla",
  bolla_senza_addebito: "Bolla senza addebito",
  riaddebito_mancante: "Riaddebito mancante",
  riaddebito_diverso: "Riaddebito diverso dalla tabella",
};

const ETICHETTA_STATO: Record<string, string> = {
  aperta: "Da decidere",
  contestata: "Contestata al vettore",
  accettata: "Accettata",
  corretta: "Corretta",
};

const COLORE_GRAVITA: Record<string, string> = {
  anomalia: "var(--color-danger)",
  da_verificare: "var(--color-warning)",
  informativa: "var(--color-text-muted)",
};

const MESI = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

const eur = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

export function AnomalieView({ iniziali, vettori, puoDecidere }: Props) {
  const [anomalie, setAnomalie] = useState(iniziali);
  const [stato, setStato] = useState<string>("aperta");
  const [vettore, setVettore] = useState<string>("");
  const [direzione, setDirezione] = useState("");
  const [periodo, setPeriodo] = useState("");
  const [outlookUrl, setOutlookUrl] = useState("");
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [decidendo, setDecidendo] = useState<AnomaliaElenco | null>(null);
  const [bozza, setBozza] = useState<{
    oggetto: string;
    corpo: string;
    destinatari: string[];
    cc: string[];
    nomeFile: string;
    eml: string;
    quante: number;
  } | null>(null);

  const visibili = useMemo(
    () =>
      anomalie.filter(
        (a) =>
          (stato === "" || a.stato === stato) &&
          (vettore === "" || a.vettore_codice === vettore) &&
          (direzione === "" || a.direzione === direzione) &&
          (periodo === "" || `${a.anno}-${a.mese}` === periodo)
      ),
    [anomalie, stato, vettore, direzione, periodo]
  );

  const totali = useMemo(() => {
    const aperte = anomalie.filter((a) => a.stato === "aperta");
    return {
      aperte: aperte.length,
      contestato: aperte.reduce((s, a) => s + (a.importo_contestato ?? 0), 0),
      contestate: anomalie.filter((a) => a.stato === "contestata").length,
      chiuse: anomalie.filter(
        (a) => a.stato === "accettata" || a.stato === "corretta"
      ).length,
    };
  }, [anomalie]);

  const decidi = useCallback(
    async (id: string, nuovo: string, motivazione: string | null) => {
      setErrore(null);
      setInCorso(id);
      try {
        const res = await fetch("/api/portali/vettori/anomalie", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, stato: nuovo, motivazione }),
        });
        const dati = await res.json();
        if (!res.ok) {
          setErrore(dati.error ?? "Non è stato possibile salvare la decisione.");
          return;
        }
        setAnomalie(dati.anomalie as AnomaliaElenco[]);
        setDecidendo(null);
      } catch {
        setErrore("Non è stato possibile contattare il server.");
      } finally {
        setInCorso(null);
      }
    },
    []
  );

  /** Costruisce la bozza sul vettore e sul mese delle anomalie visibili. */
  const preparaBozza = useCallback(async () => {
    const selezionate = visibili.filter((a) => a.stato === "aperta" || a.stato === "contestata");
    const gruppi = new Set(selezionate.map((a) => `${a.vettore_codice}|${a.anno}|${a.mese}|${a.direzione}`));
    if (gruppi.size !== 1) { setErrore("Seleziona un solo vettore, mese e direzione per preparare una bozza separata."); return; }
    const conMese = selezionate.find((a) => a.anno && a.mese && a.vettore_codice);
    if (!conMese) {
      setErrore(
        "Per costruire la bozza serve almeno un'anomalia collegata a una fattura: filtra per vettore."
      );
      return;
    }
    setErrore(null);
    setOutlookUrl("");
    setInCorso("bozza");
    try {
      const res = await fetch("/api/portali/vettori/anomalie/bozza", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vettore: conMese.vettore_codice,
          anno: conMese.anno,
          mese: conMese.mese,
          ids: selezionate.map((a) => a.id),
          direzione: conMese.direzione || undefined,
        }),
      });
      const dati = await res.json();
      if (!res.ok) {
        setErrore(dati.error ?? "Non è stato possibile costruire la bozza.");
        return;
      }
      setBozza({ ...dati.bozza, quante: dati.quante });
    } catch {
      setErrore("Non è stato possibile contattare il server.");
    } finally {
      setInCorso(null);
    }
  }, [visibili]);

  const preparaOutlook = useCallback(async () => {
    if (!bozza) return;
    setErrore(null); setInCorso("outlook");
    try {
      const res = await fetch("/api/portali/vettori/outlook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oggetto: bozza.oggetto, corpo: bozza.corpo, destinatari: bozza.destinatari, cc: bozza.cc }) });
      const d = await res.json(); if (!res.ok) throw new Error(d.error);
      setOutlookUrl(d.url);
    } catch (e) { setErrore(e instanceof Error ? e.message : "Apertura Outlook non riuscita."); } finally { setInCorso(null); }
  }, [bozza]);

  const scarica = useCallback(() => {
    if (!bozza) return;
    const blob = new Blob([bozza.eml], { type: "message/rfc822" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = bozza.nomeFile;
    a.click();
    URL.revokeObjectURL(url);
  }, [bozza]);

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-5">
        <h1 className="font-tenorite text-2xl font-bold text-text">Anomalie</h1>
        <p className="text-sm text-text-muted mt-1 max-w-2xl">
          Quello che nelle fatture non torna, con accanto il motivo. Ogni riga si
          chiude con una decisione e una motivazione, così a fine anno si sa
          perché è stata chiusa.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5">
        <Tessera
          titolo="Da decidere"
          valore={String(totali.aperte)}
          nota={totali.aperte === 0 ? "niente in coda" : "in attesa di una scelta"}
          colore={totali.aperte > 0 ? "var(--color-danger)" : "var(--color-success)"}
        />
        <Tessera
          titolo="Importo in discussione"
          valore={eur(Math.round(totali.contestato * 100) / 100)}
          nota="somma delle anomalie aperte"
          colore="var(--color-warning)"
        />
        <Tessera
          titolo="Contestate al vettore"
          valore={String(totali.contestate)}
          nota="in attesa di risposta"
          colore="var(--color-primary)"
        />
        <Tessera
          titolo="Chiuse"
          valore={String(totali.chiuse)}
          nota="accettate o corrette"
          colore="var(--color-text-muted)"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-xs">
          <span className="block text-text-muted mb-1 font-medium">Stato</span>
          <select
            value={stato}
            onChange={(e) => setStato(e.target.value)}
            className="h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text"
          >
            <option value="aperta">Da decidere</option>
            <option value="contestata">Contestate</option>
            <option value="accettata">Accettate</option>
            <option value="corretta">Corrette</option>
            <option value="">Tutte</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-text-muted mb-1 font-medium">Vettore</span>
          <select
            value={vettore}
            onChange={(e) => setVettore(e.target.value)}
            className="h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text"
          >
            <option value="">Tutti</option>
            {vettori.map((v) => (
              <option key={v.codice} value={v.codice}>
                {v.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs"><span className="block text-text-muted mb-1 font-medium">Direzione</span><select className="h-9 rounded-lg border border-border bg-bg px-3 text-sm" value={direzione} onChange={(e) => setDirezione(e.target.value)}><option value="">Tutte</option><option value="entrata">Arrivi da fornitori</option><option value="uscita">Invii a clienti</option></select></label>
        <label className="text-xs"><span className="block text-text-muted mb-1 font-medium">Mese fattura</span><select className="h-9 rounded-lg border border-border bg-bg px-3 text-sm" value={periodo} onChange={(e) => setPeriodo(e.target.value)}><option value="">Tutti</option>{[...new Set(anomalie.filter((a) => a.anno && a.mese).map((a) => `${a.anno}-${a.mese}`))].sort().map((p) => <option key={p} value={p}>{MESI[Number(p.split("-")[1]) - 1]} {p.split("-")[0]}</option>)}</select></label>
        {puoDecidere && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void preparaBozza()}
            disabled={inCorso !== null || visibili.length === 0}
          >
            {inCorso === "bozza" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Mail className="w-4 h-4 mr-2" />
            )}
            Bozza di contestazione
          </Button>
        )}
      </div>

      {errore && (
        <div
          className="mb-4 rounded-lg border p-4 flex items-start gap-3"
          style={{ borderColor: "var(--color-danger)", background: "rgba(239,68,68,0.05)" }}
        >
          <TriangleAlert className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <p className="text-sm text-text">{errore}</p>
        </div>
      )}

      {visibili.length === 0 ? (
        <div className="rounded-xl border border-border bg-bg p-10 text-center">
          <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-3" />
          <p className="text-sm text-text font-medium">
            {anomalie.length === 0
              ? "Nessuna anomalia in archivio."
              : "Nessuna anomalia con questi filtri."}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {anomalie.length === 0
              ? "Compaiono qui dopo l'acquisizione di una fattura, una per ogni riga che non torna."
              : "Prova a cambiare stato o vettore."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibili.map((a) => (
            <article
              key={a.id}
              className="rounded-xl border border-border bg-bg px-4 py-3"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded"
                      style={{
                        color: COLORE_GRAVITA[a.gravita],
                        background: "var(--color-bg-page)",
                      }}
                    >
                      {ETICHETTA_TIPO[a.tipo] ?? a.tipo}
                    </span>
                    <span className="text-xs text-text-muted">
                      {a.vettore_nome ?? "vettore ignoto"}
                      {a.fattura_numero ? ` · fattura ${a.fattura_numero}` : ""}
                      {a.mese && a.anno ? ` · ${MESI[a.mese - 1]} ${a.anno}` : ""}
                    </span>
                    {a.stato !== "aperta" && (
                      <span className="text-[10px] uppercase tracking-wider text-text-muted">
                        {ETICHETTA_STATO[a.stato]}
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-text mt-1.5">{a.descrizione}</p>

                  <p className="text-xs text-text-muted mt-1">
                    {a.data_spedizione ?? "senza data"} ·{" "}
                    <span className="font-mono">{a.riferimento ?? "senza riferimento"}</span> ·{" "}
                    {a.controparte ?? "controparte ignota"}
                    {a.colli != null ? ` · ${a.colli} colli` : ""}
                    {a.peso_tassato != null || a.peso != null
                      ? ` · ${a.peso_tassato ?? a.peso} kg`
                      : ""}
                    {a.listino ? ` · ${a.listino}` : ""}
                    {a.zona ? ` · zona ${a.zona}` : ""}
                  </p>

                  {a.motivazione && (
                    <p className="text-xs mt-1.5 text-text-muted italic">
                      Motivazione: {a.motivazione}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className="font-tenorite text-lg font-bold tabular-nums text-text">
                    {eur(a.fatturato)}
                  </p>
                  <p className="text-[11px] text-text-muted tabular-nums">
                    atteso {eur(a.atteso)}
                  </p>
                  {a.scostamento != null && (
                    <p
                      className="text-[11px] font-medium tabular-nums"
                      style={{ color: COLORE_GRAVITA[a.gravita] }}
                    >
                      {pct(a.scostamento)}
                    </p>
                  )}
                </div>
              </div>

              {puoDecidere && (
                <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-border/60 flex-wrap">
                  {a.stato === "aperta" ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={inCorso !== null}
                        onClick={() => void decidi(a.id, "contestata", null)}
                      >
                        {inCorso === a.id ? (
                          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                        ) : null}
                        Segna come contestata
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={inCorso !== null}
                        onClick={() => setDecidendo(a)}
                      >
                        Accetta o correggi…
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={inCorso !== null}
                      onClick={() => void decidi(a.id, "aperta", null)}
                    >
                      <RotateCcw className="w-3 h-3 mr-1.5" />
                      Riapri
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {decidendo && (
        <Motivazione
          anomalia={decidendo}
          inCorso={inCorso === decidendo.id}
          onAnnulla={() => setDecidendo(null)}
          onConferma={(nuovo, motivazione) =>
            void decidi(decidendo.id, nuovo, motivazione)
          }
        />
      )}

      {bozza && (
        <AnteprimaBozza bozza={bozza} onChiudi={() => setBozza(null)} onScarica={scarica} onOutlook={() => void preparaOutlook()} outlookUrl={outlookUrl} busy={inCorso === "outlook"} errore={errore} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Motivazione({
  anomalia,
  inCorso,
  onAnnulla,
  onConferma,
}: {
  anomalia: AnomaliaElenco;
  inCorso: boolean;
  onAnnulla: () => void;
  onConferma: (stato: string, motivazione: string) => void;
}) {
  const [stato, setStato] = useState("accettata");
  const [testo, setTesto] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,32,0.45)" }}
      onClick={onAnnulla}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-bg border border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-tenorite font-bold text-text">Chiudi l&apos;anomalia</h2>
          <button
            type="button"
            onClick={onAnnulla}
            className="text-text-muted hover:text-text"
            aria-label="Chiudi"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-text-muted">{anomalia.descrizione}</p>

          <label className="block text-xs">
            <span className="block text-text-muted mb-1 font-medium">Esito</span>
            <select
              value={stato}
              onChange={(e) => setStato(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text"
            >
              <option value="accettata">
                Accettata — l&apos;addebito è corretto
              </option>
              <option value="corretta">
                Corretta — il vettore ha emesso una nota di credito
              </option>
            </select>
          </label>

          <label className="block text-xs">
            <span className="block text-text-muted mb-1 font-medium">
              Motivazione (obbligatoria)
            </span>
            <textarea
              value={testo}
              onChange={(e) => setTesto(e.target.value)}
              rows={3}
              placeholder="Es. supplemento ZTL corretto, la consegna era in centro a Bologna."
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text"
            />
          </label>
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onAnnulla}>
            Annulla
          </Button>
          <Button
            type="button"
            disabled={testo.trim().length === 0 || inCorso}
            onClick={() => onConferma(stato, testo.trim())}
          >
            {inCorso ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Salva la decisione
          </Button>
        </div>
      </div>
    </div>
  );
}

function AnteprimaBozza({
  bozza,
  onChiudi,
  onScarica,
  onOutlook, outlookUrl, busy, errore,
}: {
  bozza: {
    oggetto: string;
    corpo: string;
    destinatari: string[];
    cc: string[];
    nomeFile: string;
    quante: number;
  };
  onChiudi: () => void;
  onScarica: () => void;
  onOutlook: () => void;
  outlookUrl: string;
  busy: boolean;
  errore: string | null;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,32,0.45)" }}
      onClick={onChiudi}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-bg border border-border shadow-xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-tenorite font-bold text-text">Bozza di contestazione</h2>
            <p className="text-xs text-text-muted">
              {bozza.quante} spedizioni ·{" "}
              {bozza.destinatari.length
                ? bozza.destinatari.join(", ")
                : "nessun destinatario configurato"}
            </p>
          </div>
          <button
            type="button"
            onClick={onChiudi}
            className="text-text-muted hover:text-text"
            aria-label="Chiudi"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-auto">
          <p className="text-sm mb-3">Cc: {bozza.cc.join("; ") || "nessuno"}</p>
          {errore && <p role="alert" className="text-sm text-danger mb-3">{errore}</p>}
          <p className="text-xs text-text-muted font-medium mb-1">Oggetto</p>
          <p className="text-sm text-text mb-4">{bozza.oggetto}</p>
          <p className="text-xs text-text-muted font-medium mb-1">Testo</p>
          <pre className="text-[12px] text-text whitespace-pre-wrap font-sans leading-relaxed">
            {bozza.corpo}
          </pre>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-text-muted max-w-sm">
            Outlook apre la mail precompilata tramite il collegamento SICS installato sul PC.
            Rileggi e invia manualmente. Il file EML resta disponibile come alternativa.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onChiudi}>
              Chiudi
            </Button>
            <Button type="button" onClick={onScarica}>
              Scarica {bozza.nomeFile}
            </Button>
            {outlookUrl && <Button type="button" onClick={onOutlook} disabled={busy}>Rigenera collegamento</Button>}
            {outlookUrl ? <a href={outlookUrl} className="inline-flex items-center rounded-lg bg-primary px-3 py-2 text-sm text-white">Apri in Outlook</a> : <Button type="button" onClick={onOutlook} disabled={busy}>{busy ? "Preparazione…" : "Prepara apertura Outlook"}</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Tessera({
  titolo,
  valore,
  nota,
  colore,
}: {
  titolo: string;
  valore: string;
  nota: string;
  colore: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-text-muted font-semibold">
        {titolo}
      </p>
      <p
        className="font-tenorite text-2xl font-bold mt-1 tabular-nums"
        style={{ color: colore }}
      >
        {valore}
      </p>
      <p className="text-[11px] text-text-muted mt-0.5 leading-snug">{nota}</p>
    </div>
  );
}
