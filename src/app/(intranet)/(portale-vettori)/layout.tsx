import { redirect } from "next/navigation";
import { getSessionUser, getSessionProfile } from "@/lib/auth/session";
import { VettoriSidebar } from "@/components/portali/vettori/sidebar-nav";
import {
  getVettoriContext,
  puoGestire,
  puoRegistrareArrivi,
} from "@/lib/portali/vettori/ruoli";

/**
 * Layout del Portale Controllo Vettori.
 *
 * Il livello di portale decide se si entra; i ruoli funzionali decidono cosa si
 * vede. Un addetto di magazzino entra e trova gli arrivi, non le fatture.
 */
export default async function PortaleVettoriLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const [ctx, profile] = await Promise.all([
    getVettoriContext(user.id),
    getSessionProfile(),
  ]);

  if (ctx.livello === null) redirect("/");

  return (
    <div className="flex flex-row min-h-[calc(100vh-4rem)]" style={{ background: "#f6f8fb" }}>
      <VettoriSidebar
        livello={ctx.livello}
        profile={profile}
        ruoli={ctx.ruoli}
        puoGestire={puoGestire(ctx)}
        puoRegistrareArrivi={puoRegistrareArrivi(ctx)}
      />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
