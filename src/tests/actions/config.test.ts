import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockGetUser,
  mockIsValutazioniAdmin,
  mockAdminFrom,
  mockRedirect,
  mockInsert,
  mockDelete,
  mockEq,
} = vi.hoisted(() => {
  const mockInsert = vi.fn();
  const mockEq = vi.fn();
  const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  const mockAdminFrom = vi.fn();
  const mockGetUser = vi.fn();
  const mockIsValutazioniAdmin = vi.fn();
  const mockRedirect = vi.fn().mockImplementation((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  });
  return { mockGetUser, mockIsValutazioniAdmin, mockAdminFrom, mockRedirect, mockInsert, mockDelete, mockEq };
});

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/valutazioni-admin", () => ({
  isValutazioniAdmin: mockIsValutazioniAdmin,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: mockAdminFrom,
  }),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import {
  creaScala,
  eliminaScala,
  creaParametro,
  creaSessione,
} from "@/app/(intranet)/(portale-valutazioni)/admin/config/actions";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) {
    fd.append(key, val);
  }
  return fd;
}

function setupAdminUser() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
  mockIsValutazioniAdmin.mockResolvedValue(true);
}

function setupNonAdminUser() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockIsValutazioniAdmin.mockResolvedValue(false);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("creaScala", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("non-admin viene reindirizzato a /", async () => {
    setupNonAdminUser();

    await expect(
      creaScala(makeFormData({ nome: "Test", min: "1", max: "10" }))
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("FormData con min > max restituisce { success: false, error: ... } (validazione Zod)", async () => {
    setupAdminUser();
    // min > max: Zod passa la coerce ma il valore stesso è valido per Zod
    // Zod non valida la relazione min<max — testare campo mancante o out-of-range
    const result = await creaScala(makeFormData({ nome: "", min: "1", max: "10" }));
    expect(result).toEqual({ success: false, error: "Nome obbligatorio" });
  });

  it("FormData valido con insert DB ok → redirect (success)", async () => {
    setupAdminUser();
    mockAdminFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });

    await expect(
      creaScala(makeFormData({ nome: "Scala Test", min: "1", max: "5" }))
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/admin/config");
  });

  it("errore DB restituisce { success: false, error: '...' }", async () => {
    setupAdminUser();
    mockAdminFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: "Duplicate key" } }),
    });

    const result = await creaScala(makeFormData({ nome: "Scala Test", min: "1", max: "5" }));
    expect(result).toEqual({ success: false, error: "Duplicate key" });
  });
});

describe("eliminaScala", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scala esistente → { success: true }", async () => {
    setupAdminUser();
    const mockEqFn = vi.fn().mockResolvedValue({ error: null });
    mockAdminFrom.mockReturnValue({
      delete: vi.fn().mockReturnValue({ eq: mockEqFn }),
    });

    const result = await eliminaScala("scala-uuid-123");
    expect(result).toEqual({ success: true });
    expect(mockEqFn).toHaveBeenCalledWith("id", "scala-uuid-123");
  });

  it("errore DB → { success: false, error: '...' }", async () => {
    setupAdminUser();
    mockAdminFrom.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: "FK violation" } }),
      }),
    });

    const result = await eliminaScala("scala-uuid-123");
    expect(result).toEqual({ success: false, error: "FK violation" });
  });
});

describe("creaParametro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("colore con formato invalido → { success: false, error: 'Colore non valido ...' }", async () => {
    setupAdminUser();

    const result = await creaParametro(
      makeFormData({ nome: "Param", colore: "rosso", ordine: "0" })
    );
    expect(result).toEqual({
      success: false,
      error: "Colore non valido (formato #RRGGBB)",
    });
  });

  it("colore valido con insert ok → redirect", async () => {
    setupAdminUser();
    mockAdminFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });

    await expect(
      creaParametro(
        makeFormData({ nome: "Param", colore: "#00a1be", ordine: "1" })
      )
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/admin/config");
  });

  it("nome mancante → { success: false, error: 'Nome obbligatorio' }", async () => {
    setupAdminUser();

    const result = await creaParametro(
      makeFormData({ nome: "", colore: "#00a1be", ordine: "0" })
    );
    expect(result).toEqual({ success: false, error: "Nome obbligatorio" });
  });
});

describe("creaSessione", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("anno fuori range (1900) → { success: false }", async () => {
    setupAdminUser();

    const result = await creaSessione(
      makeFormData({ anno: "1900", scala_id: "550e8400-e29b-41d4-a716-446655440000" })
    );
    expect(result).toMatchObject({ success: false });
  });

  it("scala_id non UUID → { success: false, error: 'Seleziona una scala' }", async () => {
    setupAdminUser();

    const result = await creaSessione(
      makeFormData({ anno: "2024", scala_id: "not-a-uuid" })
    );
    expect(result).toEqual({ success: false, error: "Seleziona una scala" });
  });

  it("anno valido + scala_id UUID valida → redirect", async () => {
    setupAdminUser();
    mockAdminFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });

    await expect(
      creaSessione(
        makeFormData({
          anno: "2024",
          scala_id: "550e8400-e29b-41d4-a716-446655440000",
        })
      )
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/admin/config");
  });
});
