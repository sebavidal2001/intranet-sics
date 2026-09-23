/**
 * Acquisisce una fattura trascritta a mano, quando il documento non si lascia
 * leggere da solo.
 *
 * Serve per i PDF che sono un'immagine e basta: la Trading Post di gennaio
 * 2026 è una scansione ruotata, le FedEx di giugno e luglio sono disegni da cui
 * il riconoscimento ottico recupera cinque righe su sei. Chiedere al corriere
 * il documento nativo resta la strada preferibile — ma nel frattempo la fattura
 * esiste, è leggibile a occhio, e lasciarla fuori dall'archivio significa avere
 * un mese in meno di controllo.
 *
 * ============================================================================
 * COSA RENDE ACCETTABILE UNA TRASCRIZIONE
 * ============================================================================
 * Non il fatto che qualcuno l'abbia fatta con attenzione: il fatto che si possa
 * **verificare senza fidarsi**. Nel file si trascrivono due cose che sul
 * documento stanno in posti diversi — le righe dal corpo della fattura e i
 * totali dal piede — e poi si lascia decidere alla quadratura, esattamente come
 * per le fatture lette dal programma. Se chi trascrive sbaglia una cifra, la
 * somma delle righe non torna con il totale stampato e il caricamento si
 * rifiuta.
 *
 * Su una fattura Trading Post la verifica è quintupla: numero di spedizioni,
 * colli, chili, nolo e totale devono tornare tutti. Trascrivere 23 righe
 * sbagliando in modo che tutte e cinque le somme tornino lo stesso non è una
 * cosa che capita per distrazione.
 *
 * La fattura entra in archivio con `metodo_lettura = 'manuale'`, che è un
 * valore previsto dallo schema fin dall'inizio: chi la rivede vede da dove
 * viene.
 *
 *   VETTORI_TRASCRIZIONI=/percorso/json VETTORI_FATTURE_DIR=/percorso/pdf \
 *     npx vitest run --config scripts/vettori/vitest-trascritta.config.ts
 *
 * Senza `VETTORI_CARICA=1` si ferma alla verifica e stampa cosa farebbe.
 */
