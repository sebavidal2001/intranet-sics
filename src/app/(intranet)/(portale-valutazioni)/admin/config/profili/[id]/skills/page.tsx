import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import SkillsManager from "./skills-manager";

interface Skill {
  id: string;
  nome: string;
  descrizione: string | null;
  ordine: number;
}

export default async function SkillsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");

  const sb = createAdminClient();

  const { data: ruolo } = await sb
    .from("ruoli_professionali")
    .select("id, nome, descrizione")
    .eq("id", id)
    .single();

  if (!ruolo) redirect("/admin/config/profili");

  const { data: skills } = await sb
    .from("skills")
    .select("id, nome, descrizione, ordine")
    .eq("ruolo_professionale_id", id)
    .order("ordine");

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Config", href: "/admin/config" },
        { label: "Profili", href: "/admin/config/profili" },
        { label: ruolo.nome, href: `/admin/config/profili/${id}` },
        { label: "Skills" },
      ]} />
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-tenorite text-2xl text-text">
              Skills — {ruolo.nome}
            </h1>
            {ruolo.descrizione && (
              <p className="text-text-muted text-sm mt-1">{ruolo.descrizione}</p>
            )}
          </div>
          <Link
            href={`/admin/config/profili/${id}/skills/import`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-border text-text-muted hover:text-primary hover:border-primary transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            Importa da XLSX
          </Link>
        </div>
      </div>

      <SkillsManager
        ruoloProfessionaleId={id}
        skills={(skills ?? []) as Skill[]}
      />
    </div>
  );
}
