import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getReportVisibili } from "@/lib/portali/valutazioni/services/report-service";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileBarChart2, Eye } from "lucide-react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export default async function ReportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const reports = await getReportVisibili();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[{ label: "Report" }]} />

      <div className="mb-8">
        <h1 className="font-tenorite text-2xl text-text">Report</h1>
        <p className="text-text-muted text-sm mt-1">Dashboard e analisi disponibili per il tuo ruolo.</p>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <FileBarChart2 className="w-12 h-12 text-text-muted mb-4" />
            <p className="font-tenorite text-lg text-text mb-2">Nessun report disponibile</p>
            <p className="text-text-muted text-sm">
              Non ci sono report configurati per il tuo ruolo al momento.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map((report) => (
            <Card key={report.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="text-base">{report.nome}</CardTitle>
                {report.descrizione && (
                  <CardDescription className="text-sm line-clamp-2">{report.descrizione}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <Button asChild variant="default" size="sm" className="w-full">
                  <Link href={`/report/${report.id}`}>
                    <Eye className="w-4 h-4 mr-1.5" />
                    Visualizza
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
