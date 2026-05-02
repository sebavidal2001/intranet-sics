import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import CalendarioClient from "./calendario-client";
import { getSessionUser, getSessionIsAdmin } from "@/lib/auth/session";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export const dynamic = "force-dynamic";

interface SearchParams {
  anno?: string;
  mese?: string;
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [user, isAdmin] = await Promise.all([
    getSessionUser(),
    getSessionIsAdmin(),
  ]);
  if (!user) redirect("/auth/login");
  if (!isAdmin) redirect("/");

  const supabase = createAdminClient();
  const params = await searchParams;
  const oggi = new Date();
  const anno = params.anno ? parseInt(params.anno, 10) : oggi.getFullYear();
  const mese = params.mese ? parseInt(params.mese, 10) : oggi.getMonth() + 1;

  // Carica sessioni dell'anno corrente con join utenti
  const { data: sessioni } = await supabase
    .from("sessioni_utente")
    .select("id, utente_id, scala_id, anno, data_programmata, orario, tipo_valutazione, stato, note_admin, utente:utenti!sessioni_utente_utente_id_fkey(nome, cognome)")
    .eq("anno", anno)
    .order("data_programmata", { ascending: true });

  // Carica utenti per il form (solo attivi o senza stato per retrocompatibilità)
  const { data: utenti } = await supabase
    .from("utenti")
    .select("id, nome, cognome, ruolo")
    .or("stato.eq.attivo,stato.is.null")
    .order("cognome");

  // Carica scale di valutazione
  const { data: scale } = await supabase
    .from("scale_valutazione")
    .select("id, nome")
    .order("nome");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: "Valutazioni", href: "/valutazioni" },
          { label: "Sessioni & Calendario" },
        ]} />
        {/* Header */}
        <div>
          <h1 className="font-tenorite text-3xl font-bold text-text">
            Calendario Valutazioni
          </h1>
          <p className="text-text-muted mt-1">
            Programma e gestisci le sessioni di valutazione
          </p>
        </div>

        <CalendarioClient
          sessioni={(sessioni ?? []) as unknown as { id: string; utente_id: string; scala_id: string; anno: number; data_programmata: string | null; orario: string | null; tipo_valutazione: string | null; stato: "programmata" | "resp_in_corso" | "resp_completata" | "collab_in_corso" | "completata" | "certificata"; note_admin: string | null; utente: { nome: string; cognome: string } | null }[]}
          utenti={utenti ?? []}
          scale={scale ?? []}
          anno={anno}
          mese={mese}
        />
      </div>
    </div>
  );
}
