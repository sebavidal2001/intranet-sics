import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

// GET    /api/portali/preventivatore/sessioni/[id]   → messaggi della sessione
// DELETE /api/portali/preventivatore/sessioni/[id]   → elimina sessione

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const admin = createAdminClient();

    // Verifica che la sessione appartenga all'utente
    const { data: sessione, error: sessErr } = await admin
      .schema("preventivatore")
      .from("chat_sessioni")
      .select("id, contesto, titolo")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (sessErr || !sessione) {
      return NextResponse.json({ error: "Sessione non trovata" }, { status: 404 });
    }

    const messaggiQuery = admin
      .schema("preventivatore")
      .from("chat_messaggi")
      .select("id, ruolo, contenuto, modalita, tool_usato, risultati, created_at")
      .eq("sessione_id", id)
      .order("created_at", { ascending: true });

    let { data: messaggi, error: msgErr } = await messaggiQuery;

    if (msgErr?.code === "42703") {
      const fallback = await admin
        .schema("preventivatore")
        .from("chat_messaggi")
        .select("id, ruolo, contenuto, tool_usato, risultati, created_at")
        .eq("sessione_id", id)
        .order("created_at", { ascending: true });

      messaggi = fallback.data?.map((m) => ({ ...m, modalita: null })) ?? null;
      msgErr = fallback.error;
    }

    if (msgErr) {
      console.error("GET messaggi error:", msgErr);
      return NextResponse.json({ error: "Errore DB" }, { status: 500 });
    }

    return NextResponse.json({ sessione, messaggi: messaggi ?? [] });
  } catch (err) {
    console.error("GET sessione/[id] unexpected:", err);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const admin = createAdminClient();
    const { error } = await admin
      .schema("preventivatore")
      .from("chat_sessioni")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id); // sicurezza: solo il proprietario può eliminare

    if (error) {
      console.error("DELETE sessione error:", error);
      return NextResponse.json({ error: "Errore eliminazione" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE sessione unexpected:", err);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
