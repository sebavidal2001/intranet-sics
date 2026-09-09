-- 090_bi_trasporti_documenti.sql
--
-- Tabella di atterraggio delle testate dei documenti di trasporto estratte dal
-- gestionale. È il contratto fra la pipeline notturna (lato Codex) e il Portale
-- Controllo Vettori (migrazioni 087-089).
--
-- Sta in `bi` e non in `vettori` di proposito: qui arriva il **dato grezzo del
-- gestionale**, riga per riga come lo espone il documento. Le *spedizioni
-- logiche* — che raggruppano i documenti che viaggiano insieme e che sono
-- l'unità con cui il vettore fattura — vivono in `vettori.spedizioni` e si
-- derivano da qui. Tenere le due cose separate significa poter ricostruire le
-- spedizioni quando cambia la regola di raggruppamento, senza riestrarre niente.
--
-- Caricamento: **upsert su `id_documento`**, con finestra mobile a 90 giorni.
-- Le bolle sono a sola aggiunta come `consegnato` e `fatturato` — una bolla
-- emessa non cambia più — ma le correzioni tardive esistono, quindi serve
-- `upsert` e non `append`.
--
-- Il numero di bolla arriva **grezzo**, come sta nel gestionale. La
-- normalizzazione per l'aggancio (maiuscolo, senza punteggiatura, senza zeri
-- iniziali, con `0` e `XXX` trattati come riferimento assente) avviene in un
-- solo posto — `src/lib/portali/vettori/fatture/testo.ts` — perché due
-- normalizzazioni scritte in due linguaggi divergono, e quando divergono
-- l'aggancio smette di funzionare senza che niente lo dica.

CREATE SCHEMA IF NOT EXISTS bi;

