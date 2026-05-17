import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import MansioniGlobalManager from "./mansioni-global-manager";

export default async function MansioniGlobalPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");

  const sb = createAdminClient();

  const [{ data: mansioni }, { data: ruoli }, { data: parametri }] = await Promise.all([
    sb
      .from("mansioni")
      .select("id, testo, ordine, parametro_radar_id, ruolo_professionale_id")
      .order("testo"),
    sb.from("ruoli_professionali").select("id, nome").order("nome"),
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
        { label: "Mansioni globali" },
      ]} />
      <div className="mb-6">
        <h1 className="font-tenorite text-2xl text-text">Mansioni globali</h1>
        <p className="text-text-muted text-sm mt-1">
          Gestisci tutte le mansioni dei profili professionali. Puoi trovare duplicati e unirli in un&apos;unica voce.
        </p>
      </div>

      <MansioniGlobalManager
        mansioni={(mansioni ?? []) as { id: string; testo: string; ordine: number; parametro_radar_id: string | null; ruolo_professionale_id: string }[]}
        ruoli={(ruoli ?? []) as { id: string; nome: string }[]}
        parametri={(parametri ?? []) as { id: string; nome: string; colore: string }[]}
      />
    </div>
  );
}
