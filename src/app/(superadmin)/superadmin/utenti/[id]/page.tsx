import { createClient } from "@/lib/supabase/server";
import { ModificaUtenteForm } from "@/components/superadmin/modifica-utente-form";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

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

async function getData(id: string): Promise<{
  utente: UtenteDettaglio | null;
  responsabili: ResponsabileOption[];
}> {
  const supabase = await createClient();

  const [utenteRes, responsabiliRes] = await Promise.all([
    supabase
      .from("utenti")
      .select("id, nome, cognome, username, ruolo, reparto, responsabile_id, stato")
      .eq("id", id)
      .single(),
    supabase
      .from("utenti")
      .select("id, nome, cognome, ruolo")
      // Allineata alla pagina modifica: include responsabile_intermedio e i ruoli
      // amministrativi attuali ("admin" era un ruolo legacy non più esistente).
      .in("ruolo", ["superadmin", "amministratore", "admin", "responsabile", "responsabile_intermedio"])
      .order("cognome", { ascending: true }),
  ]);

  return {
    utente: utenteRes.data as UtenteDettaglio | null,
    responsabili: (responsabiliRes.data ?? []) as ResponsabileOption[],
  };
}

export default async function ModificaUtentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { utente, responsabili } = await getData(id);

  if (!utente) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Link
          href="/superadmin/utenti"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Torna agli utenti
        </Link>
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
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link
          href="/superadmin/utenti"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Torna agli utenti
        </Link>
        <h1 className="font-tenorite text-3xl text-text">Modifica utente</h1>
        <p className="text-text-muted mt-1">
          {utente.cognome} {utente.nome}
        </p>
      </div>

      <div className="bg-bg rounded-xl border border-border p-6">
        <ModificaUtenteForm utente={utente} responsabili={responsabili} />
      </div>
    </div>
  );
}
