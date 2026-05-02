import { redirect } from "next/navigation";
import { IntranetNavbar } from "@/components/layout/intranet-navbar";
import { getSessionUser, getSessionProfile, getSessionIsAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { PORTALE_SLUGS } from "@/lib/config/portali";

export default async function IntranetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();

  const [profile, valutazioniAdmin, livelloPreventivatore] = await Promise.all([
    getSessionProfile(),
    getSessionIsAdmin(),
    getPortaleAccesso(supabase, user.id, PORTALE_SLUGS.PREVENTIVATORE),
  ]);

  const navProfile = profile
    ? {
        ...profile,
        ruoli_aggiuntivi: [],
        is_valutazioni_admin: valutazioniAdmin,
        can_access_preventivatore: livelloPreventivatore !== null,
      }
    : null;

  return (
    <div className="relative min-h-screen bg-bg-page">
      <div className="relative z-10 flex flex-col min-h-screen">
        <IntranetNavbar profile={navProfile} />
        <main className="flex-1">
          {children}
        </main>
        <footer className="py-4 text-center text-xs text-text-muted border-t border-border bg-bg/80 backdrop-blur-sm">
          SICS © {new Date().getFullYear()} · Create to Solve
        </footer>
      </div>
    </div>
  );
}
