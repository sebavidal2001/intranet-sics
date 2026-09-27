import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Schede tecniche (ricognizione del 27/09/2026): la memoria degli esempi non si
// avvelena, la scheda di un altro non si tocca, e una risposta AI troncata o
// illeggibile non diventa mai una scheda.

const mockGuard = vi.hoisted(() => vi.fn());
const mockAdmin = vi.hoisted(() => vi.fn());
const mockChiama = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portali/preventivatore/api-guard", () => ({ requirePreventivatore: mockGuard }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockAdmin }));
vi.mock("@/lib/portali/preventivatore/chat/embedding-cache", () => ({ getCachedEmbedding: vi.fn().mockResolvedValue([0.1]) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ ok: true }), tooManyRequests: vi.fn() }));
vi.mock("@/lib/portali/preventivatore/chat/config-cache", () => ({ loadAiConfig: vi.fn().mockResolvedValue({ modello_scheda_tecnica: "openrouter:anthropic/claude-sonnet-5" }) }));
vi.mock("@/lib/portali/preventivatore/ruoli", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/portali/preventivatore/ruoli")>()),
  getPreventivatoreScope: vi.fn().mockResolvedValue({ restricted: false, agenteCodice: null, clienteIds: [] }),
}));
vi.mock("@/lib/portali/preventivatore/scheda-tecnica/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/portali/preventivatore/scheda-tecnica/ai")>()),
  chiamaOpenRouterChat: mockChiama,
  recuperaEsempi: vi.fn().mockResolvedValue([]),
  registraUsage: vi.fn().mockResolvedValue(undefined),
}));

import { POST as approva } from "@/app/api/portali/preventivatore/scheda-tecnica/approva/route";
import { POST as genera } from "@/app/api/portali/preventivatore/scheda-tecnica/route";

const SCHEDA = "11111111-1111-4111-8111-111111111111";

function guard(livello: string, ruoli: string[]) {
  mockGuard.mockResolvedValue({ ok: true, user: { id: "utente-1" }, ctx: { userId: "utente-1", livello, ruoli, agenteCodice: null } });
}

/** Client finto: `schede_generate` restituisce la scheda indicata, gli insert vengono registrati. */
function admin(proprietario: string | null) {
  const inseriti: Array<Record<string, unknown>> = [];
  const catena = (esito: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "update", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = async () => esito;
    c.single = async () => esito;
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok);
    return c;
  };
  const from = (tabella: string) => {
    if (tabella === "schede_generate") return catena({ data: proprietario ? { id: SCHEDA, user_id: proprietario, builder_state: null } : null, error: null });
    const t = catena({ data: null, error: null });
    t.insert = (riga: Record<string, unknown>) => { inseriti.push(riga); return catena({ data: { id: "nuova" }, error: null }); };
    return t;
  };
  mockAdmin.mockReturnValue({ schema: () => ({ from }) });
  return inseriti;
}

const richiesta = (body: unknown) =>
  new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("approva", () => {
  beforeEach(() => vi.clearAllMocks());

  it("senza scheda_id → 400: niente testo arbitrario nella memoria", async () => {
    guard("viewer", ["preventivatore"]);
    admin("utente-1");
    const res = await approva(richiesta({ contenuto_md: "testo inventato" }));
    expect(res.status).toBe(400);
  });

  it("scheda di un altro utente → 403", async () => {
    guard("viewer", ["preventivatore"]);
    admin("altro-utente");
    const res = await approva(richiesta({ scheda_id: SCHEDA, contenuto_md: "scheda" }));
    expect(res.status).toBe(403);
  });

  it("senza ruolo preventivatore → 403", async () => {
    guard("viewer", ["commerciale"]);
    admin("utente-1");
    const res = await approva(richiesta({ scheda_id: SCHEDA, contenuto_md: "scheda" }));
    expect(res.status).toBe(403);
  });

  it("un preventivatore approva per sé (verificata=false), un admin per tutti (true)", async () => {
    guard("viewer", ["preventivatore"]);
    let inseriti = admin("utente-1");
    expect((await approva(richiesta({ scheda_id: SCHEDA, contenuto_md: "scheda" }))).status).toBe(200);
    expect(inseriti[0]).toMatchObject({ verificata: false });

    guard("admin", []);
    inseriti = admin("utente-1");
    expect((await approva(richiesta({ scheda_id: SCHEDA, contenuto_md: "scheda" }))).status).toBe(200);
    expect(inseriti[0]).toMatchObject({ verificata: true });
  });
});

describe("genera scheda", () => {
  const builderState = {
    titolo: "Nastro", cliente: null, data_consegna: null, blocchi: [],
    totali: { materiali: 0, servizi: 0, netto_totale: 0, n_blocchi: 0, n_articoli: 0, ore_totali: 0, coeff_ricarico_medio: 0 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    guard("viewer", ["preventivatore"]);
    admin("utente-1");
  });

  it("domande illeggibili due volte → 502, e nessuna scheda generata alla cieca", async () => {
    mockChiama.mockResolvedValue({ content: "non è json", usage: null, finishReason: "stop" });
    const res = await genera(richiesta({ builder_state: builderState }));
    expect(res.status).toBe(502);
    expect(mockChiama).toHaveBeenCalledTimes(2);
  });

  it("scheda troncata (finish_reason length) → 502, niente salvataggio", async () => {
    mockChiama.mockResolvedValue({ content: "Spett.le …", usage: null, finishReason: "length" });
    const inseriti = admin("utente-1");
    const res = await genera(richiesta({ builder_state: builderState, forza_generazione: true }));
    expect(res.status).toBe(502);
    expect(inseriti).toHaveLength(0);
  });
});
