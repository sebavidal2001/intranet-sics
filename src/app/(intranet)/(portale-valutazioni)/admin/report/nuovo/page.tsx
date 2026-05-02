import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import ReportWizard from "./report-wizard";

export default async function NuovoReportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");

  const [{ data: parametri }, { data: ruoli }, { data: kpis }] = await Promise.all([
    supabase.from("parametri_radar").select("id, nome").eq("is_storico", false).order("ordine"),
    supabase.from("ruoli_config").select("slug, nome, colore").order("ordine"),
    supabase.from("kpi_config").select("id, nome").eq("is_attivo", true).order("nome"),
  ]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Admin", href: "/admin/config" },
        { label: "Report", href: "/admin/report" },
        { label: "Nuovo" },
      ]} />

      <div className="mb-6">
        <Link
          href="/admin/report"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Torna ai report
        </Link>
        <h1 className="font-tenorite text-2xl text-text">Nuovo report</h1>
        <p className="text-text-muted text-sm mt-1">Configura i blocchi e la visibilità del report.</p>
      </div>

      <ReportWizard
        parametri={parametri ?? []}
        ruoli={ruoli ?? []}
        kpis={kpis ?? []}
      />
    </div>
  );
}
