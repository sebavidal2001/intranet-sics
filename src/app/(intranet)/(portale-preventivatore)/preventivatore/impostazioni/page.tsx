import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";
import { ImpostazioniView } from "@/components/portali/preventivatore/impostazioni-view";
import { PORTALE_SLUGS } from "@/lib/config/portali";

export const metadata = {
  title: "Impostazioni Preventivatore",
};

export default async function ImpostazioniPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  const livello = await getPortaleAccesso(supabase, user.id, PORTALE_SLUGS.PREVENTIVATORE);

  if (!hasMinLivello(livello, "admin")) redirect("/preventivatore/archivio");

  return <ImpostazioniView />;
}
