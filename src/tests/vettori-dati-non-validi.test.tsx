import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { z } from "zod";
import { SimulazioneView } from "@/components/portali/vettori/simulazione-view";
import { descriviDatiNonValidi, ERRORE_DEL_PROGRAMMA } from "@/lib/portali/vettori/dati-non-validi";
import { CorpoConfermaSimulazione, ETICHETTE_CONFERMA } from "@/lib/portali/vettori/simulazione-conferma";

afterEach(() => { cleanup(); vi.unstubAllGlobals() });

const calcolo = { pesoReale: 5, pesoVolumetrico: 5.4, pesoTassabile: 5.4, pesoApplicato: "volumetrico", nolo: 10, fasciaDescrizione: "fino a 10 kg", supplementi: [], imponibileNolo: 10, adeguamento: 0, carburante: 2.53, fuoriBase: 0, totale: 12.53, avvertenze: [] };
const esito = {
  vettoreId: "00000000-0000-4000-8000-00000000a001", vettoreCodice: "TNT", vettoreNome: "TNT", disponibile: true,
  listino: { id: "00000000-0000-4000-8000-00000000b001", etichetta: "Tariffe 2026", validoDal: "2026-01-01", validoAl: null },
  calcolo, riaddebito: { importo: 22.5, pesoUsato: 5.4, basePeso: "tassabile", regola: "scaglione 0-10 kg", avvertenza: null }, margine: 9.97,
};
function corpo(bolla: Record<string, unknown> = {}, extraEsito: Record<string, unknown> = {}) {
  return {
    simulazione: { direzione: "uscita", cap: "20121", provincia: "MI", controparteCodice: null, colli: 1, pesoKg: 5, gruppi: [{ quantita: 1, lunghezzaCm: 20, larghezzaCm: 30, altezzaCm: 30 }], lunghezzaCm: null, larghezzaCm: null, altezzaCm: null, data: "2026-10-19", condizioni: [], vettoreSceltoId: esito.vettoreId, costoPrevisto: 12.53, riaddebitoPrevisto: 22.5, esiti: [{ ...esito, ...extraEsito }] },
    bolla: { numeroRiferimento: "2631", dataDocumento: "2026-10-19", controparteNome: "Cliente Alfa", controparteCodice: null, ...bolla },
  };
}

describe("«Dati non validi» dice cosa correggere", () => {
  it("un campo dell'operatore torna col nome della pagina", () => {
    const parsed = CorpoConfermaSimulazione.safeParse(corpo({ controparteNome: "", numeroRiferimento: "x".repeat(201) }));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const { messaggio, delProgramma } = descriviDatiNonValidi(parsed.error, ETICHETTE_CONFERMA);
    expect(messaggio).toBe("Dati non validi — Numero bolla: al massimo 200 caratteri; Cliente/fornitore: obbligatorio.");
    expect(delProgramma).toBe(false);
  });

  it("la riga di un elenco porta il suo numero", () => {
    const c = corpo();
    c.simulazione.gruppi = [{ quantita: 1, lunghezzaCm: 20, larghezzaCm: 30, altezzaCm: 30 }, { quantita: 1, lunghezzaCm: 20, larghezzaCm: 30, altezzaCm: 3000 }];
    c.simulazione.colli = 2;
    const parsed = CorpoConfermaSimulazione.safeParse(c);
    if (parsed.success) throw new Error("doveva fallire");
    expect(descriviDatiNonValidi(parsed.error, ETICHETTE_CONFERMA).messaggio).toBe("Dati non validi — Altezza (cm) gruppo 2: al massimo 2000.");
  });

  it("un dato che l'operatore non scrive è un errore del programma, non suo", () => {
    const c = corpo();
    c.simulazione.vettoreSceltoId = "non-un-uuid";
    const parsed = CorpoConfermaSimulazione.safeParse(c);
    if (parsed.success) throw new Error("doveva fallire");
    expect(descriviDatiNonValidi(parsed.error, ETICHETTE_CONFERMA)).toEqual({ messaggio: ERRORE_DEL_PROGRAMMA, delProgramma: true });
  });

  it("i messaggi scritti negli schemi passano così come sono", () => {
    const schema = z.object({ a: z.number() }).refine(() => false, { message: "La fine validita non puo precedere l'inizio." });
    const parsed = schema.safeParse({ a: 1 });
    if (parsed.success) throw new Error("doveva fallire");
    expect(descriviDatiNonValidi(parsed.error, {}).messaggio).toBe("Dati non validi — La fine validita non puo precedere l'inizio.");
  });
});

describe("gli esiti di /simula non bloccano più la bolla", () => {
  it("un campo informativo nuovo nell'esito passa e resta nell'archivio", () => {
    const parsed = CorpoConfermaSimulazione.safeParse(corpo({}, { notaNuova: "aggiunta a /simula senza toccare lo schema" }));
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    if (parsed.success) expect(parsed.data.simulazione.esiti[0]).toHaveProperty("notaNuova");
  });

  it("i campi che la conferma usa restano controllati", () => {
    const parsed = CorpoConfermaSimulazione.safeParse(corpo({}, { calcolo: { ...calcolo, totale: "12,53" } }));
    expect(parsed.success).toBe(false);
  });
});

describe("l'errore di «Crea bolla» sta nel riquadro della bolla", () => {
  it("compare sotto i dati della bolla, non sotto il modulo", async () => {
    const risposta = { data: "2026-10-19", cap: "20121", provincia: "MI", fonteProvincia: "cap", risultati: [esito] };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.includes("/cap/")) return { ok: true, status: 200, json: async () => ({ cap: "20121", province: ["MI"], comuni: ["Milano"], fonte: "anci_istat", certo: true, estero: false }) };
      if (url.endsWith("/simula")) return { ok: true, status: 200, json: async () => risposta };
      return { ok: false, status: 400, json: async () => ({ error: "Dati non validi — Cliente/fornitore: obbligatorio." }) };
    }));
    render(<SimulazioneView />);
    fireEvent.change(screen.getByLabelText("CAP di destinazione"), { target: { value: "20121" } });
    fireEvent.change(screen.getByLabelText("Peso totale (kg)"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Quantità gruppo 1"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Lunghezza (cm) gruppo 1"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Profondità (cm) gruppo 1"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Altezza (cm) gruppo 1"), { target: { value: "30" } });
    await screen.findByText("Milano (MI)");
    fireEvent.click(screen.getByRole("button", { name: "Confronta i vettori" }));
    const tnt = await screen.findByRole("article", { name: "Vettore TNT" });
    fireEvent.click(within(tnt).getByRole("button", { name: "Scegli" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma e crea la bolla" }));
    fireEvent.change(screen.getByLabelText("Numero bolla"), { target: { value: "2631" } });
    fireEvent.change(screen.getByLabelText("Cliente/fornitore"), { target: { value: "Cliente Alfa" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea bolla" }));
    const riquadro = screen.getByRole("article", { name: "Conferma della simulazione" });
    expect((await within(riquadro).findByRole("alert")).textContent).toContain("Cliente/fornitore: obbligatorio");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
