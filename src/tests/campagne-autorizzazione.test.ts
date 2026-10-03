import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const getContext = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

// Si sostituisce solo la lettura del contesto: le funzioni che lo interpretano
// (puoOperare, eAdminCampagne) restano quelle vere, ed e' quelle che si prova.
vi.mock("@/lib/portali/campagne/ruoli", async (importOriginal) => {
  const reale = await importOriginal<typeof import("@/lib/portali/campagne/ruoli")>();
  return { ...reale, getCampagneContext: (...a: unknown[]) => getContext(...a) };
});

import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { eAdminCampagne, puoOperare, type CampagneContext } from "@/lib/portali/campagne/ruoli";

const ctx = (over: Partial<CampagneContext> = {}): CampagneContext => ({ livello: "viewer", ruoli: [], ...over });

describe("chi può cosa nel portale Campagne", () => {
  it("l'admin del portale e il superadmin operano e amministrano", () => {
    for (const livello of ["admin", "superadmin"] as const) {
      expect(puoOperare(ctx({ livello }))).toBe(true);
      expect(eAdminCampagne(ctx({ livello }))).toBe(true);
    }
  });

  it("il back office opera ma non amministra", () => {
    const bo = ctx({ ruoli: ["backoffice"] });
    expect(puoOperare(bo)).toBe(true);
    expect(eAdminCampagne(bo)).toBe(false);
  });

  it("un viewer senza il ruolo funzionale non può fare niente", () => {
    expect(puoOperare(ctx())).toBe(false);
    expect(eAdminCampagne(ctx())).toBe(false);
  });

  it("senza livello di portale nemmeno il ruolo funzionale basta", () => {
    expect(puoOperare(ctx({ livello: null, ruoli: ["backoffice"] }))).toBe(false);
  });

  it("un ruolo che non esiste non autorizza", () => {
    expect(puoOperare(ctx({ ruoli: ["amministrazione", "back_office"] }))).toBe(false);
  });
});

describe("requireCampagne", () => {
  beforeEach(() => {
    getUser.mockReset();
    getContext.mockReset();
  });

  const accedi = (contesto: CampagneContext | null) => {
    getUser.mockResolvedValue({ data: { user: contesto ? { id: "u1" } : null } });
    if (contesto) getContext.mockResolvedValue(contesto);
  };

  const stato = async (chi: "operatore" | "admin") => {
    const r = await requireCampagne({ chi });
    return r.ok ? 200 : r.response.status;
  };

  it("401 se non si è autenticati, senza nemmeno leggere i permessi", async () => {
    accedi(null);
    expect(await stato("operatore")).toBe(401);
    expect(getContext).not.toHaveBeenCalled();
  });

  it("403 senza accesso al portale", async () => {
    accedi(ctx({ livello: null }));
    expect(await stato("operatore")).toBe(403);
  });

  it("403 a un viewer senza ruolo, sia sulle route operative sia su quelle admin", async () => {
    accedi(ctx());
    expect(await stato("operatore")).toBe(403);
    expect(await stato("admin")).toBe(403);
  });

  it("il back office passa dalle route operative e NON da quelle admin", async () => {
    accedi(ctx({ ruoli: ["backoffice"] }));
    expect(await stato("operatore")).toBe(200);
    expect(await stato("admin")).toBe(403);
  });

  it("l'admin passa da entrambe e la guard restituisce utente e contesto", async () => {
    accedi(ctx({ livello: "admin" }));
    const r = await requireCampagne({ chi: "admin" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.id).toBe("u1");
      expect(r.ctx.livello).toBe("admin");
    }
    expect(await stato("operatore")).toBe(200);
  });
});
