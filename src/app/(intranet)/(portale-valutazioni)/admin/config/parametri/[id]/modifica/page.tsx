import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ModificaParametroForm from "./modifica-parametro-form";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

export default async function ModificaParametroPage({
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

  const { data: parametro } = await supabase
    .from("parametri_radar")
    .select("*")
    .eq("id", id)
    .single();

  if (!parametro) redirect("/admin/config");

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
        <h1 className="font-tenorite text-2xl text-text">Modifica Parametro Radar</h1>
      </div>

      <div className="bg-bg rounded-xl border border-border p-6">
        <ModificaParametroForm parametro={parametro} />
      </div>
    </div>
  );
}
