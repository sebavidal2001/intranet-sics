import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ModificaKpiForm from "./modifica-kpi-form";

export default async function ModificaKpiPage({
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

  const adminSb = createAdminClient();
  const [{ data: kpiRaw }, { data: parametri }] = await Promise.all([
    adminSb.from("kpi_config").select("*").eq("id", id).single(),
    adminSb.from("parametri_radar").select("id, nome").order("ordine"),
  ]);

  type KpiRow = {
    id: string; nome: string; parametro_id: string | null;
    operatore: ">" | "<" | ">=" | "<=" | "="; soglia: number; anno: number | null;
  };
  const kpi = kpiRaw as KpiRow | null;

  if (!kpi) redirect("/admin/config");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link
          href="/admin/config"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Torna alla configurazione
        </Link>
        <h1 className="font-tenorite text-2xl text-text">Modifica KPI</h1>
      </div>

      <div className="bg-bg rounded-xl border border-border p-6">
        <ModificaKpiForm kpi={kpi} parametri={parametri ?? []} />
      </div>
    </div>
  );
}
