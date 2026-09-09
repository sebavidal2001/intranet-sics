"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Fuel, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ListinoRiepilogo } from "@/lib/portali/vettori/letture";
import { carburanteVigente } from "@/lib/portali/vettori/carburante";
import { ListinoEditor } from "./listino-editor";
import { MailImpostazioni } from "./mail-impostazioni";

/** Tariffe versionate e comunicazioni carburante con continuità temporale. */

interface Props {
  iniziali: ListinoRiepilogo[];
  anno: number;
  mese: number;
}

const MESI = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

const TIPO_CALCOLO: Record<string, string> = {
  fisso_spedizione: "importo fisso a spedizione",
  per_collo: "a collo",
  per_kg: "a chilogrammo",
  percentuale_nolo: "percentuale sul nolo",
};

const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${(n * 100).toLocaleString("it-IT", { maximumFractionDigits: 3 })}%`;

export function ListiniView({ iniziali, anno, mese }: Props) {
  const [listini, setListini] = useState(iniziali);
  useEffect(() => setListini(iniziali), [iniziali]);
  const [errore, setErrore] = useState<string | null>(null);
  const [salvato, setSalvato] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [meseScelto, setMeseScelto] = useState(mese);
  const [annoScelto, setAnnoScelto] = useState(anno);
  const [valori, setValori] = useState<Record<string, string>>({});

  const salva = useCallback(
    async (codice: string) => {
      const grezzo = (valori[codice] ?? "").replace(",", ".").trim();
      const n = Number(grezzo);
      if (grezzo === "" || Number.isNaN(n) || n < 0 || n > 100) {
        setErrore("La percentuale deve essere un numero fra 0 e 100.");
        return;
      }
      setErrore(null);
      setSalvato(null);
      setInCorso(codice);
      try {
        const res = await fetch("/api/portali/vettori/carburante", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vettore: codice,
            anno: annoScelto,
            mese: meseScelto,
            percentuale: n,
            fonte: "comunicazione",
          }),
        });
        const dati = await res.json();
        if (!res.ok) {
          setErrore(dati.error ?? "Non è stato possibile salvare la percentuale.");
          return;
        }
        setListini(dati.listini as ListinoRiepilogo[]);
        setValori((v) => ({ ...v, [codice]: "" }));
        setSalvato(
          `Carburante ${MESI[meseScelto - 1]} ${annoScelto} salvato: ${n.toLocaleString("it-IT")}%.`
        );
      } catch {
        setErrore("Non è stato possibile contattare il server.");
      } finally {
        setInCorso(null);
      }
    },
    [valori, annoScelto, meseScelto]
  );

  const nostri = listini.filter((l) => l.vettore.a_nostro_carico && l.vettore.attivo);
  const altri = listini.filter((l) => !l.vettore.a_nostro_carico || !l.vettore.attivo);

  const mancanti = nostri.filter(
    (l) => l.vettore.codice !== "trading_post" && !carburanteVigente(l.carburante, annoScelto, meseScelto)
  );

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-5">
        <h1 className="font-tenorite text-2xl font-bold text-text">Listini</h1>
        <p className="text-sm text-text-muted mt-1 max-w-2xl">
          Configura tariffe e supplementi con una data di decorrenza.
          Il carburante mantiene l’ultima percentuale inserita fino alla nuova comunicazione,
          anche nei mesi successivi. I controlli già acquisiti conservano i valori applicati.
        </p>
      </header>

      {/* ---------------------------- carburante ---------------------------- */}
      <section className="rounded-xl border border-border bg-bg overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
          <Fuel className="w-4 h-4 text-primary" />
          <h2 className="font-tenorite font-bold text-sm text-text flex-1">
            Percentuale carburante del mese
          </h2>
          <select
            value={meseScelto}
            onChange={(e) => setMeseScelto(Number(e.target.value))}
            className="h-8 rounded-lg border border-border bg-bg px-2 text-xs text-text"
            aria-label="Mese"
          >
            {MESI.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={annoScelto}
            onChange={(e) => setAnnoScelto(Number(e.target.value))}
            className="h-8 rounded-lg border border-border bg-bg px-2 text-xs text-text"
            aria-label="Anno"
          >
            {Array.from({ length: 4 }, (_, i) => anno - i).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {mancanti.length > 0 && (
          <div
            className="px-5 py-2.5 flex items-start gap-2.5"
            style={{ background: "rgba(245,158,11,0.07)" }}
          >
            <TriangleAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-text leading-snug">
              Non c’è una percentuale valida entro {MESI[meseScelto - 1]} {annoScelto} per{" "}
              {mancanti.map((m) => m.vettore.nome).join(", ")}. Finché manca, il
              costo atteso di quelle spedizioni viene calcolato{" "}
              <strong>al netto del carburante</strong> e dichiarato come non
              confrontabile con la fattura.
            </p>
          </div>
        )}

        <div className="divide-y divide-border/60">
          {nostri.map((l) => {
            const corrente = carburanteVigente(l.carburante, annoScelto, meseScelto);
            return (
              <div
                key={l.vettore.codice}
                className="px-5 py-3 flex items-center gap-3 flex-wrap"
              >
                <div className="min-w-[160px]">
                  <p className="text-sm font-medium text-text">{l.vettore.nome}</p>
                  <p className="text-[11px] text-text-muted">
                    {corrente
                      ? `in vigore: ${pct(corrente.percentuale)} · da ${MESI[corrente.mese - 1]} ${corrente.anno}`
                      : l.vettore.codice === "trading_post" ? "Nessun fuel mensile: addizionale nei supplementi" : "non inserita"}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-1 justify-end">
                  <input
                    inputMode="decimal"
                    value={valori[l.vettore.codice] ?? ""}
                    onChange={(e) =>
                      setValori((v) => ({ ...v, [l.vettore.codice]: e.target.value }))
                    }
                    placeholder={corrente ? String(corrente.percentuale * 100) : "es. 13,00"}
                    aria-label={`Percentuale carburante ${l.vettore.nome}`}
                    className="w-28 h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text tabular-nums text-right"
                  />
                  <span className="text-sm text-text-muted">%</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={inCorso !== null}
                    onClick={() => void salva(l.vettore.codice)}
                  >
                    {inCorso === l.vettore.codice ? (
                      <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                    ) : null}
                    {corrente ? "Aggiorna" : "Salva"}
                  </Button>
                </div>
                <div className="w-full flex flex-wrap gap-1.5">
                  {l.carburante.slice(0, 8).map((c) => (
                    <span
                      key={`${c.anno}-${c.mese}`}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-bg-page text-text-muted tabular-nums"
                    >
                      {MESI[c.mese - 1].slice(0, 3)} {String(c.anno).slice(2)} ·{" "}
                      {pct(c.percentuale)}
                    </span>
                  ))}
                  {l.carburante.length === 0 && (
                    <span className="text-[10px] text-text-muted">
                      nessuna percentuale in archivio
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {errore && (
          <div
            className="px-5 py-3 flex items-start gap-2.5"
            style={{ background: "rgba(239,68,68,0.05)" }}
          >
            <TriangleAlert className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <p className="text-sm text-text">{errore}</p>
          </div>
        )}
        {salvato && (
          <div
            className="px-5 py-3 flex items-start gap-2.5"
            style={{ background: "rgba(34,197,94,0.06)" }}
          >
            <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
            <p className="text-sm text-text">{salvato}</p>
          </div>
        )}
      </section>

      {/* ------------------------------ listini ----------------------------- */}
      <div className="space-y-4">
        {nostri.map((l) => (
          <Scheda key={`${l.vettore.codice}-${l.listino?.id}`} l={l} />
        ))}
      </div>

      <MailImpostazioni vettori={nostri.map((l) => ({ id: l.vettore.id, nome: l.vettore.nome }))} />
      {altri.length > 0 && (
        <section className="mt-6 rounded-xl border border-border bg-bg px-5 py-4">
          <h2 className="font-tenorite font-bold text-sm text-text mb-1">
            Vettori che non ci fatturano
          </h2>
          <p className="text-xs text-text-muted">
            {altri.map((a) => a.vettore.nome).join(", ")} — compaiono sulle bolle ma
            il trasporto lo paga il cliente. Servono all&apos;analisi, non al
            controllo delle fatture, e per questo non hanno un listino.
          </p>
        </section>
      )}
    </div>
  );
}

function Scheda({ l }: { l: ListinoRiepilogo }) {
  const v = l.vettore;
  return (
    <section className="rounded-xl border border-border bg-bg overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-tenorite font-bold text-text">{v.nome}</h2>
          <p className="text-xs text-text-muted">
            {l.listino
              ? `${l.listino.etichetta} · dal ${l.listino.valido_dal}${l.listino.valido_al ? ` al ${l.listino.valido_al}` : " (in vigore)"}`
              : "nessun listino in vigore a oggi"}
          </p>
        </div>
      </div>

      <ListinoEditor l={l} />
      <div className="px-5 py-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-text-muted font-semibold mb-1.5">
            Come si forma il prezzo
          </p>
          <ul className="text-[13px] text-text space-y-0.5">
            <li>
              <strong>{l.fasce} fasce di peso</strong>
              {l.fasceQuintale > 0
                ? `, di cui ${l.fasceQuintale} tariffata${l.fasceQuintale > 1 ? "e" : ""} a quintale oltre la soglia`
                : " a importo fisso"}
            </li>
            <li>
              Peso volumetrico: <strong>{v.divisore_volumetrico} kg per metro cubo</strong>
            </li>
            {v.peso_minimo_tassabile > 0 && (
              <li>
                Minimo tassabile: <strong>{v.peso_minimo_tassabile} kg</strong>
              </li>
            )}
            {v.arrotondamento_kg > 0 && (
              <li>
                Arrotondamento a <strong>{v.arrotondamento_kg} kg</strong> oltre i{" "}
                {v.arrotondamento_da_kg} kg
              </li>
            )}
            <li>
              Adeguamento contrattuale:{" "}
              <strong>{l.adeguamento != null ? pct(l.adeguamento) : "nessuno"}</strong>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wider text-text-muted font-semibold mb-1.5">
            Zone servite
          </p>
          {l.zone.length === 0 ? (
            <p className="text-[13px] text-text-muted">Nessuna zona configurata.</p>
          ) : (
            <ul className="text-[13px] text-text space-y-0.5">
              {l.zone.map((z) => (
                <li key={z.codice}>
                  <strong>{z.nome}</strong>
                  {z.is_default ? " (predefinita)" : ""} —{" "}
                  <span className="text-text-muted">
                    {z.province.length > 0
                      ? z.province.join(" ")
                      : "tutte le destinazioni non elencate altrove"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {l.supplementi.length > 0 && (
        <div className="px-5 pb-4">
          <p className="text-[11px] uppercase tracking-wider text-text-muted font-semibold mb-1.5">
            Supplementi ({l.supplementi.length})
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[520px]">
              <thead>
                <tr className="text-text-muted text-[10px] uppercase tracking-wider">
                  <th className="text-left font-semibold pb-1">Voce</th>
                  <th className="text-left font-semibold pb-1">Come si calcola</th>
                  <th className="text-right font-semibold pb-1">Valore</th>
                  <th className="text-left font-semibold pb-1 pl-4">Quando</th>
                  <th className="text-center font-semibold pb-1">Fa base</th>
                </tr>
              </thead>
              <tbody>
                {l.supplementi.map((s) => (
                  <tr key={s.codice} className="border-t border-border/50">
                    <td className="py-1 text-text">{s.nome}</td>
                    <td className="py-1 text-text-muted">
                      {TIPO_CALCOLO[s.tipo_calcolo] ?? s.tipo_calcolo}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {s.tipo_calcolo === "percentuale_nolo"
                        ? pct(s.valore)
                        : s.valore.toLocaleString("it-IT", {
                            style: "currency",
                            currency: "EUR",
                          })}
                    </td>
                    <td className="py-1 pl-4 text-text-muted">
                      {s.condizione ? s.condizione.replace(/_/g, " ") : "sempre"}
                    </td>
                    <td className="py-1 text-center text-text-muted">
                      {s.base_nolo ? "sì" : "no"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-text-muted mt-2 leading-snug">
            «Fa base» dice se la voce entra nell&apos;imponibile su cui si calcolano
            adeguamento e carburante. È la colonna che fa tornare i conti con la
            fattura: sul documento GLS di luglio l&apos;assicurazione non fa base,
            handling e autostrade sì.
          </p>
        </div>
      )}
    </section>
  );
}
