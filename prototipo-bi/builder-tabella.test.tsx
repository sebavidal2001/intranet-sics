/**
 * IL BUILDER PER CHI SI ASPETTA UNA TABELLA COME IN POWER BI.
 *
 * Le richieste dell'utente, una per una:
 *   - in una tabella si mettono tutti i campi e tutti i valori che si vogliono,
 *     senza dover usare un asse o una legenda;
 *   - un valore ha il suo periodo: «ordinato» e «ordinato dell'anno scorso» sono
 *     due colonne;
 *   - si vede cosa si sta selezionando (somma, conteggio, media) e come si calcola;
 *   - il numero del documento sta dentro l'operazione che lo porta;
 *   - i filtri valgono per tutti i valori, non solo per il primo.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorAnalisi } from "@/components/prototipo-bi/editor-analisi";
import { AlberoCampi, SELEZIONE_VUOTA, type VocabolarioAlbero } from "@/components/prototipo-bi/albero-campi";
import { vocabolario } from "@/lib/prototipo-bi/semantico";
import type { Dimensione, RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

// L'editor monta l'albero intero col vocabolario vero: con la suite in parallelo
// il primo rendering supera i 5 secondi di default, e un timeout lascia il
// componente montato per i test dopo.
vi.setConfig({ testTimeout: 40_000 });

const VOCABOLARIO = JSON.parse(JSON.stringify(vocabolario())) as ReturnType<typeof vocabolario>;

/** Un risultato finto ma della forma giusta: una riga per ogni valore di ogni dimensione. */
function risultato(spec: SpecQuery): RisultatoQuery {
  const dimensioni: Dimensione[] = spec.raggruppa ?? [];
  const nome = (d: Dimensione, k: number) => `${d}-${k}`;
  const righe =
    dimensioni.length === 0
      ? [{ etichetta: "totale", chiavi: {}, valore: 100, conteggio: 1 }]
      : [0, 1].map((k) => ({
          etichetta: dimensioni.map((d) => nome(d, k)).join(" · "),
          chiavi: Object.fromEntries(dimensioni.map((d) => [d, nome(d, k)])),
          valore: 100 - k * 10,
          conteggio: 1,
        }));
  return {
    spec,
    metrica: spec.metrica,
    unita: spec.metrica === "n_ordini" ? "numero" : "euro",
    righe,
    totale: righe.reduce((s, r) => s + r.valore, 0),
    certificata: true,
    avvisi: [],
  };
}

function risposta(corpo: unknown, ok = true) {
  return { ok, json: async () => corpo };
}

function preparaFetch() {
  const spia = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/bi/misure") return risposta({ misure: [], utenteId: "u1", puoGestireTutte: false });
    if (url.includes("/api/bi/analisi")) return risposta({ analisi: { id: "analisi-1" } });
    if (!init?.method) return risposta(VOCABOLARIO);
    const body = JSON.parse(String(init.body)) as { specs?: Array<{ id: string; spec: SpecQuery }> };
    return risposta({ risultati: (body.specs ?? []).map((v) => ({ id: v.id, risultato: risultato(v.spec) })) });
  });
  vi.stubGlobal("fetch", spia);
  return spia;
}

type Spia = ReturnType<typeof preparaFetch>;

/** Le specifiche dell'ULTIMA richiesta al motore, una per serie. */
function ultimeSpec(spia: Spia): SpecQuery[] {
  const richieste = spia.mock.calls.filter(([url, init]) => String(url) === "/api/bi/query" && init?.method === "POST");
  const ultima = richieste.at(-1);
  if (!ultima) return [];
  return (JSON.parse(String(ultima[1]?.body)) as { specs: Array<{ spec: SpecQuery }> }).specs.map((s) => s.spec);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "IntersectionObserver",
    class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (voci: unknown[]) => void) {}
      observe() { this.callback([{ contentRect: { width: 800, height: 400 } }]); }
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function carica() {
  await act(async () => Promise.resolve());
  await act(async () => Promise.resolve());
}

async function completaDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  await act(async () => Promise.resolve());
}

const pannello = () => screen.getByRole("tabpanel", { name: "Campi" });
const apriGruppo = (nome: RegExp) => {
  const bottone = within(pannello()).getAllByRole("button", { name: nome })[0];
  if (bottone.getAttribute("aria-expanded") === "false") fireEvent.click(bottone);
};
/** Sceglie «Tabella» dalla fila delle visualizzazioni (serve un risultato: si propone da sola quando i campi sono piu' di due). */
async function scegliTabella() {
  fireEvent.click(screen.getByRole("button", { name: "Visualizzazione: Tabella" }));
  await completaDebounce();
}
const spunta = (nome: RegExp | string) => fireEvent.click(within(pannello()).getByRole("checkbox", { name: nome }));

