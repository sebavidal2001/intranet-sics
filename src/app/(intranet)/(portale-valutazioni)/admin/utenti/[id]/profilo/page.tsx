import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import ProfiloManager from "./profilo-manager";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

export default async function UtenteProfilo({
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

  // Carica utente
  const { data: utente } = await supabase
    .from("utenti")
    .select("id, nome, cognome, ruolo, reparto")
    .eq("id", id)
    .single();

  if (!utente) redirect("/admin/utenti");

  // Carica tutti i ruoli professionali con le mansioni
  const { data: ruoli } = await supabase
    .from("ruoli_professionali")
    .select(
      "id, nome, descrizione, mansioni(id, testo, ordine, parametro:parametri_radar(nome, colore))"
    )
    .order("nome");

  // Profili assegnati all'utente
  const { data: profiliAssegnati } = await supabase
    .from("utente_profili")
    .select("ruolo_professionale_id")
    .eq("utente_id", id);

  // Mansioni assegnate all'utente
  const { data: mansioniAssegnate } = await supabase
    .from("utente_mansioni")
    .select("mansione_id")
    .eq("utente_id", id);

  const profiliIds = (profiliAssegnati ?? []).map(
    (p) => p.ruolo_professionale_id
  );
  const mansioniIds = (mansioniAssegnate ?? []).map((m) => m.mansione_id);

  // Normalizza struttura ruoli per il client component
  type MansioneRaw = {
    id: string;
    testo: string;
    ordine: number;
    parametro: { nome: string; colore: string } | { nome: string; colore: string }[] | null;
  };

  type RuoloRaw = {
    id: string;
    nome: string;
    descrizione: string | null;
    mansioni: MansioneRaw[] | null;
  };

  const ruoliNormalizzati = (ruoli as unknown as RuoloRaw[] ?? []).map((r) => ({
    id: r.id,
    nome: r.nome,
    descrizione: r.descrizione,
    mansioni: (r.mansioni ?? [])
      .map((m) => ({
        id: m.id,
        testo: m.testo,
        ordine: m.ordine,
        parametro: Array.isArray(m.parametro) ? (m.parametro[0] ?? null) : m.parametro,
      }))
      .sort((a, b) => a.ordine - b.ordine),
  }));

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-text-muted mb-6">
        <Link
          href="/admin/utenti"
          className="hover:text-primary transition-colors"
        >
          Utenti
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-text">
          {utente.nome} {utente.cognome}
        </span>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-text">Profilo professionale</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-full bg-primary-light text-primary text-sm font-tenorite flex items-center justify-center">
            {utente.nome[0]}
            {utente.cognome[0]}
          </div>
          <div>
            <h1 className="font-tenorite text-2xl text-text">
              {utente.nome} {utente.cognome}
            </h1>
            {utente.reparto && (
              <p className="text-sm text-text-muted">{utente.reparto}</p>
            )}
          </div>
        </div>
        <p className="text-text-muted text-sm mt-3">
          Assegna i profili professionali e le singole mansioni per questo
          utente.
        </p>
        <div className="mt-3">
          <Link
            href={`/admin/utenti/${id}/permessi`}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary-dark font-tenorite transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            Gestisci permessi portali
          </Link>
        </div>
      </div>

      <ProfiloManager
        utenteId={id}
        ruoli={ruoliNormalizzati}
        profiliAssegnati={profiliIds}
        mansioniAssegnate={mansioniIds}
      />
    </div>
  );
}
