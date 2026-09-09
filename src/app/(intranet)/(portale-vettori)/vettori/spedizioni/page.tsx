import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getVettoriContext, vedeImporti } from "@/lib/portali/vettori/ruoli";
import { elencoSpedizioni, valoriFiltro } from "@/lib/portali/vettori/storico";
import { StoricoView } from "@/components/portali/vettori/storico-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Storico spedizioni",
};

/**
 * Lo storico si apre sulle **partenze**, che sono la parte più numerosa e
 * quella su cui si discute di più con i clienti. Gli arrivi sono a una
 * linguetta di distanza, non dietro un filtro da impostare.
 */
export default async function SpedizioniPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  const ctx = await getVettoriContext(user.id);
  if (ctx.livello === null) redirect("/");
  if (!vedeImporti(ctx)) redirect("/vettori/simulazione");

  const [iniziali, valori] = await Promise.all([
    elencoSpedizioni({ direzione: "uscita", perPagina: 100 }),
    valoriFiltro(),
  ]);

  return <StoricoView iniziali={iniziali} valori={valori} />;
}
