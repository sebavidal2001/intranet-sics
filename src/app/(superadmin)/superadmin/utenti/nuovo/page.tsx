import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NuovoUtenteForm } from "@/components/superadmin/nuovo-utente-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

async function getData() {
  await createClient(); // refresh session cookie
  const supabase = createAdminClient();

  const [responsabiliRes, ruoliRes, repartiRes] = await Promise.all([
    supabase
      .from("utenti")
      .select("id, nome, cognome, ruolo")
      .not("ruolo", "eq", "collaboratore")
      .or("stato.eq.attivo,stato.is.null")
      .order("cognome", { ascending: true }),
    supabase
      .from("ruoli_config")
      .select("id, nome, slug, ordine")
      .order("ordine", { ascending: true }),
    supabase
      .from("reparti")
      .select("id, nome")
      .eq("attivo", true)
      .order("ordine", { ascending: true }),
  ]);

  const ruoliConfig = ((ruoliRes.data ?? []) as { id: string; nome: string; slug: string }[]).map(
    (r) => ({ value: r.slug, label: r.nome })
  );

  const reparti = (repartiRes.data ?? []) as { id: string; nome: string }[];
  const responsabili = (responsabiliRes.data ?? []) as {
    id: string;
    nome: string;
    cognome: string;
    ruolo: string;
  }[];

  return { responsabili, ruoliConfig, reparti };
}

export default async function NuovoUtentePage() {
  const { responsabili, ruoliConfig, reparti } = await getData();

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Breadcrumbs items={[
        { label: "Superadmin", href: "/superadmin" },
        { label: "Utenti", href: "/superadmin/utenti" },
        { label: "Nuovo utente" },
      ]} />

      <div>
        <h1 className="font-tenorite text-3xl text-text">Nuovo utente</h1>
        <p className="text-text-muted mt-1">Crea un nuovo utente e assegna ruolo, reparto e stato</p>
      </div>

      <div className="bg-bg rounded-xl border border-border p-6">
        <NuovoUtenteForm
          responsabili={responsabili}
          ruoliConfig={ruoliConfig}
          reparti={reparti}
        />
      </div>
    </div>
  );
}
