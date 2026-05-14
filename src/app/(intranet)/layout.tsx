import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
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
        <main className="flex-1 min-w-0">
          {children}
        </main>
        <footer className="py-4 px-4 text-xs text-text-muted border-t border-border bg-bg/80 backdrop-blur-sm">
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <span>
              SICS © {new Date().getFullYear()} · Create to Solve
            </span>
            <span className="text-border" aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 text-text-muted/70 italic">
              <Sparkles className="w-3 h-3 text-primary/70" />
              powered by Seba
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
