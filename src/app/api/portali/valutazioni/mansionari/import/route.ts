import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Verifica autenticazione
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    // Verifica che sia admin
    const isAdmin = await isValutazioniAdmin(supabase, user.id);
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Accesso negato" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { anno, mansionari } = body;

    if (!anno || !mansionari || !Array.isArray(mansionari)) {
      return NextResponse.json(
        { error: "Dati non validi" },
        { status: 400 }
      );
    }

    const errors: { row: number; reason: string }[] = [];
    const warnings: { row: number; reason: string }[] = [];
    let success = 0;

    // 1. Carica tutti gli utenti in una sola query (batch invece di N query nel loop)
    const emails = [...new Set(mansionari.map((m: { email: string }) => m.email))];
    const { data: utentiList } = await supabase
      .from("utenti")
      .select("id, email")
      .in("email", emails);
    const utenteMap = new Map((utentiList ?? []).map((u: { id: string; email: string }) => [u.email, u.id]));

    // 2. Costruisci i record da upsertare, tracciando errori per email non trovate
    const records: { utente_id: string; anno: number; mansione: string; competenze: string }[] = [];
    for (let i = 0; i < mansionari.length; i++) {
      const m = mansionari[i];
      const rowNum = i + 2;
      const utenteId = utenteMap.get(m.email);
      if (!utenteId) {
        errors.push({ row: rowNum, reason: `Utente con email ${m.email} non trovato` });
        continue;
      }
      records.push({ utente_id: utenteId, anno, mansione: m.mansione, competenze: m.competenze });
    }

    // 3. Bulk upsert in una sola chiamata
    if (records.length > 0) {
      const { error: upsertError } = await supabase
        .from("mansionari")
        .upsert(records, { onConflict: "utente_id,anno" });

      if (upsertError) {
        return NextResponse.json({ error: upsertError.message }, { status: 500 });
      }
      success = records.length;
    }

    return NextResponse.json({
      success,
      errors,
      warnings,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Errore del server" },
      { status: 500 }
    );
  }
}
