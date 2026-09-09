"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, Loader2, PackageSearch, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Rilevazione } from "@/lib/portali/vettori/letture";

/**
 * Registrazione degli arrivi a magazzino.
 *
 * Non è un complemento del gestionale: **è l'unica fonte dei dati fisici degli
 * arrivi**. Sui 1.937 carichi da fornitore del 2026 il gestionale ha i colli 8
 * volte, il peso lordo 5, il volume mai. Senza questa schermata non c'è modo di
 * verificare un peso volumetrico addebitato da un vettore.
 *
 * Il modulo è pensato per un banco: pochi campi, tutti raggiungibili col
 * tabulatore, e resta compilato con fornitore e data dopo il salvataggio —
 * chi scarica un camion registra cinque colli di fila, non uno.
 */

interface Props {
  iniziali: Rilevazione[];
}

const CONDIZIONI = [
  { slug: "bancale", nome: "Su bancale" },
  { slug: "non_sovrapponibile", nome: "Non sovrapponibile" },
  { slug: "oversized", nome: "Fuori sagoma" },
  { slug: "ztl", nome: "Zona a traffico limitato" },
  { slug: "movimentazione_manuale", nome: "Movimentazione manuale" },
] as const;

const oggiISO = () => new Date().toISOString().slice(0, 10);

const numero = (v: string): number | null => {
  const n = Number(v.replace(",", "."));
  return v.trim() === "" || Number.isNaN(n) ? null : n;
};

