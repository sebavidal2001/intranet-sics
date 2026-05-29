import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";
import { TemplateManager } from "@/components/portali/preventivatore/template-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Template Prodotti" };

export default async function TemplatePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
  if (!hasMinLivello(livello, "admin")) redirect("/preventivatore/dashboard");
  return <TemplateManager />;
}
