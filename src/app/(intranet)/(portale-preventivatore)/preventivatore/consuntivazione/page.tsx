import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getPreventivatoreContext, haRuoloFunzionale, filtroCommercialeFromContext, PREVENTIVATORE_RUOLI } from "@/lib/portali/preventivatore/ruoli";
import { ConsuntivazioneView } from "@/components/portali/preventivatore/consuntivazione-view";

export const metadata = {
  title: "Consuntivazione",
};

export default async function ConsuntivazionePage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  // Stessa regola delle API (consuntivi-guard): ufficio tecnico, non i commerciali ristretti.
  const ctx = await getPreventivatoreContext(user.id);
  if (
    ctx.livello === null ||
    filtroCommercialeFromContext(ctx) !== null ||
    !haRuoloFunzionale(ctx, [PREVENTIVATORE_RUOLI.preventivatore])
  ) {
    redirect("/preventivatore/archivio");
  }

  return <ConsuntivazioneView />;
}