describe("tabella: nessun asse, nessuna legenda, tutti i campi che si vogliono", () => {
  it("scegliendo Tabella i pozzetti diventano Campi, Valori, Filtri", async () => {
    preparaFetch();
    render(<EditorAnalisi />);
    await carica();

    // Prima, grafico: Asse, Legenda, Valori, Filtri.
    expect(within(pannello()).getByRole("region", { name: "Asse" })).toBeInTheDocument();
    expect(within(pannello()).getByRole("region", { name: "Legenda" })).toBeInTheDocument();
    // Non c'e' nessun interruttore Grafico/Tabella: il tipo si sceglie dalla fila delle visualizzazioni.
    expect(screen.queryByRole("button", { name: "Tabella" })).not.toBeInTheDocument();

    spunta(/^Ordinato/);
    await completaDebounce();
    await scegliTabella();
    expect(within(pannello()).queryByRole("region", { name: "Asse" })).not.toBeInTheDocument();
    expect(within(pannello()).queryByRole("region", { name: "Legenda" })).not.toBeInTheDocument();
    for (const nome of ["Campi", "Valori", "Filtri"]) {
      expect(within(pannello()).getByRole("region", { name: nome })).toBeInTheDocument();
    }
  });

  it("quattro campi e due valori: ognuno e' una colonna, nessuno e' costretto in un asse", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi />);
    await carica();

    spunta(/^Ordinato/);
    apriGruppo(/^Prodotti/);
    for (const campo of [/^Cliente/, /^Agente/, /^Codice articolo/, /^Descrizione articolo/]) spunta(campo);
    spunta(/^Numero ordini/);
    await completaDebounce();

    const [principale, secondo] = ultimeSpec(spia);
    expect(principale.raggruppa).toEqual(["cliente", "agente", "codice_articolo", "articolo"]);
    expect(secondo.raggruppa).toEqual(["cliente", "agente", "codice_articolo", "articolo"]);

    const tabella = screen.getByRole("table");
    const intestazioni = within(tabella).getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(intestazioni.slice(0, 4)).toEqual(["Cliente", "Agente", "Codice articolo", "Descrizione articolo"]);
    expect(intestazioni).toEqual(expect.arrayContaining(["Ordinato", "Numero ordini"]));
    // Ogni campo ha il suo valore sulla riga, non concatenato in una voce sola.
    expect(within(tabella).getAllByText("codice_articolo-0").length).toBeGreaterThan(0);
  });

  it("con piu' di due campi il sistema propone la tabella da solo, e con due torna a un grafico", async () => {
    preparaFetch();
    render(<EditorAnalisi />);
    await carica();
    spunta(/^Ordinato/);
    for (const campo of [/^Cliente/, /^Agente/]) spunta(campo);
    await completaDebounce();
    expect(within(pannello()).getByRole("region", { name: "Asse" })).toBeInTheDocument();

    apriGruppo(/^Prodotti/);
    spunta(/^Categoria/);
    await completaDebounce();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(within(pannello()).getByRole("region", { name: "Campi" })).toBeInTheDocument();
    // Nella fila delle visualizzazioni resta la sola tabella: nessun grafico regge tre campi.
    expect(screen.queryByRole("button", { name: "Visualizzazione: Barre" })).not.toBeInTheDocument();

    spunta(/^Categoria/);
    await completaDebounce();
    expect(within(pannello()).getByRole("region", { name: "Asse" })).toBeInTheDocument();
  });

  it("la tabella resta tabella quando si aggiunge un campo, e si salva come tabella", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi />);
    await carica();
    spunta(/^Ordinato/);
    spunta(/^Cliente/);
    await completaDebounce();
    await scegliTabella();
    expect(screen.getByRole("table")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Titolo del riquadro"), { target: { value: "Ordinato per cliente" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Salva il riquadro/ }));
      await Promise.resolve();
    });
    const salvataggio = spia.mock.calls.find(([url, init]) => String(url).includes("/api/bi/analisi") && init?.method === "POST");
    expect(JSON.parse(String(salvataggio?.[1]?.body))).toMatchObject({ grafico: "tabella" });
  });
});

