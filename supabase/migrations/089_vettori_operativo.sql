-- 089_vettori_operativo.sql
--
-- PORTALE CONTROLLO VETTORI — il ciclo operativo: spedizioni attese, rilevazioni
-- di magazzino, fatture dei vettori, controlli, anomalie e chiusura del mese.
--
-- Dipende dalla 087 (schema e listini) e dalla 088 (dati 2026).
--
-- Le quattro scelte di struttura, e perché:
--
--   1) LA SPEDIZIONE LOGICA NON È IL DOCUMENTO.
--      Una bolla del fornitore corrisponde a più carichi nel gestionale in 62
--      casi sul 2026, e un documento Parker risulta suddiviso in undici. Il
--      vettore però fattura una spedizione sola. `spedizioni` è quindi l'unità
--      che il vettore fattura, e `spedizioni_documenti` la lega agli N documenti
--      del gestionale che la compongono.
--
--   2) LA CHIAVE DI AGGANCIO CAMBIA VERSO.
--      Sulle partenze la fattura cita il nostro numero di bolla; sugli arrivi
--      cita quello *del fornitore*. `numero_riferimento` contiene sempre il
--      numero con cui il vettore fattura, qualunque dei due sia, così la
--      riconciliazione ha una chiave sola.
--
--   3) IL CONTROLLO CONGELA I VALORI APPLICATI.
--      Non basta la validità temporale del listino: `controlli` conserva copia
--      di percentuali, importi e voci usate. Correggere un errore in un listino
--      del passato non deve muovere i mesi già chiusi.
--
--   4) L'ANOMALIA È SEPARATA DAL CONTROLLO.
--      Un controllo è un calcolo e si può rifare; un'anomalia è una decisione di
--      una persona, con una motivazione, e non si rifà. Tenerle nella stessa
--      riga significherebbe perdere la decisione a ogni ricalcolo.

-- ============================================================
-- 1) SPEDIZIONI ATTESE
-- ============================================================
CREATE TABLE IF NOT EXISTS vettori.spedizioni (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direzione          text NOT NULL CHECK (direzione IN ('entrata', 'uscita')),
  vettore_id         uuid REFERENCES vettori.vettori(id) ON DELETE SET NULL,
  -- Il numero con cui il VETTORE fattura questa spedizione: nostro numero di
  -- bolla sulle uscite, numero del fornitore sulle entrate.
  numero_riferimento      text,
  numero_riferimento_norm text,
  data_documento     date NOT NULL,
  -- Controparte: cliente sulle uscite, fornitore sulle entrate
  controparte_codice text,
  controparte_nome   text,
  -- Zona tariffaria: destinazione sulle uscite, provenienza sulle entrate
  zona_cap           text,
  zona_provincia     char(2),
  fonte_zona         text,
  -- Porto. ATTENZIONE: il significato si inverte fra i due versi. Sulle uscite
  -- sono a nostro carico i codici 01 (franco) e 03 (franco addebito fattura);
  -- sugli arrivi lo è il 02 (porto assegnato), perché lì è il vettore a
  -- fatturare a noi. Sbagliarlo significa cercare in fattura le spedizioni
  -- sbagliate: sulle 39 bolle agganciate alla fattura GLS di luglio, 37 erano
  -- in porto assegnato.
  porto_codice       text,
  porto_descrizione  text,
  a_nostro_carico    boolean,
  -- Dati dalla bolla, quando ci sono
  colli_bolla        int,
  peso_bolla         numeric(12,3),
  origine            text NOT NULL DEFAULT 'gestionale'
                       CHECK (origine IN ('gestionale', 'manuale')),
  stato              text NOT NULL DEFAULT 'attesa'
                       CHECK (stato IN ('attesa', 'abbinata', 'senza_fattura', 'ignorata')),
  note               text,
  creata_il          timestamptz NOT NULL DEFAULT now(),
  aggiornata_il      timestamptz NOT NULL DEFAULT now()
);

-- Chiave logica della spedizione. Le entrate senza numero restano individuali e
-- passano dall'abbinamento assistito: imporre l'unicità su controparte + data
-- le fonderebbe fra loro, che è peggio del non agganciarle.
CREATE UNIQUE INDEX IF NOT EXISTS uq_spedizioni_riferimento
  ON vettori.spedizioni (direzione, coalesce(controparte_codice, ''), numero_riferimento_norm, data_documento)
  WHERE numero_riferimento_norm IS NOT NULL AND numero_riferimento_norm <> '';

