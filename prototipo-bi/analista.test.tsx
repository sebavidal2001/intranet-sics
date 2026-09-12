/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Previsione, instradamento del modello, costi e formattazione della chat.
 */

import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calcolaPrevisione } from "@/lib/prototipo-bi/previsione";
import { instrada, calcolaCosto, MODELLI, aggiornaPrezzi } from "@/lib/prototipo-bi/modelli";
import { esegui } from "@/lib/prototipo-bi/semantico";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import { leggiConfigurazione } from "@/lib/prototipo-bi/archivio";
import { Markdown } from "@/components/prototipo-bi/markdown";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";

const M = (n: number) => Math.round(n).toLocaleString("it-IT");

// ─────────────────────────────────────────────────────────────────────────────

describe("Instradamento del modello", () => {
  it("manda le letture dirette sul modello economico", () => {
    const r = instrada("quanto ho fatturato a marzo?");
    expect(r.complessita).toBe("semplice");
    expect(r.modello.id).toBe(MODELLI.leggero.id);
  });

  it("sale di livello quando serve ragionare", () => {
    for (const d of [
      "confronta l'ordinato con l'anno scorso",
      "quali clienti sono calati?",
      "analizza la situazione del portafoglio",
    ]) {
      expect(instrada(d).complessita, d).toBe("analitica");
    }
  });

  it("riconosce previsioni, scenari e richieste di documento", () => {
    for (const d of [
      "a che importo pensi che chiuderemo l'anno?",
      "fammi una previsione del fatturato",
      "preparami un report excel",
    ]) {
      expect(instrada(d).complessita, d).toBe("profonda");
    }
    expect(instrada("previsione 2026").modello.id).toBe(MODELLI.standard.id);
  });

  it("nel dubbio sale invece di scendere", () => {
    // Una domanda lunga contiene quasi sempre più richieste insieme.
    const lunga = "dimmi il fatturato " + "e poi anche altro ".repeat(15);
    expect(instrada(lunga).complessita).not.toBe("semplice");
  });

  it("rispetta la scelta forzata dall'utente", () => {
    expect(instrada("quanto ho fatturato?", "profonda").complessita).toBe("profonda");
  });

  it("concede più passi ai compiti più difficili", () => {
    expect(instrada("quanto?").massimoPassi).toBeLessThan(
      instrada("previsione fine anno").massimoPassi
    );
  });
});

