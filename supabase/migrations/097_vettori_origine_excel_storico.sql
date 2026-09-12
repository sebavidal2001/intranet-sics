-- 097_vettori_origine_excel_storico.sql
--
-- Terza origine per `vettori.spedizioni`: le spedizioni ricostruite dai fogli
-- Excel che l'amministrazione teneva a mano prima del portale.
--
-- Perché non riusare 'manuale': quel valore significa «una persona l'ha
-- inserita nel portale», ed è una garanzia diversa. Le righe importate dai
-- fogli hanno una qualità propria — numeri di bolla scritti a mano, celle con
-- più DDT nella stessa riga, qualche data fuori periodo — e chi le guarda deve
-- poterle distinguere senza andare a memoria. È lo stesso motivo per cui
-- `vettori.carburante` distingue `comunicazione` da `letto_da_fattura`.

ALTER TABLE vettori.spedizioni
  DROP CONSTRAINT IF EXISTS spedizioni_origine_check;

ALTER TABLE vettori.spedizioni
  ADD CONSTRAINT spedizioni_origine_check
  CHECK (origine IN ('gestionale', 'manuale', 'excel_storico'));

COMMENT ON COLUMN vettori.spedizioni.origine IS
  'gestionale = arrivata dalla pipeline; manuale = inserita nel portale; excel_storico = importata dai fogli 2026 dell''amministrazione.';

NOTIFY pgrst, 'reload schema';