CREATE INDEX IF NOT EXISTS idx_spedizioni_ricerca
  ON vettori.spedizioni (data_documento DESC, direzione, vettore_id);
CREATE INDEX IF NOT EXISTS idx_spedizioni_norm
  ON vettori.spedizioni (numero_riferimento_norm)
  WHERE numero_riferimento_norm IS NOT NULL;

COMMENT ON TABLE vettori.spedizioni IS
  'Una spedizione come la fattura il vettore, non come la registra il gestionale: raggruppa i documenti che viaggiano insieme.';
COMMENT ON COLUMN vettori.spedizioni.numero_riferimento_norm IS
  'Numero di riferimento normalizzato (maiuscolo, senza punteggiatura né zeri iniziali) per l''aggancio alle righe di fattura.';

-- I documenti del gestionale che compongono la spedizione ----------------------
CREATE TABLE IF NOT EXISTS vettori.spedizioni_documenti (
  spedizione_id      uuid NOT NULL REFERENCES vettori.spedizioni(id) ON DELETE CASCADE,
  id_documento       integer NOT NULL,          -- chiave del gestionale
  codice_profilo     text,                      -- BC, BF, ...
  tipo_registro      text,                      -- DV, DA
  numero_progressivo text,
  numero_documento   text,
  PRIMARY KEY (spedizione_id, id_documento)
);

CREATE INDEX IF NOT EXISTS idx_sped_doc_documento
  ON vettori.spedizioni_documenti (id_documento);

