import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getVettoriContext, puoGestire } from "@/lib/portali/vettori/ruoli";
import { elencoAnomalie } from "@/lib/portali/vettori/letture";
import { elencoVettori } from "@/lib/portali/vettori/listino-service";
import { AnomalieView } from "@/components/portali/vettori/anomalie-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Anomalie",
};

export default async function AnomaliePage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  const ctx = await getVettoriContext(user.id);
  if (ctx.livello === null) redirect("/");

  const [anomalie, vettori] = await Promise.all([
    elencoAnomalie(),
    elencoVettori(true),
  ]);

  return (
    <AnomalieView
      iniziali={anomalie}
      vettori={vettori.map((v) => ({ codice: v.codice, nome: v.nome }))}
      puoDecidere={puoGestire(ctx)}
    />
  );
}
