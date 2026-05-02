import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ModificaUtenteForm } from "@/components/superadmin/modifica-utente-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

interface UtenteDettaglio {
  id: string;
  nome: string;
  cognome: string;
  username: string | null;
  ruolo: string;
  stato: "attivo" | "inattivo" | null;
  reparto: string | null;
  responsabile_id: string | null;
}

interface ResponsabileOption {
  id: string;
  nome: string;
  cognome: string;
  ruolo: string;
}

interface RuoloOption {
  value: string;
  label: string;
}

async function getData(id: string): Promise<{
  utente: UtenteDettaglio | null;
  responsabili: ResponsabileOption[];
  ruoliConfig: RuoloOption[];
}> {
  await createClient(); // refresh session cookie
  const supabase = createAdminClient();

  const [utenteRes, responsabiliRes, ruoliConfigRes] = await Promise.all([
    supabase
      .from("utenti")
      .select("id, nome, cognome, username, ruolo, reparto, responsabile_id, stato")
      .eq("id", id)
      .single(),
    supabase
      .from("utenti")
      .select("id, nome, cognome, ruolo")
      .in("ruolo", ["superadmin", "amministratore", "admin", "responsabile", "responsabile_intermedio"])
      .order("cognome", { ascending: true }),
    supabase
      .from("ruoli_config")
      .select("id, nome, slug")
      .order("ordine", { ascending: true }),
  ]);

  const ruoliConfig: RuoloOption[] = (ruoliConfigRes.data ?? []).map((r: { id: string; nome: string; slug: string }) => ({
    value: r.slug,
    label: r.nome,
  }));

  return {
    utente: utenteRes.data as UtenteDettaglio | null,
    responsabili: (responsabiliRes.data ?? []) as ResponsabileOption[],
    ruoliConfig,
  };
}

export default async function ModificaUtentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { utente, responsabili, ruoliConfig } = await getData(id);

  if (!utente) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Breadcrumbs items={[{ label: "Superadmin", href: "/superadmin" }, { label: "Utenti", href: "/superadmin/utenti" }, { label: "Modifica" }]} />
        <div className="bg-bg rounded-xl border border-border p-8 text-center">
          <p className="font-tenorite text-lg text-text">Utente non trovato</p>
          <p className="text-text-muted text-sm mt-1">
            L&apos;utente richiesto non esiste o è stato eliminato.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Breadcrumbs items={[
        { label: "Superadmin", href: "/superadmin" },
        { label: "Utenti", href: "/superadmin/utenti" },
        { label: `${utente.cognome} ${utente.nome}` },
      ]} />
      <div>
        <h1 className="font-tenorite text-3xl text-text">Modifica utente</h1>
        <p className="text-text-muted mt-1">
          {utente.cognome} {utente.nome}
        </p>
      </div>

      <div className="bg-bg rounded-xl border border-border p-6">
        <ModificaUtenteForm
          utente={utente}
          responsabili={responsabili}
          ruoliConfig={ruoliConfig}
        />
      </div>
    </div>
  );
}
