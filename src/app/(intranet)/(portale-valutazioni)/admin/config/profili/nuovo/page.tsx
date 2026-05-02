import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NuovoProfiloForm from "./nuovo-profilo-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

export default async function NuovoProfiloPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Config", href: "/admin/config" },
        { label: "Profili professionali", href: "/admin/config/profili" },
        { label: "Nuovo profilo" },
      ]} />
      <div className="mb-6">
        <h1 className="font-tenorite text-2xl text-text">
          Nuovo Profilo Professionale
        </h1>
        <p className="text-text-muted text-sm mt-1">
          I profili professionali raggruppano le mansioni per la valutazione del
          personale.
        </p>
      </div>

      <div className="bg-bg rounded-xl border border-border p-6">
        <NuovoProfiloForm />
      </div>
    </div>
  );
}
