/**
 * Credenziali per i test che leggono dal database vero.
 *
 * Vitest non popola `process.env` con le variabili di `.env.local` (Vite
 * espone solo quelle con prefisso, e qui servono `NEXT_PUBLIC_SUPABASE_URL` e
 * `SUPABASE_SERVICE_ROLE_KEY`). Ogni test del database se le caricava da sé,
 * con lo stesso blocco di sette righe ricopiato in altrettanti file: chi ne
 * scrive uno nuovo senza saperlo si prende un `supabaseUrl is required` che
 * non dice dove sta il problema.
 *
 * Il BOM: `.env.local` è stato salvato da PowerShell almeno una volta, e la
 * prima chiave si porta dietro `﻿`. Senza toglierlo, `NEXT_PUBLIC_...`
 * esiste in `process.env` con un nome che non corrisponde a niente.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function caricaEnvLocale(file = ".env.local"): void {
  let testo: string;
  try {
    testo = readFileSync(resolve(process.cwd(), file), "utf8");
  } catch {
    // Assente: se le variabili sono già nell'ambiente va bene lo stesso, e
    // altrimenti fallisce il test, non il caricamento.
    return;
  }
  for (const riga of testo.split(/\r?\n/)) {
    if (!riga.includes("=") || riga.trim().startsWith("#")) continue;
    const i = riga.indexOf("=");
    const chiave = riga.slice(0, i).replace(/^﻿/, "").trim();
    // Chi ha già un valore nell'ambiente comanda: permette di puntare un test
    // a un altro database senza toccare il file.
    if (!process.env[chiave]) process.env[chiave] = riga.slice(i + 1).trim();
  }
}
