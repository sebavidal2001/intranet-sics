import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { elencoConfigAi, numeroParametro } from "@/lib/ai/config";
import { chiaveConfigurata, credito, elencoModelli } from "@/lib/ai/openrouter";
import { AiConfigForm, type ModelloScelta, type VoceConfig } from "./ai-config-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configurazione AI" };

/**
 * Quali modelli usa l'intranet, e con quale credito.
 *
 * La pagina esiste per una ragione pratica: il modello giusto per un lavoro
 * cambia ogni pochi mesi, e finché la scelta stava nel codice cambiarla voleva
 * dire un deploy. Qui è una tendina, riempita con l'elenco vero di OpenRouter —
 * così non si può scrivere storto un identificativo — e limitata ai modelli che
 * accettano immagini, perché le fatture da leggere sono immagini.
 *
 * La chiave API non si tocca da qui: sta nell'ambiente della VM, con le altre
 * credenziali. Di lei la pagina mostra quello che serve sapere davvero, cioè se
 * c'è e quanto credito è rimasto.
 */
export default async function ConfigurazioneAiPage() {
  const voci = await elencoConfigAi();

  const [modelli, saldo] = await Promise.all([
    elencoModelli().catch(() => []),
    chiaveConfigurata() ? credito().catch(() => null) : Promise.resolve(null),
  ]);

  const conVisione: ModelloScelta[] = modelli
    .filter((m) => m.vedeImmagini && m.prezzoIngresso !== null)
    .sort((a, b) => (a.prezzoIngresso ?? 0) - (b.prezzoIngresso ?? 0))
    .map((m) => ({
      id: m.id,
      nome: m.nome,
      prezzoIngresso: m.prezzoIngresso,
      prezzoUscita: m.prezzoUscita,
    }));

  const vociForm: VoceConfig[] = voci.map((v) => ({
    chiave: v.chiave,
    descrizione: v.descrizione,
    modelloPrimario: v.modelloPrimario,
    modelloRiserva: v.modelloRiserva,
    attivo: v.attivo,
    dpi: numeroParametro(v, "dpi", 200),
    massimoPagine: numeroParametro(v, "massimo_pagine", 8),
    timeoutSecondi: numeroParametro(v, "timeout_secondi", 120),
    massimoTokenRisposta: numeroParametro(v, "massimo_token_risposta", 8000),
    aggiornatoIl: v.aggiornatoIl,
  }));

  return (
    <div className="max-w-4xl">
      <Breadcrumbs items={[{ label: "Superadmin", href: "/superadmin" }, { label: "AI" }]} />

      <h1 className="font-tenorite text-2xl text-text mt-4">Configurazione AI</h1>
      <p className="text-sm text-text-muted mt-2 mb-6">
        I modelli che l&apos;intranet usa, scelti fra quelli che OpenRouter offre oggi. Cambiarli
        qui ha effetto dal prossimo documento: non serve un rilascio.
      </p>

      <div className="bg-bg border border-border rounded-xl p-5 mb-6">
        <h2 className="font-tenorite text-base text-text mb-3">Accesso a OpenRouter</h2>
        {!chiaveConfigurata() ? (
          <p className="text-sm text-danger">
            La chiave <code className="text-xs">OPENROUTER_API_KEY</code> non è configurata sul
            server: la lettura assistita non parte e le fatture senza testo restano al
            riconoscimento ottico locale.
          </p>
        ) : saldo === null ? (
          <p className="text-sm text-warning">
            La chiave è configurata, ma il credito non è leggibile in questo momento.
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span className="text-text-muted">
              Credito caricato: <strong className="text-text">{saldo.totale.toFixed(2)} $</strong>
            </span>
            <span className="text-text-muted">
              Consumato: <strong className="text-text">{saldo.usato.toFixed(2)} $</strong>
            </span>
            <span className={saldo.residuo <= 0 ? "text-danger" : "text-text-muted"}>
              Residuo:{" "}
              <strong className={saldo.residuo <= 0 ? "text-danger" : "text-text"}>
                {saldo.residuo.toFixed(2)} $
              </strong>
              {saldo.residuo <= 0 && " — esaurito: le letture falliranno finché non si ricarica."}
            </span>
          </div>
        )}
        <p className="text-xs text-text-muted mt-3">
          La chiave si cambia in <code className="text-xs">.env.local</code> sulla VM, non da
          questa pagina: in tabella finirebbe nei backup e nei dump di sviluppo.
        </p>
      </div>

      {conVisione.length === 0 && (
        <p className="text-sm text-warning mb-4">
          L&apos;elenco dei modelli non è raggiungibile: restano selezionabili solo quelli già
          configurati.
        </p>
      )}

      <div className="space-y-5">
        {vociForm.map((voce) => (
          <AiConfigForm key={voce.chiave} voce={voce} modelli={conVisione} />
        ))}
      </div>

      <div className="mt-8 text-sm text-text-muted border-t border-border pt-5 space-y-2">
        <p>
          <strong className="text-text">Come viene usato il modello di riserva.</strong> La
          lettura di una fattura viene sempre confrontata con i totali stampati sul documento: se
          la somma delle righe non torna, la fattura non si archivia. Il modello di riserva entra
          in gioco solo in quel caso — a decidere se vale la pena spendere di più è una prova
          aritmetica, non una regola fissa.
        </p>
        <p>
          <strong className="text-text">Cosa esce dall&apos;azienda.</strong> Le pagine delle
          fatture senza testo vengono inviate al fornitore del modello per essere lette.
          Contengono nomi di clienti e fornitori, indirizzi e importi.
        </p>
      </div>
    </div>
  );
}
