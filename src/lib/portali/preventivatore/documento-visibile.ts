import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPreventivatoreScope,
  type PreventivatoreLivello,
} from "./ruoli";

export type DocumentoVisibileResult =
  | { ok: true; documento: { id: string; cliente_master_id: string | null } }
  | { ok: false; status: 403 | 404; error: string };

/**
 * Verifica l'esistenza e la visibilita di un documento prima di qualsiasi
 * lettura con il client amministrativo. Per uno scope ristretto un documento
 * senza cliente master e sempre negato: l'assenza del collegamento non deve
 * trasformarsi in un bypass del portfolio.
 */
export async function requireDocumentoVisibile(
  ctx: { userId: string; livello: PreventivatoreLivello },
  documentoId: string,
): Promise<DocumentoVisibileResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("preventivatore")
    .from("documenti")
    .select("id, cliente_master_id")
    .eq("id", documentoId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return { ok: false, status: 404, error: "Documento non trovato" };
  }

  const scope = await getPreventivatoreScope(ctx.userId, ctx.livello);
  const documento = data as { id: string; cliente_master_id: string | null };
  if (
    scope.restricted &&
    (!documento.cliente_master_id || !scope.clienteIds.includes(documento.cliente_master_id))
  ) {
    return { ok: false, status: 403, error: "Documento fuori dal tuo portfolio" };
  }

  return { ok: true, documento };
}
