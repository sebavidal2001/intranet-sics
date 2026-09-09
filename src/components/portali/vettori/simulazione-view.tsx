"use client";

import { useState } from "react";
import { Calculator, Info, Package, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Pagina di simulazione: quanto costa spedire questo collo, con chi.
 *
 * Non crea niente e non impegna niente — è una domanda. Mostra però anche i
 * vettori che NON possono farla, con il motivo: farli sparire dall'elenco è il
 * modo migliore per far credere che non siano stati considerati.
 */

interface VoceCalcolo {
  codice: string;
  descrizione: string;
  importo: number;
}

interface Calcolo {
  pesoReale: number;
  pesoVolumetrico: number;
  pesoTassabile: number;
  pesoApplicato: "reale" | "volumetrico" | "minimo";
  nolo: number;
  fasciaDescrizione: string;
  supplementi: VoceCalcolo[];
  imponibileNolo: number;
  adeguamento: number;
  carburante: number;
  fuoriBase: number;
  totale: number;
  avvertenze: string[];
}

interface Risultato {
  vettoreId: string;
  vettoreCodice: string;
  vettoreNome: string;
  disponibile: boolean;
  motivoIndisponibilita?: string;
  listino?: { etichetta: string; validoDal: string; validoAl: string | null } | null;
  calcolo?: Calcolo;
  differenzaDalMigliore?: number;
}

const CONDIZIONI: Array<{ slug: string; etichetta: string }> = [
  { slug: "bancale", etichetta: "Su bancale" },
  { slug: "non_sovrapponibile", etichetta: "Non sovrapponibile" },
  { slug: "oversized", etichetta: "Fuori sagoma" },
  { slug: "ztl", etichetta: "Zona a traffico limitato" },
  { slug: "fuori_provincia", etichetta: "Fuori provincia" },
  { slug: "movimentazione_manuale", etichetta: "Movimentazione manuale" },
];

const eur = (n: number) =>
  n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const kg = (n: number) =>
  `${n.toLocaleString("it-IT", { maximumFractionDigits: 2 })} kg`;

export function SimulazioneView() {
  const [colli, setColli] = useState("1");
  const [peso, setPeso] = useState("");
  const [lung, setLung] = useState("");
  const [larg, setLarg] = useState("");
  const [alt, setAlt] = useState("");
  const [provincia, setProvincia] = useState("");
  const [condizioni, setCondizioni] = useState<string[]>([]);
  const [risultati, setRisultati] = useState<Risultato[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const num = (v: string) => {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  function toggleCondizione(slug: string) {
    setCondizioni((c) =>
      c.includes(slug) ? c.filter((x) => x !== slug) : [...c, slug]
    );
  }

  async function simula(e: React.FormEvent) {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      const res = await fetch("/api/portali/vettori/simula", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colli: Math.max(1, Math.round(num(colli))),
          pesoKg: num(peso),
          lunghezzaCm: lung ? num(lung) : null,
          larghezzaCm: larg ? num(larg) : null,
          altezzaCm: alt ? num(alt) : null,
          provincia: provincia.trim() ? provincia.trim().toUpperCase() : null,
          condizioni,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrore(body.error ?? "Errore nella simulazione");
        setRisultati(null);
        return;
      }
      setRisultati(body.risultati as Risultato[]);
    } catch {
      setErrore("Non è stato possibile contattare il server.");
      setRisultati(null);
    } finally {
      setInCorso(false);
    }
  }

  const disponibili = (risultati ?? []).filter((r) => r.disponibile);
  const esclusi = (risultati ?? []).filter((r) => !r.disponibile);

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="font-tenorite text-2xl font-bold text-text">
          Simulazione spedizione
        </h1>
        <p className="text-sm text-text-muted mt-1 max-w-2xl">
          Quanto costa spedire questo collo, oggi, con ciascun vettore. Il calcolo
          usa i listini in vigore, i supplementi contrattuali e il carburante del
          mese &mdash; le stesse regole con cui poi si controlla la fattura.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] items-start">
        {/* ---------------- form ---------------- */}
        <form
          onSubmit={simula}
          className="bg-bg border border-border rounded-xl p-5 space-y-4 lg:sticky lg:top-4"
        >
          <div className="flex items-center gap-2 text-text">
            <Package className="w-4 h-4 text-primary" />
            <h2 className="font-tenorite font-bold text-sm">Il collo</h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="colli">Colli</Label>
              <Input
                id="colli"
                inputMode="numeric"
                value={colli}
                onChange={(e) => setColli(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="peso">Peso (kg)</Label>
              <Input
                id="peso"
                inputMode="decimal"
                placeholder="es. 12,5"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Misure di un collo in centimetri (colli uguali)</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input
                aria-label="Lunghezza in centimetri"
                inputMode="decimal"
                placeholder="L"
                value={lung}
                onChange={(e) => setLung(e.target.value)}
              />
              <Input
                aria-label="Larghezza in centimetri"
                inputMode="decimal"
                placeholder="P"
                value={larg}
                onChange={(e) => setLarg(e.target.value)}
              />
              <Input
                aria-label="Altezza in centimetri"
                inputMode="decimal"
                placeholder="H"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
              />
            </div>
            <p className="text-[11px] text-text-muted leading-snug">
              Servono a calcolare il peso volumetrico. Ogni vettore usa il suo
              rapporto: senza misure si confronta solo il peso reale.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provincia">Provincia di destinazione</Label>
            <Input
              id="provincia"
              maxLength={2}
              placeholder="es. MI"
              className="uppercase"
              value={provincia}
              onChange={(e) => setProvincia(e.target.value.toUpperCase())}
            />
          </div>

          <div className="space-y-2">
            <Label>Condizioni particolari</Label>
            <div className="flex flex-wrap gap-1.5">
              {CONDIZIONI.map((c) => {
                const attiva = condizioni.includes(c.slug);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => toggleCondizione(c.slug)}
                    aria-pressed={attiva}
                    className="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
                    style={{
                      borderColor: attiva ? "#00a1be" : "var(--color-border)",
                      background: attiva ? "rgba(0,161,190,0.10)" : "transparent",
                      color: attiva ? "#007a91" : "var(--color-text-muted)",
                    }}
                  >
                    {c.etichetta}
                  </button>
                );
              })}
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={inCorso}>
            <Calculator className="w-4 h-4 mr-2" />
            {inCorso ? "Calcolo in corso…" : "Confronta i vettori"}
          </Button>

          {errore && (
            <p className="text-xs text-danger flex items-start gap-1.5">
              <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {errore}
            </p>
          )}
        </form>

        {/* ---------------- risultati ---------------- */}
        <div className="space-y-3">
          {risultati === null && (
            <div className="bg-bg border border-border border-dashed rounded-xl p-10 text-center">
              <Calculator className="w-8 h-8 text-border mx-auto mb-3" />
              <p className="text-sm text-text-muted">
                Inserisci peso e destinazione: il confronto compare qui.
              </p>
            </div>
          )}

          {disponibili.map((r, i) => {
            const c = r.calcolo!;
            const migliore = i === 0;
            return (
              <article
                key={r.vettoreId}
                className="bg-bg border rounded-xl overflow-hidden"
                style={{
                  borderColor: migliore ? "#00a1be" : "var(--color-border)",
                  boxShadow: migliore ? "0 4px 16px rgba(0,161,190,0.10)" : undefined,
                }}
              >
                <div className="flex items-baseline justify-between gap-4 px-5 py-3.5 border-b border-border">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-tenorite font-bold text-text">
                        {r.vettoreNome}
                      </h3>
                      {migliore && (
                        <span
                          className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded"
                          style={{ background: "rgba(0,161,190,0.12)", color: "#007a91" }}
                        >
                          più conveniente
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-muted mt-0.5 truncate">
                      {r.listino?.etichetta} &middot; {c.fasciaDescrizione}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-tenorite text-xl font-bold text-text tabular-nums">
                      {eur(c.totale)}
                    </p>
                    {!migliore && r.differenzaDalMigliore ? (
                      <p className="text-[11px] text-danger tabular-nums">
                        +{eur(r.differenzaDalMigliore)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="px-5 py-3 grid gap-x-6 gap-y-1 sm:grid-cols-2 text-[13px]">
                  <Riga
                    etichetta={`Nolo · peso ${
                      c.pesoApplicato === "volumetrico"
                        ? "volumetrico"
                        : c.pesoApplicato === "minimo"
                        ? "minimo tassabile"
                        : "reale"
                    } ${kg(c.pesoTassabile)}`}
                    valore={c.nolo}
                  />
                  {c.supplementi.map((s) => (
                    <Riga key={s.codice} etichetta={s.descrizione} valore={s.importo} />
                  ))}
                  {c.adeguamento > 0 && (
                    <Riga etichetta="Adeguamento contrattuale" valore={c.adeguamento} />
                  )}
                  {c.carburante > 0 && (
                    <Riga etichetta="Supplemento carburante" valore={c.carburante} />
                  )}
                </div>

                {(c.pesoVolumetrico > 0 || c.avvertenze.length > 0) && (
                  <div className="px-5 pb-3 space-y-1">
                    {c.pesoVolumetrico > 0 && (
                      <p className="text-[11px] text-text-muted">
                        Peso reale {kg(c.pesoReale)} · volumetrico{" "}
                        {kg(c.pesoVolumetrico)} · fa prezzo{" "}
                        <strong>{kg(c.pesoTassabile)}</strong>
                      </p>
                    )}
                    {c.avvertenze.map((a) => (
                      <p
                        key={a}
                        className="text-[11px] text-warning flex items-start gap-1.5"
                      >
                        <Info className="w-3 h-3 shrink-0 mt-0.5" />
                        {a}
                      </p>
                    ))}
                  </div>
                )}
              </article>
            );
          })}

          {esclusi.length > 0 && (
            <div className="bg-bg-page border border-border rounded-xl p-4">
              <h3 className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">
                Non possono farla
              </h3>
              <ul className="space-y-1.5">
                {esclusi.map((r) => (
                  <li key={r.vettoreId} className="text-[13px] text-text-muted">
                    <span className="font-medium text-text">{r.vettoreNome}</span>
                    {" — "}
                    {r.motivoIndisponibilita}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {risultati !== null && (
            <p className="text-[11px] text-text-muted leading-relaxed pt-1">
              I tempi di consegna non compaiono perché nessun vettore li ha dichiarati
              per iscritto e il gestionale non registra la data di consegna effettiva.
              Finché quel dato non c&rsquo;è, la simulazione risponde alla domanda del
              costo, non a quella dell&rsquo;urgenza.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Riga({ etichetta, valore }: { etichetta: string; valore: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-0.5">
      <span className="text-text-muted truncate">{etichetta}</span>
      <span className="tabular-nums text-text shrink-0">{eur(valore)}</span>
    </div>
  );
}
