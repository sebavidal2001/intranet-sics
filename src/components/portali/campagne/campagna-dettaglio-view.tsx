"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CampagnaRiepilogo, StatoCampagna } from "@/lib/portali/campagne/tipi";
import { chiamaApi, daElenco, formattaDataOra } from "./api-client";
import { Campo, Messaggio, Pannello, StatoCampagnaChip } from "./ui";
import { SelezioneDestinatari } from "./selezione-destinatari";

interface Esito {
  tipo: "errore" | "ok";
  testo: string;
}

export function CampagnaDettaglioView({ iniziale }: { iniziale: CampagnaRiepilogo }) {
  const [campagna, setCampagna] = useState(iniziale);
  const [nome, setNome] = useState(iniziale.nome);
  const [note, setNote] = useState(iniziale.note ?? "");
  const [articolo, setArticolo] = useState(iniziale.articolo_codice);
  const [parole, setParole] = useState(iniziale.testo_riconoscimento.join(", "));
  const [marchio, setMarchio] = useState(iniziale.marchio ?? "");
  const [promossi, setPromossi] = useState(iniziale.articoli_promossi.join(", "));
  const [occupato, setOccupato] = useState<string | null>(null);
  const [esito, setEsito] = useState<Esito | null>(null);
  const [esitoPubblico, setEsitoPubblico] = useState<Esito | null>(null);

  const terminata = campagna.stato === "terminata";
  const haInvii = campagna.preparate + campagna.da_spedire + campagna.consegnate + campagna.consegnate_banco > 0;

  async function salva() {
    setOccupato("salva");
    setEsito(null);
    const r = await chiamaApi<{ campagna: CampagnaRiepilogo }>(`/api/portali/campagne/campagne/${campagna.id}`, {
      metodo: "PATCH",
      corpo: {
        nome,
        note: note.trim() || null,
        articolo_codice: articolo,
        testo_riconoscimento: daElenco(parole),
        marchio: marchio.trim() || null,
        articoli_promossi: daElenco(promossi),
      },
    });
    setOccupato(null);
    if (!r.ok) setEsito({ tipo: "errore", testo: r.errore });
    else {
      setCampagna(r.dati.campagna);
      setEsito({ tipo: "ok", testo: "Campagna aggiornata." });
    }
  }

  async function cambiaStato(stato: StatoCampagna) {
    if (stato === "terminata" && !window.confirm("Terminare la campagna? Non si potrà più riattivare.")) return;
    setOccupato("stato");
    setEsito(null);
    const r = await chiamaApi<{ campagna: CampagnaRiepilogo }>(`/api/portali/campagne/campagne/${campagna.id}`, {
      metodo: "PATCH",
      corpo: { stato },
    });
    setOccupato(null);
    if (!r.ok) setEsito({ tipo: "errore", testo: r.errore });
    else setCampagna(r.dati.campagna);
  }

  async function applicaStandard() {
    if (!window.confirm("Aggiungere ai destinatari tutti i clienti del pubblico standard? Nessuno viene tolto.")) return;
    setOccupato("standard");
    setEsitoPubblico(null);
    const r = await chiamaApi<{ esito: { aggiunti: number }; campagna: CampagnaRiepilogo }>(
      `/api/portali/campagne/campagne/${campagna.id}/destinatari`,
      { corpo: { azione: "applica_standard" } }
    );
    setOccupato(null);
    if (!r.ok) setEsitoPubblico({ tipo: "errore", testo: r.errore });
    else {
      setCampagna(r.dati.campagna);
      setEsitoPubblico({ tipo: "ok", testo: `${r.dati.esito.aggiunti} clienti aggiunti ai destinatari.` });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/campagne/gestione" className="text-sm text-primary hover:underline">
          ← Tutte le campagne
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-tenorite text-2xl font-bold text-text">
            {campagna.codice} · {campagna.nome}
          </h1>
          <StatoCampagnaChip stato={campagna.stato} />
        </div>
        <p className="mt-1 text-sm text-text-muted">
          Stato cambiato il {formattaDataOra(campagna.stato_cambiato_il)} · precedenza n. {campagna.ordine}
        </p>
      </div>

      <Pannello titolo="Stato">
        {terminata ? (
          <p className="text-sm text-text-muted">Campagna terminata: non si può più riattivare né modificare i destinatari.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {campagna.stato === "sospesa" ? (
              <Button variant="success" disabled={occupato !== null} onClick={() => cambiaStato("attiva")}>Attiva</Button>
            ) : (
              <Button variant="outline" disabled={occupato !== null} onClick={() => cambiaStato("sospesa")}>Sospendi</Button>
            )}
            <Button variant="ghost" disabled={occupato !== null} onClick={() => cambiaStato("terminata")}>Termina</Button>
            <span className="text-xs text-text-muted">
              Una campagna sospesa o terminata non viene suggerita. Le buste già preparate partono comunque.
            </span>
          </div>
        )}
      </Pannello>

      <Pannello titolo="Dati della campagna">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etichetta="Titolo">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} disabled={terminata} />
          </Campo>
          <Campo
            etichetta="Codice articolo"
            aiuto={haInvii ? "Non si cambia: la campagna ha già degli invii." : "L'articolo che si inserisce nell'ordine in Impresa."}
          >
            <Input value={articolo} onChange={(e) => setArticolo(e.target.value)} maxLength={60} disabled={terminata || haInvii} />
          </Campo>
          <div className="sm:col-span-2">
            <Campo etichetta="Note">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={1000}
                disabled={terminata}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              />
            </Campo>
          </div>
          <Campo etichetta="Parole di riconoscimento" aiuto="Solo con articolo condiviso: parole nella descrizione della riga d'ordine.">
            <Input value={parole} onChange={(e) => setParole(e.target.value)} disabled={terminata} />
          </Campo>
          <Campo etichetta="Marchio" aiuto="Per l'analisi delle vendite.">
            <Input value={marchio} onChange={(e) => setMarchio(e.target.value)} maxLength={80} disabled={terminata} />
          </Campo>
          <div className="sm:col-span-2">
            <Campo etichetta="Articoli promossi" aiuto="Codici separati da virgola: servono all'analisi.">
              <Input value={promossi} onChange={(e) => setPromossi(e.target.value)} disabled={terminata} />
            </Campo>
          </div>
        </div>
        {!terminata ? (
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={salva} disabled={occupato !== null || !nome.trim() || !articolo.trim()}>
              {occupato === "salva" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salva
            </Button>
          </div>
        ) : null}
        {esito ? <div className="mt-3"><Messaggio tipo={esito.tipo}>{esito.testo}</Messaggio></div> : null}
      </Pannello>

      <Pannello titolo={`Destinatari · ${campagna.destinatari.toLocaleString("it-IT")}`}>
        <p className="mb-4 text-sm text-text-muted">
          {campagna.preparate + campagna.da_spedire} buste in corso · {campagna.consegnate + campagna.consegnate_banco} consegnate.
          Il pubblico è una fotografia: cambiare il pubblico standard non modifica questa campagna.
        </p>
        {!terminata ? (
          <div className="mb-5">
            <Button variant="outline" onClick={applicaStandard} disabled={occupato !== null}>
              {occupato === "standard" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Applica il pubblico standard
            </Button>
            {esitoPubblico ? <div className="mt-3"><Messaggio tipo={esitoPubblico.tipo}>{esitoPubblico.testo}</Messaggio></div> : null}
          </div>
        ) : null}
        <SelezioneDestinatari campagnaId={campagna.id} bloccata={terminata} onAggiornata={setCampagna} />
      </Pannello>
    </div>
  );
}
