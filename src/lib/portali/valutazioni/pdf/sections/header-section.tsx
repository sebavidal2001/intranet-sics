import { View, Text, Image } from "@react-pdf/renderer";
import type { CertificatoConfig, PdfStyles } from "../certificato";

export function HeaderBar({
  titolo,
  cfg,
  s,
  logoPath,
}: {
  titolo: string;
  cfg: CertificatoConfig;
  s: PdfStyles;
  logoPath?: string;
}) {
  const hasEdition = cfg.data_edizione || cfg.data_aggiornamento;
  return (
    <View style={s.headerBar}>
      {/* Logo */}
      <View style={s.headerLogo}>
        {logoPath ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image does not accept alt prop
          <Image src={logoPath} style={s.headerLogoImg} />
        ) : (
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: cfg.colore_primario }}>
            SICS
          </Text>
        )}
      </View>

      {/* Title */}
      <View style={s.headerTitle}>
        <Text style={s.headerTitleText}>{titolo}</Text>
      </View>

      {/* Code box */}
      <View style={s.headerCode}>
        <Text style={s.headerCodeText}>{cfg.codice_documento}</Text>
        {cfg.data_edizione ? (
          <Text style={s.headerCodeText}>Edizione: {cfg.data_edizione}</Text>
        ) : null}
        {cfg.data_aggiornamento ? (
          <Text style={s.headerCodeText}>Ultimo aggiornamento: {cfg.data_aggiornamento}</Text>
        ) : null}
        {!hasEdition ? (
          <Text style={s.headerCodeText}> </Text>
        ) : null}
      </View>
    </View>
  );
}
