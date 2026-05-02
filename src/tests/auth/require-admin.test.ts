import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock calls are hoisted to the top of the file by Vitest.
// Variables declared with const/let are NOT available at hoist time.
// Use vi.hoisted() to declare mocks that need to be referenced in factories.

const { mockRedirect, mockGetUser, mockIsValutazioniAdmin, mockSupabase } =
  vi.hoisted(() => {
    const mockRedirect = vi.fn();
    const mockGetUser = vi.fn();
    const mockSupabase = { auth: { getUser: mockGetUser } };
    const mockIsValutazioniAdmin = vi.fn();
    return { mockRedirect, mockGetUser, mockIsValutazioniAdmin, mockSupabase };
  });

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@/lib/auth/valutazioni-admin", () => ({
  isValutazioniAdmin: mockIsValutazioniAdmin,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

// Import DOPO i mock
import { requireValutazioniAdmin } from "@/lib/auth/require-admin";

describe("requireValutazioniAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("chiama redirect('/auth/login') se getUser restituisce user null", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    // In Next.js, redirect() lancia NEXT_REDIRECT internamente
    mockRedirect.mockImplementationOnce(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(requireValutazioniAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
    expect(mockRedirect).toHaveBeenCalledTimes(1);
  });

  it("chiama redirect('/') se l'utente non è admin", async () => {
    const fakeUser = { id: "user-123" };
    mockGetUser.mockResolvedValueOnce({ data: { user: fakeUser } });
    mockIsValutazioniAdmin.mockResolvedValueOnce(false);
    mockRedirect.mockImplementationOnce(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(requireValutazioniAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockIsValutazioniAdmin).toHaveBeenCalledWith(mockSupabase, "user-123");
  });

  it("non chiama redirect se utente autenticato e admin", async () => {
    const fakeUser = { id: "admin-456" };
    mockGetUser.mockResolvedValueOnce({ data: { user: fakeUser } });
    mockIsValutazioniAdmin.mockResolvedValueOnce(true);

    const result = await requireValutazioniAdmin();

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(result).toBe(mockSupabase);
  });

  it("chiama isValutazioniAdmin con il client supabase e userId corretti", async () => {
    const fakeUser = { id: "user-789" };
    mockGetUser.mockResolvedValueOnce({ data: { user: fakeUser } });
    mockIsValutazioniAdmin.mockResolvedValueOnce(true);

    await requireValutazioniAdmin();

    expect(mockIsValutazioniAdmin).toHaveBeenCalledTimes(1);
    expect(mockIsValutazioniAdmin).toHaveBeenCalledWith(mockSupabase, "user-789");
  });
});
