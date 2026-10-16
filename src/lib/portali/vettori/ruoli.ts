import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Ruoli funzionali del portale Controllo Vettori (slug stabili, migration 087).
 *
 * Vale qui la stessa separazione del Preventivatore: il **livello di portale**
 * stabilisce se vedi il portale, il **ruolo funzionale** stabilisce cosa puoi
 * farci. Senza questa distinzione un addetto di magazzino, per registrare tre
 * misure, dovrebbe ricevere i permessi pieni sul portale — e vedrebbe listini
 * e importi che non lo riguardano.
 */
export const VETTORI_RUOLI = {
  amministrazione: "amministrazione",
  magazzino: "magazzino",
  direzione: "direzione",
  listini: "listini",
} as const;

export type VettoriRuoloSlug = (typeof VETTORI_RUOLI)[keyof typeof VETTORI_RUOLI];

export type VettoriLivello = "viewer" | "exporter" | "admin" | "superadmin" | null;

export interface VettoriContext {
  livello: VettoriLivello;
  ruoli: string[];
}

/**
 * Contesto permessi in una sola query (RPC `get_vettori_context`, migration 087),
 * invece dei due round-trip seriali livello + ruoli.
 */
export async function getVettoriContext(userId: string): Promise<VettoriContext> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("get_vettori_context", { p_user_id: userId });
  const ctx = (data ?? {}) as { livello?: string | null; ruoli?: string[] | null };
  return {
    livello: (ctx.livello as VettoriLivello) ?? null,
    ruoli: ctx.ruoli ?? [],
  };
}

/** Autorizzazione per operazione, basata sui ruoli funzionali. */
export function haRuoloFunzionale(
  ctx: VettoriContext,
  ruoliAmmessi: readonly string[]
): boolean {
  if (ctx.livello === "admin" || ctx.livello === "superadmin") return true;
  return ctx.ruoli.some((r) => ruoliAmmessi.includes(r));
}

/**
 * Può vedere gli importi?
 *
 * Il magazzino no: vede pesi, misure e condizioni della merce. È una scelta
 * di riservatezza ma anche pratica — la schermata delle bolle deve essere
 * veloce su un banco, e mostrare listini la renderebbe solo più lenta da usare.
 */
export function vedeImporti(ctx: VettoriContext): boolean {
  if (ctx.livello === "admin" || ctx.livello === "superadmin") return true;
  return (
    ctx.ruoli.includes(VETTORI_RUOLI.amministrazione) ||
    ctx.ruoli.includes(VETTORI_RUOLI.direzione) ||
    ctx.ruoli.includes(VETTORI_RUOLI.listini)
  );
}

/** Può caricare fatture, decidere anomalie e chiudere i mesi. */
export function puoGestire(ctx: VettoriContext): boolean {
  return haRuoloFunzionale(ctx, [VETTORI_RUOLI.amministrazione]);
}

/** Vede la pagina Listini: l'amministrazione in consultazione, chi li gestisce per modificarli. */
export function vedeListini(ctx: VettoriContext): boolean {
  return puoGestire(ctx) || ctx.ruoli.includes(VETTORI_RUOLI.listini);
}

/**
 * Può cambiare tariffe, supplementi e percentuali carburante.
 *
 * Volutamente NON passa da `haRuoloFunzionale`: lì il livello «admin» del
 * portale apre tutto, e l'amministrazione (16/10/2026) ha chiesto che i listini
 * li tocchi solo chi tiene i rapporti con i vettori, per non creare confusione.
 * Resta il superadmin, per non lasciare il portale senza nessuno che possa
 * correggere un listino se quella persona manca.
 * Il carburante letto dalle fatture al momento dell'acquisizione non passa di
 * qui: è un dato del documento, non una scelta.
 */
export function puoModificareListini(ctx: VettoriContext): boolean {
  return ctx.livello === "superadmin" || ctx.ruoli.includes(VETTORI_RUOLI.listini);
}

/** Può registrare e misurare le bolle a magazzino. */
export function puoRegistrareArrivi(ctx: VettoriContext): boolean {
  return haRuoloFunzionale(ctx, [
    VETTORI_RUOLI.magazzino,
    VETTORI_RUOLI.amministrazione,
  ]);
}
