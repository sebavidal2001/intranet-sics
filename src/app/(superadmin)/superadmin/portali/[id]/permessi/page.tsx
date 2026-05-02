import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PermessiRuoloGrid } from "@/components/superadmin/permessi-ruolo-grid";
import { PermessiUtenteSection } from "@/components/superadmin/permessi-utente-section";
import PermessiDipendentiAccordion from "@/components/superadmin/permessi-dipendenti-accordion";

interface Portale {
  id: string;
  nome: string;
  slug: string;
}

interface PermessoPortale {
  id: string;
  portale_id: string;
  ruolo: string;
  can_access: boolean;
  can_export: boolean;
  can_approve: boolean;
}

interface PermessoUtente {
  id: string;
  portale_id: string;
  utente_id: string;
  override_access: boolean | null;
  override_export: boolean | null;
  is_portal_admin: boolean;
  utenti: {
    nome: string;
    cognome: string;
    ruolo: string;
  } | null;
}

interface UtenteOption {
  id: string;
  nome: string;
  cognome: string;
  ruolo: string;
  reparto: string | null;
}

async function getData(portaleId: string) {
  const supabase = await createClient();

  const [portaleRes, permessiRuoloRes, permessiUtenteRes, utentiRes, ruoliRes] =
    await Promise.all([
      supabase
        .from("portali")
        .select("id, nome, slug")
        .eq("id", portaleId)
        .single(),
      supabase
        .from("permessi_portale")
        .select("id, portale_id, ruolo, can_access, can_export, can_approve")
        .eq("portale_id", portaleId),
      supabase
        .from("permessi_utente")
        .select(
          "id, portale_id, utente_id, override_access, override_export, is_portal_admin, utenti(nome, cognome, ruolo)"
        )
        .eq("portale_id", portaleId),
      supabase
        .from("utenti")
        .select("id, nome, cognome, ruolo, reparto")
        .or("stato.eq.attivo,stato.is.null")
        .order("cognome", { ascending: true }),
      supabase
        .from("ruoli_config")
        .select("slug, nome")
        .order("ordine", { ascending: true }),
    ]);

  return {
    portale: portaleRes.data as Portale | null,
    permessiRuolo: (permessiRuoloRes.data ?? []) as PermessoPortale[],
    permessiUtente: (permessiUtenteRes.data ?? []) as unknown as PermessoUtente[],
    utenti: (utentiRes.data ?? []) as UtenteOption[],
    ruoli: (ruoliRes.data ?? []) as { slug: string; nome: string }[],
  };
}

export default async function PermessiPortalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { portale, permessiRuolo, permessiUtente, utenti, ruoli } = await getData(id);

  if (!portale) notFound();

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <Breadcrumbs items={[
        { label: "Superadmin", href: "/superadmin" },
        { label: "Portali", href: "/superadmin/portali" },
        { label: portale.nome, href: `/superadmin/portali/${id}` },
        { label: "Permessi" },
      ]} />
      {/* Header */}
      <div>
        <h1 className="font-tenorite text-3xl text-text">
          Permessi — {portale.nome}
        </h1>
        <p className="text-text-muted mt-1">
          Configura accesso, export e approvazione per dipendente
        </p>
      </div>

      {/* Permessi per ruolo */}
      <section className="bg-bg rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-bg-page">
          <h2 className="font-tenorite text-base text-text">Permessi per ruolo</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Definisce il comportamento di default per ogni ruolo su questo portale
          </p>
        </div>
        <PermessiRuoloGrid
          portaleId={portale.id}
          permessiRuolo={permessiRuolo}
          ruoli={ruoli}
        />
      </section>

      {/* Permessi per dipendente (accordion) */}
      <section className="bg-bg rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-bg-page">
          <h2 className="font-tenorite text-base text-text">Accesso per dipendente</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Abilita o disabilita l&apos;accesso al portale per ogni dipendente. Organizzati per reparto.
          </p>
        </div>
        <PermessiDipendentiAccordion
          portaleId={portale.id}
          utenti={utenti}
          permessiEsistenti={permessiUtente.map((p) => ({
            utente_id: p.utente_id,
            can_access: p.override_access ?? true,
          }))}
        />
      </section>

      {/* Override avanzato singoli utenti */}
      <section className="bg-bg rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-bg-page">
          <h2 className="font-tenorite text-base text-text">Override avanzato per utente</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Sovrascrive export e approvazione per singoli utenti rispetto al default del ruolo.
          </p>
        </div>
        <PermessiUtenteSection
          portaleId={portale.id}
          permessiUtente={permessiUtente}
          utenti={utenti}
        />
      </section>
    </div>
  );
}