export function ArriviView({ iniziali }: Props) {
  const [rilevazioni, setRilevazioni] = useState(iniziali);
  const [fornitore, setFornitore] = useState("");
  const [numeroBolla, setNumeroBolla] = useState("");
  const [data, setData] = useState(oggiISO());
  const [colli, setColli] = useState("1");
  const [peso, setPeso] = useState("");
  const [lung, setLung] = useState("");
  const [larg, setLarg] = useState("");
  const [alt, setAlt] = useState("");
  const [condizioni, setCondizioni] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [salvato, setSalvato] = useState<string | null>(null);

  /**
   * Il volume si mostra mentre si digita, perché è il numero su cui si discute
   * col vettore: 1 mc addebitato come 300 kg fa la differenza fra un addebito
   * normale e uno da contestare.
   */
  const volume = useMemo(() => {
    const l = numero(lung);
    const p = numero(larg);
    const h = numero(alt);
    if (l == null || p == null || h == null || l * p * h === 0) return null;
    const mc = (l * p * h) / 1_000_000;
    const c = numero(colli) ?? 1;
    return { mc: mc * c, a300: mc * c * 300, a250: mc * c * 250 };
  }, [lung, larg, alt, colli]);

  const salva = useCallback(async () => {
    setErrore(null);
    setSalvato(null);
    if (fornitore.trim().length === 0) {
      setErrore("Indicare il fornitore.");
      return;
    }
    setInCorso(true);
    try {
      const res = await fetch("/api/portali/vettori/arrivi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fornitore: fornitore.trim(),
          numeroBolla: numeroBolla.trim() || null,
          dataArrivo: data,
          colli: Math.max(1, Math.round(numero(colli) ?? 1)),
          pesoKg: numero(peso),
          lunghezzaCm: numero(lung),
          larghezzaCm: numero(larg),
          altezzaCm: numero(alt),
          condizioni,
          note: note.trim() || null,
        }),
      });
      const dati = await res.json();
      if (!res.ok) {
        setErrore(dati.error ?? "Non è stato possibile registrare l'arrivo.");
        return;
      }
      setRilevazioni(dati.rilevazioni as Rilevazione[]);
      setSalvato(`Registrato: ${fornitore.trim()}${numeroBolla ? ` · ${numeroBolla}` : ""}`);
      // Fornitore e data restano: chi scarica un camion registra più colli.
      setNumeroBolla("");
      setColli("1");
      setPeso("");
      setLung("");
      setLarg("");
      setAlt("");
      setCondizioni([]);
      setNote("");
    } catch {
      setErrore("Non è stato possibile contattare il server.");
    } finally {
      setInCorso(false);
    }
  }, [fornitore, numeroBolla, data, colli, peso, lung, larg, alt, condizioni, note]);

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-5">
        <h1 className="font-tenorite text-2xl font-bold text-text">Arrivi</h1>
        <p className="text-sm text-text-muted mt-1 max-w-2xl">
          Peso, colli e misure della merce che arriva. Il gestionale questi dati
          non li ha — sui carichi da fornitore i colli ci sono 8 volte su 1.937 —
          quindi è da qui che passa la verifica dei pesi volumetrici addebitati.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px] items-start">
        {/* ------------------------------ modulo ----------------------------- */}
        <section className="rounded-xl border border-border bg-bg p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etichetta="Fornitore" larga>
              <input
                value={fornitore}
                onChange={(e) => setFornitore(e.target.value)}
                placeholder="Ragione sociale come sulla bolla"
                className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text"
              />
            </Campo>
            <Campo etichetta="Numero bolla del fornitore">
              <input
                value={numeroBolla}
                onChange={(e) => setNumeroBolla(e.target.value)}
                placeholder="es. 2026/004512"
                className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text font-mono"
              />
            </Campo>
            <Campo etichetta="Data di arrivo">
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text"
              />
            </Campo>
            <Campo etichetta="Colli">
              <input
                inputMode="numeric"
                value={colli}
                onChange={(e) => setColli(e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text tabular-nums"
              />
            </Campo>
            <Campo etichetta="Peso (kg)">
              <input
                inputMode="decimal"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                placeholder="es. 42,5"
                className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text tabular-nums"
              />
            </Campo>
          </div>

          <div className="mt-4">
            <p className="text-xs text-text-muted mb-1 font-medium">
              Misure di un collo in centimetri (colli uguali)
            </p>
            <div className="grid grid-cols-3 gap-2">
              <input
                inputMode="decimal"
                value={lung}
                onChange={(e) => setLung(e.target.value)}
                placeholder="L"
                aria-label="Lunghezza in centimetri"
                className="h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text tabular-nums"
              />
              <input
                inputMode="decimal"
                value={larg}
                onChange={(e) => setLarg(e.target.value)}
                placeholder="P"
                aria-label="Larghezza in centimetri"
                className="h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text tabular-nums"
              />
              <input
                inputMode="decimal"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                placeholder="H"
                aria-label="Altezza in centimetri"
                className="h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text tabular-nums"
              />
            </div>
            {volume ? (
              <p className="text-[11px] text-text-muted mt-1.5 leading-snug">
                {volume.mc.toLocaleString("it-IT", { maximumFractionDigits: 3 })} mc ·
                pesa {Math.round(volume.a300)} kg per GLS e Trading Post,{" "}
                {Math.round(volume.a250)} kg per TNT e FedEx.
              </p>
            ) : (
              <p className="text-[11px] text-text-muted mt-1.5">
                Senza misure il peso volumetrico non è verificabile: se il vettore
                lo addebita, non c&apos;è modo di contestarlo.
              </p>
            )}
          </div>

          <div className="mt-4">
            <p className="text-xs text-text-muted mb-1.5 font-medium">
              Condizioni particolari
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CONDIZIONI.map((c) => {
                const attiva = condizioni.includes(c.slug);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() =>
                      setCondizioni((v) =>
                        attiva ? v.filter((x) => x !== c.slug) : [...v, c.slug]
                      )
                    }
                    className="text-xs px-2.5 py-1 rounded-lg border transition-colors"
                    style={{
                      borderColor: attiva ? "#00a1be" : "var(--color-border)",
                      background: attiva ? "rgba(0,161,190,0.10)" : "var(--color-bg)",
                      color: attiva ? "#007a91" : "var(--color-text-muted)",
                    }}
                  >
                    {c.nome}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            <Campo etichetta="Note" larga>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Es. imballo danneggiato, mancano 2 colli"
                className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text"
              />
            </Campo>
          </div>

          {errore && (
            <div
              className="mt-4 rounded-lg border p-3 flex items-start gap-2.5"
              style={{
                borderColor: "var(--color-danger)",
                background: "rgba(239,68,68,0.05)",
              }}
            >
              <TriangleAlert className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <p className="text-sm text-text">{errore}</p>
            </div>
          )}

          {salvato && (
            <div
              className="mt-4 rounded-lg border p-3 flex items-start gap-2.5"
              style={{
                borderColor: "var(--color-success)",
                background: "rgba(34,197,94,0.06)",
              }}
            >
              <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
              <p className="text-sm text-text">{salvato}</p>
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <Button type="button" onClick={() => void salva()} disabled={inCorso}>
              {inCorso ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Registra l&apos;arrivo
            </Button>
          </div>
        </section>

        {/* --------------------------- ultimi arrivi ------------------------- */}
        <section className="rounded-xl border border-border bg-bg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <PackageSearch className="w-4 h-4 text-primary" />
            <h2 className="font-tenorite font-bold text-sm text-text">Ultimi 30 giorni</h2>
          </div>
          {rilevazioni.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-text-muted">
              Ancora nessun arrivo registrato.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 max-h-[520px] overflow-auto">
              {rilevazioni.map((r) => (
                <li key={r.id} className="px-4 py-2.5">
                  <p className="text-sm text-text truncate" title={r.fornitore_testo ?? ""}>
                    {r.fornitore_testo ?? "senza fornitore"}
                  </p>
                  <p className="text-[11px] text-text-muted tabular-nums">
                    {r.data_arrivo} · {r.colli} colli
                    {r.peso_kg != null ? ` · ${r.peso_kg} kg` : ""}
                    {r.lunghezza_cm && r.larghezza_cm && r.altezza_cm
                      ? ` · ${r.lunghezza_cm}×${r.larghezza_cm}×${r.altezza_cm}`
                      : ""}
                  </p>
                  {r.numero_bolla && (
                    <p className="text-[11px] text-text-muted font-mono">{r.numero_bolla}</p>
                  )}
                  {r.condizioni.length > 0 && (
                    <p className="text-[10px] text-text-muted mt-0.5">
                      {r.condizioni.join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Campo({
  etichetta,
  larga,
  children,
}: {
  etichetta: string;
  larga?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-xs ${larga ? "sm:col-span-2" : ""}`}>
      <span className="block text-text-muted mb-1 font-medium">{etichetta}</span>
      {children}
    </label>
  );
}