-- ============================================================
-- 2) RILEVAZIONI DI MAGAZZINO
-- ============================================================
-- Sui 1.937 carichi da fornitore del 2026 il gestionale ha i colli 8 volte, il
-- peso lordo 5 e il volume mai. Questa tabella non è un complemento: è l'unica
-- fonte dei dati fisici degli arrivi.
CREATE TABLE IF NOT EXISTS vettori.rilevazioni (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spedizione_id uuid REFERENCES vettori.spedizioni(id) ON DELETE SET NULL,
  -- Se la bolla non è ancora arrivata dal gestionale, si registra lo stesso e
  -- si aggancia dopo: fermare il magazzino in attesa dell'estrazione notturna
  -- vorrebbe dire non avere il dato.
  fornitore_testo text,
  numero_bolla    text,
  data_arrivo     date NOT NULL DEFAULT current_date,
  colli           int NOT NULL DEFAULT 1,
  peso_kg         numeric(12,3),
  lunghezza_cm    numeric(10,1),
  larghezza_cm    numeric(10,1),
  altezza_cm      numeric(10,1),
  -- Condizioni che fanno scattare i supplementi in fattura
  condizioni      text[] NOT NULL DEFAULT '{}',
  note            text,
  rilevata_da     uuid REFERENCES public.utenti(id) ON DELETE SET NULL,
  rilevata_il     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rilevazioni_spedizione
  ON vettori.rilevazioni (spedizione_id);
CREATE INDEX IF NOT EXISTS idx_rilevazioni_data
  ON vettori.rilevazioni (data_arrivo DESC);

COMMENT ON COLUMN vettori.rilevazioni.condizioni IS
  'Slug delle condizioni osservate: bancale, non_sovrapponibile, oversized, ztl, movimentazione_manuale. Sono quelle che il listino usa per applicare i supplementi.';

-- ============================================================
-- 3) FATTURE DEI VETTORI
-- ============================================================
CREATE TABLE IF NOT EXISTS vettori.fatture (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vettore_id     uuid NOT NULL REFERENCES vettori.vettori(id) ON DELETE RESTRICT,
  numero         text NOT NULL,
  data_fattura   date NOT NULL,
  anno           int NOT NULL,
  mese           int NOT NULL CHECK (mese BETWEEN 1 AND 12),
  -- Totali dichiarati dalla fattura, per la quadratura
  tot_nolo         numeric(14,2),
  tot_supplementi  numeric(14,2),
  tot_adeguamento  numeric(14,2),
  tot_carburante   numeric(14,2),
  tot_documento    numeric(14,2),
  perc_carburante  numeric(8,5),
  -- Acquisizione
  nome_file      text,
  hash_file      text,                     -- per riconoscere un file già caricato
  metodo_lettura text NOT NULL DEFAULT 'testo'
                   CHECK (metodo_lettura IN ('testo', 'ocr', 'manuale')),
  righe_lette    int NOT NULL DEFAULT 0,
  quadratura_ok  boolean,
  quadratura_note text,
  stato          text NOT NULL DEFAULT 'bozza'
                   CHECK (stato IN ('bozza', 'confermata', 'chiusa')),
  caricata_da    uuid REFERENCES public.utenti(id) ON DELETE SET NULL,
  caricata_il    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fatture_vettore_numero
  ON vettori.fatture (vettore_id, numero, data_fattura);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fatture_hash
  ON vettori.fatture (hash_file) WHERE hash_file IS NOT NULL;

COMMENT ON COLUMN vettori.fatture.quadratura_ok IS
  'Il totale delle righe lette coincide con quello stampato in fattura? Se no, la fattura resta in bozza e non genera controlli: un''acquisizione parziale che sembra completa è peggio di un errore dichiarato.';

CREATE TABLE IF NOT EXISTS vettori.fatture_righe (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fattura_id    uuid NOT NULL REFERENCES vettori.fatture(id) ON DELETE CASCADE,
  riga_numero   int NOT NULL,
  data_spedizione        date,
  numero_spedizione      text,             -- numero del vettore (GLS N.Sp., TNT LDV, ...)
  numero_riferimento     text,             -- il numero di bolla citato in fattura
  numero_riferimento_norm text,
  controparte_testo      text,             -- come scritta in fattura, spesso troncata
  direzione     text CHECK (direzione IN ('entrata', 'uscita')),
  colli         int,
  peso          numeric(12,3),
  peso_volumetrico numeric(12,3),
  peso_tassato  numeric(12,3),
  nolo          numeric(14,4),
  supplementi   numeric(14,4) NOT NULL DEFAULT 0,
  adeguamento   numeric(14,4) NOT NULL DEFAULT 0,
  carburante    numeric(14,4) NOT NULL DEFAULT 0,
  totale        numeric(14,4),
  dettaglio     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- voci come lette dal PDF
  confermata    boolean NOT NULL DEFAULT true,        -- false finché l'operatore non valida (OCR)
  UNIQUE (fattura_id, riga_numero)
);

CREATE INDEX IF NOT EXISTS idx_fatture_righe_norm
  ON vettori.fatture_righe (numero_riferimento_norm)
  WHERE numero_riferimento_norm IS NOT NULL;

COMMENT ON COLUMN vettori.fatture_righe.confermata IS
  'Sulle fatture lette per riconoscimento ottico parte a false: il riconoscimento non è affidabile quanto la lettura del testo, e nessuna riga entra nei controlli finché una persona non l''ha guardata.';

-- ============================================================
-- 4) CONTROLLI — IL CONFRONTO, CON I VALORI CONGELATI
-- ============================================================
CREATE TABLE IF NOT EXISTS vettori.controlli (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fattura_riga_id  uuid NOT NULL REFERENCES vettori.fatture_righe(id) ON DELETE CASCADE,
  spedizione_id    uuid REFERENCES vettori.spedizioni(id) ON DELETE SET NULL,
  -- Come è stato agganciato, e quanto ci si può fidare
  abbinamento      text NOT NULL DEFAULT 'nessuno'
                     CHECK (abbinamento IN ('nessuno', 'numero', 'assistito', 'manuale')),
  abbinato_da      uuid REFERENCES public.utenti(id) ON DELETE SET NULL,
  -- ---- snapshot del listino applicato: è il congelamento ----
  listino_id       uuid REFERENCES vettori.listini(id) ON DELETE SET NULL,
  listino_etichetta text,
  zona_codice      text,
  perc_adeguamento numeric(8,5),
  perc_carburante  numeric(8,5),
  -- ---- pesi ----
  peso_reale       numeric(12,3),
  peso_volumetrico numeric(12,3),
  peso_tassabile   numeric(12,3),
  peso_applicato   text CHECK (peso_applicato IN ('reale', 'volumetrico', 'minimo')),
  -- ---- costo atteso, voce per voce ----
  atteso_nolo         numeric(14,4) NOT NULL DEFAULT 0,
  atteso_imponibile   numeric(14,4) NOT NULL DEFAULT 0,
  atteso_adeguamento  numeric(14,4) NOT NULL DEFAULT 0,
  atteso_carburante   numeric(14,4) NOT NULL DEFAULT 0,
  atteso_fuori_base   numeric(14,4) NOT NULL DEFAULT 0,
  atteso_totale       numeric(14,4) NOT NULL DEFAULT 0,
  atteso_dettaglio    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- ---- confronto ----
  fatturato_totale numeric(14,4),
  scostamento      numeric(10,6),          -- frazione: 0.152 = +15,2%
  esito            text NOT NULL DEFAULT 'non_valutabile'
                     CHECK (esito IN ('in_linea', 'da_verificare', 'anomalia', 'non_valutabile')),
  avvertenze       text[] NOT NULL DEFAULT '{}',
  calcolato_il     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fattura_riga_id)
);

