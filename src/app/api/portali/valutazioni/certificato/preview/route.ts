import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderToBuffer } from "@react-pdf/renderer";
import { CertificatoPDF, type DatiCertificato, type CertificatoConfig, DEFAULT_CONFIG } from "@/lib/portali/valutazioni/pdf/certificato";
import React, { createElement } from "react";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { getDefaultLogoDataUri } from "@/lib/portali/valutazioni/pdf/logo";

export const dynamic = "force-dynamic";

const MOCK_RIGHE = [
  { mansione: "Gestione pratiche amministrative", parametro: "Competenze tecniche", parametroColore: "#00A1BE", punteggioAuto: 4, punteggioResp: 4, note: "Processo gestito con precisione e buona autonomia." },
  { mansione: "Relazione con il cliente", parametro: "Competenze relazionali", parametroColore: "#22c55e", punteggioAuto: 3, punteggioResp: 4, note: "Comunicazione chiara anche nelle situazioni piu' complesse." },
  { mansione: "Rispetto delle scadenze", parametro: "Organizzazione", parametroColore: "#f59e0b", punteggioAuto: 5, punteggioResp: 4 },
  { mansione: "Lavoro in team", parametro: "Competenze relazionali", parametroColore: "#22c55e", punteggioAuto: 4, punteggioResp: 3 },
  { mansione: "Utilizzo strumenti informatici", parametro: "Competenze tecniche", parametroColore: "#00A1BE", punteggioAuto: 3, punteggioResp: 3 },
  { mansione: "Autonomia operativa", parametro: "Organizzazione", parametroColore: "#f59e0b", punteggioAuto: 4, punteggioResp: 4 },
];

const MOCK_RADAR = [
  { parametro: "Competenze tecniche", colore: "#00A1BE", autovalutazione: 3.5, responsabile: 3.5 },
  { parametro: "Competenze relazionali", colore: "#22c55e", autovalutazione: 3.5, responsabile: 3.5 },
  { parametro: "Organizzazione", colore: "#f59e0b", autovalutazione: 4.5, responsabile: 4.0 },
];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const db = createAdminClient();

  // Carica config salvata (o usa default)
  const { data: configRow } = await db
    .from("certificato_config")
    .select("*")
    .limit(1)
    .maybeSingle();

  const certConfig: Partial<CertificatoConfig> = configRow
    ? {
        titoli_scheda: configRow.titoli_scheda ?? DEFAULT_CONFIG.titoli_scheda,
        codice_documento: configRow.codice_documento,
        data_edizione: configRow.data_edizione,
        data_aggiornamento: configRow.data_aggiornamento,
        colore_primario: configRow.colore_primario,
        colore_testo: configRow.colore_testo,
        font_corpo: configRow.font_corpo,
        orientamento: configRow.orientamento,
        mostra_radar: configRow.mostra_radar,
        etichetta_area: configRow.etichetta_area,
        etichetta_responsabile: configRow.etichetta_responsabile,
        etichetta_valutatore: configRow.etichetta_valutatore,
        etichetta_data_assunzione: configRow.etichetta_data_assunzione,
        etichetta_data_valutazione: configRow.etichetta_data_valutazione,
        etichetta_anzianita: configRow.etichetta_anzianita,
      }
    : {};

  // Logo
  let logoSrc: string | undefined;
  if (configRow?.logo_url) {
    logoSrc = configRow.logo_url;
  } else {
    logoSrc = getDefaultLogoDataUri(certConfig.colore_primario ?? DEFAULT_CONFIG.colore_primario);
  }

  const valoriResp = MOCK_RIGHE.map((r) => r.punteggioResp);
  const mediaResponsabile = valoriResp.reduce((a, b) => a + b, 0) / valoriResp.length;

  const dati: DatiCertificato = {
    utente: {
      nome: "Mario",
      cognome: "Rossi",
      email: "mario.rossi@sics.it",
      reparto: "Amministrazione",
      ruolo: "addetto",
      data_assunzione: "2018-03-15",
    },
    responsabile: { nome: "Laura", cognome: "Bianchi" },
    scala: { nome: "1-5", min: 1, max: 5 },
    anno: new Date().getFullYear(),
    dataCertificazione: new Date().toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }),
    righe: MOCK_RIGHE,
    mediaResponsabile,
    radarData: MOCK_RADAR,
    logoPath: logoSrc,
    config: certConfig,
  };

  const buffer = await renderToBuffer(createElement(CertificatoPDF, { dati }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=\"anteprima_certificato.pdf\"",
      "Content-Length": buffer.byteLength.toString(),
    },
  });
}
