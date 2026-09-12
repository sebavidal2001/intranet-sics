import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import {
  getVettoriContext,
  puoGestire,
  puoRegistrareArrivi,
} from "@/lib/portali/vettori/ruoli";

/**
 * `/vettori` non è una pagina: è la porta d'ingresso, e manda ciascuno dove
 * lavora davvero.
 *
 * Mandare tutti alla Simulazione — com'era prima — significava che chi entra
 * per controllare una fattura si trovava davanti un calcolatore di preventivi,
 * e che ogni sessione scaduta riportava lì invece che al punto di partenza.
 *
 * Chi ha il ruolo magazzino entra in Bolle, dove misura i colli e puo creare
 * una spedizione prima che il gestionale porti il documento.
 */
export default async function VettoriRootPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const ctx = await getVettoriContext(user.id);
  if (ctx.livello === null) redirect("/");

  if (puoGestire(ctx)) redirect("/vettori/fatture");
  if (puoRegistrareArrivi(ctx)) redirect("/vettori/bolle");
  redirect("/vettori/simulazione");
}
