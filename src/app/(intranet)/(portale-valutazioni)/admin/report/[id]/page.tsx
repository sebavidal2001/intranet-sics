import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { getReport, calcolaDatiBlocco } from "@/lib/portali/valutazioni/services/report-service";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ReportBlock } from "@/components/portali/valutazioni/report/report-block";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Pencil, Download, Printer } from "lucide-react";

export default async function AdminReportViewPage({
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

  const result = await getReport(id);
  if (!result) notFound();

  const { report, blocchi } = result;
  const dati = await Promise.all(blocchi.map((b) => calcolaDatiBlocco(b)));

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Admin", href: "/admin/config" },
        { label: "Report", href: "/admin/report" },
        { label: report.nome },
      ]} />

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-tenorite text-2xl text-text">{report.nome}</h1>
            {!report.is_attivo && <Badge variant="outline">Inattivo</Badge>}
          </div>
          {report.descrizione && (
            <p className="text-text-muted text-sm">{report.descrizione}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/portali/valutazioni/report/${id}/export-csv`} download>
              <Download className="w-4 h-4 mr-1.5" />
              CSV
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/report/${id}/print`} target="_blank">
              <Printer className="w-4 h-4 mr-1.5" />
              Stampa PDF
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/admin/report/${id}/modifica`}>
              <Pencil className="w-4 h-4 mr-1.5" />
              Modifica
            </Link>
          </Button>
        </div>
      </div>

      {blocchi.length === 0 ? (
        <div className="bg-bg rounded-xl border border-border p-12 text-center">
          <p className="text-text-muted">Questo report non ha ancora blocchi configurati.</p>
          <Button asChild className="mt-4">
            <Link href={`/admin/report/${id}/modifica`}>Aggiungi blocchi</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {blocchi.map((blocco, i) => (
            <ReportBlock key={blocco.id} blocco={blocco} dati={dati[i]} />
          ))}
        </div>
      )}
    </div>
  );
}
