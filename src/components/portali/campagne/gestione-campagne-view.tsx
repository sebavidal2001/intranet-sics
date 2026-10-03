"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CampagnaRiepilogo, StatoCampagna } from "@/lib/portali/campagne/tipi";
import { chiamaApi, daElenco } from "./api-client";
import { Campo, Messaggio, Pannello, StatoCampagnaChip, classeSelect } from "./ui";

interface Esito {
  tipo: "errore" | "ok";
  testo: string;
}

export function GestioneCampagneView({ campagne }: { campagne: CampagnaRiepilogo[] }) {
  const router = useRouter();
  const [apri, setApri] = useState(false);
  const [esito, setEsito] = useState<Esito | null>(null);
  const [occupato, setOccupato] = useState<string | null>(null);

  async function cambiaStato(c: CampagnaRiepilogo, stato: StatoCampagna) {
    if (stato === "terminata" && !window.confirm(`Terminare ${c.codice}? Una campagna terminata non si può più riattivare.`)) return;
    setOccupato(c.id);
    setEsito(null);
    const r = await chiamaApi(`/api/portali/campagne/campagne/${c.id}`, { metodo: "PATCH", corpo: { stato } });
    setOccupato(null);
    if (!r.ok) setEsito({ tipo: "errore", testo: r.errore });
    else router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-tenorite text-2xl font-bold text-text">Campagne</h1>
          <p className="mt-1 text-sm text-text-muted">
            Si assegnano dalla più vecchia alla più recente, solo se attive. Sospesa si può riattivare; terminata no.
          </p>
        </div>
        <Button onClick={() => setApri((v) => !v)}>
          <Plus className="h-4 w-4" />
          Nuova campagna
        </Button>
      </div>

      {apri ? <NuovaCampagna onCreata={() => { setApri(false); router.refresh(); }} /> : null}
      {esito ? <Messaggio tipo={esito.tipo}>{esito.testo}</Messaggio> : null}

      <Pannello>
        {campagne.length === 0 ? (
          <p className="text-sm text-text-muted">Nessuna campagna. Creane una con il pulsante in alto.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Campagna</th>
                  <th className="py-2 pr-3 font-medium">Stato</th>
                  <th className="py-2 pr-3 text-right font-medium">Destinatari</th>
                  <th className="py-2 pr-3 text-right font-medium">In corso</th>
                  <th className="py-2 pr-3 text-right font-medium">Consegnate</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {campagne.map((c) => (
                  <tr key={c.id} className="align-middle">
                    <td className="py-3 pr-3 text-text-muted">{c.ordine}</td>
                    <td className="py-3 pr-3">
                      <Link href={`/campagne/gestione/${c.id}`} className="font-semibold text-text hover:text-primary">
                        {c.codice} · {c.nome}
                      </Link>
                      <span className="block text-xs text-text-muted">articolo {c.articolo_codice}</span>
                    </td>
                    <td className="py-3 pr-3">
                      <StatoCampagnaChip stato={c.stato} />
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums">{c.destinatari.toLocaleString("it-IT")}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{(c.preparate + c.da_spedire).toLocaleString("it-IT")}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{(c.consegnate + c.consegnate_banco).toLocaleString("it-IT")}</td>
                    <td className="py-3 text-right whitespace-nowrap">
                      {occupato === c.id ? (
                        <Loader2 className="ml-auto h-4 w-4 animate-spin text-text-muted" />
                      ) : (
                        <span className="inline-flex gap-1.5">
                          {c.stato !== "attiva" && c.stato !== "terminata" ? (
                            <Button size="sm" variant="success" onClick={() => cambiaStato(c, "attiva")}>Attiva</Button>
                          ) : null}
                          {c.stato === "attiva" ? (
                            <Button size="sm" variant="outline" onClick={() => cambiaStato(c, "sospesa")}>Sospendi</Button>
                          ) : null}
                          {c.stato !== "terminata" ? (
                            <Button size="sm" variant="ghost" onClick={() => cambiaStato(c, "terminata")}>Termina</Button>
                          ) : null}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Pannello>
    </div>
  );
}

function NuovaCampagna({ onCreata }: { onCreata: () => void }) {
  const [codice, setCodice] = useState("");
  const [nome, setNome] = useState("");
  const [articolo, setArticolo] = useState("");
  const [note, setNote] = useState("");
  const [marchio, setMarchio] = useState("");
  const [parole, setParole] = useState("");
  const [stato, setStato] = useState<"attiva" | "sospesa">("sospesa");
  const [standard, setStandard] = useState(true);
  const [occupato, setOccupato] = useState(false);
  const [esito, setEsito] = useState<Esito | null>(null);

  async function crea() {
    setOccupato(true);
    setEsito(null);
    const r = await chiamaApi("/api/portali/campagne/campagne", {
      corpo: {
        codice,
        nome,
        articolo_codice: articolo,
        note: note || null,
        marchio: marchio || null,
        testo_riconoscimento: daElenco(parole),
        stato,
        applica_pubblico_standard: standard,
      },
    });
    setOccupato(false);
    if (!r.ok) setEsito({ tipo: "errore", testo: r.errore });
    else onCreata();
  }

  return (
    <Pannello titolo="Nuova campagna">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etichetta="Codice *" aiuto="es. C_04_26">
          <Input value={codice} onChange={(e) => setCodice(e.target.value)} maxLength={30} />
        </Campo>
        <Campo etichetta="Titolo *">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} />
        </Campo>
        <Campo etichetta="Codice articolo *" aiuto="L'articolo che l'operatrice inserisce nell'ordine in Impresa. Ogni nuova campagna ha il suo.">
          <Input value={articolo} onChange={(e) => setArticolo(e.target.value)} maxLength={60} />
        </Campo>
        <Campo etichetta="Marchio" aiuto="Serve all'analisi delle vendite (facoltativo ora).">
          <Input value={marchio} onChange={(e) => setMarchio(e.target.value)} maxLength={80} />
        </Campo>
        <div className="sm:col-span-2">
          <Campo etichetta="Note">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </Campo>
        </div>
        <Campo etichetta="Parole di riconoscimento" aiuto="Solo se l'articolo è condiviso con altre campagne (come DOCUMENTAZIONE): parole che compaiono nella descrizione della riga, separate da virgola.">
          <Input value={parole} onChange={(e) => setParole(e.target.value)} placeholder="es. ZECA, ZETEK" />
        </Campo>
        <Campo etichetta="Stato iniziale">
          <select className={classeSelect} value={stato} onChange={(e) => setStato(e.target.value as "attiva" | "sospesa")}>
            <option value="sospesa">Non attiva (la attivo dopo)</option>
            <option value="attiva">Attiva subito</option>
          </select>
        </Campo>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={standard} onChange={(e) => setStandard(e.target.checked)} className="mt-1" />
        <span>
          Applica il <strong>pubblico standard</strong> salvato
          <span className="block text-xs text-text-muted">
            Copia i destinatari adesso; poi si possono ritoccare nella pagina della campagna. Se la campagna è mirata, lascia vuoto e scegli per categoria.
          </span>
        </span>
      </label>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={crea} disabled={occupato || !codice.trim() || !nome.trim() || !articolo.trim()}>
          {occupato ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Crea campagna
        </Button>
        {esito ? <Messaggio tipo={esito.tipo}>{esito.testo}</Messaggio> : null}
      </div>
    </Pannello>
  );
}
