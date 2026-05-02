import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import PermessiClient from "./permessi-client";

export default async function PermessiPortalePage({
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

  const db = createAdminClient();

  // Carica utente target
  const { data: utente } = await db
    .from("utenti")
    .select("id, nome, cognome, ruolo, reparto")
    .eq("id", id)
    .single();

  if (!utente) redirect("/admin/utenti");

  // Carica tutti i portali attivi
  const { data: portali } = await db
    .from("portali")
    .select("id, nome, slug, icona, colore")
    .eq("is_attivo", true)
    .order("ordine");

  // Carica permessi esistenti per l'utente
  const { data: permessiRaw } = await db
    .from("permessi_utente")
    .select("portale_id, override_access, override_export, is_portal_admin")
    .eq("utente_id", id);

  // Carica livello effettivo per ogni portale in parallelo (Promise.all invece di loop sequenziale)
  const livelli: Record<string, string | null> = {};
  await Promise.all(
    (portali ?? []).map(async (portale) => {
      const { data } = await db.rpc("get_portale_livello", {
        p_user_id: id,
        p_slug: portale.slug,
      });
      livelli[portale.id] = data ?? null;
    })
  );

  const permessi = (portali ?? []).map((p) => {
    const raw = (permessiRaw ?? []).find((r) => r.portale_id === p.id);
    return {
      portale_id: p.id,
      livello_effettivo: livelli[p.id] ?? null,
      override_access: raw?.override_access ?? null,
      override_export: raw?.override_export ?? null,
      is_portal_admin: raw?.is_portal_admin ?? false,
    };
  });

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-text-muted mb-6">
        <Link href="/admin/utenti" className="hover:text-primary transition-colors">
          Utenti
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link href={`/admin/utenti/${id}/profilo`} className="hover:text-primary transition-colors">
          {utente.nome} {utente.cognome}
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-text">Permessi portali</span>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-full bg-primary-light text-primary text-sm font-tenorite flex items-center justify-center">
            {utente.nome[0]}{utente.cognome[0]}
          </div>
          <div>
            <h1 className="font-tenorite text-2xl text-text">
              {utente.nome} {utente.cognome}
            </h1>
            <p className="text-sm text-text-muted capitalize">{utente.ruolo} · {utente.reparto}</p>
          </div>
        </div>
        <p className="text-text-muted text-sm mt-3">
          Configura i permessi di accesso ai portali. Gli override individuali hanno priorità sui permessi del ruolo.
        </p>
      </div>

      <PermessiClient
        utenteId={id}
        ruoloUtente={utente.ruolo}
        portali={portali ?? []}
        permessi={permessi}
      />
    </div>
  );
}