CREATE INDEX IF NOT EXISTS idx_controlli_esito
  ON vettori.controlli (esito, calcolato_il DESC);
CREATE INDEX IF NOT EXISTS idx_controlli_spedizione
  ON vettori.controlli (spedizione_id);

COMMENT ON TABLE vettori.controlli IS
  'Il confronto fra costo atteso e importo fatturato per una riga di fattura. Conserva copia del listino applicato: ricalcolare un mese chiuso deve dare lo stesso risultato di allora, anche se nel frattempo il listino è stato corretto.';
COMMENT ON COLUMN vettori.controlli.scostamento IS
  'Frazione, non percentuale. NULL quando l''atteso è zero: una divisione per zero travestita da -100% riempie un cruscotto di anomalie inesistenti, ed è esattamente quello che succede oggi nei fogli.';

-- ============================================================
-- 5) ANOMALIE — LA DECISIONE DI UNA PERSONA
-- ============================================================
CREATE TABLE IF NOT EXISTS vettori.anomalie (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  controllo_id  uuid REFERENCES vettori.controlli(id) ON DELETE CASCADE,
  spedizione_id uuid REFERENCES vettori.spedizioni(id) ON DELETE SET NULL,
  tipo          text NOT NULL CHECK (tipo IN (
                  'importo_oltre_soglia',
                  'peso_diverso_da_bolla',
                  'volumetrico_non_giustificato',
                  'supplemento_non_previsto',
                  'carburante_diverso',
                  'fattura_senza_bolla',
                  'bolla_senza_addebito',
                  'riaddebito_mancante',
                  'riaddebito_diverso'
                )),
  gravita       text NOT NULL DEFAULT 'da_verificare'
                  CHECK (gravita IN ('da_verificare', 'anomalia', 'informativa')),
  descrizione   text NOT NULL,
  importo_contestato numeric(14,2),
  stato         text NOT NULL DEFAULT 'aperta'
                  CHECK (stato IN ('aperta', 'contestata', 'accettata', 'corretta')),
  motivazione   text,
  decisa_da     uuid REFERENCES public.utenti(id) ON DELETE SET NULL,
  decisa_il     timestamptz,
  comunicazione_id uuid,
  creata_il     timestamptz NOT NULL DEFAULT now(),
  -- Una decisione senza motivazione fra sei mesi non è più una decisione.
  CHECK (stato = 'aperta' OR motivazione IS NOT NULL OR stato = 'contestata')
);

CREATE INDEX IF NOT EXISTS idx_anomalie_stato
  ON vettori.anomalie (stato, gravita, creata_il DESC);
CREATE INDEX IF NOT EXISTS idx_anomalie_controllo
  ON vettori.anomalie (controllo_id);

COMMENT ON COLUMN vettori.anomalie.gravita IS
  '`informativa` esiste per il riaddebito diverso dalla tabella: sui 233 addebiti del 2026 la tabella è applicata alla lettera in meno della metà dei casi, perché chi addebita arrotonda. Trattarlo come anomalia rifarebbe l''errore del foglio di partenza.';

-- ============================================================
-- 6) RIADDEBITO AL CLIENTE — QUELLO TROVATO IN FATTURA
-- ============================================================
CREATE TABLE IF NOT EXISTS vettori.riaddebiti (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spedizione_id     uuid REFERENCES vettori.spedizioni(id) ON DELETE CASCADE,
  id_spesa_documento integer,               -- chiave della spesa nel gestionale
  id_documento_fattura integer,
  numero_fattura    text,
  data_fattura      date,
  codice_spesa      text,                   -- 'T' spese di trasporto, 'I' logistica e imballo
  descrizione_spesa text,
  importo           numeric(14,2) NOT NULL,
  importo_atteso    numeric(14,2),          -- dalla tabella a scaglioni in vigore
  origine           text NOT NULL DEFAULT 'gestionale'
                      CHECK (origine IN ('gestionale', 'manuale'))
);

