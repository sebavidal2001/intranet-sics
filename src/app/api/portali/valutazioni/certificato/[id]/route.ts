import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderToBuffer } from "@react-pdf/renderer";
import { CertificatoPDF, type DatiCertificato, type RigaCertificato, type RadarPoint, type CertificatoConfig, DEFAULT_CONFIG } from "@/lib/portali/valutazioni/pdf/certificato";
import React, { createElement } from "react";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { getDefaultLogoDataUri } from "@/lib/portali/valutazioni/pdf/logo";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Auth con client utente (RLS attiva per verificare identità)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const sessioneId = params.id;
  // Admin client per leggere tutti i dati senza RLS
  const db = createAdminClient();

  // Carica sessione con dati utente e responsabile
  const { data: sessione, error: sessErr } = await db
    .from("sessioni_utente")
    .select(`
      id, anno, stato, utente_id, responsabile_id, scala_id,
      scala:scale_valutazione(id, nome, min, max)
    `)
    .eq("id", sessioneId)
    .single();

  if (sessErr || !sessione) {
    return NextResponse.json({ error: "Sessione non trovata" }, { status: 404 });
  }

  // Verifica stato sessione
  if (sessione.stato !== "completata" && sessione.stato !== "certificata") {
    return NextResponse.json(
      { error: "La valutazione non è ancora completata" },
      { status: 400 }
    );
  }

  // Verifica admin prima di caricare dati sensibili
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  // Carica in parallelo: dati utente, mansioni, risposte, config
  let parallelData: Awaited<ReturnType<typeof Promise.all<[unknown, unknown, unknown, unknown, unknown, unknown]>>>;
  try {
    parallelData = await Promise.all([
      db.from("utenti").select("id, nome, cognome, email, reparto, ruolo, data_assunzione").eq("id", sessione.utente_id).single(),
      sessione.responsabile_id
        ? db.from("utenti").select("id, nome, cognome").eq("id", sessione.responsabile_id).single()
        : Promise.resolve({ data: null }),
      db.from("utente_mansioni").select(`mansione:mansioni(id, testo, ordine, parametro:parametri_radar(id, nome, colore))`).eq("utente_id", sessione.utente_id),
      db.from("risposte_valutazione").select("mansione_id, skill_id, punteggio, tipo, note").eq("sessione_utente_id", sessioneId),
      db.from("certificato_config").select("*").limit(1).maybeSingle(),
      db.from("sessione_skills").select(`skill:skills(id, nome, ordine, parametro:parametri_radar(id, nome, colore))`).eq("sessione_id", sessioneId),
    ]);
  } catch (err) {
    console.error("Certificato parallel fetch error:", err);
    return NextResponse.json({ error: "Errore nel caricamento dei dati" }, { status: 500 });
  }

  const [utenteRes, responsabileRes, utenteMansioni, risposteRes, configRes, sessioneSkillsRes] =
    parallelData as unknown as [
      { data: { id: string; nome: string; cognome: string; email: string; reparto: string | null; ruolo: string; data_assunzione: string | null } | null },
      { data: { id: string; nome: string; cognome: string } | null },
      { data: Array<{ mansione: unknown }> | null },
      { data: Array<{ mansione_id: string | null; skill_id: string | null; punteggio: number; tipo: string; note: string | null }> | null },
      { data: Record<string, unknown> | null },
      { data: Array<{ skill: unknown }> | null },
    ];

  const utenteData = utenteRes.data;
  const responsabileData = responsabileRes.data;
  const configRow = configRes.data;
  const risposte = risposteRes.data as Array<{ mansione_id: string | null; skill_id: string | null; punteggio: number; tipo: string; note: string | null }> | null;

  if (!utenteData) {
    return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
  }

  const risposteMap = {
    responsabile: new Map<string, { punteggio: number; note: string | null }>(),
    auto: new Map<string, { punteggio: number; note: string | null }>(),
  };
  for (const r of risposte ?? []) {
    const key = r.mansione_id ?? r.skill_id;
    if (!key) continue;
    const value = { punteggio: r.punteggio, note: r.note ?? null };
    if (r.tipo === "responsabile") risposteMap.responsabile.set(key, value);
    if (r.tipo === "autovalutazione") risposteMap.auto.set(key, value);
  }

  // Costruisce righe tabella — mansioni + skill
  // Cast necessario: Supabase inferisce il tipo del join annidato come array, ma è sempre singolo
  type VoceCon = { id: string; testo: string; ordine: number; parametro: { id: string; nome: string; colore: string } | null } | null;
  const mansioni = ((utenteMansioni.data ?? []) as unknown as { mansione: VoceCon }[])
    .map((um) => um.mansione)
    .filter(Boolean)
    .sort((a, b) => (a!.ordine ?? 0) - (b!.ordine ?? 0));

  // Le skill della sessione: normalizzate alla stessa forma delle mansioni (nome → testo)
  const skills = ((sessioneSkillsRes.data ?? []) as unknown as { skill: { id: string; nome: string; ordine: number; parametro: { id: string; nome: string; colore: string } | null } | null }[])
    .map((ss) => ss.skill)
    .filter(Boolean)
    .map((s) => ({ id: s!.id, testo: s!.nome, ordine: s!.ordine, parametro: s!.parametro }))
    .sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0));

  const rigaDaVoce = (v: { id: string; testo: string; parametro: { nome: string; colore: string } | null }, tipo: "mansione" | "skill"): RigaCertificato => ({
    tipo,
    mansione: v.testo,
    parametro: v.parametro?.nome ?? "—",
    parametroColore: v.parametro?.colore ?? "#747373",
    punteggioAuto: risposteMap.auto.get(v.id)?.punteggio ?? null,
    punteggioResp: risposteMap.responsabile.get(v.id)?.punteggio ?? null,
    note: risposteMap.responsabile.get(v.id)?.note ?? null,
  });

  const righe: RigaCertificato[] = [
    ...mansioni.map((m) => rigaDaVoce(m!, "mansione")),
    ...skills.map((s) => rigaDaVoce(s, "skill")),
  ];

  // Media responsabile (esclude null e 0) — su mansioni + skill
  const valoriResp = righe.map((r) => r.punteggioResp).filter((v): v is number => v !== null && v > 0);
  const mediaResponsabile =
    valoriResp.length > 0
      ? valoriResp.reduce((a, b) => a + b, 0) / valoriResp.length
      : 0;

  // Calcola dati radar (raggruppa per parametro) — mansioni + skill
  const parametriRadar: Record<string, { nome: string; colore: string; autoVals: number[]; respVals: number[] }> = {};
  for (const v of [...mansioni.map((m) => m!), ...skills]) {
    const parametro = v.parametro as { id: string; nome: string; colore: string } | null;
    if (!parametro) continue;
    if (!parametriRadar[parametro.id]) {
      parametriRadar[parametro.id] = { nome: parametro.nome, colore: parametro.colore, autoVals: [], respVals: [] };
    }
    const autoVal = risposteMap.auto.get(v.id)?.punteggio;
    const respVal = risposteMap.responsabile.get(v.id)?.punteggio;
    if (autoVal !== undefined) parametriRadar[parametro.id].autoVals.push(autoVal);
    if (respVal !== undefined) parametriRadar[parametro.id].respVals.push(respVal);
  }
  const radarData: RadarPoint[] = Object.values(parametriRadar).map((p) => ({
    parametro: p.nome,
    colore: p.colore,
    autovalutazione:
      p.autoVals.length > 0
        ? Math.round((p.autoVals.reduce((a, b) => a + b, 0) / p.autoVals.length) * 10) / 10
        : 0,
    responsabile:
      p.respVals.length > 0
        ? Math.round((p.respVals.reduce((a, b) => a + b, 0) / p.respVals.length) * 10) / 10
        : 0,
  }));

  const scala = sessione.scala as unknown as { id: string; nome: string; min: number; max: number };
  const utente = utenteData;
  const responsabile = responsabileData ?? null;

  const certConfig: Partial<CertificatoConfig> = configRow
    ? {
        titoli_scheda: (configRow.titoli_scheda as CertificatoConfig["titoli_scheda"] | null) ?? DEFAULT_CONFIG.titoli_scheda,
        codice_documento: configRow.codice_documento as string | undefined,
        data_edizione: configRow.data_edizione as string | undefined,
        data_aggiornamento: configRow.data_aggiornamento as string | undefined,
        colore_primario: configRow.colore_primario as string | undefined,
        colore_testo: configRow.colore_testo as string | undefined,
        font_corpo: configRow.font_corpo as string | undefined,
        orientamento: configRow.orientamento as CertificatoConfig["orientamento"] | undefined,
        mostra_radar: configRow.mostra_radar as boolean | undefined,
        etichetta_area: configRow.etichetta_area as string | undefined,
        etichetta_responsabile: configRow.etichetta_responsabile as string | undefined,
        etichetta_valutatore: configRow.etichetta_valutatore as string | undefined,
        etichetta_data_assunzione: configRow.etichetta_data_assunzione as string | undefined,
        etichetta_data_valutazione: configRow.etichetta_data_valutazione as string | undefined,
        etichetta_anzianita: configRow.etichetta_anzianita as string | undefined,
      }
    : {};

  // Logo: usa URL configurato oppure il logo SICS predefinito ricolorato in turchese,
  // come nella pagina di login (il PNG originale e' bianco e su A4 sparisce).
  let logoSrc: string | undefined;
  if (configRow?.logo_url) {
    logoSrc = configRow.logo_url as string;
  } else {
    logoSrc = getDefaultLogoDataUri(certConfig.colore_primario ?? DEFAULT_CONFIG.colore_primario);
  }

  const dati: DatiCertificato = {
    utente: {
      nome: utente.nome,
      cognome: utente.cognome,
      email: utente.email,
      reparto: utente.reparto ?? "—",
      ruolo: utente.ruolo,
      data_assunzione: utenteData?.data_assunzione ?? null,
    },
    responsabile: responsabile
      ? { nome: responsabile.nome, cognome: responsabile.cognome }
      : null,
    scala: { nome: scala.nome, min: scala.min, max: scala.max },
    anno: sessione.anno,
    dataCertificazione: new Date().toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }),
    righe,
    mediaResponsabile,
    radarData,
    logoPath: logoSrc,
    config: certConfig,
  };

  // Genera PDF
  const buffer = await renderToBuffer(
    createElement(CertificatoPDF, { dati }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>
  );

  // Aggiorna stato sessione a 'certificata' (admin client, bypassa RLS)
  await db
    .from("sessioni_utente")
    .update({ stato: "certificata" })
    .eq("id", sessioneId);

  const filename = `certificato_${utente.cognome}_${utente.nome}_${sessione.anno}.pdf`
    .toLowerCase()
    .replace(/\s+/g, "_");

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.byteLength.toString(),
    },
  });
}
