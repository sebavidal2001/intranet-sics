import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import {
  FatturaNonLeggibile,
  leggiFattura,
  quadra,
} from "@/lib/portali/vettori/fatture";
import {
  preparaAcquisizione,
  erroreEstremiMancanti,
  risolviEstremiFattura,
  salvaAcquisizione,
} from "@/lib/portali/vettori/acquisizione";
import { logError } from "@/lib/logger";
import { MisureFattura } from "@/lib/portali/vettori/misure";
import { leggiFedexOcr, type LetturaOcr } from "@/lib/portali/vettori/fatture/fedex";
import { leggiFatturaConModello, type LetturaConModello } from "@/lib/portali/vettori/fatture/llm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTE = 15 * 1024 * 1024;

const CampiOperatore = z.object({
  numeroFattura: z.preprocess(
    (valore) => valore === null || valore === "" ? undefined : valore,
    z.string().trim().min(1, "Il numero della fattura non può essere vuoto.").max(100, "Il numero della fattura può contenere al massimo 100 caratteri.").optional()
  ),
  dataFattura: z.preprocess(
    (valore) => valore === null || valore === "" ? undefined : valore,
    z.string().date("La data della fattura deve avere il formato AAAA-MM-GG.").optional()
  ),
});

/**
 * POST /api/portali/vettori/fatture/acquisisci
 *
 * Legge il PDF, aggancia le righe alle bolle, calcola il costo atteso e salva
 * tutto in una transazione.
 *
 * Il file viene **riletto qui**, non ricevuto già interpretato dal browser. Una
 * fattura che entra in archivio deve venire dal PDF che l'operatore ha in mano,
 * non da un oggetto costruito nella pagina: sarebbe l'unico punto del modulo in
 * cui i numeri salvati non hanno una fonte verificabile.
 *
 * Con `?anteprima=1` fa tutto tranne l'ultimo passo. È la stessa strada, così
 * quello che si vede a schermo è esattamente quello che verrà scritto.
 */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
    if (!guard.ok) return guard.response;

    const soloAnteprima = request.nextUrl.searchParams.get("anteprima") === "1";

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Nessun file ricevuto." }, { status: 400 });
    }
    if (file.size > MAX_BYTE) {
      return NextResponse.json(
        { error: `Il file supera i ${MAX_BYTE / 1024 / 1024} MB: non sembra una fattura.` },
        { status: 413 }
      );
    }

    const campiOperatore = CampiOperatore.safeParse({
      numeroFattura: form.get("numeroFattura"),
      dataFattura: form.get("dataFattura"),
    });
    if (!campiOperatore.success) {
      return NextResponse.json(
        { error: campiOperatore.error.issues.map((issue) => issue.message).join(" ") },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");

    const { extractText, getDocumentProxy } = await import("unpdf");
    let testo: string;
    try {
      // Una copia, non i byte originali: pdf.js **stacca** l'array che riceve.
      // Senza questa copia `bytes` resta svuotato, e la strada del
      // riconoscimento ottico — che parte subito sotto, sugli stessi byte —
      // muore con «Cannot perform slice on a detached ArrayBuffer» prima
      // ancora di leggere una pagina. Cioè: nessuna fattura scansionata
      // sarebbe mai stata acquisibile.
      const pdf = await getDocumentProxy(bytes.slice());
      const estratto = await extractText(pdf, { mergePages: true });
      testo = Array.isArray(estratto.text) ? estratto.text.join("\n") : estratto.text;
    } catch {
      return NextResponse.json(
        { error: "Il file non è un PDF leggibile o è danneggiato." },
        { status: 422 }
      );
    }

    /**
     * Lettura: prima il testo, e solo se il testo non c'e il riconoscimento
     * ottico.
     *
     * L'ordine non e negoziabile. Il testo di un PDF e il documento; il
     * riconoscimento ottico e un'interpretazione di un'immagine del documento,
     * per quanto accurata. Usarlo dove il testo c'e significherebbe scegliere
     * la fonte peggiore avendo quella migliore a disposizione.
     */
    let fattura;
    let ocr: LetturaOcr | null = null;
    let lettura: LetturaConModello | null = null;
    try {
      fattura = leggiFattura(testo);
    } catch (e) {
      if (!(e instanceof FatturaNonLeggibile) || e.motivo !== "senza_testo") throw e;

      /**
       * Senza testo, prima il modello e poi il riconoscimento ottico.
       *
       * Fra le due interpretazioni di un'immagine si sceglie quella che sui
       * documenti veri funziona meglio: misurato sulle tre fatture del 2026 che
       * nessun lettore prendeva, il modello ricostruisce le FedEx riga per riga
       * — compresa quella da 9,04 € che l'OCR perdeva — mentre Tesseract ne
       * recupera una parte. L'OCR resta come ripiego per quando la lettura
       * assistita è spenta, la chiave non c'è o il servizio non risponde: è
       * locale e non dipende da nessuno.
       *
       * Nessuna delle due scorciatoie salta la quadratura, che poco più sotto
       * decide se la fattura si può archiviare.
       */
      lettura = await leggiFatturaConModello(bytes);
      if (lettura.fattura && lettura.fattura.righe.length > 0) {
        fattura = lettura.fattura;
      } else {
        ocr = await leggiFedexOcr(bytes);
        if (ocr.fattura.righe.length === 0) {
          return NextResponse.json(
            {
              error:
                "Il PDF non contiene testo, e né la lettura assistita né il riconoscimento " +
                "ottico hanno trovato spedizioni. " + (ocr.spiegazioni[0] ?? ""),
              motivo: "senza_testo",
              spiegazioni: [...lettura.spiegazioni, ...ocr.spiegazioni],
            },
            { status: 422 }
          );
        }
        fattura = ocr.fattura;
      }
    }
    let misureInput: unknown;
    try { misureInput = JSON.parse(String(form.get("misure") ?? "[]")); }
    catch { return NextResponse.json({ error: "Misure non valide." }, { status: 400 }); }
    const misure = MisureFattura.safeParse(misureInput);
    if (!misure.success || misure.data.some((m) => !fattura.righe.some((r) => r.numero === m.riga))) {
      return NextResponse.json({ error: misure.success ? "Riga di fattura non trovata." : misure.error.issues.map((i) => i.message).join(" ") }, { status: 400 });
    }
    const quadratura = quadra(fattura);
    const estremi = risolviEstremiFattura(fattura, {
      numero: campiOperatore.data.numeroFattura,
      data: campiOperatore.data.dataFattura,
    });

    // La quadratura è il gate. Una fattura che non quadra si può guardare, non
    // acquisire: le righe che mancano non si vedono guardando quelle lette.
    if (!soloAnteprima && !quadratura.ok) {
      return NextResponse.json(
        {
          error:
            "La fattura non quadra con i totali stampati: non può essere acquisita.",
          quadratura,
        },
        { status: 409 }
      );
    }

    const { payload, riepilogo } = await preparaAcquisizione({
      fattura,
      quadraturaOk: quadratura.ok,
      quadraturaNote: [...quadratura.note, ...fattura.avvertenze].join(" ") || null,
      nomeFile: file.name,
      hashFile: hash,
      utenteId: guard.user.id,
      misure: misure.data,
      metodoLettura: lettura?.fattura ? "modello" : ocr ? "ocr" : "testo",
      numeroFattura: campiOperatore.data.numeroFattura,
      dataFattura: campiOperatore.data.dataFattura,
    });

    if (soloAnteprima) {
      return NextResponse.json({
        salvata: false,
        nomeFile: file.name,
        origineMetadati: {
          numero: fattura.numero ? "documento" : "assente",
          data: fattura.data ? "documento" : "assente",
        },
        fattura: {
          vettore: fattura.vettore,
          numero: fattura.numero,
          data: fattura.data,
          totali: fattura.totali,
          avvertenze: fattura.avvertenze,
          righeNonLette: fattura.righeNonLette,
        },
        quadratura,
        riepilogo,
        righe: payload.righe,
        // Con il riconoscimento ottico l'anteprima porta anche l'immagine della
        // pagina e la confidenza cella per cella: e li che l'operatore
        // controlla, e senza il documento accanto il controllo sarebbe un atto
        // di fede.
        ocr: ocr
          ? {
              pagine: ocr.pagine,
              spiegazioni: ocr.spiegazioni,
              ruoli: ocr.ruoli,
              righe: ocr.righeGrezze,
            }
          : null,
      });
    }

    // Otto allegati GLS reali del 2026 contengono 414 righe tutte leggibili e
    // quadrate, ma nessuno contiene numero o data. Li fermiamo qui con una
    // spiegazione utile, prima che i NOT NULL del database producano un errore
    // tecnico che l'operatore non può risolvere.
    const erroreEstremi = erroreEstremiMancanti(fattura.vettore, estremi);
    if (erroreEstremi) {
      return NextResponse.json(
        { error: erroreEstremi },
        { status: 400 }
      );
    }

    const esito = await salvaAcquisizione(payload);
    return NextResponse.json({ salvata: true, esito, riepilogo, quadratura });
  } catch (e) {
    if (e instanceof FatturaNonLeggibile) {
      return NextResponse.json({ error: e.message, motivo: e.motivo }, { status: 422 });
    }
    const messaggio = e instanceof Error ? e.message : String(e);
    // Gli errori che la RPC solleva di proposito sono risposte all'operatore,
    // non guasti: il file già caricato e il mese chiuso sono i due casi normali.
    if (/hash_file|uq_fatture/.test(messaggio)) {
      return NextResponse.json(
        { error: "Questa fattura è già stata caricata." },
        { status: 409 }
      );
    }
    if (/già chiuso/.test(messaggio)) {
      return NextResponse.json({ error: messaggio }, { status: 409 });
    }
    logError("vettori.fatture.acquisisci", "acquisizione fallita", e);
    return NextResponse.json(
      { error: "Errore nell'acquisizione della fattura." },
      { status: 500 }
    );
  }
}
