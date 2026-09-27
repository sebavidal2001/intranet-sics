import { Suspense } from "react";
import { redirect } from "next/navigation";
import { NuovoView } from "@/components/portali/preventivatore/nuovo-view";
import type { ServizioDB } from "@/components/portali/preventivatore/nuovo-view-types";
import type { TemplateListItem } from "@/components/portali/preventivatore/blocco-template-panel";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { PORTALE_SLUGS } from "@/lib/config/portali";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Nuovo Preventivo",
};

// Catalogo servizi e template arrivano già con la pagina: prima il builder li
// chiedeva con due fetch dopo l'idratazione, e i picker restavano vuoti.
export default async function NuovoPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  const supabase = await createClient();
  const livello = await getPortaleAccesso(supabase, user.id, PORTALE_SLUGS.PREVENTIVATORE);
  if (livello === null) redirect("/");

  const admin = createAdminClient();
  const [serviziRes, templateRes] = await Promise.all([
    admin
      .schema("preventivatore")
      .from("servizi_manodopera")
      .select("id, nome, categoria, tariffa_ora, unita, ordine, is_attivo, scala_con_quantita")
      .eq("is_attivo", true)
      .order("ordine", { ascending: true }),
    admin
      .schema("preventivatore")
      .from("template")
      .select("id, nome, slug, descrizione, attivo, ordine, consegna_settimane_min, consegna_settimane_max")
      .eq("attivo", true)
      .order("ordine", { ascending: true }),
  ]);

  // In caso di errore si lascia che il client ripieghi sulle API (props assenti).
  const servizi = serviziRes.error ? undefined : ((serviziRes.data ?? []) as ServizioDB[]);
  const template = templateRes.error ? undefined : ((templateRes.data ?? []) as TemplateListItem[]);

  return (
    <Suspense fallback={null}>
      <NuovoView serviziIniziali={servizi} templateIniziali={template} />
    </Suspense>
  );
}
