import { redirect } from "next/navigation";
import { IntranetNavbar } from "@/components/layout/intranet-navbar";
import { getSessionUser, getSessionProfile, getSessionIsAdmin } from "@/lib/auth/session";

export default async function IntranetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const [profile, valutazioniAdmin] = await Promise.all([
    getSessionProfile(),
    getSessionIsAdmin(),
  ]);

  const navProfile = profile
    ? {
        ...profile,
        ruoli_aggiuntivi: [],
        is_valutazioni_admin: valutazioniAdmin,
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
