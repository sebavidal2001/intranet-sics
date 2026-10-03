"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CampagnaRiepilogo, StatoCampagna } from "@/lib/portali/campagne/tipi";
import { chiamaApi, daElenco, formattaDataOra } from "./api-client";
import { Campo, Messaggio, Pannello, StatoCampagnaChip, classeSelect } from "./ui";
import type { PubblicoScelta } from "./gestione-campagne-view";
import { SelezioneDestinatari } from "./selezione-destinatari";
import { AlberoArticoli } from "./albero-articoli";
import type { SelettoreArticolo } from "@/lib/portali/campagne/albero";

interface Esito {
  tipo: "errore" | "ok";
  testo: string;
}

export function CampagnaDettaglioView({
  iniziale,
  pubblici,
  mancanti: mancantiIniziali,
}: {
  iniziale: CampagnaRiepilogo;
  pubblici: PubblicoScelta[];
  /** Clienti che rientrano nel pubblico della campagna e non ne sono ancora destinatari. */
  mancanti: number;
}) {
  const [campagna, setCampagna] = useState(iniziale);
  const [mancanti, setMancanti] = useState(mancantiIniziali);
  const [nome, setNome] = useState(iniziale.nome);
  const [note, setNote] = useState(iniziale.note ?? "");
  const [articolo, setArticolo] = useState(iniziale.articolo_codice);
  const [parole, setParole] = useState(iniziale.testo_riconoscimento.join(", "));
  const [marchio, setMarchio] = useState(iniziale.marchio ?? "");
  const [promossi, setPromossi] = useState(iniziale.articoli_promossi.join(", "));
  const [albero, setAlbero] = useState<SelettoreArticolo[]>(iniziale.promossi_albero ?? []);
  const [esitoPromossi, setEsitoPromossi] = useState<Esito | null>(null);
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
      },
    });
    setOccupato(null);
    if (!r.ok) setEsito({ tipo: "errore", testo: r.errore });
    else {
      setCampagna(r.dati.campagna);
      setEsito({ tipo: "ok", testo: "Campagna aggiornata." });
    }
  }

  async function salvaPromossi() {
    setOccupato("promossi");
    setEsitoPromossi(null);
    const r = await chiamaApi<{ campagna: CampagnaRiepilogo }>(`/api/portali/campagne/campagne/${campagna.id}`, {
      metodo: "PATCH",
      corpo: { promossi_albero: albero, articoli_promossi: daElenco(promossi) },
    });
    setOccupato(null);
    if (!r.ok) setEsitoPromossi({ tipo: "errore", testo: r.errore });
    else {
      setCampagna(r.dati.campagna);
      setEsitoPromossi({ tipo: "ok", testo: "Articoli promossi salvati. L'Analisi li usa subito." });
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

  async function cambiaPubblico(pubblicoId: string) {
    setOccupato("pubblico");
    setEsitoPubblico(null);
    const r = await chiamaApi<{ campagna: CampagnaRiepilogo; mancanti: number }>(`/api/portali/campagne/campagne/${campagna.id}`, {
      metodo: "PATCH",
      corpo: { pubblico_id: pubblicoId },
    });
    setOccupato(null);
    if (!r.ok) setEsitoPubblico({ tipo: "errore", testo: r.errore });
    else {
      setCampagna(r.dati.campagna);
      setMancanti(r.dati.mancanti);
      setEsitoPubblico({ tipo: "ok", testo: "Pubblico cambiato. I destinatari che la campagna ha già non sono stati toccati." });
    }
  }

  async function applicaPubblico() {
    const nomePubblico = campagna.pubblico?.nome ?? "della campagna";
    if (!window.confirm(`Aggiungere ai destinatari i ${mancanti.toLocaleString("it-IT")} clienti del pubblico «${nomePubblico}» che ancora non ci sono? Nessuno viene tolto.`)) return;
    setOccupato("pubblico");
    setEsitoPubblico(null);
    const r = await chiamaApi<{ esito: { aggiunti: number }; campagna: CampagnaRiepilogo }>(
      `/api/portali/campagne/campagne/${campagna.id}/destinatari`,
      { corpo: { azione: "applica_pubblico" } }
    );
    setOccupato(null);
    if (!r.ok) setEsitoPubblico({ tipo: "errore", testo: r.errore });
    else {
      setCampagna(r.dati.campagna);
      setMancanti(0);
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
          <Campo etichetta="Marchio" aiuto="Un'etichetta: non serve a riconoscere gli articoli (per quelli c'è il pannello qui sotto).">
            <Input value={marchio} onChange={(e) => setMarchio(e.target.value)} maxLength={80} disabled={terminata} />
          </Campo>
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

      <Pannello titolo="Articoli promossi" descrizione="I prodotti della campagna: servono all'Analisi per sapere chi li compra e chi non li aveva mai presi.">
        <AlberoArticoli selezione={albero} onChange={setAlbero} disabled={terminata} />
        <div className="mt-4">
          <Campo etichetta="Altri codici a mano" aiuto="Facoltativo: codici che nell'anagrafica non ci sono, separati da virgola. Con l'asterisco un prefisso (AFD.00.* = tutti i codici che iniziano per AFD.00.).">
            <Input value={promossi} onChange={(e) => setPromossi(e.target.value)} disabled={terminata} aria-label="Altri codici a mano" />
          </Campo>
        </div>
        {!terminata ? (
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={salvaPromossi} disabled={occupato !== null}>
              {occupato === "promossi" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salva gli articoli promossi
            </Button>
          </div>
        ) : null}
        {esitoPromossi ? <div className="mt-3"><Messaggio tipo={esitoPromossi.tipo}>{esitoPromossi.testo}</Messaggio></div> : null}
      </Pannello>

      <Pannello titolo="Pubblico">
        <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Campo
            etichetta="A chi si rivolge"
            aiuto="Di default lo standard. Cambiarlo non toglie né aggiunge destinatari da solo: i clienti si aggiungono col pulsante qui sotto."
          >
            <select
              className={classeSelect}
              value={campagna.pubblico_id}
              disabled={terminata || occupato !== null}
              onChange={(e) => cambiaPubblico(e.target.value)}
              aria-label="Pubblico della campagna"
            >
              {pubblici.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                  {p.standard ? " (standard)" : ""}
                </option>
              ))}
            </select>
          </Campo>
          <Link href={`/campagne/pubblico/${campagna.pubblico_id}`} className="pb-2 text-sm font-medium text-primary hover:underline">
            Modifica questo pubblico →
          </Link>
        </div>
        {!terminata ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={applicaPubblico} disabled={occupato !== null || mancanti === 0}>
              {occupato === "pubblico" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Aggiungi i clienti che rientrano
            </Button>
            <span className="text-sm text-text-muted">
              {mancanti === 0
                ? "Tutti i clienti del pubblico sono già destinatari."
                : `${mancanti.toLocaleString("it-IT")} ${mancanti === 1 ? "cliente rientra" : "clienti rientrano"} nel pubblico e non ${mancanti === 1 ? "è ancora destinatario" : "sono ancora destinatari"}.`}
            </span>
          </div>
        ) : null}
        {esitoPubblico ? <div className="mt-3"><Messaggio tipo={esitoPubblico.tipo}>{esitoPubblico.testo}</Messaggio></div> : null}
      </Pannello>

      <Pannello titolo={`Destinatari · ${campagna.destinatari.toLocaleString("it-IT")}`}>
        <p className="mb-4 text-sm text-text-muted">
          {campagna.preparate + campagna.da_spedire} buste in corso · {campagna.consegnate + campagna.consegnate_banco} consegnate.
          I destinatari sono una fotografia: cambiare il pubblico non modifica questa campagna finché non aggiungi i clienti. Qui sotto puoi anche
          aggiungere o togliere singoli clienti.
        </p>
        <SelezioneDestinatari campagnaId={campagna.id} bloccata={terminata} onAggiornata={setCampagna} />
      </Pannello>
    </div>
  );
}
