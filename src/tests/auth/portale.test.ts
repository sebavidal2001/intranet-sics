import { describe, it, expect, vi } from "vitest";
import { getPortaleAccesso, hasMinLivello, canAdminPortale } from "@/lib/auth/portale";
import type { LivelloAccesso } from "@/lib/auth/portale";

// Helper per costruire un mock Supabase con RPC configurabile
function makeSupabaseMock(rpcResult: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("getPortaleAccesso", () => {
  it("restituisce 'admin' quando la RPC ritorna 'admin'", async () => {
    const supabase = makeSupabaseMock({ data: "admin", error: null });
    const result = await getPortaleAccesso(supabase, "user-1", "valutazioni");
    expect(result).toBe("admin");
  });

  it("restituisce 'viewer' quando la RPC ritorna 'viewer'", async () => {
    const supabase = makeSupabaseMock({ data: "viewer", error: null });
    const result = await getPortaleAccesso(supabase, "user-1", "valutazioni");
    expect(result).toBe("viewer");
  });

  it("restituisce null quando la RPC ritorna errore", async () => {
    const supabase = makeSupabaseMock({ data: null, error: new Error("DB error") });
    const result = await getPortaleAccesso(supabase, "user-1", "valutazioni");
    expect(result).toBeNull();
  });

  it("restituisce null quando la RPC ritorna undefined", async () => {
    const supabase = makeSupabaseMock({ data: undefined, error: null });
    const result = await getPortaleAccesso(supabase, "user-1", "valutazioni");
    expect(result).toBeNull();
  });

  it("restituisce null quando la RPC ritorna null esplicitamente", async () => {
    const supabase = makeSupabaseMock({ data: null, error: null });
    const result = await getPortaleAccesso(supabase, "user-1", "valutazioni");
    expect(result).toBeNull();
  });

  it("chiama la RPC con i parametri corretti", async () => {
    const supabase = makeSupabaseMock({ data: "exporter", error: null });
    await getPortaleAccesso(supabase, "uid-42", "preventivatore");
    expect(supabase.rpc).toHaveBeenCalledWith("get_portale_livello", {
      p_user_id: "uid-42",
      p_slug: "preventivatore",
    });
  });
});

describe("hasMinLivello", () => {
  it("superadmin soddisfa il minimo 'superadmin'", () => {
    expect(hasMinLivello("superadmin", "superadmin")).toBe(true);
  });

  it("superadmin soddisfa il minimo 'admin'", () => {
    expect(hasMinLivello("superadmin", "admin")).toBe(true);
  });

  it("superadmin soddisfa il minimo 'viewer'", () => {
    expect(hasMinLivello("superadmin", "viewer")).toBe(true);
  });

  it("admin soddisfa il minimo 'admin'", () => {
    expect(hasMinLivello("admin", "admin")).toBe(true);
  });

  it("admin soddisfa il minimo 'exporter'", () => {
    expect(hasMinLivello("admin", "exporter")).toBe(true);
  });

  it("viewer NON soddisfa il minimo 'admin'", () => {
    expect(hasMinLivello("viewer", "admin")).toBe(false);
  });

  it("exporter NON soddisfa il minimo 'admin'", () => {
    expect(hasMinLivello("exporter", "admin")).toBe(false);
  });

  it("null restituisce sempre false", () => {
    expect(hasMinLivello(null, "viewer")).toBe(false);
    expect(hasMinLivello(null, "admin")).toBe(false);
    expect(hasMinLivello(null, "superadmin")).toBe(false);
  });
});

describe("canAdminPortale", () => {
  it("restituisce true quando il livello è 'admin'", async () => {
    const supabase = makeSupabaseMock({ data: "admin", error: null });
    const result = await canAdminPortale(supabase, "user-1", "valutazioni");
    expect(result).toBe(true);
  });

  it("restituisce true quando il livello è 'superadmin'", async () => {
    const supabase = makeSupabaseMock({ data: "superadmin", error: null });
    const result = await canAdminPortale(supabase, "user-1", "valutazioni");
    expect(result).toBe(true);
  });

  it("restituisce false quando il livello è 'viewer'", async () => {
    const supabase = makeSupabaseMock({ data: "viewer", error: null });
    const result = await canAdminPortale(supabase, "user-1", "valutazioni");
    expect(result).toBe(false);
  });

  it("restituisce false quando l'utente non ha accesso (null)", async () => {
    const supabase = makeSupabaseMock({ data: null, error: null });
    const result = await canAdminPortale(supabase, "user-1", "valutazioni");
    expect(result).toBe(false);
  });
});
