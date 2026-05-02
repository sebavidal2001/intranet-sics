import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import ModificaProfiloForm from "./modifica-profilo-form";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

export default async function ModificaProfiloPage({
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

  const { data: ruolo } = await supabase
    .from("ruoli_professionali")
    .select("id, nome, descrizione")
    .eq("id", id)
    .single();

  if (!ruolo) redirect("/admin/config/profili");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link
          href={`/admin/config/profili/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          Torna a {ruolo.nome}
        </Link>
        <h1 className="font-tenorite text-2xl text-text">Modifica Profilo</h1>
        <p className="text-text-muted text-sm mt-1">
          Aggiorna nome e descrizione del profilo professionale.
        </p>
      </div>

      <div className="bg-bg rounded-xl border border-border p-6">
        <ModificaProfiloForm
          id={id}
          defaultNome={ruolo.nome}
          defaultDescrizione={ruolo.descrizione ?? ""}
        />
      </div>
    </div>
  );
}
