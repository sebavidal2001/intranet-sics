import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { eAdminCampagne, getCampagneContext, puoOperare, type CampagneContext } from "./ruoli";

/**
 * Controlli di accesso per le pagine del portale. Il layout li fa gia' una volta,
 * ma ogni pagina rifa' il suo: la protezione non deve dipendere dal fatto che
 * qualcuno non sposti mai un `children` dentro un'altra struttura.
 */
export async function richiediOperatore(): Promise<{ userId: string; ctx: CampagneContext }> {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  const ctx = await getCampagneContext(user.id);
  if (!puoOperare(ctx)) redirect("/");
  return { userId: user.id, ctx };
}

export async function richiediAdmin(): Promise<{ userId: string; ctx: CampagneContext }> {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  const ctx = await getCampagneContext(user.id);
  if (ctx.livello === null) redirect("/");
  if (!eAdminCampagne(ctx)) redirect("/campagne");
  return { userId: user.id, ctx };
}