describe("Costi", () => {
  it("calcola il costo dai token e dal listino", () => {
    // Sonnet 4.5: 3 $/Mtok in ingresso, 15 in uscita.
    const c = calcolaCosto(MODELLI.standard, 10_000, 2_000);
    expect(c.costoUsd).toBeCloseTo(10_000 / 1e6 * 3 + 2_000 / 1e6 * 15, 6);
    expect(c.costoUsd).toBeCloseTo(0.06, 4);
  });

  it("il modello economico costa molto meno a parità di token", () => {
    const grande = calcolaCosto(MODELLI.standard, 10_000, 2_000).costoUsd;
    const piccolo = calcolaCosto(MODELLI.leggero, 10_000, 2_000).costoUsd;
    expect(piccolo).toBeLessThan(grande / 2);
  });

  it("i prezzi si possono rileggere dal listino pubblico", async () => {
    const esito = await aggiornaPrezzi();
    if (esito.errore) {
      console.log(`   listino non raggiungibile (${esito.errore}): si usano i valori noti`);
      return;
    }
    expect(esito.aggiornati.length).toBeGreaterThan(0);
    expect(MODELLI.standard.ingresso).toBeGreaterThan(0);
    console.log(
      `   Listino: Haiku ${MODELLI.leggero.ingresso}/${MODELLI.leggero.uscita} · ` +
        `Sonnet ${MODELLI.standard.ingresso}/${MODELLI.standard.uscita} $/Mtok`
    );
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Markdown della chat", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
  });

  it("rende titoli, grassetto ed elenchi invece del testo grezzo", () => {
    render(
      <Markdown
        testo={`## Analisi ordinato\n\n**Ordinato 2026:** 2.830.358 €\n- Mese più forte: aprile\n- Mese più debole: agosto`}
      />
    );
    expect(screen.getByText("Analisi ordinato")).toBeInTheDocument();
    // Il grassetto diventa un elemento, non asterischi a schermo.
    const forte = screen.getByText("Ordinato 2026:");
    expect(forte.tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("**");
    expect(document.body.textContent).not.toContain("##");
  });

  it("rende le tabelle", () => {
    render(
      <Markdown
        testo={`| BU | Valore |\n|---|---:|\n| COMPONENTI | 1.320.383 € |\n| IMPIANTI | 973.556 € |`}
      />
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("COMPONENTI")).toBeInTheDocument();
  });

  it("rende elenchi numerati, citazioni e righe orizzontali", () => {
    const { container } = render(
      <Markdown testo={`1. primo\n2. secondo\n\n> nota importante\n\n---\n\ntesto finale`} />
    );
    expect(container.querySelector("ol")).toBeTruthy();
    expect(container.querySelector("blockquote")).toBeTruthy();
    expect(container.querySelector("hr")).toBeTruthy();
    expect(screen.getByText("testo finale")).toBeInTheDocument();
  });

  it("non interpreta HTML contenuto nella risposta", () => {
    const { container } = render(<Markdown testo={`<script>alert(1)</script> testo`} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("non va in ciclo infinito su input strani", () => {
    render(<Markdown testo={"|||\n\n```\n\n#\n"} />);
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Previsione sui dati reali", () => {
  let snapshot: Snapshot;

  beforeAll(async () => {
    const t = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const r of t.split(/\r?\n/)) {
      if (!r.includes("=") || r.trim().startsWith("#")) continue;
      const i = r.indexOf("=");
      const k = r.slice(0, i).replace(/^﻿/, "").trim();
      if (!process.env[k]) process.env[k] = r.slice(i + 1).trim();
    }
    snapshot = await costruisciSnapshot();
  }, 240_000);

  async function previsione(metrica: "ordinato" | "fatturato") {
    const anno = Number((snapshot.dataMassima ?? "").slice(0, 4));
    const limite = `${anno}-${(snapshot.dataMassima ?? "").slice(5, 10)}`;
    const q = (s: Record<string, unknown>) =>
      esegui(s as never, snapshot);

    const config = await leggiConfigurazione(anno);
    return calcolaPrevisione({
      anno,
      giornoLimite: limite,
      consuntivoAlGiorno: q({ metrica, periodo: { dal: `${anno}-01-01`, al: limite } }).totale,
      precedenteAlGiorno: q({
        metrica,
        modificatore: "anno_precedente",
        periodo: { dal: `${anno}-01-01`, al: limite },
      }).totale,
      precedenteIntero: q({ metrica, periodo: { anno: anno - 1 } }).totale,
      serieMensile: q({ metrica, granularita: "mese", periodo: { anno }, ordina: "etichetta" }).righe,
      chiusure: config?.chiusure ?? [],
      escludiWeekend: config?.escludiWeekend ?? true,
    });
  }

  it("i tre metodi producono stime plausibili e coerenti fra loro", async () => {
    const p = await previsione("ordinato");

    // La stima deve superare il consuntivo: mancano quattro mesi.
    expect(p.stimaCentrale).toBeGreaterThan(p.consuntivoAlGiorno);
    // E restare nell'ordine di grandezza dell'anno precedente.
    expect(p.stimaCentrale).toBeLessThan(p.consuntivoAlGiorno * 2.5);
    expect(p.minimo).toBeLessThanOrEqual(p.stimaCentrale);
    expect(p.massimo).toBeGreaterThanOrEqual(p.stimaCentrale);

    console.log(`\n   Ordinato ${p.anno} al ${p.giornoLimite}: ${M(p.consuntivoAlGiorno)} €`);
    for (const m of p.metodi) {
      console.log(
        m.nonApplicabile
          ? `     ${m.nome.padEnd(36)} non applicabile — ${m.nonApplicabile}`
          : `     ${m.nome.padEnd(36)} ${M(m.stima).padStart(11)} €`
      );
    }
    console.log(
      `   Stima ${M(p.stimaCentrale)} € · intervallo ${M(p.minimo)} – ${M(p.massimo)} (±${p.incertezzaPct}%)`
    );
  });

  it("il metodo stagionale tiene conto della forma dell'anno precedente", async () => {
    const p = await previsione("fatturato");
    const stagionale = p.metodi.find((m) => m.metodo === "stagionale")!;
    expect(stagionale.nonApplicabile).toBeUndefined();
    expect(stagionale.stima).toBeGreaterThan(p.consuntivoAlGiorno);
    expect(stagionale.spiegazione).toContain("%");

    console.log(
      `   Fatturato: stagionale ${M(stagionale.stima)} € · centrale ${M(p.stimaCentrale)} €`
    );
  });

  it("avverte quando i metodi divergono troppo per dare un numero solo", async () => {
    const p = await previsione("ordinato");
    if (p.incertezzaPct > 15) {
      expect(p.avvisi.join(" ")).toContain("intervallo");
    }
    // In ogni caso l'intervallo è coerente.
    expect(p.massimo - p.minimo).toBeGreaterThanOrEqual(0);
  });

  it("dichiara i metodi non applicabili invece di inventare un numero", () => {
    const p = calcolaPrevisione({
      anno: 2026,
      giornoLimite: "2026-02-15",
      consuntivoAlGiorno: 100_000,
      precedenteAlGiorno: 0,
      precedenteIntero: 0,
      serieMensile: [],
      chiusure: [],
      escludiWeekend: true,
    });
    const stagionale = p.metodi.find((m) => m.metodo === "stagionale")!;
    const tendenza = p.metodi.find((m) => m.metodo === "tendenza")!;
    expect(stagionale.nonApplicabile).toBeTruthy();
    expect(tendenza.nonApplicabile).toBeTruthy();
    // Resta il metodo del ritmo, quindi una stima c'è comunque.
    expect(p.stimaCentrale).toBeGreaterThan(0);
    expect(p.avvisi.length).toBeGreaterThan(0);
  });

  it("senza chiusure configurate lo dice, perché la stima si gonfia", () => {
    const p = calcolaPrevisione({
      anno: 2026,
      giornoLimite: "2026-08-28",
      consuntivoAlGiorno: 1_000_000,
      precedenteAlGiorno: 900_000,
      precedenteIntero: 1_400_000,
      serieMensile: [],
      chiusure: [],
      escludiWeekend: true,
    });
    expect(p.avvisi.join(" ")).toContain("chiusura");
  });
});
