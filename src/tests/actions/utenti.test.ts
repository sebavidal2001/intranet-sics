import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockGetUser,
  mockUserFrom,
  mockAdminCreateUser,
  mockAdminUpdateUserById,
  mockAdminFrom,
  mockRedirect,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockUserFrom = vi.fn();
  const mockAdminCreateUser = vi.fn();
  const mockAdminUpdateUserById = vi.fn();
  const mockAdminFrom = vi.fn();
  const mockRedirect = vi.fn().mockImplementation((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  });
  return {
    mockGetUser,
    mockUserFrom,
    mockAdminCreateUser,
    mockAdminUpdateUserById,
    mockAdminFrom,
    mockRedirect,
  };
});

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockUserFrom,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue({
    auth: {
      admin: {
        createUser: mockAdminCreateUser,
        updateUserById: mockAdminUpdateUserById,
      },
    },
    from: mockAdminFrom,
  }),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { creaUtente, modificaUtente } from "@/app/(superadmin)/superadmin/utenti/actions";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) {
    fd.append(key, val);
  }
  return fd;
}

const VALID_UTENTE_FIELDS = {
  nome: "Mario",
  cognome: "Rossi",
  username: "mario.rossi",
  password: "password123",
  ruolo: "collaboratore",
  stato: "attivo",
};

function setupSuperadmin() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
  mockUserFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { ruolo: "superadmin" }, error: null }),
      }),
    }),
  });
}

function setupNonSuperadmin() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockUserFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { ruolo: "collaboratore" }, error: null }),
      }),
    }),
  });
}

// ── creaUtente ────────────────────────────────────────────────────────────────
describe("creaUtente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("utente non superadmin viene reindirizzato a /", async () => {
    setupNonSuperadmin();

    await expect(creaUtente(makeFormData(VALID_UTENTE_FIELDS))).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("username troppo corto → { success: false, error: '...' }", async () => {
    setupSuperadmin();

    const result = await creaUtente(
      makeFormData({ ...VALID_UTENTE_FIELDS, username: "ab" })
    );
    expect(result).toMatchObject({ success: false });
    expect((result as { success: false; error: string }).error).toContain(
      "Username minimo 3 caratteri"
    );
  });

  it("password troppo corta → { success: false, error: '...' }", async () => {
    setupSuperadmin();

    const result = await creaUtente(
      makeFormData({ ...VALID_UTENTE_FIELDS, password: "abc" })
    );
    expect(result).toMatchObject({ success: false });
  });

  it("dati validi + auth.admin.createUser ok → redirect a /superadmin/utenti", async () => {
    setupSuperadmin();
    mockAdminCreateUser.mockResolvedValue({
      data: { user: { id: "new-user-123" } },
      error: null,
    });
    mockAdminFrom.mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });

    await expect(creaUtente(makeFormData(VALID_UTENTE_FIELDS))).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(mockRedirect).toHaveBeenCalledWith("/superadmin/utenti");
  });

  it("errore da auth.admin.createUser → { success: false, error: '...' }", async () => {
    setupSuperadmin();
    mockAdminCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Email già in uso" },
    });

    const result = await creaUtente(makeFormData(VALID_UTENTE_FIELDS));
    expect(result).toEqual({ success: false, error: "Email già in uso" });
  });
});

// ── modificaUtente ────────────────────────────────────────────────────────────
describe("modificaUtente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("utente non superadmin viene reindirizzato a /", async () => {
    setupNonSuperadmin();

    await expect(
      modificaUtente(makeFormData({ ...VALID_UTENTE_FIELDS, id: "user-abc" }))
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("ID mancante → { success: false, error: 'ID utente mancante' }", async () => {
    setupSuperadmin();

    const result = await modificaUtente(makeFormData(VALID_UTENTE_FIELDS));
    expect(result).toEqual({ success: false, error: "ID utente mancante" });
  });

  it("dati validi (senza cambio password) → redirect a /superadmin/utenti", async () => {
    setupSuperadmin();
    // No password field → updateUserById not called
    const fieldsWithoutPassword = { nome: "Mario", cognome: "Rossi", username: "mario.rossi", ruolo: "collaboratore", stato: "attivo", id: "user-abc" };
    mockAdminFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    await expect(
      modificaUtente(makeFormData(fieldsWithoutPassword))
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/superadmin/utenti");
  });

  it("errore DB update → { success: false, error: '...' }", async () => {
    setupSuperadmin();
    // No password field → updateUserById not called
    const fieldsWithoutPassword = { nome: "Mario", cognome: "Rossi", username: "mario.rossi", ruolo: "collaboratore", stato: "attivo", id: "user-abc" };
    mockAdminFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: "DB error" } }),
      }),
    });

    const result = await modificaUtente(
      makeFormData(fieldsWithoutPassword)
    );
    expect(result).toEqual({ success: false, error: "DB error" });
  });
});