import { it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { quadra } from "../../src/lib/portali/vettori/fatture";
import type {
  CodiceVettore,
  FatturaLetta,
  RigaFattura,
  TotaliDichiarati,
} from "../../src/lib/portali/vettori/fatture/tipi";
import {
  preparaAcquisizione,
  erroreEstremiMancanti,
  risolviEstremiFattura,
  salvaAcquisizione,
} from "../../src/lib/portali/vettori/acquisizione";

process.loadEnvFile(".env.local");

const CARTELLA = process.env.VETTORI_TRASCRIZIONI;
const PDF = process.env.VETTORI_FATTURE_DIR;
const SCRIVI = process.env.VETTORI_CARICA === "1";

interface RigaTrascritta {
  data: string | null;
  numeroSpedizione: string | null;
  riferimento: string | null;
  controparte: string | null;
  direzione: "entrata" | "uscita" | null;
  colli: number | null;
  peso: number | null;
  pesoTassato?: number | null;
  pesoVolumetrico?: number | null;
  nolo: number | null;
  supplementi?: number;
  carburante?: number;
  [altro: string]: unknown;
}

interface Trascrizione {
  vettore: CodiceVettore;
  numero: string;
  data: string;
  pdf?: string;
  totaliDichiarati: Partial<TotaliDichiarati> & { pesoRiferito?: "reale" | "tassato" };
  righe: RigaTrascritta[];
}

/**
 * Il dettaglio conserva quello che sul documento c'è e nel modello no: le
 * dimensioni stampate da FedEx, la provincia, la tariffa di Trading Post.
 * Non entra nel calcolo, ma chi rivede la riga lo trova accanto ai numeri.
 */
function dettaglioDi(r: RigaTrascritta): Record<string, number | string> {
  const fuori: Record<string, number | string> = { origine: "trascritta a vista dal documento" };
  for (const [chiave, valore] of Object.entries(r)) {
    if (["data", "numeroSpedizione", "riferimento", "controparte", "direzione",
         "colli", "peso", "pesoTassato", "pesoVolumetrico", "nolo",
         "supplementi", "carburante"].includes(chiave)) continue;
    if (typeof valore === "number" || typeof valore === "string") fuori[chiave] = valore;
    if (typeof valore === "boolean") fuori[chiave] = valore ? "sì" : "no";
  }
  return fuori;
}

function fatturaDa(t: Trascrizione): FatturaLetta {
  const righe: RigaFattura[] = t.righe.map((r, i) => {
    const supplementi = r.supplementi ?? 0;
    const carburante = r.carburante ?? 0;
    return {
      numero: i + 1,
      data: r.data,
      numeroSpedizione: r.numeroSpedizione,
      riferimento: r.riferimento,
      controparte: r.controparte,
      direzione: r.direzione,
      colli: r.colli,
      peso: r.peso,
      pesoVolumetrico: r.pesoVolumetrico ?? null,
      pesoTassato: r.pesoTassato ?? null,
      nolo: r.nolo,
      supplementi,
      carburante,
      totale: Math.round(((r.nolo ?? 0) + supplementi + carburante) * 100) / 100,
      dettaglio: dettaglioDi(r),
    };
  });

  return {
    vettore: t.vettore,
    numero: t.numero,
    data: t.data,
    anno: Number(t.data.slice(0, 4)),
    mese: Number(t.data.slice(5, 7)),
    righe,
    totali: {
      spedizioni: t.totaliDichiarati.spedizioni ?? null,
      colli: t.totaliDichiarati.colli ?? null,
      peso: t.totaliDichiarati.peso ?? null,
      pesoRiferito: t.totaliDichiarati.pesoRiferito ?? "reale",
      nolo: t.totaliDichiarati.nolo ?? null,
      supplementi: t.totaliDichiarati.supplementi ?? null,
      adeguamento: t.totaliDichiarati.adeguamento ?? null,
      carburante: t.totaliDichiarati.carburante ?? null,
      percentualeCarburante: t.totaliDichiarati.percentualeCarburante ?? null,
      totaleDocumento: t.totaliDichiarati.totaleDocumento ?? null,
      totaleRighe: t.totaliDichiarati.totaleRighe ?? null,
    },
    righeNonLette: [],
    avvertenze: [
      "Fattura trascritta a mano dal documento: i numeri non vengono da una lettura automatica. " +
        "La quadratura con i totali stampati è la verifica che la trascrizione sia fedele.",
    ],
  };
}

it("verifica e acquisisce le fatture trascritte", async () => {
  expect(CARTELLA, "VETTORI_TRASCRIZIONI non impostata").toBeTruthy();
  const nomi = readdirSync(CARTELLA!).filter((n) => n.endsWith(".json")).sort();
  console.log(`${nomi.length} trascrizioni${SCRIVI ? "" : " — verifica, non scrive"}`);

  for (const nome of nomi) {
    const t = JSON.parse(readFileSync(join(CARTELLA!, nome), "utf8")) as Trascrizione;
    const fattura = fatturaDa(t);
    const quadratura = quadra(fattura);

    console.log(
      `\n${nome}\n  ${fattura.vettore} ${fattura.numero} del ${fattura.data}, ` +
        `${fattura.righe.length} righe`
    );
    for (const c of quadratura.confronti) {
      if (c.dichiarato == null) continue;
      console.log(
        `  ${c.ok ? "ok  " : "NO  "}${c.voce}: dichiarato ${c.dichiarato}, ` +
          `somma delle righe ${c.calcolato}`
      );
    }

    if (!quadratura.ok) {
      console.log(`  NON ACQUISITA: ${quadratura.note.join(" ")}`);
      continue;
    }

    // Il PDF, quando c'è, dà l'impronta del documento: ricaricarlo poi in altro
    // modo verrebbe rifiutato come doppione, ed è giusto così.
    let hash: string | null = null;
    const pdf = t.pdf && PDF ? join(PDF, t.pdf) : null;
    if (pdf && existsSync(pdf)) {
      hash = createHash("sha256").update(new Uint8Array(readFileSync(pdf))).digest("hex");
    }

    const estremi = risolviEstremiFattura(fattura, {});
    const erroreEstremi = erroreEstremiMancanti(fattura.vettore, estremi);
    if (erroreEstremi) {
      console.log(`  NON ACQUISITA: ${erroreEstremi}`);
      continue;
    }

    const { payload, riepilogo } = await preparaAcquisizione({
      fattura,
      quadraturaOk: true,
      quadraturaNote: fattura.avvertenze.join(" "),
      nomeFile: t.pdf ?? nome,
      hashFile: hash,
      utenteId: null,
      metodoLettura: "manuale",
    });

    console.log(
      `  fatturato ${riepilogo.totaleFatturato} / atteso ${riepilogo.totaleAtteso} — ` +
        `${riepilogo.anomalie} anomalie, ${riepilogo.nonValutabili} non valutabili, ` +
        `${riepilogo.senzaCandidati} senza bolla`
    );

    if (!SCRIVI) {
      console.log("  quadra: pronta da acquisire");
      continue;
    }
    try {
      await salvaAcquisizione(payload);
      console.log("  ACQUISITA");
    } catch (e) {
      const messaggio = e instanceof Error ? e.message : String(e);
      console.log(
        `  NON ACQUISITA: ${/hash_file|uq_fatture/.test(messaggio) ? "già in archivio" : messaggio}`
      );
    }
  }
  expect(nomi.length).toBeGreaterThan(0);
}, 600_000);
