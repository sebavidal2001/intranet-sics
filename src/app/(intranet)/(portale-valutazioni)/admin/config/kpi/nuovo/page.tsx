import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { creaKpi } from "../../actions";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import NuovoKpiForm from "./nuovo-kpi-form";

export default async function NuovoKpiPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");

  const { data: parametri } = await supabase
    .from("parametri_radar")
    .select("id, nome")
    .eq("is_attivo", true)
    .order("ordine");

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
        <h1 className="font-tenorite text-2xl text-text">Nuovo KPI</h1>
        <p className="text-text-muted text-sm mt-1">
          Configura un indicatore chiave di performance basato sui parametri radar.
        </p>
      </div>

      <div className="bg-bg rounded-xl border border-border p-6">
        <NuovoKpiForm parametri={parametri ?? []} action={creaKpi} />
      </div>
    </div>
  );
}