describe("il numero del documento in una tabella", () => {
  it("il numero porta l'anno: i documenti di anni diversi non si fondono e non serve nessun avviso", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi />);
    await carica();
    spunta(/^Ordinato/);
    spunta(/^Numero ordine\/anno/);
    await completaDebounce();
    await scegliTabella();

    expect(ultimeSpec(spia)[0].raggruppa).toEqual(["documento_anno"]);
    // La colonna dice di quale documento si tratta.
    const intestazioni = within(screen.getByRole("table")).getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(intestazioni[0]).toBe("Numero ordine/anno");
    expect(screen.queryByLabelText("Avvisi del risultato")).not.toBeInTheDocument();
  });
});

describe("un valore e il suo periodo", () => {
  it("«Aggiungi anche l'anno precedente» fa due colonne: corrente e anno precedente", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi />);
    await carica();
    spunta(/^Ordinato/);
    spunta(/^Cliente/);
    await completaDebounce();
    await scegliTabella();

    fireEvent.click(within(pannello()).getByRole("button", { name: "Calcolo e periodo di Ordinato" }));
    fireEvent.click(within(pannello()).getByRole("button", { name: /Aggiungi anche l’anno precedente/ }));
    await completaDebounce();

    const specs = ultimeSpec(spia);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({ metrica: "ordinato", raggruppa: ["cliente"] });
    expect(specs[0].modificatore ?? "corrente").toBe("corrente");
    expect(specs[1]).toMatchObject({ metrica: "ordinato", modificatore: "anno_precedente", raggruppa: ["cliente"] });

    const intestazioni = within(screen.getByRole("table")).getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(intestazioni).toEqual(expect.arrayContaining(["Ordinato", "Ordinato · anno precedente"]));
    // Nei valori si distinguono: il periodo sta dopo il nome.
    const valori = screen.getByRole("region", { name: "Valori" });
    expect(within(valori).getByText(/anno prec\./)).toBeInTheDocument();
  });

  it("il menu offre somma, numero e valore medio, e cambiare calcolo tiene il periodo", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi />);
    await carica();
    spunta(/^Ordinato/);
    await completaDebounce();

    fireEvent.click(within(pannello()).getByRole("button", { name: "Calcolo e periodo di Ordinato" }));
    const gruppo = within(pannello()).getByRole("group", { name: "Calcolo e periodo di Ordinato" });
    for (const voce of ["Somma degli importi", "Numero di ordini", "Valore medio per ordine"]) {
      expect(within(gruppo).getByRole("button", { name: new RegExp(voce) })).toBeInTheDocument();
    }
    fireEvent.click(within(gruppo).getByRole("button", { name: /Valore medio per ordine/ }));
    await completaDebounce();
    expect(ultimeSpec(spia)[0].metrica).toBe("ordine_medio");
  });

  it("il progressivo e' spento su una media, col suo perche'", async () => {
    preparaFetch();
    render(<EditorAnalisi />);
    await carica();
    apriGruppo(/^Ordinato/);
    // La media sta fra le Misure, non dentro l'operazione.
    const misure = screen.getByRole("region", { name: "Misure" });
    fireEvent.click(within(misure).getAllByRole("button", { name: /^Ordinato/ })[0]);
    fireEvent.click(within(misure).getByRole("checkbox", { name: /^Ordine medio/ }));
    await completaDebounce();

    fireEvent.click(within(pannello()).getByRole("button", { name: "Calcolo e periodo di Ordine medio" }));
    const progressivo = within(pannello()).getByRole("button", { name: "Progressivo" });
    expect(progressivo).toBeDisabled();
    expect(progressivo).toHaveAttribute("title", expect.stringMatching(/cumula/));
    expect(within(pannello()).getByRole("button", { name: "Anno precedente" })).toBeEnabled();
  });
});

describe("i filtri valgono per tutti i valori", () => {
  const filtro = { campo: "cliente" as const, op: "in" as const, valore: ["ACME"] };

  it("una misura aggiunta dall'albero eredita il filtro della principale", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato", filtri: [filtro] }} />);
    await carica();
    await completaDebounce();

    spunta(/^Numero ordini/);
    await completaDebounce();
    const specs = ultimeSpec(spia);
    expect(specs.map((s) => s.metrica)).toEqual(["ordinato", "n_ordini"]);
    // Senza questo, la seconda colonna mostrerebbe i numeri di TUTTI i clienti
    // accanto a quelli di ACME.
    expect(specs[1].filtri).toEqual([filtro]);
  });

  it("anche l'anno precedente di un valore e' filtrato come l'originale", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato", filtri: [filtro] }} />);
    await carica();
    await completaDebounce();

    fireEvent.click(within(pannello()).getByRole("button", { name: "Calcolo e periodo di Ordinato" }));
    fireEvent.click(within(pannello()).getByRole("button", { name: /Aggiungi anche l’anno precedente/ }));
    await completaDebounce();
    expect(ultimeSpec(spia)[1]).toMatchObject({ modificatore: "anno_precedente", filtri: [filtro] });
  });

  it("una serie che ha filtri suoi li tiene: un confronto fra due clienti non si cancella", async () => {
    const spia = preparaFetch();
    const altro = { campo: "cliente" as const, op: "in" as const, valore: ["BETA"] };
    render(
      <EditorAnalisi
        specIniziale={{ metrica: "ordinato", filtri: [filtro] }}
        serieIniziali={[
          { ruolo: "principale", nome: "Ordinato ACME", spec: { metrica: "ordinato", filtri: [filtro] } },
          { ruolo: "confronto", nome: "Ordinato BETA", spec: { metrica: "ordinato", filtri: [altro] } },
        ]}
      />
    );
    await carica();
    await completaDebounce();
    const specs = ultimeSpec(spia);
    expect(specs[0].filtri).toEqual([filtro]);
    expect(specs[1].filtri).toEqual([altro]);
  });
});

