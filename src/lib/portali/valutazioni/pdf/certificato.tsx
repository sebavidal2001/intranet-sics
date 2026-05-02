import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { HeaderBar } from "./sections/header-section";
import { BarraPunteggio } from "./sections/barre-section";
import { RadarChartSvg } from "./sections/radar-section";

// ============================================================
// Tipi
// ============================================================
export interface RigaCertificato {
  mansione: string;
  parametro: string;
  parametroColore: string;
  punteggioAuto: number | null;
  punteggioResp: number;
}

export interface RadarPoint {
  parametro: string;
  colore: string;
  autovalutazione: number;
  responsabile: number;
}

export interface TitoloScheda {
  titolo: string;
  ruoli: string[]; // slug da ruoli_config
}

export interface CertificatoConfig {
  titoli_scheda: TitoloScheda[];
  codice_documento: string;
  data_edizione: string;
  data_aggiornamento: string;
  colore_primario: string;
  colore_testo: string;
  font_corpo: string;
  orientamento: "portrait" | "landscape";
  mostra_radar: boolean;
  etichetta_area: string;
  etichetta_responsabile: string;
  etichetta_valutatore: string;
  etichetta_data_assunzione: string;
  etichetta_data_valutazione: string;
  etichetta_anzianita: string;
}

export const DEFAULT_CONFIG: CertificatoConfig = {
  titoli_scheda: [
    { titolo: "Scheda di valutazione della prestazione del Personale", ruoli: ["collaboratore"] },
    { titolo: "Scheda di valutazione della prestazione dei Coordinatori", ruoli: ["responsabile_intermedio"] },
    { titolo: "Scheda di valutazione della prestazione dei Responsabili", ruoli: ["responsabile"] },
  ],
  codice_documento: "D.50-9 Rev 04",
  data_edizione: "",
  data_aggiornamento: "",
  colore_primario: "#00A1BE",
  colore_testo: "#1a202c",
  font_corpo: "Helvetica",
  orientamento: "portrait",
  mostra_radar: true,
  etichetta_area: "Area",
  etichetta_responsabile: "Responsabile",
  etichetta_valutatore: "Valutatore",
  etichetta_data_assunzione: "Data Assunzione",
  etichetta_data_valutazione: "Data Valutazione",
  etichetta_anzianita: "Anzianità",
};

export interface DatiCertificato {
  utente: {
    nome: string;
    cognome: string;
    email: string;
    reparto: string;
    ruolo?: string;
    data_assunzione?: string | null;
  };
  responsabile: { nome: string; cognome: string } | null;
  scala: { nome: string; min: number; max: number };
  anno: number;
  dataCertificazione: string;
  righe: RigaCertificato[];
  mediaResponsabile: number;
  radarData: RadarPoint[];
  logoPath?: string;
  config?: Partial<CertificatoConfig>;
}

// ============================================================
// Helpers
// ============================================================
function getTitoloVariante(ruolo: string | undefined, config: CertificatoConfig): string {
  if (ruolo && config.titoli_scheda.length > 0) {
    const match = config.titoli_scheda.find((t) => t.ruoli.includes(ruolo));
    if (match) return match.titolo;
  }
  return config.titoli_scheda[0]?.titolo ?? "Scheda di valutazione";
}

function calcolaAnzianita(dataAssunzione: string | null | undefined): string {
  if (!dataAssunzione) return "—";
  const d = new Date(dataAssunzione);
  const oggi = new Date();
  const anni = oggi.getFullYear() - d.getFullYear();
  const mesi = oggi.getMonth() - d.getMonth();
  const totaleAnni = mesi < 0 ? anni - 1 : anni;
  return totaleAnni > 0 ? `${totaleAnni} ann${totaleAnni === 1 ? "o" : "i"}` : "< 1 anno";
}

