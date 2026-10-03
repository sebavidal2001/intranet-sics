"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Package, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { testoRigaCampagna } from "@/lib/portali/campagne/controllo";
import { STATO_INVIO_UI, azioniConsentite, etichettaOrdine, type AzioneInvio } from "@/lib/portali/campagne/stati";
import type { EsitoControlloInvio, Invio, OrdineAperto, SchedaCliente } from "@/lib/portali/campagne/tipi";
import { chiamaApi, formattaData, formattaDataOra } from "./api-client";
import { CartaAnomalia } from "./anomalie-view";
import { Copia } from "./copia";
import { Campo, Messaggio, Pannello, StatoInvioChip, classeSelect } from "./ui";

interface Esito {
  tipo: "errore" | "ok";
  testo: string;
}

const ETICHETTA_FONTE: Record<string, string> = {
  ddt: "da DDT",
  banco: "al banco",
  manuale: "registrata a mano",
  import_excel: "dallo storico Excel",
};

/** Cosa ha trovato l'ultimo controllo con Impresa, detto all'operatrice. */
/** Le due lettere del tondo accanto al nome: «POLETTI srl» → «PO». */
function iniziali(nome: string): string {
  const parole = nome.replace(/[^A-Za-zÀ-ÿ0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const prime = parole.length > 1 ? parole[0][0] + parole[1][0] : (parole[0] ?? "?").slice(0, 2);
  return prime.toUpperCase();
}

function Etichetta({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-bg-page px-2.5 py-1 text-xs font-medium text-text-muted">{children}</span>;
}

const ESITO_CONTROLLO: Partial<Record<EsitoControlloInvio, string>> = {
  attesa_dati: "In attesa del prossimo aggiornamento dei dati di Impresa (ogni notte).",
  riga_trovata: "Riga DOCUMENTAZIONE trovata nell'ordine: in attesa della spedizione.",
  consegnata: "Spedita: il DDT è stato trovato in Impresa.",
  ordine_non_trovato: "L'ordine non risulta in Impresa: controlla il numero.",
  riga_mancante: "Nell'ordine manca la riga DOCUMENTAZIONE.",
  campagna_incoerente: "La riga dell'ordine nomina un'altra campagna.",
  evasa_senza_ddt: "La riga risulta evasa ma il DDT non è stato trovato.",
};

export function SchedaClienteView({ scheda, annoCorrente, oggi }: { scheda: SchedaCliente; annoCorrente: number; oggi: string }) {
  const { cliente, invii, assegnabili, ordini_aperti, anomalie } = scheda;
  const suggerita = assegnabili[0] ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,32,0.04),0_4px_16px_rgba(15,23,32,0.04)]">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-dark font-tenorite text-xl font-bold text-white shadow-sm"
          aria-hidden
        >
          {iniziali(cliente.ragione_sociale)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-tenorite text-2xl font-bold tracking-tight text-text">{cliente.ragione_sociale}</h1>
          <p className="mt-0.5 text-sm text-text-muted">Codice {cliente.codice_cliente}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {cliente.agente_nome ? <Etichetta>{cliente.agente_nome}</Etichetta> : null}
            {cliente.cat_commerciale && cliente.cat_commerciale !== "-" ? <Etichetta>{cliente.cat_commerciale}</Etichetta> : null}
            {cliente.cat_attivita ? <Etichetta>{cliente.cat_attivita}</Etichetta> : null}
            {cliente.rivenditore ? (
              <span className="rounded-md bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">Rivenditore: di norma escluso dalle campagne</span>
            ) : null}
          </div>
        </div>
      </header>

      {anomalie.length > 0 ? (
        <Pannello titolo={`Da sistemare · ${anomalie.length}`}>
          <ul className="divide-y divide-border">
            {anomalie.map((a) => (
              <CartaAnomalia key={a.id} anomalia={a} mostraCliente={false} />
            ))}
          </ul>
        </Pannello>
      ) : null}

      <AzioneSuggerita
        codiceCliente={cliente.codice_cliente}
        assegnabili={assegnabili}
        suggeritaId={suggerita?.id ?? null}
        annoCorrente={annoCorrente}
        ordiniAperti={ordini_aperti}
      />

      <Pannello titolo="Storico campagne">
        {invii.length === 0 ? (
          <p className="text-sm text-text-muted">Nessuna campagna ancora assegnata a questo cliente.</p>
        ) : (
          <ul className="divide-y divide-border">
            {invii.map((i) => (
              <RigaInvio key={i.id} invio={i} oggi={oggi} annoCorrente={annoCorrente} />
            ))}
          </ul>
        )}
      </Pannello>
    </div>
  );
}

// ─── Azione suggerita e modulo di assegnazione ─────────────────────────────
function AzioneSuggerita({
  codiceCliente,
  assegnabili,
  suggeritaId,
  annoCorrente,
  ordiniAperti,
}: {
  codiceCliente: string;
  assegnabili: SchedaCliente["assegnabili"];
  suggeritaId: string | null;
  annoCorrente: number;
  ordiniAperti: OrdineAperto[];
}) {
  const router = useRouter();
  const [campagnaId, setCampagnaId] = useState(suggeritaId ?? "");
  const [referente, setReferente] = useState("");
  const [ordineNumero, setOrdineNumero] = useState("");
  const [ordineAnno, setOrdineAnno] = useState(String(annoCorrente));
  const [occupato, setOccupato] = useState(false);
  const [esito, setEsito] = useState<Esito | null>(null);

  if (assegnabili.length === 0) {
    return (
      <Pannello>
        <p className="text-sm font-semibold text-text">Nulla da fare</p>
        <p className="mt-1 text-sm text-text-muted">
          Non c&apos;è nessuna campagna attiva da assegnare a questo cliente: o le ha già ricevute tutte, o non è tra i destinatari.
        </p>
      </Pannello>
    );
  }

  const scelta = assegnabili.find((c) => c.id === campagnaId) ?? assegnabili[0];
  const nonLaPiuVecchia = scelta.id !== assegnabili[0].id;

  async function invia(tipo: "ordine" | "banco") {
    setEsito(null);
    if (tipo === "banco" && !window.confirm(`Confermi la consegna al banco di ${scelta.codice}?`)) return;
    setOccupato(true);
    const r = await chiamaApi<{ invio: Invio }>("/api/portali/campagne/invii", {
      corpo:
        tipo === "ordine"
          ? {
              tipo,
              codice_cliente: codiceCliente,
              campagna_id: scelta.id,
              referente,
              ordine_numero: ordineNumero,
              ordine_anno: Number(ordineAnno),
            }
          : { tipo, codice_cliente: codiceCliente, campagna_id: scelta.id, referente: referente || null },
    });
    setOccupato(false);
    if (!r.ok) {
      setEsito({ tipo: "errore", testo: r.errore });
      return;
    }
    setReferente("");
    setOrdineNumero("");
    setEsito({
      tipo: "ok",
      testo: tipo === "ordine" ? `Busta ${scelta.codice} preparata.` : `Consegna al banco di ${scelta.codice} registrata.`,
    });
    router.refresh();
  }

  return (
    <section className="rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-white to-primary/5 p-5 shadow-[0_8px_24px_rgba(0,161,190,0.10)]">
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">Azione suggerita</p>
      <h2 className="mt-1 font-tenorite text-xl font-bold text-text">
        Preparare {assegnabili[0].codice} · {assegnabili[0].nome}
      </h2>
      {assegnabili[0].note ? <p className="mt-1 text-sm text-text-muted">{assegnabili[0].note}</p> : null}

      {assegnabili.length > 1 ? (
        <div className="mt-4 max-w-md">
          <Campo etichetta="Campagna da assegnare" aiuto={nonLaPiuVecchia ? "Non è la campagna più vecchia: di norma si assegna quella suggerita." : undefined}>
            <select className={classeSelect} value={campagnaId} onChange={(e) => setCampagnaId(e.target.value)}>
              {assegnabili.map((c, n) => (
                <option key={c.id} value={c.id}>
                  {c.codice} · {c.nome}
                  {n === 0 ? " (suggerita)" : ""}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      ) : null}

      {ordiniAperti.filter((o) => !o.invio_id).length > 0 ? (
        <div className="mt-4">
          <p className="mb-1.5 text-sm font-medium text-text">Ordini aperti del cliente</p>
          <div className="flex flex-wrap gap-2">
            {ordiniAperti
              .filter((o) => !o.invio_id)
              .map((o) => {
                const scelto = ordineNumero === o.numero && ordineAnno === String(o.anno);
                return (
                  <button
                    key={`${o.profilo}|${o.anno}|${o.numero}`}
                    type="button"
                    onClick={() => {
                      setOrdineNumero(o.numero);
                      setOrdineAnno(String(o.anno));
                    }}
                    aria-pressed={scelto}
                    className={`rounded-lg border px-3 py-1.5 text-left text-xs transition-colors ${
                      scelto ? "border-primary bg-primary/10 text-text" : "border-border bg-white text-text hover:bg-bg-page"
                    }`}
                  >
                    <span className="block font-semibold">
                      {o.profilo} {o.numero}/{o.anno}
                    </span>
                    <span className="block text-text-muted">
                      del {formattaData(o.data_ordine)}
                      {o.consegna_prevista ? ` · consegna ${formattaData(o.consegna_prevista)}` : ""}
                      {o.ha_documentazione ? " · ha già la riga" : ""}
                    </span>
                  </button>
                );
              })}
          </div>
          <p className="mt-1 text-xs text-text-muted">Dati di Impresa aggiornati ogni notte: un ordine di oggi si vede da domani.</p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Campo etichetta="Referente dell'azienda *">
          <Input value={referente} onChange={(e) => setReferente(e.target.value)} placeholder="Nome e cognome" maxLength={120} />
        </Campo>
        <Campo etichetta="N° ordine Impresa *">
          <Input value={ordineNumero} onChange={(e) => setOrdineNumero(e.target.value)} placeholder="es. 1117" inputMode="numeric" maxLength={20} />
        </Campo>
        <Campo etichetta="Anno ordine">
          <Input value={ordineAnno} onChange={(e) => setOrdineAnno(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" />
        </Campo>
      </div>

      <div className="mt-3 rounded-lg bg-bg-page px-3 py-2 text-xs text-text-muted">
        <p>Nell&apos;ordine in Impresa deve esserci una riga con:</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <Copia etichetta="Articolo" valore={scelta.articolo_codice} />
          <Copia etichetta="Descrizione" valore={testoRigaCampagna(scelta)} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => invia("ordine")} disabled={occupato || referente.trim().length < 2 || !ordineNumero.trim() || ordineAnno.length !== 4}>
          {occupato ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
          Busta preparata
        </Button>
        <Button variant="outline" onClick={() => invia("banco")} disabled={occupato}>
          <Store className="h-4 w-4" />
          Banco
        </Button>
        <span className="text-xs text-text-muted">Il banco non richiede ordine: la consegna si registra subito.</span>
      </div>

      {esito ? (
        <div className="mt-3">
          <Messaggio tipo={esito.tipo}>{esito.testo}</Messaggio>
        </div>
      ) : null}
    </section>
  );
}

// ─── Una riga dello storico, con le azioni che lo stato consente ───────────
function RigaInvio({ invio, oggi, annoCorrente }: { invio: Invio; oggi: string; annoCorrente: number }) {
  const router = useRouter();
  const [modo, setModo] = useState<AzioneInvio | null>(null);
  const [referente, setReferente] = useState(invio.referente ?? "");
  const [ordineNumero, setOrdineNumero] = useState(invio.ordine_numero ?? "");
  const [ordineAnno, setOrdineAnno] = useState(String(invio.ordine_anno ?? annoCorrente));
  const [data, setData] = useState(oggi);
  const [motivo, setMotivo] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [esito, setEsito] = useState<Esito | null>(null);

  const consentite = azioniConsentite(invio);

  async function esegui(corpo: Record<string, unknown>, ok: string) {
    setOccupato(true);
    setEsito(null);
    const r = await chiamaApi<{ invio: Invio }>(`/api/portali/campagne/invii/${invio.id}`, { metodo: "PATCH", corpo });
    setOccupato(false);
    if (!r.ok) {
      setEsito({ tipo: "errore", testo: r.errore });
      return;
    }
    setModo(null);
    setEsito({ tipo: "ok", testo: ok });
    router.refresh();
  }

  const ordine = etichettaOrdine(invio);

  return (
    <li className="border-l-[3px] py-4 pl-4" style={{ borderColor: STATO_INVIO_UI[invio.stato].pallino }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">
            {invio.campagna?.codice ?? "—"} <span className="font-normal text-text-muted">· {invio.campagna?.nome ?? ""}</span>
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            {ordine ? `Ordine ${ordine}` : "Senza ordine"}
            {invio.referente ? ` · referente ${invio.referente}` : ""}
            {invio.origine === "import_excel" ? " · storico Excel" : ""}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            Assegnata {formattaDataOra(invio.assegnata_il)}
            {invio.data_consegna
              ? ` · consegna ${formattaData(invio.data_consegna)}${invio.fonte_consegna ? ` (${ETICHETTA_FONTE[invio.fonte_consegna] ?? invio.fonte_consegna})` : ""}`
              : ""}
          </p>
          {invio.ddt_numero ? (
            <p className="mt-0.5 text-xs text-text-muted">
              DDT {invio.ddt_numero}
              {invio.ddt_metodo === "euristico" ? " (abbinato per data)" : ""}
            </p>
          ) : null}
          {invio.controllo_esito && (invio.stato === "preparata" || invio.stato === "da_spedire") ? (
            <p className="mt-0.5 text-xs text-text-muted">{ESITO_CONTROLLO[invio.controllo_esito]}</p>
          ) : null}
          {invio.note ? <p className="mt-0.5 text-xs text-text-muted">{invio.note}</p> : null}
          {invio.stato === "annullata" && invio.motivo_annullo ? (
            <p className="mt-0.5 text-xs text-text-muted">Annullata: {invio.motivo_annullo}</p>
          ) : null}
        </div>
        <StatoInvioChip stato={invio.stato} />
      </div>

      {consentite.length > 0 && modo === null ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {consentite.includes("modifica") ? (
            <Button size="sm" variant="outline" onClick={() => setModo("modifica")}>Modifica</Button>
          ) : null}
          {consentite.includes("consegna") ? (
            <Button size="sm" variant="outline" onClick={() => setModo("consegna")}>Segna consegnata</Button>
          ) : null}
          {consentite.includes("banco") ? (
            <Button
              size="sm"
              variant="outline"
              disabled={occupato}
              onClick={() => {
                if (window.confirm("Il cliente ha ritirato la busta al banco?")) void esegui({ azione: "banco" }, "Consegna al banco registrata.");
              }}
            >
              Ritirata al banco
            </Button>
          ) : null}
          {consentite.includes("annulla") ? (
            <Button size="sm" variant="ghost" onClick={() => setModo("annulla")}>Annulla invio</Button>
          ) : null}
        </div>
      ) : null}

      {modo === "modifica" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <Campo etichetta="Referente">
            <Input value={referente} onChange={(e) => setReferente(e.target.value)} maxLength={120} />
          </Campo>
          <Campo etichetta="N° ordine">
            <Input value={ordineNumero} onChange={(e) => setOrdineNumero(e.target.value)} maxLength={20} />
          </Campo>
          <Campo etichetta="Anno">
            <Input value={ordineAnno} onChange={(e) => setOrdineAnno(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          </Campo>
          <div className="flex gap-2 sm:col-span-3">
            <Button
              size="sm"
              disabled={occupato}
              onClick={() =>
                esegui(
                  { azione: "modifica", referente, ordine_numero: ordineNumero, ordine_anno: Number(ordineAnno) },
                  "Dati aggiornati."
                )
              }
            >
              Salva
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setModo(null)}>Chiudi</Button>
          </div>
        </div>
      ) : null}

      {modo === "consegna" ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Campo etichetta="Data di consegna">
            <Input type="date" value={data} max={oggi} onChange={(e) => setData(e.target.value)} className="w-44" />
          </Campo>
          <Button size="sm" disabled={occupato || !data} onClick={() => esegui({ azione: "consegna", data_consegna: data }, "Consegna registrata.")}>
            Conferma
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setModo(null)}>Chiudi</Button>
        </div>
      ) : null}

      {modo === "annulla" ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <Campo etichetta="Motivo dell'annullamento" aiuto="L'invio si chiude e la campagna torna assegnabile al cliente.">
              <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
            </Campo>
          </div>
          <Button size="sm" variant="danger" disabled={occupato || motivo.trim().length < 3} onClick={() => esegui({ azione: "annulla", motivo }, "Invio annullato.")}>
            Annulla invio
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setModo(null)}>Chiudi</Button>
        </div>
      ) : null}

      {esito ? (
        <div className="mt-2">
          <Messaggio tipo={esito.tipo}>{esito.testo}</Messaggio>
        </div>
      ) : null}
    </li>
  );
}