CREATE TABLE IF NOT EXISTS bi.trasporti_documenti (
  -- identità
  id_documento               integer PRIMARY KEY,
  direzione                  text,
  tipo_registro              text,
  codice_profilo             text,
  descrizione_profilo        text,
  numero_progressivo         text,
  -- Sulle uscite coincide col progressivo; sugli arrivi è il numero di bolla
  -- DEL FORNITORE, che è la chiave con cui i vettori fatturano gli arrivi.
  numero_documento           text,
  data_documento             date,
  data_registrazione         date,
  -- `timestamp` senza fuso, non `timestamptz`: il gestionale restituisce orari
  -- locali privi di fuso, e interpretarli come UTC li sposterebbe di un'ora o
  -- due a seconda dell'ora legale. Sono timbri amministrativi — «chi ha creato
  -- cosa, quando» — che si leggono con l'orologio dell'ufficio e non attraverso
  -- fusi diversi: conservarli alla lettera è più fedele che convertirli.
  data_creazione             timestamp,

  -- stato: esposto, non filtrato via
  stampato                   text,
  contabilizzato             text,
  sospeso                    text,
  bloccato                   text,

  -- controparte: cliente sulle uscite, fornitore sugli arrivi
  id_sog_commerciale         integer,
  codice_soggetto            text,
  soggetto                   text,
  soggetto_piva              text,
  soggetto_indirizzo         text,
  soggetto_cap               text,
  soggetto_localita          text,
  soggetto_provincia         text,

  -- destinazione: tre fonti, perché nessuna da sola basta
  id_destinazione            integer,
  destinazione_codificata    text,
  dest_indirizzo_cod         text,
  dest_cap_cod               text,
  dest_localita_cod          text,
  dest_provincia_cod         text,
  dest_rag_soc               text,
  dest_indirizzo             text,
  dest_cap                   text,
  dest_localita              text,
  dest_provincia             text,
  provincia_destinazione     text,

  -- zona tariffaria già risolta dalla pipeline, con la sua provenienza
  zona_cap                   text,
  zona_provincia             text,
  fonte_zona                 text,

  -- trasporto
  id_tipo_trasporto          integer,
  tipo_trasporto_codice      text,
  tipo_trasporto             text,
  id_caus_trasporto          integer,
  causale_trasporto_codice   text,
  causale_trasporto          text,
  tras_mezzo                 text,
  asp_beni                   text,
  id_sog_commerciale_vettore integer,
  vettore_codice             text,
  vettore                    text,

  -- dati fisici: sugli arrivi sono quasi sempre vuoti, ed è un fatto noto
  num_colli                  numeric(14,3),
  num_pallet                 numeric(14,3),
  peso_netto                 numeric(14,3),
  peso_lordo                 numeric(14,3),
  volume                     numeric(14,4),
  id_unita_misura_peso       integer,
  um_peso                    text,
  id_unita_misura_volume     integer,
  um_volume                  text,
  val_spese                  numeric(14,4),

  -- date
  data_trasporto             date,
  data_prev_consegna         date,
  data_consegna_cliente      date,

  note_spedizione            text,

  -- chi ha scritto il documento
  id_utente_crea             integer,
  codice_utente_creatore     text,
  utente_creatore            text,
  id_utente_modifica         integer,
  data_modifica              timestamp,   -- stesso motivo di data_creazione
  generato_da                text,

  -- servizio, scritte dal caricamento e non dal gestionale
  ultimo_visto_run           text,
  aggiornato_il              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE bi.trasporti_documenti IS
  'Testate dei documenti di trasporto dal gestionale, upsert su id_documento con finestra mobile a 90 giorni. Dato grezzo: le spedizioni logiche si derivano in vettori.spedizioni.';

COMMENT ON COLUMN bi.trasporti_documenti.numero_documento IS
  'Sulle uscite coincide col progressivo interno; sugli arrivi (profilo BF) è il numero di bolla del FORNITORE. È la chiave con cui GLS e Trading Post fatturano gli arrivi: verificato, aggancia 39 spedizioni GLS su 44 e 38 partenze Trading Post su 38. Presente su 4.407 carichi fornitore su 4.415 dal 2025.';

COMMENT ON COLUMN bi.trasporti_documenti.tipo_trasporto_codice IS
  'Chi paga il trasporto. ATTENZIONE: il significato si inverte fra i due versi. Sulle uscite sono a nostro carico 01 (franco) e 03 (franco addebito fattura); sugli arrivi lo è 02 (porto assegnato), perché lì è il vettore a fatturare a noi.';

COMMENT ON COLUMN bi.trasporti_documenti.utente_creatore IS
  'Chi ha creato il documento a gestionale. DUE LIMITI da dichiarare ogni volta che si espone. Primo: misura VOLUME AMMINISTRATIVO, non produttività — una bolla da trenta righe e una da una riga contano uguale. Secondo, più insidioso: metà dei valori NON sono persone ma postazioni condivise (magazzino1 con 3.809 documenti, magazzino2, vendite, acquisti); solo alcuni sono nominativi. Attribuire quei numeri a una persona sarebbe sbagliato.';

COMMENT ON COLUMN bi.trasporti_documenti.volume IS
  'MAI valorizzato: 0 su 4.415 carichi fornitore dal 2025. Anche colli (18) e peso lordo (9) sono di fatto assenti; il peso netto arriva al 43%. Il peso volumetrico viene dalla rilevazione a magazzino (vettori.rilevazioni), non da qui.';

-- Indici: le tre domande che il portale fa a questa tabella.
CREATE INDEX IF NOT EXISTS idx_trasporti_doc_ricerca
  ON bi.trasporti_documenti (data_registrazione DESC, codice_profilo);
CREATE INDEX IF NOT EXISTS idx_trasporti_doc_soggetto
  ON bi.trasporti_documenti (id_sog_commerciale, data_documento DESC);
-- L'aggancio cerca per numero: l'indice è su `upper(numero_documento)` perché
-- la normalizzazione completa vive in TypeScript e qui serve solo a restringere
-- i candidati, non a decidere l'abbinamento.
CREATE INDEX IF NOT EXISTS idx_trasporti_doc_numero
  ON bi.trasporti_documenti (upper(numero_documento))
  WHERE numero_documento IS NOT NULL;

ALTER TABLE bi.trasporti_documenti ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA bi TO service_role;
GRANT ALL PRIVILEGES ON bi.trasporti_documenti TO service_role;

NOTIFY pgrst, 'reload schema';
