import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getVettoriContext, vedeImporti } from "@/lib/portali/vettori/ruoli";

/**
 * Registrazione degli arrivi a magazzino — **sospesa dal 9 settembre 2026**.
 *
 * La schermata nasceva perché il gestionale i dati fisici degli arrivi non li
 * ha: sui 1.937 carichi da fornitore del 2026 i colli compaiono 8 volte, il
 * peso lordo 5, il volume mai. La strada alternativa è farli inserire a
 * gestionale insieme alla bolla, e in quel caso arriverebbero dalla pipeline
 * senza una seconda digitazione.
 *
 * Finché la decisione non è presa la voce sparisce dal menù ma **niente viene
 * cancellato**: il componente `arrivi-view.tsx`, la route
 * `/api/portali/vettori/arrivi` e la tabella `vettori.rilevazioni` restano al
 * loro posto, insieme alle registrazioni già fatte. Per riattivarla basta
 * rimettere la voce in `sidebar-nav.tsx` e togliere questo reindirizzamento.
 */
export default async function ArriviPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  const ctx = await getVettoriContext(user.id);
  if (ctx.livello === null) redirect("/");

  redirect(vedeImporti(ctx) ? "/vettori/spedizioni" : "/vettori/simulazione");
}
