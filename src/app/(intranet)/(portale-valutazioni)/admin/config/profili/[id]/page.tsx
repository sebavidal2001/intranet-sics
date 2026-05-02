import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import MansioniManager from "./mansioni-manager";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

export default async function ProfiloDetailPage({
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

  // Carica tutto in parallelo
  const [{ data: ruolo }, { data: mansioni }, { data: parametri }] =
    await Promise.all([
      sb
        .from("ruoli_professionali")
        .select("id, nome, descrizione")
        .eq("id", id)
        .single(),
      sb
        .from("mansioni")
        .select("id, testo, ordine, parametro_radar_id, parametro:parametri_radar(id, nome, colore)")
        .eq("ruolo_professionale_id", id)
        .order("ordine"),
      sb
        .from("parametri_radar")
        .select("id, nome, colore")
        .eq("is_attivo", true)
        .order("nome"),
    ]);

  if (!ruolo) redirect("/admin/config/profili");

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <Breadcrumbs items={[
        { label: "Config", href: "/admin/config" },
        { label: "Profili professionali", href: "/admin/config/profili" },
        { label: ruolo.nome },
      ]} />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-tenorite text-2xl text-text">{ruolo.nome}</h1>
          {ruolo.descrizione && (
            <p className="text-text-muted text-sm mt-1">{ruolo.descrizione}</p>
          )}
        </div>
        <Link
          href={`/admin/config/profili/${id}/modifica`}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-border text-text-muted hover:text-primary hover:border-primary transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
          Modifica profilo
        </Link>
      </div>

      {/* Sezione Mansioni */}
      <section>
        <div className="mb-4">
          <h2 className="font-tenorite text-lg text-text">Mansioni</h2>
          <p className="text-sm text-text-muted mt-0.5">
            Le mansioni sono le attività valutate durante le sessioni. Ogni mansione è collegata a un parametro radar.
          </p>
        </div>

        {parametri && parametri.length === 0 ? (
          <div className="bg-warning/10 border border-warning/30 rounded-xl p-6 text-center">
            <p className="font-tenorite text-text mb-1">
              Nessun parametro radar configurato
            </p>
            <p className="text-sm text-text-muted mb-4">
              Prima di aggiungere mansioni devi configurare i parametri radar.
            </p>
            <Link
              href="/admin/config/parametri/nuovo"
              className="text-sm text-primary hover:text-primary-dark transition-colors"
            >
              Crea parametro →
            </Link>
          </div>
        ) : (
          <MansioniManager
            ruoloId={id}
            ruoloNome={ruolo.nome}
            // admin client returns join relations as arrays; runtime shape matches expected
            mansioni={(mansioni ?? []) as unknown as { id: string; testo: string; ordine: number; parametro_radar_id: string; parametro: { id: string; nome: string; colore: string } | null }[]}
            parametri={parametri ?? []}
          />
        )}
      </section>

    </div>
  );
}
