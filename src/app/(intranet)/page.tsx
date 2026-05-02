import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { IntranetHero } from "@/components/intranet/intranet-hero";
import { PortalGrid } from "@/components/intranet/portal-grid";
import { HomepageBlocks } from "@/components/intranet/homepage-blocks";
import { HomepageParticles } from "@/components/intranet/homepage-particles";
import { getSessionUser, getSessionProfile } from "@/lib/auth/session";

export default async function IntranetHomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  // getSessionProfile è già cached nel layout — nessuna query extra
  const profile = await getSessionProfile();
  const supabase = await createClient();

  // 4 query indipendenti in parallelo
  const [portaliBase, permessiRuolo, permessiUtente, blocks] = await Promise.all([
    supabase
      .from("portali")
      .select("id, nome, slug, descrizione, icona, colore, ordine")
      .eq("is_attivo", true)
      .order("ordine")
      .then((r) => r.data),
    supabase
      .from("permessi_portale")
      .select("portale_id, can_access")
      .eq("ruolo", profile?.ruolo ?? "")
      .then((r) => r.data),
    supabase
      .from("permessi_utente")
      .select("portale_id, override_access")
      .eq("utente_id", user.id)
      .then((r) => r.data),
    supabase
      .from("homepage_blocks")
      .select("id, tipo, titolo, testo, url, icona, ordine")
      .eq("is_attivo", true)
      .order("ordine")
      .then((r) => r.data),
  ]);

  // Filtra portali accessibili
  const accessiMap = new Map<string, boolean>();
  permessiRuolo?.forEach((p) => accessiMap.set(p.portale_id, p.can_access));
  permessiUtente?.forEach((p) => {
    if (p.override_access !== null) accessiMap.set(p.portale_id, p.override_access);
  });

  const isSuperadmin = profile?.ruolo === "superadmin";
  const portali = (portaliBase ?? []).filter(
    (p) => isSuperadmin || accessiMap.get(p.id) === true
  );

  const news = (blocks ?? []).filter((b) => b.tipo === "news");
  const links = (blocks ?? []).filter((b) => b.tipo === "link");

  return (
    <>
      <HomepageParticles />
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      <IntranetHero nome={profile?.nome ?? ""} />

      <section>
        <h2 className="font-tenorite text-xl text-text mb-5">I tuoi portali</h2>
        <PortalGrid portali={portali} />
      </section>

      {(news.length > 0 || links.length > 0) && (
        <HomepageBlocks news={news} links={links} />
      )}
    </div>
    </>
  );
}
