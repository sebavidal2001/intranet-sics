import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NuovaSessioneForm from "./nuova-sessione-form";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export default async function NuovaSessionePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("utenti")
    .select("ruolo")
    .eq("id", user.id)
    .single();

  if (!profile || profile.ruolo !== "admin") redirect("/");

  const { data: scale } = await supabase
    .from("scale_valutazione")
    .select("id, nome, min, max")
    .order("nome");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Config", href: "/admin/config" },
        { label: "Sessioni" },
        { label: "Nuova sessione" },
      ]} />
      <div className="mb-6">
        <h1 className="font-tenorite text-2xl text-text">Nuova Sessione di Valutazione</h1>
        <p className="text-text-muted text-sm mt-1">
          Crea una sessione per un anno specifico. Una volta creata, potrai aggiungere le domande.
        </p>
      </div>

      {scale && scale.length === 0 ? (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-6 text-center">
          <p className="font-tenorite text-text mb-1">Nessuna scala disponibile</p>
          <p className="text-sm text-text-muted mb-4">
            Prima di creare una sessione devi creare almeno una scala di valutazione.
          </p>
          <Link
            href="/admin/config/scale/nuova"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary-dark transition-colors"
          >
            Crea una scala →
          </Link>
        </div>
      ) : (
        <div className="bg-bg rounded-xl border border-border p-6">
          <NuovaSessioneForm scale={scale ?? []} />
        </div>
      )}
    </div>
  );
}
