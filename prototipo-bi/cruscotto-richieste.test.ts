/**
 * OGNI SCHEDA DEVE CHIEDERE I DATI CHE DISEGNA.
 *
 * La torta «Quota per business unit» nella scheda Clienti è rimasta vuota senza
 * che nessuno se ne accorgesse: la scheda la disegnava leggendo `ordinatoBu`,
 * ma nel suo blocco di richieste quella chiave non c'era. Ricevendo
 * `undefined`, il grafico mostrava uno **scheletro di caricamento** — e uno
 * scheletro dice «sto arrivando», non «non arriverò mai».
 *
 * È una classe di errore invisibile a occhio, perché somiglia a una pagina
 * lenta. Il controllo si fa sul **sorgente** e non montando i componenti: a
 * schermo l'ordine dei render rende il segnale ambiguo, e un test intermittente
 * su una cosa del genere è peggio che non averlo.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SORGENTE = readFileSync(
  resolve(process.cwd(), "src/components/prototipo-bi/cruscotto-view.tsx"),
  "utf8"
);

/** Le chiavi dichiarate al primo livello di un oggetto letterale. */
function chiaviDi(blocco: string): Set<string> {
  return new Set([...blocco.matchAll(/^\s{6,8}(\w+):/gm)].map((m) => m[1]));
}

/** L'oggetto letterale che si apre dopo `da`, bilanciando le graffe. */
function corpoOggetto(da: number): string {
  const inizio = SORGENTE.indexOf("{", da);
  let livello = 0;
  for (let i = inizio; i < SORGENTE.length; i += 1) {
    if (SORGENTE[i] === "{") livello += 1;
    else if (SORGENTE[i] === "}") {
      livello -= 1;
      if (livello === 0) return SORGENTE.slice(inizio, i + 1);
    }
  }
  return "";
}

/** Chiavi richieste da ogni vista, comprese quelle comuni a tutte. */
function richiestePerVista(): Record<string, Set<string>> {
  // `comuni` è un `const … = {`, non un `return`: cercare qui la parola
  // «return» portava al blocco della vista successiva, e ogni vista sembrava
  // chiedere tutto. È il motivo per cui questo controllo, scritto male, passava
  // anche sul difetto che doveva trovare.
  const comuni = chiaviDi(corpoOggetto(SORGENTE.indexOf("const comuni")));

  const perVista: Record<string, Set<string>> = {};
  for (const m of SORGENTE.matchAll(/if \(vista === "(\w+)"\) \{/g)) {
    perVista[m[1]] = new Set([...comuni, ...chiaviDi(corpoOggetto(SORGENTE.indexOf("return", m.index ?? 0)))]);
  }

  // Due forme che la sola ricerca degli `if` non coglie.

  // 1. Il ritorno anticipato: «conversione» e «backoffice» disegnano i propri
  //    grafici da sé e dal batch prendono solo la fascia comune.
  for (const m of SORGENTE.matchAll(/if \(([^)]*vista === "[^)]*)\) return comuni;/g)) {
    for (const v of m[1].matchAll(/vista === "(\w+)"/g)) perVista[v[1]] = new Set(comuni);
  }

  // 2. Il ramo di ripiego: un `return { ...comuni,` senza `if` davanti, che nel
  //    codice attuale serve i preventivi. Si riconosce dal contenuto e non
  //    dalla posizione: nel file ci sono altri `return {` di altre funzioni.
  const ripieghi = [...SORGENTE.matchAll(/return \{\s*\.\.\.comuni,/g)];
  const ultimo = ripieghi[ripieghi.length - 1];
  if (ultimo && !perVista.preventivi) {
    perVista.preventivi = new Set([...comuni, ...chiaviDi(corpoOggetto(ultimo.index ?? 0))]);
  }

  return perVista;
}

/** Chiavi lette dentro il JSX di ogni vista. */
function lettePerVista(): Record<string, Set<string>> {
  const letto: Record<string, Set<string>> = {};
  const aperture = [...SORGENTE.matchAll(/\{vista === "(\w+)" && \(/g)];

  aperture.forEach((apertura, indice) => {
    const da = apertura.index ?? 0;
    const a = indice + 1 < aperture.length ? (aperture[indice + 1].index ?? SORGENTE.length) : SORGENTE.length;
    const blocco = SORGENTE.slice(da, a);
    letto[apertura[1]] = new Set([
      // Lettura diretta e primo argomento di `tabellaDi`, che legge anch'esso
      // dal batch.
      ...[...blocco.matchAll(/\br\("(\w+)"\)/g)].map((m) => m[1]),
      ...[...blocco.matchAll(/tabellaDi\(\s*"(\w+)",\s*"(\w+)"(?:,\s*"?(\w+)"?)?(?:,\s*"?(\w+)"?)?/g)]
        .flatMap((m) => [m[1], m[2], m[3], m[4]])
        .filter((chiave): chiave is string => Boolean(chiave) && chiave !== "null"),
    ]);
  });
  return letto;
}

describe("Il Cruscotto non disegna dati che non chiede", () => {
  const richieste = richiestePerVista();
  const lette = lettePerVista();

  it("il sorgente si lascia leggere: viste trovate da entrambe le parti", () => {
    // Se il file cambia forma e le espressioni non agganciano più niente, il
    // test passerebbe a vuoto dando una falsa sicurezza.
    expect(Object.keys(richieste).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(lette).length).toBeGreaterThanOrEqual(4);
  });

  it.each(Object.keys(lette))("la scheda %s chiede tutto ciò che disegna", (vista) => {
    const disponibili = richieste[vista];
    expect(disponibili, `la vista "${vista}" non ha un blocco di richieste`).toBeDefined();

    const mancanti = [...lette[vista]].filter((chiave) => !disponibili.has(chiave)).sort();
    expect(
      mancanti,
      `la vista "${vista}" disegna ${mancanti.join(", ")} senza chiederlo: ` +
        "resterebbe a scheletro per sempre"
    ).toEqual([]);
  });
});
