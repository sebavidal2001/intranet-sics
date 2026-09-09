import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getVettoriContext, puoGestire } from "@/lib/portali/vettori/ruoli";
import { riepilogoListini } from "@/lib/portali/vettori/letture";
import { ListiniView } from "@/components/portali/vettori/listini-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Listini vettori",
};

export default async function ListiniPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  const ctx = await getVettoriContext(user.id);
  if (ctx.livello === null) redirect("/");
  if (!puoGestire(ctx)) redirect("/vettori/simulazione");

  const oggi = new Date();
  return (
    <ListiniView
      iniziali={await riepilogoListini(oggi.toISOString().slice(0, 10))}
      anno={oggi.getFullYear()}
      mese={oggi.getMonth() + 1}
    />
  );
}
