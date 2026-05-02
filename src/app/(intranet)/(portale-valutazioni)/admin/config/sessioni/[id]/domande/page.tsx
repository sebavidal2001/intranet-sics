import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Lock, Unlock } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import DipendentiSessioneManager from "./dipendenti-sessione-manager";

export default async function DomandePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("utenti")
    .select("ruolo")
    .eq("id", user.id)
    .single();

  const { isValutazioniAdmin } = await import("@/lib/auth/valutazioni-admin");
  const isAdminUser = await isValutazioniAdmin(supabase, user.id);
  if (!isAdminUser) redirect("/");

  const sb = createAdminClient();

  const { data: sessione } = await sb
    .from("sessioni_valutazione")
    .select("*, scala:scale_valutazione(nome, min, max)")
    .eq("id", id)
    .single();

  if (!sessione) redirect("/admin/config");

  // Load active utenti
  const { data: utenti } = await sb
    .from("utenti")
    .select("id, nome, cognome, ruolo, reparto")
    .or("stato.eq.attivo,stato.is.null")
    .order("cognome");

  // Load scales
  const { data: scale } = await sb
    .from("scale_valutazione")
    .select("id, nome, min, max")
    .order("nome");

  // Load existing sessioni_utente for this sessione's anno
  const { data: sessioniUtente } = await sb
    .from("sessioni_utente")
    .select("id, utente_id, scala_id, anno, data_programmata, orario, tipo_valutazione, stato, note_admin, ordine_profili")
    .eq("anno", sessione.anno);

  // Load utente_mansioni for active users
  const utentiIds = ((utenti ?? []) as { id: string }[]).map((u) => u.id);
  const { data: utenteMansioni } = utentiIds.length > 0
    ? await sb
        .from("utente_mansioni")
        .select("id, utente_id, mansione_id, mansione:mansioni(id, testo)")
        .in("utente_id", utentiIds)
    : { data: [] };

  // Load ruoli_professionali with their mansioni
  const { data: ruoliProfessionali } = await sb
    .from("ruoli_professionali")
    .select("id, nome, mansioni(id, testo, ordine)")
    .order("nome");

  // Load all skills with parametro_radar info
  const { data: allSkills } = await sb
    .from("skills")
    .select("id, nome, descrizione, ordine, parametro_radar_id, parametro_radar:parametri_radar(id, nome, colore)")
    .order("ordine");

  // Load existing sessione_skills for sessions in this anno
  const sessioniUtenteIds = ((sessioniUtente ?? []) as { id: string }[]).map((s) => s.id);
  const { data: sessioneSkills } = sessioniUtenteIds.length > 0
    ? await sb
        .from("sessione_skills")
        .select("sessione_id, skill_id")
        .in("sessione_id", sessioniUtenteIds)
    : { data: [] };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Config", href: "/admin/config" },
        { label: "Sessioni" },
        { label: `Sessione ${sessione.anno}`, href: `/admin/config/sessioni/${id}` },
        { label: "Domande" },
      ]} />
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-tenorite text-2xl text-text">
              Configurazione — Sessione {sessione.anno}
            </h1>
            <p className="text-text-muted text-sm mt-1">
              Scala: {sessione.scala?.nome} ({sessione.scala?.min}–{sessione.scala?.max}) ·{" "}
              {utenti?.length || 0} dipendenti attivi
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-tenorite ${
              sessione.is_aperta
                ? "bg-success/10 text-success border border-success/30"
                : "bg-secondary-light text-text-muted border border-border"
            }`}
          >
            {sessione.is_aperta ? (
              <><Unlock className="w-3 h-3" /> Aperta</>
            ) : (
              <><Lock className="w-3 h-3" /> Chiusa</>
            )}
          </span>
        </div>
      </div>

      <div className="space-y-8">
        {/* Sezione dipendenti */}
        <section>
          <div className="mb-4">
            <h2 className="font-tenorite text-lg text-text">Dipendenti attivi</h2>
            <p className="text-sm text-text-muted mt-0.5">
              Configura la sessione di valutazione per ogni dipendente
            </p>
          </div>

          <DipendentiSessioneManager
            sessioneId={id}
            sessioneAnno={sessione.anno}
            utenti={utenti ?? []}
            scale={scale ?? []}
            sessioniUtente={sessioniUtente ?? []}
            // admin client returns join relations as arrays; runtime shape matches expected interface
            utenteMansioni={(utenteMansioni ?? []) as unknown as import("./dipendent-row").UtenteMansione[]}
            ruoliProfessionali={ruoliProfessionali ?? []}
            allSkills={(allSkills ?? []) as unknown as import("./dipendent-row").AllSkill[]}
            sessioneSkills={sessioneSkills ?? []}
          />
        </section>

      </div>
    </div>
  );
}
