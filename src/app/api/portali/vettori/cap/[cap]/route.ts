import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { risolviCap } from "@/lib/portali/vettori/cap";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const Parametri = z.object({
  cap: z.string().trim().regex(/^\d{5}$/),
}).strict();

/** Risoluzione puntuale usata dal form mentre l'operatore inserisce il CAP. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { cap: string } }
) {
  try {
    const guard = await requireVettori();
    if (!guard.ok) return guard.response;

    const parsed = Parametri.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: "CAP non valido." }, { status: 400 });
    }
    const esito = await risolviCap(parsed.data.cap);
    if (!esito) {
      return NextResponse.json({ error: "CAP non trovato." }, { status: 404 });
    }
    return NextResponse.json(esito, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("vettori.cap", "risoluzione CAP fallita", error);
    return NextResponse.json({ error: "Non e stato possibile risolvere il CAP." }, { status: 500 });
  }
}
