import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockGetUser,
  mockUserFrom,
  mockAdminFrom,
  mockRedirect,
  mockRevalidatePath,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockUserFrom = vi.fn();
  const mockAdminFrom = vi.fn();
  const mockRedirect = vi.fn().mockImplementation((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  });
  const mockRevalidatePath = vi.fn();
  return { mockGetUser, mockUserFrom, mockAdminFrom, mockRedirect, mockRevalidatePath };
});

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockUserFrom,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: mockAdminFrom,
  }),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { salvaRisposteAuto } from "@/app/(intranet)/(portale-valutazioni)/valutazioni/auto/[id]/actions";
import { salvaRisposteResponsabile } from "@/app/(intranet)/(portale-valutazioni)/valutazioni/responsabile/[id]/actions";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const SESSIONE_ID = "sess-uuid-001";
const USER_ID = "user-uuid-001";
const RESP_ID = "resp-uuid-001";

const BASE_DATA_AUTO = {
  sessione_id: SESSIONE_ID,
  risposteMansioni: [] as { mansione_id: string; punteggio: number }[],
  risposteSkills: [] as { skill_id: string; punteggio: number }[],
  completa: false,
};

const BASE_DATA_RESP = {
  sessione_id: SESSIONE_ID,
  risposteMansioni: [] as { mansione_id: string; punteggio: number }[],
  risposteSkills: [] as { skill_id: string; punteggio: number }[],
  completa: false,
};

// ── salvaRisposteAuto ─────────────────────────────────────────────────────────
describe("salvaRisposteAuto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("utente non autenticato → redirect a /auth/login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    await expect(salvaRisposteAuto(BASE_DATA_AUTO)).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("sessione non trovata → { error: 'Sessione non trovata' }", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockUserFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
        }),
      }),
    });

    const result = await salvaRisposteAuto(BASE_DATA_AUTO);
    expect(result).toEqual({ error: "Sessione non trovata" });
  });

  it("sessione appartiene a utente diverso → { error: 'Non autorizzato' }", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockUserFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: SESSIONE_ID, utente_id: "other-user", stato: "collab_in_corso" },
            error: null,
          }),
        }),
      }),
    });

    const result = await salvaRisposteAuto(BASE_DATA_AUTO);
    expect(result).toEqual({ error: "Non autorizzato" });
  });

  it("stato sessione non valido per autovalutazione → { error: '...' }", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockUserFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: SESSIONE_ID, utente_id: USER_ID, stato: "bozza" },
            error: null,
          }),
        }),
      }),
    });

    const result = await salvaRisposteAuto(BASE_DATA_AUTO);
    expect(result).toEqual({ error: "La sessione non è aperta per l'autovalutazione" });
  });

  it("dati validi con stato 'collab_in_corso' → { } (success)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockUserFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: SESSIONE_ID, utente_id: USER_ID, stato: "collab_in_corso" },
            error: null,
          }),
        }),
      }),
    });

    const result = await salvaRisposteAuto(BASE_DATA_AUTO);
    expect(result).toEqual({});
    expect(mockRevalidatePath).toHaveBeenCalled();
  });

  it("dati validi con stato 'resp_completata' → { } (success)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockUserFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: SESSIONE_ID, utente_id: USER_ID, stato: "resp_completata" },
            error: null,
          }),
        }),
      }),
    });

    const result = await salvaRisposteAuto(BASE_DATA_AUTO);
    expect(result).toEqual({});
  });
});

// ── salvaRisposteResponsabile ─────────────────────────────────────────────────
describe("salvaRisposteResponsabile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("utente non autenticato → redirect a /auth/login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    await expect(salvaRisposteResponsabile(BASE_DATA_RESP)).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("sessione appartiene a responsabile diverso → { error: 'Non autorizzato' }", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: RESP_ID } } });
    mockUserFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: SESSIONE_ID, responsabile_id: "other-resp", stato: "resp_in_corso" },
            error: null,
          }),
        }),
      }),
    });

    const result = await salvaRisposteResponsabile(BASE_DATA_RESP);
    expect(result).toEqual({ error: "Non autorizzato" });
  });

  it("completa=true ma stato non è 'resp_in_corso' → { error: '...' }", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: RESP_ID } } });
    mockUserFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: SESSIONE_ID, responsabile_id: RESP_ID, stato: "bozza" },
            error: null,
          }),
        }),
      }),
    });

    const result = await salvaRisposteResponsabile({ ...BASE_DATA_RESP, completa: true });
    expect(result).toEqual({
      error: "La sessione non è in uno stato che consente questa operazione",
    });
  });

  it("dati validi con completa=false → { } (success, nessun update stato)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: RESP_ID } } });
    mockUserFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: SESSIONE_ID, responsabile_id: RESP_ID, stato: "resp_in_corso" },
            error: null,
          }),
        }),
      }),
    });

    const result = await salvaRisposteResponsabile(BASE_DATA_RESP);
    expect(result).toEqual({});
    expect(mockRevalidatePath).toHaveBeenCalled();
  });

  it("dati validi con completa=true e stato 'resp_in_corso' → { } (success, aggiorna stato)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: RESP_ID } } });
    mockUserFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: SESSIONE_ID, responsabile_id: RESP_ID, stato: "resp_in_corso" },
            error: null,
          }),
        }),
      }),
    });
    // Mock admin from for stato update
    mockAdminFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    const result = await salvaRisposteResponsabile({ ...BASE_DATA_RESP, completa: true });
    expect(result).toEqual({});
    expect(mockAdminFrom).toHaveBeenCalledWith("sessioni_utente");
  });
});
