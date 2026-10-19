import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { VistaBackoffice } from "@/components/prototipo-bi/vista-backoffice";
import { VistaCarico } from "@/components/prototipo-bi/vista-carico";
import type { RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class {
    constructor(private cb: (e: unknown[]) => void) {}
    observe() {
      this.cb([{ contentRect: { width: 800, height: 400 } }]);
    }
    unobserve() {}
    disconnect() {}
  };
  g.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
});

afterEach(() => vi.unstubAllGlobals());

function ris(spec: SpecQuery, righe: [Record<string, string>, number][]): RisultatoQuery {
  return {
    spec,
    metrica: spec.metrica,
    unita: "numero",
    righe: righe.map(([chiavi, valore]) => ({ etichetta: Object.values(chiavi).join(" · "), chiavi, valore, conteggio: 1 })),
    totale: righe.reduce((t, [, v]) => t + v, 0),
    certificata: true,
    avvisi: [],
  };
}

/** Risponde a ogni spec in base a metrica e raggruppamenti, come farebbe il motore. */
function rispondi(spec: SpecQuery): RisultatoQuery {
  const g = (spec.raggruppa ?? []).join("+") + (spec.granularita ? `+${spec.granularita}` : "");
  const righe = spec.metrica.startsWith("righe");
  if (spec.modificatore === "anno_precedente") return ris(spec, [[{}, righe ? 800 : 200]]);
  switch (g) {
    case "creatore":
      return ris(spec, [
        [{ creatore: "Lucia Roda" }, righe ? 500 : 100],
        [{ creatore: "vendite" }, righe ? 300 : 80],
      ]);
    case "creatore+profilo":
      return ris(spec, [
        [{ creatore: "Lucia Roda", profilo: "PC" }, 60],
        [{ creatore: "Lucia Roda", profilo: "OC" }, 40],
        [{ creatore: "vendite", profilo: "FC" }, 80],
      ]);
    case "creatore+giorno":
      return ris(spec, [
        [{ creatore: "Lucia Roda", periodo: "2026-09-07" }, 30],
        [{ creatore: "Lucia Roda", periodo: "2026-09-08" }, 20],
        [{ creatore: "vendite", periodo: "2026-09-07" }, 15],
      ]);
    case "creatore+mese":
      return ris(spec, [
        [{ creatore: "Lucia Roda", periodo: "2026-08" }, 200],
        [{ creatore: "Lucia Roda", periodo: "2026-09" }, 300],
      ]);
    case "creatore+ora_creazione":
      return ris(spec, [
        [{ creatore: "Lucia Roda", ora_creazione: "08:00" }, 100],
        [{ creatore: "Lucia Roda", ora_creazione: "10:00" }, 400],
      ]);
    default:
      return ris(spec, []);
  }
}

function stubFetch(extra?: (url: string) => unknown) {
  const f = vi.fn(async (url: string, init?: { body?: string }) => {
    if (url === "/api/bi/query") {
      const { specs } = JSON.parse(init!.body!) as { specs: { id: string; spec: SpecQuery }[] };
      return {
        ok: true,
        json: async () => ({ risultati: specs.map((s) => ({ id: s.id, risultato: rispondi(s.spec) })), dataMassima: "2026-09-30" }),
      };
    }
    return { ok: true, json: async () => extra?.(url) ?? {} };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("VistaCarico", () => {
  it("mostra il lavoro, la tabella per utente e dice che i ruoli condivisi non sono persone", async () => {
    const f = stubFetch();
    render(<VistaCarico area="vendite" anno={2026} periodo={{ anno: 2026 }} />);

    await waitFor(() => expect(screen.getByText("Chi fa cosa")).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getAllByText("Lucia Roda").length).toBeGreaterThan(0);
    expect(screen.getAllByText("vendite").length).toBeGreaterThan(0);
    // 300 righe su 800 sono dell'utente condiviso «vendite» (37,5%): l'avviso c'è.
    expect(screen.getByText(/utenti condivisi \(vendite, segreteria/)).toBeInTheDocument();
    // Le colonne dei tipi di documento dell'area. Si cercano come intestazioni
    // della tabella: le stesse parole sono anche nella legenda del mix documenti,
    // che compare quando il grafico ha misurato il contenitore — un getByText
    // trovava una o due copie secondo i tempi, e il test era instabile.
    expect(screen.getByRole("button", { name: "Ordina per Preventivi" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ordina per Fatture" })).toBeInTheDocument();
    // Una sola chiamata al motore, e nessuna all'API degli acquisti per le Vendite.
    expect(f.mock.calls.filter(([u]) => u === "/api/bi/query")).toHaveLength(1);
    expect(f.mock.calls.some(([u]) => String(u).startsWith("/api/bi/acquisti"))).toBe(false);
  });

  it("per gli Acquisti usa le metriche d'acquisto e legge anche l'esito dei buyer", async () => {
    const f = stubFetch((url) =>
      url.startsWith("/api/bi/acquisti")
        ? { perBuyer: [{ nome: "Lucia Roda", puntualitaPct: 91, righeScadute: 4 }] }
        : {}
    );
    render(<VistaCarico area="acquisti" anno={2026} periodo={{ dal: "2026-01-01", al: "2026-09-30" }} />);

    await waitFor(() => expect(screen.getByText("Chi fa cosa")).toBeInTheDocument(), { timeout: 5000 });
    const corpo = JSON.parse((f.mock.calls.find(([u]) => u === "/api/bi/query")![1] as { body: string }).body) as {
      specs: { spec: SpecQuery }[];
    };
    expect(new Set(corpo.specs.map((s) => s.spec.metrica))).toEqual(
      new Set(["documenti_acquisto_creati", "righe_acquisto_inserite"])
    );
    await waitFor(() => expect(screen.getByText("Puntualità")).toBeInTheDocument());
    expect(f.mock.calls.some(([u]) => u === "/api/bi/acquisti?dal=2026-01-01&al=2026-09-30")).toBe(true);
  });

  it("alterna volumi e quote percentuali nel carico mensile", async () => {
    stubFetch();
    render(<VistaCarico area="vendite" anno={2026} periodo={{ anno: 2026 }} />);

    await waitFor(() => expect(screen.getByText("Come si distribuisce il carico")).toBeInTheDocument(), { timeout: 5000 });
    const sezione = screen.getByText("Come si distribuisce il carico").closest("section")!;
    fireEvent.click(within(sezione).getByText("Mostra quote %"));
    expect(within(sezione).getByText("Mostra volumi")).toBeInTheDocument();
    expect(within(sezione).getByText("quota di ciascuno sul totale del mese")).toBeInTheDocument();
  });
});

describe("VistaBackoffice", () => {
  it("si apre sulle Vendite e passa agli Acquisti con l'interruttore", async () => {
    stubFetch();
    render(
      <VistaBackoffice
        anno={2026}
        periodo={{ anno: 2026 }}
        filtriSpec={[]}
        alternaFiltro={() => {}}
        filtroDi={() => null}
      />
    );
    expect(screen.getByRole("tab", { name: "Vendite", selected: true })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Preventivi: reattività ed esito")).toBeInTheDocument(), { timeout: 5000 });

    fireEvent.click(screen.getByRole("tab", { name: "Acquisti" }));
    expect(screen.getByRole("tab", { name: "Acquisti", selected: true })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Preventivi: reattività ed esito")).not.toBeInTheDocument());
  });
});
