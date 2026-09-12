import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getVettoriContext } from "@/lib/portali/vettori/ruoli";

/** La simulazione è il punto di ingresso operativo per tutti i ruoli. */
export default async function VettoriRootPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const ctx = await getVettoriContext(user.id);
  if (ctx.livello === null) redirect("/");

  redirect("/vettori/simulazione");
}
