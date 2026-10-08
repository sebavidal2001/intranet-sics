import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getVettoriContext, puoGestire } from "@/lib/portali/vettori/ruoli";
import { FattureView } from "@/components/portali/vettori/fatture-view";

export const metadata = {
  title: "Fatture dei vettori",
};

export default async function FatturePage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  const ctx = await getVettoriContext(user.id);
  if (ctx.livello === null) redirect("/");
  if (!puoGestire(ctx)) redirect("/vettori/simulazione");
  return <FattureView />;
}
