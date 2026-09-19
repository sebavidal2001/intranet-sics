/**
 * Carica in archivio le fatture dei vettori partendo dai PDF.
 *
 * È la stessa strada di `POST /api/portali/vettori/fatture/acquisisci`: il PDF
 * viene riletto qui, non ricevuto già interpretato. Serve quando le fatture da
 * caricare sono decine e passarle a mano dal portale, una per una, costerebbe
 * un pomeriggio — non per aggirare i controlli, che restano tutti: quadratura,
 * estremi obbligatori, hash per non caricare due volte lo stesso documento.
 *
 * Eseguire dalla radice del progetto, sulla macchina che ha le credenziali del
 * database da scrivere (in produzione: la VM, con il suo `.env.local`):
 *
 *   VETTORI_FATTURE_DIR=/percorso/pdf \
 *     npx vitest run --config scripts/vettori/vitest-carica.config.ts
 *
 * Senza altro, si ferma all'anteprima e stampa cosa farebbe. Per scrivere
 * davvero serve dirlo:  VETTORI_CARICA=1
 */
import { it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { leggiFattura, quadra, FatturaNonLeggibile } from "../../src/lib/portali/vettori/fatture";
import { leggiFedexOcr } from "../../src/lib/portali/vettori/fatture/fedex";
import {
  preparaAcquisizione,
  erroreEstremiMancanti,
  risolviEstremiFattura,
  salvaAcquisizione,
} from "../../src/lib/portali/vettori/acquisizione";

process.loadEnvFile(".env.local");

const CARTELLA = process.env.VETTORI_FATTURE_DIR;
const SCRIVI = process.env.VETTORI_CARICA === "1";
/** Un pezzo di nome file, per ripassare su una sola fattura senza rifare l'OCR di tutte. */
const SOLO = process.env.VETTORI_FATTURE_SOLO;

/**
 * Estremi letti a occhio sul documento, quando il lettore non li trova.
 *
 * È il caso della FedEx di maggio: il riconoscimento ottico prende il numero
 * ma non la data, che sulla fattura c'è ed è stampata in chiaro. Vanno in un
 * file accanto ai PDF, `estremi.json`, nella forma
 * `{ "ft fedex_05.pdf": { "data": "2026-05-26" } }`, perché un valore indicato
 * da una persona resti scritto da qualche parte invece di vivere dentro un
 * comando lanciato una volta sola. Quello che il documento dichiara ha
 * comunque la precedenza: qui si colmano assenze, non si correggono letture.
 */
function estremiIndicati(): Record<string, { numero?: string; data?: string }> {
  try {
    return JSON.parse(readFileSync(join(CARTELLA!, "estremi.json"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * GLS stampa gli estremi solo sulla fattura cartacea: il PDF è l'allegato con
 * il dettaglio delle spedizioni. Il numero sta nel nome del file, e la data di
 * emissione è l'ultimo giorno del mese fatturato — le stesse due deduzioni che
 * l'interfaccia propone all'operatore, qui dichiarate nello stesso modo.
 */
function estremiDalNomeFile(nomeFile: string): { numero: string; data: string } | null {
  const parti = /^FAT-BM_([^_]+)_.+_(\d{4})_(\d{2})\.pdf$/i.exec(nomeFile);
  if (!parti) return null;
  const [, numero, anno, mese] = parti;
  const ultimo = new Date(Date.UTC(Number(anno), Number(mese), 0));
  return { numero, data: ultimo.toISOString().slice(0, 10) };
}

async function testoDelPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // Copia: pdf.js stacca l'array che riceve, e questi stessi byte servono dopo
  // per il riconoscimento ottico.
  const pdf = await getDocumentProxy(bytes.slice());
  const estratto = await extractText(pdf, { mergePages: true });
  return Array.isArray(estratto.text) ? estratto.text.join("\n") : estratto.text;
}

it("legge i PDF e li porta in archivio", async () => {
  expect(CARTELLA, "VETTORI_FATTURE_DIR non impostata").toBeTruthy();
  const indicati = estremiIndicati();
  const nomi = readdirSync(CARTELLA!)
    .filter((n) => /\.pdf$/i.test(n))
    .filter((n) => !SOLO || n.includes(SOLO))
    .sort();
  console.log(`${nomi.length} file in ${CARTELLA}${SCRIVI ? "" : " — anteprima, non scrive"}`);

  const esiti: string[] = [];
  for (const nome of nomi) {
    const bytes = new Uint8Array(readFileSync(join(CARTELLA!, nome)));
    const hash = createHash("sha256").update(bytes).digest("hex");

    // Prima il testo, e solo se il testo non c'è il riconoscimento ottico:
    // il testo di un PDF è il documento, l'OCR è un'interpretazione.
    let fattura;
    let metodoLettura: "testo" | "ocr" = "testo";
    try {
      fattura = leggiFattura(await testoDelPdf(bytes));
    } catch (e) {
      if (!(e instanceof FatturaNonLeggibile) || e.motivo !== "senza_testo") {
        esiti.push(`${nome}\tNON LETTA\t${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const ocr = await leggiFedexOcr(bytes);
      if (ocr.fattura.righe.length === 0) {
        esiti.push(`${nome}\tNON LETTA\tsenza testo, OCR senza spedizioni: ${ocr.spiegazioni[0] ?? ""}`);
        continue;
      }
      fattura = ocr.fattura;
      metodoLettura = "ocr";
    }

    const quadratura = quadra(fattura);
    const dedotti = { ...estremiDalNomeFile(nome), ...indicati[nome] } as
      | { numero?: string; data?: string }
      | undefined;
    const estremi = risolviEstremiFattura(fattura, {
      numero: dedotti?.numero,
      data: dedotti?.data,
    });
    const erroreEstremi = erroreEstremiMancanti(fattura.vettore, estremi);

    const intestazione =
      `${nome}\t${fattura.vettore}\t${estremi.numero ?? "—"}\t${estremi.data ?? "—"}` +
      `\t${fattura.righe.length} righe\t${metodoLettura}` +
      `\tquadra=${quadratura.ok ? "sì" : "NO"}`;

    if (erroreEstremi) {
      esiti.push(`${intestazione}\tSALTATA: ${erroreEstremi}`);
      continue;
    }
    // La quadratura è il gate: una fattura che non quadra si può guardare, non
    // acquisire. Le righe che mancano non si vedono guardando quelle lette.
    if (!quadratura.ok) {
      esiti.push(`${intestazione}\tSALTATA: ${quadratura.note.join(" ")}`);
      continue;
    }

    const { payload, riepilogo } = await preparaAcquisizione({
      fattura,
      quadraturaOk: quadratura.ok,
      quadraturaNote: [...quadratura.note, ...fattura.avvertenze].join(" ") || null,
      nomeFile: nome,
      hashFile: hash,
      utenteId: null,
      metodoLettura,
      numeroFattura: dedotti?.numero,
      dataFattura: dedotti?.data,
    });

    const conti =
      `fatturato=${riepilogo.totaleFatturato}\tatteso=${riepilogo.totaleAtteso}` +
      `\tanomalie=${riepilogo.anomalie}\tnon_valutabili=${riepilogo.nonValutabili}` +
      `\tsenza_bolla=${riepilogo.senzaCandidati}`;

    if (!SCRIVI) {
      esiti.push(`${intestazione}\t${conti}\tANTEPRIMA`);
      continue;
    }
    try {
      await salvaAcquisizione(payload);
      esiti.push(`${intestazione}\t${conti}\tSALVATA`);
    } catch (e) {
      const messaggio = e instanceof Error ? e.message : String(e);
      const gia = /hash_file|uq_fatture/.test(messaggio) ? "già in archivio" : messaggio;
      esiti.push(`${intestazione}\t${conti}\tNON SALVATA: ${gia}`);
    }
  }

  for (const riga of esiti) console.log(riga);
  expect(esiti.length).toBe(nomi.length);
}, 1_800_000);
