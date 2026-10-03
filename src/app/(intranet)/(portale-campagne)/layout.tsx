import { redirect } from "next/navigation";
import { getSessionUser, getSessionProfile } from "@/lib/auth/session";
import { CampagneSidebar } from "@/components/portali/campagne/sidebar-nav";
import { eAdminCampagne, getCampagneContext, puoOperare } from "@/lib/portali/campagne/ruoli";

/**
 * Layout del Portale Campagne Marketing.
 *
 * Il livello di portale decide se si entra; il ruolo funzionale `backoffice`
 * decide se si lavora sugli invii. Chi entra senza ruolo vede un avviso e non
 * le pagine, che comunque rifiuterebbero ogni operazione.
 */
export default async function PortaleCampagneLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const [ctx, profile] = await Promise.all([getCampagneContext(user.id), getSessionProfile()]);
  if (ctx.livello === null) redirect("/");

  const operativo = puoOperare(ctx);

  return (
    <div className="flex flex-row min-h-[calc(100vh-4rem)]" style={{ background: "#f6f8fb" }}>
      <CampagneSidebar livello={ctx.livello} profile={profile} puoOperare={operativo} eAdmin={eAdminCampagne(ctx)} />
      <main className="flex-1 overflow-auto p-6">
        {operativo ? (
          children
        ) : (
          <div className="mx-auto max-w-lg rounded-xl border border-border bg-white p-6 shadow-sm">
            <h1 className="font-tenorite text-lg font-bold text-text">Accesso non ancora abilitato</h1>
            <p className="mt-2 text-sm text-text-muted">
              Hai accesso al portale ma non il ruolo <strong>Back office</strong>, quindi non puoi lavorare sugli invii.
              Chiedi a un amministratore di assegnartelo.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
