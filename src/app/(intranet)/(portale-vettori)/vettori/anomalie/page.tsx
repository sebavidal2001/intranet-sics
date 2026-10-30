import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getVettoriContext, puoGestire, vedeImporti } from "@/lib/portali/vettori/ruoli";
import { elencoAnomalie } from "@/lib/portali/vettori/letture";
import { elencoVettori } from "@/lib/portali/vettori/listino-service";
import { AnomalieView } from "@/components/portali/vettori/anomalie-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Anomalie",
};

export default async function AnomaliePage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; stato?: string }>;
}) {
  const { tipo, stato } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  const ctx = await getVettoriContext(user.id);
  if (ctx.livello === null) redirect("/");
  // Chi vede gli importi (direzione, listini) consulta; decide solo chi gestisce.
  if (!vedeImporti(ctx)) redirect("/vettori/simulazione");

  const [anomalie, vettori] = await Promise.all([
    elencoAnomalie(),
    elencoVettori(true),
  ]);

  return (
    <AnomalieView
      iniziali={anomalie}
      vettori={vettori.map((v) => ({ codice: v.codice, nome: v.nome }))}
      puoDecidere={puoGestire(ctx)}
      tipoIniziale={tipo}
      statoIniziale={stato === "tutte" ? "" : stato}
    />
  );
}
