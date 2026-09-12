import { redirect } from "next/navigation";
import { BolleView } from "@/components/portali/vettori/bolle-view";
import { getSessionUser } from "@/lib/auth/session";
import {
  getVettoriContext,
  puoRegistrareArrivi,
} from "@/lib/portali/vettori/ruoli";

export const metadata = {
  title: "Bolle da misurare",
};

export default async function BollePage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const ctx = await getVettoriContext(user.id);
  if (ctx.livello === null) redirect("/");
  if (!puoRegistrareArrivi(ctx)) redirect("/vettori/simulazione");

  return <BolleView />;
}
