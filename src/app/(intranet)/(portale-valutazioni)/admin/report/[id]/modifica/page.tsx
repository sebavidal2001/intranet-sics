import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { getReport } from "@/lib/portali/valutazioni/services/report-service";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ReportWizard from "../../nuovo/report-wizard";

export default async function ModificaReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");

  const [reportResult, { data: parametri }, { data: ruoli }, { data: kpis }] = await Promise.all([
    getReport(id),
    supabase.from("parametri_radar").select("id, nome").eq("is_storico", false).order("ordine"),
    supabase.from("ruoli_config").select("slug, nome, colore").order("ordine"),
    supabase.from("kpi_config").select("id, nome").eq("is_attivo", true).order("nome"),
  ]);

  if (!reportResult) notFound();
  const { report, blocchi } = reportResult;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Admin", href: "/admin/config" },
        { label: "Report", href: "/admin/report" },
        { label: report.nome, href: `/admin/report/${id}` },
        { label: "Modifica" },
      ]} />

      <div className="mb-6">
        <Link
          href={`/admin/report/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Torna al report
        </Link>
        <h1 className="font-tenorite text-2xl text-text">Modifica report</h1>
        <p className="text-text-muted text-sm mt-1">{report.nome}</p>
      </div>

      <ReportWizard
        parametri={parametri ?? []}
        ruoli={ruoli ?? []}
        kpis={kpis ?? []}
        reportEsistente={report}
        blocchiEsistenti={blocchi}
      />
    </div>
  );
}
