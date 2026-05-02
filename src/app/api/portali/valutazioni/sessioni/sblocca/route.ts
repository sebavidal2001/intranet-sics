import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, getSessioneApertainEmailTemplate } from "@/lib/email/nodemailer";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { env } from "@/lib/config/env";

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
    const { sessioneId, isAperta } = body;

    if (!sessioneId || typeof isAperta !== "boolean") {
      return NextResponse.json(
        { error: "Parametri non validi" },
        { status: 400 }
      );
    }

    // 1. Aggiorna stato sessione
    const { data: sessione, error: updateError } = await supabase
      .from("sessioni_valutazione")
      .update({ is_aperta: isAperta })
      .eq("id", sessioneId)
      .select("anno")
      .single();

    if (updateError || !sessione) {
      return NextResponse.json(
        { error: "Errore aggiornamento sessione" },
        { status: 500 }
      );
    }

    // 2. Se sbloccata (is_aperta = true), invia email a tutti gli utenti
    if (isAperta) {
      const { data: utenti } = await supabase
        .from("utenti")
        .select("nome, cognome, email")
        .neq("ruolo", "admin"); // Escludi admin dalle notifiche

      if (utenti && utenti.length > 0) {
        const urlPiattaforma = env.app.url;

        // Invia email a tutti gli utenti in parallelo, tracciando i fallimenti
        const emailFallite: string[] = [];
        const emailPromises = utenti.map((utente) =>
          sendEmail({
            to: utente.email,
            subject: `Sessione Valutazione ${sessione.anno} - Aperta`,
            html: getSessioneApertainEmailTemplate(
              `${utente.nome} ${utente.cognome}`,
              sessione.anno,
              urlPiattaforma
            ),
            text: `Ciao ${utente.nome}, la sessione di valutazione ${sessione.anno} è stata aperta. Accedi a ${urlPiattaforma}/valutazioni per completare la tua autovalutazione.`,
          }).catch((error) => {
            console.error(`Errore invio email a ${utente.email}:`, error);
            emailFallite.push(utente.email);
          })
        );

        await Promise.all(emailPromises);

        return NextResponse.json({
          success: true,
          message: `Sessione ${isAperta ? "aperta" : "chiusa"}. ${utenti.length - emailFallite.length}/${utenti.length} email inviate.`,
          emailFallite: emailFallite.length > 0 ? emailFallite : undefined,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Sessione ${isAperta ? "aperta" : "chiusa"}.`,
    });
  } catch (error) {
    console.error("Sblocca sessione error:", error);
    return NextResponse.json(
      { error: "Errore del server" },
      { status: 500 }
    );
  }
}