function formatData(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  try {
    return new Date(isoDate).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

// ============================================================
// Stili — dinamici in base al config
// ============================================================
export function makeStyles(cfg: CertificatoConfig) {
  const primary = cfg.colore_primario;
  const textColor = cfg.colore_testo;
  const font = cfg.font_corpo;
  const fontBold = font === "Times-Roman" ? "Times-Bold"
    : font === "Courier" ? "Courier-Bold"
    : "Helvetica-Bold";

  const border = "#d1d5db";
  const bgPage = "#f8fafc";
  const white = "#ffffff";
  const muted = "#64748b";
  const isLandscape = cfg.orientamento === "landscape";

  return StyleSheet.create({
    page: {
      fontFamily: font,
      fontSize: 9,
      color: textColor,
      paddingTop: 0,
      paddingBottom: 24,
      paddingHorizontal: 0,
      backgroundColor: white,
    },

    // ── Header bar (replicates template header) ──────────────
    headerBar: {
      flexDirection: "row",
      alignItems: "stretch",
      borderBottomWidth: 1,
      borderBottomColor: border,
      marginBottom: 10,
    },
    headerLogo: {
      width: isLandscape ? 80 : 72,
      paddingHorizontal: 10,
      paddingVertical: 8,
      justifyContent: "center",
      alignItems: "center",
      borderRightWidth: 1,
      borderRightColor: border,
    },
    headerLogoImg: {
      width: isLandscape ? 56 : 48,
      height: isLandscape ? 28 : 24,
      objectFit: "contain",
    },
    headerTitle: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: 8,
      justifyContent: "center",
      alignItems: "center",
    },
    headerTitleText: {
      fontFamily: fontBold,
      fontSize: isLandscape ? 11 : 10,
      color: textColor,
      textAlign: "center",
    },
    headerCode: {
      width: isLandscape ? 130 : 120,
      paddingHorizontal: 8,
      paddingVertical: 6,
      justifyContent: "center",
      borderLeftWidth: 1,
      borderLeftColor: border,
    },
    headerCodeText: {
      fontSize: 7,
      color: muted,
      lineHeight: 1.5,
    },

    // ── Corpo pagina ─────────────────────────────────────────
    body: {
      paddingHorizontal: isLandscape ? 32 : 24,
    },

    // ── Griglia info ─────────────────────────────────────────
    infoGrid: {
      marginBottom: 12,
      borderWidth: 0.5,
      borderColor: border,
      borderRadius: 2,
    },
    infoRow: {
      flexDirection: "row",
      borderBottomWidth: 0.5,
      borderBottomColor: border,
    },
    infoRowLast: {
      flexDirection: "row",
    },
    infoCell: {
      flex: 1,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRightWidth: 0.5,
      borderRightColor: border,
    },
    infoCellLast: {
      flex: 1,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    infoLabel: {
      fontSize: 7,
      color: muted,
      marginBottom: 1,
      fontFamily: fontBold,
    },
    infoValue: {
      fontSize: 8.5,
      color: textColor,
    },

    // ── Tabella ──────────────────────────────────────────────
    table: { marginBottom: 14 },
    tableHeader: {
      flexDirection: "row",
      backgroundColor: primary,
      paddingVertical: 5,
      paddingHorizontal: 4,
      marginBottom: 0,
    },
    tableHeaderCell: {
      color: white,
      fontFamily: fontBold,
      fontSize: 7,
      textTransform: "uppercase",
    },
    tableRow: {
      flexDirection: "row",
      paddingVertical: 4,
      paddingHorizontal: 4,
      borderBottomWidth: 0.5,
      borderBottomColor: border,
      alignItems: "center",
    },
    tableRowAlt: { backgroundColor: bgPage },
    tableRowTotal: {
      flexDirection: "row",
      paddingVertical: 6,
      paddingHorizontal: 4,
      backgroundColor: bgPage,
      borderTopWidth: 1,
      borderTopColor: border,
      alignItems: "center",
    },

    colMansione: { width: isLandscape ? "36%" : "34%", paddingRight: 4 },
    colAuto:     { width: "12%", textAlign: "center" },
    colResp:     { width: "12%", textAlign: "center" },
    colPunteggio:{ width: isLandscape ? "26%" : "28%", paddingHorizontal: 4 },
    colOss:      { width: "14%", textAlign: "center" },

    barBg: { height: 7, backgroundColor: border, borderRadius: 3, overflow: "hidden" },
    barFill: { height: 7, borderRadius: 3, backgroundColor: primary },
    barLabel: { fontSize: 6.5, color: muted, marginTop: 1 },

    // ── Firma ─────────────────────────────────────────────────
    firmaBox: {
      marginTop: 20,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    firmaSlot: {
      width: "30%",
      borderTopWidth: 0.5,
      borderTopColor: "#94a3b8",
      paddingTop: 5,
    },
    firmaLabel: { fontSize: 7, color: muted },

    // ── Footer ────────────────────────────────────────────────
    footer: {
      borderTopWidth: 0.5,
      borderTopColor: border,
      paddingTop: 6,
      paddingHorizontal: isLandscape ? 32 : 24,
      marginTop: 16,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    footerText: { fontSize: 6.5, color: muted },

    // ── Radar ─────────────────────────────────────────────────
    radarSection: {
      flexDirection: "row",
      gap: 20,
      alignItems: "flex-start",
      marginBottom: 16,
    },
    radarLeft: { flex: 1, alignItems: "center" },
    radarRight: { width: isLandscape ? "38%" : "42%" },
    radarTitle: { fontSize: 11, color: primary, fontFamily: fontBold, marginBottom: 3 },
    radarSubtitle: { fontSize: 7.5, color: muted, marginBottom: 10 },
    legendRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 3.5,
      paddingHorizontal: 4,
      borderBottomWidth: 0.5,
      borderBottomColor: border,
      gap: 5,
    },
    legendRowAlt: { backgroundColor: bgPage },
    legendDot: { width: 7, height: 7, borderRadius: 3.5 },
    legendName: { flex: 1, fontSize: 7.5, color: textColor },
    legendVal: { width: 26, fontSize: 7.5, textAlign: "center" },
    legendHeader: {
      flexDirection: "row",
      paddingVertical: 4,
      paddingHorizontal: 4,
      backgroundColor: primary,
      borderRadius: 2,
      marginBottom: 1,
      gap: 5,
    },
    legendHeaderText: { fontSize: 6.5, color: white, fontFamily: fontBold, textTransform: "uppercase" },
    seriesLegend: { flexDirection: "row", gap: 14, marginTop: 10, justifyContent: "center" },
    seriesItem: { flexDirection: "row", alignItems: "center", gap: 4 },
    seriesDot: { width: 10, height: 4, borderRadius: 2 },
    seriesLabel: { fontSize: 7.5, color: muted },
    warningText: { fontSize: 8.5, color: "#f59e0b" },
  });
}

// Exported type for use in section components
export type PdfStyles = ReturnType<typeof makeStyles>;

// ============================================================
// Documento PDF principale
// ============================================================
export function CertificatoPDF({ dati }: { dati: DatiCertificato }) {
  const cfg: CertificatoConfig = { ...DEFAULT_CONFIG, ...dati.config };
  const s = makeStyles(cfg);

  const {
    utente, responsabile, scala, anno, dataCertificazione,
    righe, mediaResponsabile, radarData, logoPath,
  } = dati;

  const titoloVariante = getTitoloVariante(utente.ruolo, cfg);
  const anzianita = calcolaAnzianita(utente.data_assunzione);
  const dataAssunzioneFormatted = formatData(utente.data_assunzione);
  const orientation = cfg.orientamento;
  const fontBold = cfg.font_corpo === "Times-Roman" ? "Times-Bold"
    : cfg.font_corpo === "Courier" ? "Courier-Bold"
    : "Helvetica-Bold";

  return (
    <Document
      title={`${titoloVariante} — ${utente.cognome} ${utente.nome} ${anno}`}
      author="SICS — Create to Solve"
    >
      {/* ══════════════════════════════════════════════
          PAGINA 1: Dati utente + Tabella mansioni
      ══════════════════════════════════════════════ */}
      <Page size="A4" orientation={orientation} style={s.page}>

        <HeaderBar titolo={titoloVariante} cfg={cfg} s={s} logoPath={logoPath} />

        <View style={s.body}>

          {/* ── Griglia info (4 righe × 2 colonne) ─────── */}
          <View style={s.infoGrid}>
            <View style={s.infoRow}>
              <View style={s.infoCell}>
                <Text style={s.infoLabel}>Nome:</Text>
                <Text style={s.infoValue}>{utente.cognome} {utente.nome}</Text>
              </View>
              <View style={s.infoCellLast}>
                <Text style={s.infoLabel}>Ruolo:</Text>
                <Text style={s.infoValue}>{utente.ruolo ?? "—"}</Text>
              </View>
            </View>
            <View style={s.infoRow}>
              <View style={s.infoCell}>
                <Text style={s.infoLabel}>{cfg.etichetta_area}:</Text>
                <Text style={s.infoValue}>{utente.reparto || "—"}</Text>
              </View>
              <View style={s.infoCellLast}>
                <Text style={s.infoLabel}>{cfg.etichetta_data_assunzione}:</Text>
                <Text style={s.infoValue}>{dataAssunzioneFormatted}</Text>
              </View>
            </View>
            <View style={s.infoRow}>
              <View style={s.infoCell}>
                <Text style={s.infoLabel}>{cfg.etichetta_responsabile}:</Text>
                <Text style={s.infoValue}>
                  {responsabile ? `${responsabile.cognome} ${responsabile.nome}` : "—"}
                </Text>
              </View>
              <View style={s.infoCellLast}>
                <Text style={s.infoLabel}>{cfg.etichetta_data_valutazione}:</Text>
                <Text style={s.infoValue}>{dataCertificazione}</Text>
              </View>
            </View>
            <View style={s.infoRowLast}>
              <View style={s.infoCell}>
                <Text style={s.infoLabel}>{cfg.etichetta_valutatore}:</Text>
                <Text style={s.infoValue}>
                  {responsabile ? `${responsabile.cognome} ${responsabile.nome}` : "—"}
                </Text>
              </View>
              <View style={s.infoCellLast}>
                <Text style={s.infoLabel}>{cfg.etichetta_anzianita}:</Text>
                <Text style={s.infoValue}>{anzianita}</Text>
              </View>
            </View>
          </View>

          {/* ── Tabella mansioni ─────────────────────────── */}
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={[s.tableHeaderCell, s.colMansione]}>Mansione</Text>
              <Text style={[s.tableHeaderCell, s.colAuto]}>Autoval.</Text>
              <Text style={[s.tableHeaderCell, s.colResp]}>Val. Resp.</Text>
              <Text style={[s.tableHeaderCell, s.colPunteggio]}>Punteggio</Text>
              <Text style={[s.tableHeaderCell, s.colOss]}>Osservaz.</Text>
            </View>

            {righe.map((r, i) => {
              const diff = r.punteggioAuto !== null ? r.punteggioAuto - r.punteggioResp : null;
              return (
                <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                  <View style={s.colMansione}>
                    <Text style={{ fontSize: 8, lineHeight: 1.3 }}>{r.mansione}</Text>
                    <Text style={{ fontSize: 6.5, color: r.parametroColore, marginTop: 1 }}>
                      {r.parametro}
                    </Text>
                  </View>
                  <Text style={[s.colAuto, { fontSize: 8.5 }]}>
                    {r.punteggioAuto !== null ? r.punteggioAuto.toFixed(1) : "—"}
                  </Text>
                  <Text style={[s.colResp, { fontSize: 8.5, fontFamily: fontBold }]}>
                    {r.punteggioResp !== null ? (r.punteggioResp ?? 0).toFixed(1) : "—"}
                  </Text>
                  <View style={s.colPunteggio}>
                    <BarraPunteggio valore={r.punteggioResp ?? 0} max={scala.max} primary={cfg.colore_primario} />
                  </View>
                  <View style={[s.colOss, { alignItems: "center" }]}>
                    {diff !== null && Math.abs(diff) >= 2 ? (
                      <Text style={s.warningText}>⚠ {diff > 0 ? "+" : ""}{diff}</Text>
                    ) : (
                      <Text>—</Text>
                    )}
                  </View>
                </View>
              );
            })}

            <View style={s.tableRowTotal}>
              <Text style={[s.colMansione, { fontFamily: fontBold, fontSize: 8.5 }]}>
                Punteggio Valutazione
              </Text>
              <Text style={s.colAuto} />
              <Text style={[s.colResp, { fontFamily: fontBold, fontSize: 9.5, color: cfg.colore_primario }]}>
                {mediaResponsabile.toFixed(2)}
              </Text>
              <View style={s.colPunteggio}>
                <BarraPunteggio valore={mediaResponsabile} max={scala.max} primary={cfg.colore_primario} />
              </View>
              <Text style={s.colOss} />
            </View>
          </View>

          {/* ── Firme ─────────────────────────────────────── */}
          <View style={s.firmaBox}>
            <View style={s.firmaSlot}>
              <Text style={s.firmaLabel}>
                {cfg.etichetta_responsabile}:{"\n"}
                {responsabile ? `${responsabile.cognome} ${responsabile.nome}` : ""}
              </Text>
            </View>
            <View style={s.firmaSlot}>
              <Text style={s.firmaLabel}>
                Collaboratore:{"\n"}
                {utente.cognome} {utente.nome}
              </Text>
            </View>
            <View style={s.firmaSlot}>
              <Text style={s.firmaLabel}>Firma Admin / Timbro</Text>
            </View>
          </View>

        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>SICS Srl · Create to Solve · Documento riservato</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Pagina ${pageNumber} di ${totalPages}`}
          />
        </View>
      </Page>

      {/* ══════════════════════════════════════════════
          PAGINA 2: Radar (opzionale)
      ══════════════════════════════════════════════ */}
      {cfg.mostra_radar && radarData.length >= 3 && (
        <Page size="A4" orientation={orientation} style={s.page}>

          <HeaderBar titolo={titoloVariante} cfg={cfg} s={s} logoPath={logoPath} />

          <View style={s.body}>
            <View style={s.radarSection}>
              <View style={s.radarLeft}>
                <Text style={s.radarTitle}>Analisi Radar Competenze {anno}</Text>
                <Text style={s.radarSubtitle}>
                  {utente.cognome} {utente.nome} · {utente.reparto}
                </Text>
                <RadarChartSvg data={radarData} scalaMax={scala.max} primary={cfg.colore_primario} />
                <View style={s.seriesLegend}>
                  <View style={s.seriesItem}>
                    <View style={[s.seriesDot, { backgroundColor: cfg.colore_primario }]} />
                    <Text style={s.seriesLabel}>Autovalutazione</Text>
                  </View>
                  <View style={s.seriesItem}>
                    <View style={[s.seriesDot, { backgroundColor: "#f59e0b" }]} />
                    <Text style={s.seriesLabel}>Val. Responsabile</Text>
                  </View>
                </View>
              </View>

              <View style={s.radarRight}>
                <Text style={s.radarTitle}>Parametri Radar</Text>
                <Text style={s.radarSubtitle}>
                  Scala: {scala.nome} ({scala.min}–{scala.max})
                </Text>
                <View style={s.legendHeader}>
                  <View style={{ width: 9 }} />
                  <Text style={[s.legendHeaderText, { flex: 1 }]}>Parametro</Text>
                  <Text style={[s.legendHeaderText, { width: 26, textAlign: "center" }]}>Auto</Text>
                  <Text style={[s.legendHeaderText, { width: 26, textAlign: "center" }]}>Resp</Text>
                </View>
                {radarData.map((row, i) => (
                  <View key={i} style={[s.legendRow, i % 2 === 1 ? s.legendRowAlt : {}]}>
                    <View style={[s.legendDot, { backgroundColor: row.colore || "#747373" }]} />
                    <Text style={s.legendName}>{row.parametro}</Text>
                    <Text style={[s.legendVal, { color: cfg.colore_primario, fontFamily: fontBold }]}>
                      {row.autovalutazione.toFixed(1)}
                    </Text>
                    <Text style={[s.legendVal, { color: "#f59e0b", fontFamily: fontBold }]}>
                      {row.responsabile.toFixed(1)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={s.footer} fixed>
            <Text style={s.footerText}>SICS Srl · Create to Solve · Documento riservato</Text>
            <Text
              style={s.footerText}
              render={({ pageNumber, totalPages }) => `Pagina ${pageNumber} di ${totalPages}`}
            />
          </View>
        </Page>
      )}
    </Document>
  );
}
