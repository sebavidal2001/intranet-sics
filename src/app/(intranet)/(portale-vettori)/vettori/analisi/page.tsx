import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getVettoriContext, vedeImporti } from "@/lib/portali/vettori/ruoli";
import { analisi } from "@/lib/portali/vettori/letture";
import { AnalisiView } from "@/components/portali/vettori/analisi-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Analisi vettori",
};

/**
 * Il periodo si legge dalla query, con l'anno in corso come ripiego.
 * Un'analisi senza periodo dichiarato è un numero senza unità di misura.
 */
function periodo(sp: Record<string, string | string[] | undefined>) {
  const anno = Number(Array.isArray(sp.anno) ? sp.anno[0] : sp.anno);
  const valido = Number.isInteger(anno) && anno >= 2020 && anno <= 2100;
  const a = valido ? anno : new Date().getFullYear();
  return { da: `${a}-01-01`, a: `${a}-12-31`, anno: a };
}

export default async function AnalisiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  const ctx = await getVettoriContext(user.id);
  if (ctx.livello === null) redirect("/");
  // Il magazzino non vede importi: un'analisi di spesa non lo riguarda.
  if (!vedeImporti(ctx)) redirect("/vettori/bolle");

  const p = periodo(await searchParams);
  return <AnalisiView dati={await analisi(p.da, p.a)} anno={p.anno} />;
}