describe("l'albero: operazioni, misure, documento", () => {
  const VOCABOLARIO_ALBERO: VocabolarioAlbero = {
    tipologie: [],
    metriche: VOCABOLARIO.metriche as VocabolarioAlbero["metriche"],
    dimensioni: VOCABOLARIO.dimensioni as VocabolarioAlbero["dimensioni"],
    dimensioniPerMetrica: VOCABOLARIO.dimensioniPerMetrica as VocabolarioAlbero["dimensioniPerMetrica"],
  };

  function monta(selezione = SELEZIONE_VUOTA, onPartiDa?: (testo: string) => void) {
    const onCambia = vi.fn();
    render(
      <AlberoCampi compatto vocabolario={VOCABOLARIO_ALBERO} selezione={selezione} onCambia={onCambia} onPartiDa={onPartiDa} />
    );
    return onCambia;
  }

  it("tre sezioni: campi comuni, operazioni, misure", () => {
    monta();
    for (const nome of [/Campi comuni/, /Operazioni/, /Misure/]) {
      expect(screen.getByRole("region", { name: nome })).toBeInTheDocument();
    }
  });

  it("la business unit sta fra i prodotti; le visite stanno in un gruppo solo", () => {
    monta();
    const comuni = within(screen.getByRole("region", { name: /Campi comuni/ }));
    fireEvent.click(comuni.getByRole("button", { name: /^Prodotti/ }));
    expect(comuni.getByRole("checkbox", { name: /^Business unit/ })).toBeInTheDocument();
    expect(comuni.getByRole("checkbox", { name: /^Codice articolo/ })).toBeInTheDocument();
    expect(comuni.getByRole("checkbox", { name: /^Descrizione articolo/ })).toBeInTheDocument();
    // Nessun gruppo «Azienda» a parte.
    expect(screen.queryByRole("button", { name: /^Azienda/ })).not.toBeInTheDocument();

    const operazioni = within(screen.getByRole("region", { name: /Operazioni/ }));
    fireEvent.click(operazioni.getByRole("button", { name: /^Visite commerciali/ }));
    for (const campo of [/^Visite/, /^CAP/, /^Provincia/, /^Grado visita/, /^Tipo visita/]) {
      expect(operazioni.getAllByRole("checkbox", { name: campo }).length).toBeGreaterThan(0);
    }
    // E non esiste piu' un gruppo «Visite e territorio» separato.
    expect(screen.queryByRole("button", { name: /Visite e territorio/ })).not.toBeInTheDocument();
  });

  it("il numero documento sta dentro ogni operazione, con il suo nome", () => {
    monta();
    const operazioni = within(screen.getByRole("region", { name: /Operazioni/ }));
    for (const [gruppo, nome] of [
      ["Ordinato", /^Numero ordine\/anno/],
      ["Fatturato", /^Numero fattura/],
      ["Preventivi", /^Numero preventivo/],
    ] as const) {
      const intestazione = operazioni.getByRole("button", { name: new RegExp(`^${gruppo}`) });
      if (intestazione.getAttribute("aria-expanded") === "false") fireEvent.click(intestazione);
      expect(operazioni.getByRole("checkbox", { name: nome })).toBeInTheDocument();
    }
  });

  it("con ordinato scelto, il numero documento delle fatture e' spento e dice perche'", () => {
    monta({ misure: ["ordinato"], suddivisioni: [] });
    const operazioni = within(screen.getByRole("region", { name: /Operazioni/ }));
    fireEvent.click(operazioni.getByRole("button", { name: /^Fatturato/ }));
    expect(operazioni.getByRole("checkbox", { name: /^Numero ordine\/anno$/ })).toBeEnabled();
    const fattura = operazioni.getByRole("checkbox", { name: /^Numero fattura/ });
    expect(fattura).toBeDisabled();
    expect(operazioni.getAllByText(/non è il documento delle misure scelte/i).length).toBeGreaterThan(0);
  });

  it("un numero documento gia' scelto spegne le misure di un'altra operazione, col perche'", () => {
    monta({ misure: ["ordinato"], suddivisioni: ["documento"] });
    const operazioni = within(screen.getByRole("region", { name: /Operazioni/ }));
    fireEvent.click(operazioni.getByRole("button", { name: /^Fatturato/ }));
    expect(operazioni.getByRole("checkbox", { name: /^Fatturato/ })).toBeDisabled();
    expect(operazioni.getAllByText(/vale per una sola operazione/).length).toBeGreaterThan(0);
    // Ma restano accese quelle della stessa operazione.
    expect(operazioni.getByRole("checkbox", { name: /^Numero ordini/ })).toBeEnabled();
  });

  it("ogni valore dice se e' una somma o un conteggio", () => {
    monta();
    const operazioni = within(screen.getByRole("region", { name: /Operazioni/ }));
    const riga = (nome: RegExp) => operazioni.getByRole("checkbox", { name: nome }).closest("div") as HTMLElement;
    expect(within(riga(/^Ordinato/)).getByText("(Somma)")).toBeInTheDocument();
    expect(within(riga(/^Numero ordini/)).getByText("(Conteggio)")).toBeInTheDocument();
  });

  it("le medie e i tassi stanno nelle Misure, non dentro l'operazione", () => {
    monta();
    const operazioni = within(screen.getByRole("region", { name: /Operazioni/ }));
    fireEvent.click(operazioni.getByRole("button", { name: /^Preventivi/ }));
    expect(operazioni.queryByRole("checkbox", { name: /^Valore medio preventivo/ })).not.toBeInTheDocument();
    expect(operazioni.queryByRole("checkbox", { name: /^Tasso di conversione/ })).not.toBeInTheDocument();

    const misure = within(screen.getByRole("region", { name: /^Misure/ }));
    fireEvent.click(misure.getByRole("button", { name: /^Preventivi/ }));
    expect(misure.getByRole("checkbox", { name: /^Valore medio preventivo/ })).toBeInTheDocument();
    expect(misure.getByRole("checkbox", { name: /^Tasso di conversione/ })).toBeInTheDocument();
  });

  it("ogni misura mostra come si calcola, e da li' si parte per farne una variante", () => {
    const onPartiDa = vi.fn();
    monta(SELEZIONE_VUOTA, onPartiDa);
    const misure = within(screen.getByRole("region", { name: /^Misure/ }));
    fireEvent.click(misure.getByRole("button", { name: /^Preventivi/ }));
    expect(misure.queryByText("Come si calcola")).not.toBeInTheDocument();

    fireEvent.click(misure.getByRole("button", { name: "Come si calcola Tasso di conversione" }));
    expect(misure.getByText("Come si calcola")).toBeInTheDocument();
    expect(misure.getByText(/Parte di preventivo diventata ordine ÷ valore totale dei preventivi × 100/)).toBeInTheDocument();

    fireEvent.click(misure.getByRole("button", { name: /Parti da questa/ }));
    expect(onPartiDa).toHaveBeenCalledWith(expect.stringMatching(/^Come «Tasso di conversione» \(.*× 100\), ma $/));
  });

  it("nelle tabelle non c'e' il limite di due suddivisioni", () => {
    const selezione = { misure: ["ordinato" as const], suddivisioni: ["cliente", "agente"] as Dimensione[] };
    const { unmount } = render(
      <AlberoCampi compatto vocabolario={VOCABOLARIO_ALBERO} selezione={selezione} onCambia={vi.fn()} />
    );
    fireEvent.click(within(screen.getByRole("region", { name: /Campi comuni/ })).getByRole("button", { name: /^Prodotti/ }));
    expect(screen.getByRole("checkbox", { name: /^Categoria/ })).toBeDisabled();
    unmount();

    render(
      <AlberoCampi compatto senzaLimiteSuddivisioni vocabolario={VOCABOLARIO_ALBERO} selezione={selezione} onCambia={vi.fn()} />
    );
    fireEvent.click(within(screen.getByRole("region", { name: /Campi comuni/ })).getByRole("button", { name: /^Prodotti/ }));
    expect(screen.getByRole("checkbox", { name: /^Categoria/ })).toBeEnabled();
  });
});