CREATE INDEX IF NOT EXISTS idx_riaddebiti_spedizione
  ON vettori.riaddebiti (spedizione_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_riaddebiti_spesa
  ON vettori.riaddebiti (id_spesa_documento) WHERE id_spesa_documento IS NOT NULL;

COMMENT ON TABLE vettori.riaddebiti IS
  'Gli addebiti di trasporto trovati sulle fatture ai clienti. Conserva l''identificativo della singola spesa e non solo il documento d''origine, perché una fattura può contenere più addebiti riferiti a bolle diverse.';

-- ============================================================
-- 7) CHIUSURA DEL MESE
-- ============================================================
CREATE TABLE IF NOT EXISTS vettori.chiusure (
  vettore_id uuid NOT NULL REFERENCES vettori.vettori(id) ON DELETE CASCADE,
  anno       int NOT NULL,
  mese       int NOT NULL CHECK (mese BETWEEN 1 AND 12),
  righe      int NOT NULL DEFAULT 0,
  anomalie   int NOT NULL DEFAULT 0,
  importo_controllato numeric(14,2),
  importo_contestato  numeric(14,2),
  note       text,
  chiusa_da  uuid REFERENCES public.utenti(id) ON DELETE SET NULL,
  chiusa_il  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vettore_id, anno, mese)
);

COMMENT ON TABLE vettori.chiusure IS
  'Un mese chiuso per vettore. Da qui in poi le righe non sono più modificabili e i valori applicati restano congelati. La riapertura è un''operazione esplicita, tracciata come tale.';

-- ============================================================
-- 8) MODELLI DI COMUNICAZIONE
-- ============================================================
CREATE TABLE IF NOT EXISTS vettori.mail_modelli (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vettore_id   uuid REFERENCES vettori.vettori(id) ON DELETE CASCADE,  -- NULL = modello generale
  nome         text NOT NULL,
  oggetto      text NOT NULL,
  corpo        text NOT NULL,
  destinatari  text[] NOT NULL DEFAULT '{}',
  cc           text[] NOT NULL DEFAULT '{}',
  attivo       boolean NOT NULL DEFAULT true,
  aggiornato_da uuid REFERENCES public.utenti(id) ON DELETE SET NULL,
  aggiornato_il timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_modello_attivo
  ON vettori.mail_modelli (coalesce(vettore_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE attivo;

COMMENT ON COLUMN vettori.mail_modelli.corpo IS
  'Testo con segnaposto richiamabili per nome: {vettore}, {mese}, {anno}, {n_anomalie}, {totale_contestato}, {tabella}. Il programma mostra l''anteprima con i dati veri prima di produrre il file.';

INSERT INTO vettori.mail_modelli (vettore_id, nome, oggetto, corpo)
SELECT NULL, 'Riepilogo anomalie — modello generale',
  'Richiesta di verifica addebiti — {vettore} {mese}/{anno}',
  E'Spett.le {vettore},\n\n' ||
  E'dal controllo della Vostra fattura relativa al mese di {mese}/{anno} risultano ' ||
  E'{n_anomalie} spedizioni i cui addebiti non corrispondono alle condizioni contrattuali, ' ||
  E'per un totale di {totale_contestato}.\n\n' ||
  E'{tabella}\n\n' ||
  E'Vi chiediamo cortesemente di verificare e di farci sapere.\n\n' ||
  E'Cordiali saluti'
WHERE NOT EXISTS (
  SELECT 1 FROM vettori.mail_modelli WHERE vettore_id IS NULL AND attivo
);

-- ============================================================
-- 9) SICUREZZA
-- ============================================================
ALTER TABLE vettori.spedizioni            ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.spedizioni_documenti  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.rilevazioni           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.fatture               ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.fatture_righe         ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.controlli             ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.anomalie              ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.riaddebiti            ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.chiusure              ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.mail_modelli          ENABLE ROW LEVEL SECURITY;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA vettori TO service_role;

NOTIFY pgrst, 'reload schema';
