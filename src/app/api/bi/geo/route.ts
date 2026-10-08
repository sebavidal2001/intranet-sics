/**
 * Coordinate per la mappa delle visite.
 *
 * Restituisce un punto per ogni CAP che compare nelle visite e il capoluogo di
 * ogni provincia. Sono dati geografici pubblici, non dati commerciali: non
 * dicono quali clienti sono stati visitati né da chi (quello lo decide la query
 * del riquadro, che passa dal perimetro). Si richiede comunque il login al
 * portale, come ogni altra route del BI.
 *
 * Il punto è il centro del CAP, o il capoluogo di provincia quando il CAP non
 * è noto (`precisione`): la mappa deve poter dire quale dei due ha usato.
 */

import { NextResponse } from "next/server";
import { preliminari, errore } from "../_comune";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  const admin = createAdminClient();
  const [cap, province] = await Promise.all([
    admin.from("bi_visite_punti").select("cap,lat,lon,precisione,comune,provincia"),
    admin.from("bi_provincia_coordinate").select("provincia,nome,lat,lon"),
  ]);
  if (cap.error || province.error) {
    return errore("Impossibile leggere le coordinate.", 500);
  }
  return NextResponse.json(
    { cap: cap.data ?? [], province: province.data ?? [] },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
