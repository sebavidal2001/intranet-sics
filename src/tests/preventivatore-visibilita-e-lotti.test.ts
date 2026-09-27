import { beforeEach, describe, expect, it, vi } from "vitest";

// Visibilità dei documenti (fail-closed) e lettura a lotti degli id nei tool
// della chat: una lista di centinaia di id dentro `.in()` supera il limite di
// URL di nginx (verificato in produzione: 461 id → HTTP 414).

const mockCreateAdminClient = vi.hoisted(() => vi.fn());
const mockScope = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/portali/preventivatore/ruoli", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/portali/preventivatore/ruoli")>()),
  getPreventivatoreScope: mockScope,
}));

import { requireDocumentoVisibile } from "@/lib/portali/preventivatore/documento-visibile";
import { dispatchTool } from "@/lib/portali/preventivatore/chat/tool-handlers";

/** Query builder finto: ogni metodo è concatenabile, `await` restituisce la risposta scelta per tabella. */
function clientFinto(risposte: (tabella: string, chiamate: Array<[string, unknown[]]>) => { data: unknown; error: null }) {
  const registro: Array<{ tabella: string; chiamate: Array<[string, unknown[]]> }> = [];
  const from = (tabella: string) => {
    const chiamate: Array<[string, unknown[]]> = [];
    registro.push({ tabella, chiamate });
    const builder: Record<string, unknown> = {};
    const proxy: object = new Proxy(builder, {
      get(_t, prop: string) {
        if (prop === "then") {
          const esito = risposte(tabella, chiamate);
          return (ok: (v: unknown) => unknown) => Promise.resolve(esito).then(ok);
        }
        return (...args: unknown[]) => {
          chiamate.push([prop, args]);
          return proxy;
        };
      },
    });
    return proxy;
  };
  return { client: { schema: () => ({ from }), from }, registro };
}

describe("requireDocumentoVisibile", () => {
  beforeEach(() => vi.clearAllMocks());

  function conDocumento(doc: { id: string; cliente_master_id: string | null } | null) {
    mockCreateAdminClient.mockReturnValue(clientFinto(() => ({ data: doc, error: null })).client);
  }

  it("commerciale ristretto + documento senza cliente master → 403", async () => {
    conDocumento({ id: "d1", cliente_master_id: null });
    mockScope.mockResolvedValue({ restricted: true, agenteCodice: "AG1", clienteIds: ["c1"] });
    await expect(requireDocumentoVisibile({ userId: "u", livello: "viewer" }, "d1")).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it("fuori portfolio → 403; nel portfolio → ok", async () => {
    mockScope.mockResolvedValue({ restricted: true, agenteCodice: "AG1", clienteIds: ["c1"] });
    conDocumento({ id: "d1", cliente_master_id: "c2" });
    await expect(requireDocumentoVisibile({ userId: "u", livello: "viewer" }, "d1")).resolves.toMatchObject({ ok: false, status: 403 });
    conDocumento({ id: "d1", cliente_master_id: "c1" });
    await expect(requireDocumentoVisibile({ userId: "u", livello: "viewer" }, "d1")).resolves.toMatchObject({ ok: true });
  });

  it("senza scope vede tutto; documento inesistente → 404", async () => {
    mockScope.mockResolvedValue({ restricted: false, agenteCodice: null, clienteIds: [] });
    conDocumento({ id: "d1", cliente_master_id: null });
    await expect(requireDocumentoVisibile({ userId: "u", livello: "admin" }, "d1")).resolves.toMatchObject({ ok: true });
    conDocumento(null);
    await expect(requireDocumentoVisibile({ userId: "u", livello: "admin" }, "d1")).resolves.toMatchObject({ ok: false, status: 404 });
  });
});

describe("tool della chat: id a lotti", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cerca_articolo senza filtri non passa liste di id", async () => {
    const finto = clientFinto(() => ({ data: [], error: null }));
    mockCreateAdminClient.mockReturnValue(finto.client);
    await dispatchTool("cerca_articolo", { query: "FM85" });
    const conIn = finto.registro.filter((r) => r.chiamate.some(([m]) => m === "in"));
    expect(conIn).toHaveLength(0);
  });

  it("con lo scope, le righe si cercano a lotti di al massimo 150 documenti", async () => {
    const documenti = Array.from({ length: 400 }, (_, i) => ({ id: `doc-${i}`, codice: `C${i}`, cliente: "X" }));
    const finto = clientFinto((tabella, chiamate) => {
      if (tabella === "documenti") {
        const range = chiamate.find(([m]) => m === "range");
        const da = range ? Number(range[1][0]) : 0;
        return { data: documenti.slice(da, da + 1000), error: null };
      }
      return { data: [], error: null };
    });
    mockCreateAdminClient.mockReturnValue(finto.client);
    await dispatchTool("cerca_articolo", { query: "FM85" }, { clienteIds: ["cm-1"], agenteCodice: "AG1" });
    const lotti = finto.registro
      .filter((r) => r.tabella === "righe_distinta")
      .map((r) => (r.chiamate.find(([m, a]) => m === "in" && a[0] === "documento_id")?.[1][1] as string[]).length);
    expect(lotti).toEqual([150, 150, 100]);
  });

  it("dettaglio_preventivo trova anche i codici commessa con trattino", async () => {
    const finto = clientFinto(() => ({ data: null, error: null }));
    mockCreateAdminClient.mockReturnValue(finto.client);
    await dispatchTool("dettaglio_preventivo", { codice: "SIM-RIC-0927" });
    const filtri = finto.registro.flatMap((r) => r.chiamate.filter(([m]) => m === "or").map(([, a]) => String(a[0])));
    expect(filtri.some((f) => f.includes("codice.ilike.SIM-RIC-0927"))).toBe(true);
  });
});
