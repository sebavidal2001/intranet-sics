import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import SkillsGlobalManager from "./skills-global-manager";

export default async function SkillsGlobalPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");

  const sb = createAdminClient();

  const [{ data: skills }, { data: parametri }] = await Promise.all([
    sb
      .from("skills")
      .select("id, nome, descrizione, ordine, parametro_radar_id")
      .order("nome"),
    sb
      .from("parametri_radar")
      .select("id, nome, colore")
      .eq("is_storico", false)
      .order("ordine"),
  ]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Config", href: "/admin/config" },
        { label: "Skills globali" },
      ]} />
      <div className="mb-6">
        <h1 className="font-tenorite text-2xl text-text">Skills globali</h1>
        <p className="text-text-muted text-sm mt-1">
          Gestisci tutte le skills disponibili nel sistema. Le skills sono raggruppate per parametro radar e usate in tutte le sessioni di valutazione.
        </p>
      </div>

      <SkillsGlobalManager
        skills={(skills ?? []) as { id: string; nome: string; descrizione: string | null; ordine: number; parametro_radar_id: string | null }[]}
        parametri={(parametri ?? []) as { id: string; nome: string; colore: string }[]}
      />
    </div>
  );
}
