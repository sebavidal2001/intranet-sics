/**
 * Estrae il testo delle fatture dei vettori e lo salva come fixture di test.
 *
 * I test dei parser NON leggono i PDF: leggono il testo estratto qui. Due
 * ragioni. La prima è che un test non deve dipendere da file che stanno nei
 * Download di qualcuno. La seconda è che così, se un giorno cambia la libreria
 * di estrazione, il test dice subito se il testo è cambiato — invece di
 * segnalare un parser rotto quando il parser è a posto.
 *
 * Uso:
 *   node scripts/vettori/estrai-testo-fatture.mjs <cartella-con-i-pdf>
 */
import { extractText, getDocumentProxy } from "unpdf";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const sorgente = process.argv[2];
if (!sorgente) {
  console.error("Indicare la cartella dei PDF.");
  process.exit(1);
}
const destinazione = path.resolve("src/tests/fixtures/fatture");
await mkdir(destinazione, { recursive: true });

async function* pdfIn(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* pdfIn(p);
    else if (/\.pdf$/i.test(e.name)) yield p;
  }
}

for await (const f of pdfIn(sorgente)) {
  const buf = new Uint8Array(await readFile(f));
  const pdf = await getDocumentProxy(buf);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const nome = path
    .basename(f, path.extname(f))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const out = path.join(destinazione, `${nome}.txt`);
  await writeFile(out, text, "utf8");
  console.log(
    `${String(totalPages).padStart(2)} pag · ${String(text.length).padStart(6)} car · ${nome}.txt`
  );
}
