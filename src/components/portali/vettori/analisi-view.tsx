"use client";

import { useRouter } from "next/navigation";
import { BarChart3, Info } from "lucide-react";
import type { Analisi } from "@/lib/portali/vettori/letture";

/**
 * Analisi della spesa di trasporto, per vettore e per mese.
 *
 * Serve a una cosa sola: **avere numeri da portare a un tavolo con un
 * fornitore**. Per questo mostra sempre affiancati fatturato e atteso, e per
 * questo dichiara quante righe non erano valutabili invece di nasconderle nella
 * media — una percentuale calcolata su metà delle spedizioni, presentata come se
 * valesse per tutte, è il difetto dei fogli che questo modulo sostituisce.
 */

interface Props {
  dati: Analisi;
  anno: number;
}

const MESI_BREVI = [
  "gen", "feb", "mar", "apr", "mag", "giu",
  "lug", "ago", "set", "ott", "nov", "dic",
];

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

const eur = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eurPreciso = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const int = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("it-IT", { maximumFractionDigits: 0 });

export function AnalisiView({ dati, anno }: Props) {
  const router = useRouter();
  const vuoto = dati.totali.righe === 0;

  const differenza = dati.totali.fatturato - dati.totali.atteso;
  const maxMese = Math.max(1, ...dati.mesi.map((m) => m.fatturato));

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-tenorite text-2xl font-bold text-text">Analisi vettori</h1>
          <p className="text-sm text-text-muted mt-1 max-w-2xl">
            Quanto si spende, con chi, e quanto spesso i conti non tornano. È il
            materiale con cui si tratta il rinnovo di un contratto.
          </p>
        </div>
        <label className="text-xs">
          <span className="block text-text-muted mb-1 font-medium">Anno</span>
          <select
            value={anno}
            onChange={(e) => router.push(`/vettori/analisi?anno=${e.target.value}`)}
            className="h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text"
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </header>

      {vuoto ? (
        <div className="rounded-xl border border-border bg-bg p-10 text-center">
          <BarChart3 className="w-8 h-8 text-border mx-auto mb-3" />
          <p className="text-sm text-text font-medium">
            Nessuna fattura acquisita per il {anno}.
          </p>
          <p className="text-xs text-text-muted mt-1 max-w-md mx-auto">
            L&apos;analisi si popola man mano che le fatture vengono caricate nella
            pagina Fatture. Le fatture che non quadrano restano in bozza e non
            entrano qui: una statistica usata per trattare non può poggiare su
            letture parziali.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5">
            <Tessera
              titolo="Fatturato"
              valore={eur(dati.totali.fatturato)}
              nota={`${int(dati.totali.righe)} spedizioni · ${int(dati.totali.colli)} colli`}
              colore="var(--color-text)"
            />
            <Tessera
              titolo="Costo atteso"
              valore={eur(dati.totali.atteso)}
              nota="secondo i listini contrattuali"
              colore="var(--color-text-muted)"
            />
            <Tessera
              titolo="Differenza"
              valore={eur(differenza)}
              nota={
                dati.totali.atteso > 0
                  ? `${((differenza / dati.totali.atteso) * 100).toFixed(1)}% sul dovuto`
                  : "atteso non calcolabile"
              }
              colore={differenza > 0 ? "var(--color-danger)" : "var(--color-success)"}
            />
            <Tessera
              titolo="Righe fuori linea"
              valore={int(dati.totali.anomalie)}
              nota={`${int(dati.totali.kg)} kg trasportati`}
              colore={dati.totali.anomalie > 0 ? "var(--color-warning)" : "var(--color-success)"}
            />
          </div>

          {/* ---------------------------- per vettore --------------------------- */}
          <section className="rounded-xl border border-border bg-bg overflow-hidden mb-5">
            <div className="px-5 py-3 border-b border-border">
              <h2 className="font-tenorite font-bold text-sm text-text">Per vettore</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] min-w-[820px]">
                <thead>
                  <tr className="text-text-muted text-[11px] uppercase tracking-wider bg-bg-page">
                    <th className="text-left font-semibold px-4 py-2">Vettore</th>
                    <th className="text-right font-semibold px-4 py-2">Spedizioni</th>
                    <th className="text-right font-semibold px-4 py-2">Colli</th>
                    <th className="text-right font-semibold px-4 py-2">Kg</th>
                    <th className="text-right font-semibold px-4 py-2">Fatturato</th>
                    <th className="text-right font-semibold px-4 py-2">Atteso</th>
                    <th className="text-right font-semibold px-4 py-2">Differenza</th>
                    <th className="text-right font-semibold px-4 py-2">Fuori linea</th>
                    <th className="text-right font-semibold px-4 py-2">In discussione</th>
                  </tr>
                </thead>
                <tbody>
                  {dati.vettori.map((v) => {
                    const diff = v.fatturato - v.atteso;
                    const quota = v.righe > 0 ? v.anomalie / v.righe : 0;
                    return (
                      <tr key={v.codice} className="border-t border-border/50">
                        <td className="px-4 py-2 font-medium text-text">{v.nome}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{int(v.righe)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{int(v.colli)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{int(v.kg)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium">
                          {eurPreciso(v.fatturato)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-text-muted">
                          {eurPreciso(v.atteso)}
                        </td>
                        <td
                          className="px-4 py-2 text-right tabular-nums font-medium"
                          style={{
                            color:
                              diff > 0 ? "var(--color-danger)" : "var(--color-text-muted)",
                          }}
                        >
                          {eurPreciso(diff)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {int(v.anomalie)}
                          <span className="text-text-muted">
                            {" "}
                            ({(quota * 100).toFixed(0)}%)
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {eurPreciso(v.contestato)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2.5 border-t border-border flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
              <p className="text-[11px] text-text-muted leading-snug">
                Le righe non valutabili — listino mancante per quella data o zona —
                non entrano nel conteggio «fuori linea»:{" "}
                {dati.vettori
                  .filter((v) => v.non_valutabili > 0)
                  .map((v) => `${v.nome} ${v.non_valutabili}`)
                  .join(", ") || "quest'anno nessuna"}
                . Le spedizioni fatturate senza bolla a gestionale sono{" "}
                {dati.vettori.reduce((s, v) => s + v.senza_bolla, 0)}.
              </p>
            </div>
          </section>

          {/* ----------------------------- per mese ----------------------------- */}
          <section className="rounded-xl border border-border bg-bg overflow-hidden mb-5">
            <div className="px-5 py-3 border-b border-border">
              <h2 className="font-tenorite font-bold text-sm text-text">Andamento mensile</h2>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-end gap-2 h-40">
                {dati.mesi.map((m) => (
                  <div key={`${m.anno}-${m.mese}`} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-text-muted tabular-nums">
                      {eur(m.fatturato)}
                    </span>
                    <div
                      className="w-full rounded-t"
                      style={{
                        height: `${Math.max(3, (m.fatturato / maxMese) * 100)}%`,
                        background:
                          m.anomalie > 0
                            ? "linear-gradient(180deg,#f59e0b 0%,#00a1be 60%)"
                            : "#00a1be",
                      }}
                      title={`${int(m.righe)} spedizioni · ${int(m.anomalie)} fuori linea`}
                    />
                    <span className="text-[11px] text-text-muted">
                      {MESI_BREVI[m.mese - 1]}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-text-muted mt-3">
                La parte arancione in cima segnala i mesi con righe fuori linea. Le
                barre sono il fatturato, non l&apos;atteso.
              </p>
            </div>
          </section>

          {/* ------------------------- tipi di anomalia ------------------------- */}
          {dati.tipi_anomalia.length > 0 && (
            <section className="rounded-xl border border-border bg-bg overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h2 className="font-tenorite font-bold text-sm text-text">
                  Perché non tornano
                </h2>
              </div>
              <ul className="divide-y divide-border/60">
                {dati.tipi_anomalia.map((t) => (
                  <li
                    key={t.tipo}
                    className="px-5 py-2.5 flex items-center justify-between gap-4"
                  >
                    <span className="text-sm text-text">
                      {ETICHETTA_TIPO[t.tipo] ?? t.tipo}
                    </span>
                    <span className="text-xs text-text-muted tabular-nums shrink-0">
                      {int(t.quante)} volte · {int(t.aperte)} ancora aperte ·{" "}
                      {eurPreciso(t.contestato)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
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
