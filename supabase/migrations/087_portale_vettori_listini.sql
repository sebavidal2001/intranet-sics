-- 087_portale_vettori_listini.sql
--
-- PORTALE CONTROLLO VETTORI — fondamento: anagrafica vettori e listini versionati.
--
-- Contesto:
--   L'amministrazione controlla oggi le fatture dei vettori (GLS, TNT, FedEx,
--   Trading Post) su quattro fogli di calcolo. Il difetto strutturale di quel
--   controllo è che confronta grandezze non omogenee — costo atteso = solo nolo,
--   importo fatturato = nolo + assicurazione + ISTAT + carburante — e quindi
--   segnala 151 spedizioni su 192 come fuori soglia. Rifacendo il confronto su
--   grandezze omogenee le anomalie vere scendono a 41, di cui 15 sopra il 20%.
--
-- Questa migration crea SOLO la configurazione: chi sono i vettori, come si
-- forma il loro prezzo, e come cambia nel tempo. I listini 2026 arrivano con la
-- 088; le spedizioni, le fatture e i controlli con la 089.
--
-- Le tre scelte che contano:
--
--   1) MODELLI TARIFFARI DIVERSI, NON LA STESSA TABELLA CON NUMERI DIVERSI.
--      GLS e TNT usano scaglioni a importo fisso; Trading Post una tariffa a
--      quintale con minimo tassabile. Anche il divisore volumetrico cambia:
--      300 kg/mc per GLS e Trading Post, 250 per TNT e FedEx. Sono parametri
--      del vettore, non costanti nel codice.
--
--   2) CONGELAMENTO A DUE LIVELLI. Il listino ha una validità temporale
--      (`valido_dal`/`valido_al`): dice quale listino valeva a luglio. La riga
--      di controllo — migration 089 — conserva in più copia dei valori
--      applicati. Così correggere un errore in un listino del passato non
--      muove i mesi già chiusi.
--
--   3) IL CARBURANTE È UN DATO MENSILE, NON UNA VOCE DI LISTINO. Cambia ogni
--      mese e arriva per email. A luglio 2026: 13,00% GLS, 24,30% TNT e FedEx,
--      sullo stesso mese e sulla stessa merce. Trading Post non applica
--      carburante: l'11,0% che compare su ogni sua riga è l'addizionale di
--      gestione contrattuale, ed è modellato come supplemento, non qui.
--
-- Nessuna RLS aperta: coerente con il lockdown della 062, l'accesso passa solo
-- dalle route server con service_role.
--
-- > DOPO L'APPLICAZIONE, SU OGNI AMBIENTE, SERVE UN PASSO IN PIÙ.
-- > Le route leggono lo schema `vettori` (e `bi`) via PostgREST, che espone
-- > soltanto gli schemi elencati in `pgrst.db_schemas`. Finché non ci sono, ogni
-- > query torna vuota senza errore visibile e le pagine dicono «nessun vettore
-- > configurato». Da eseguire una volta per database:
-- >
-- >   ALTER ROLE authenticator
-- >     SET pgrst.db_schemas = 'public, preventivatore, service, vettori, bi';
-- >   NOTIFY pgrst, 'reload config';
-- >
-- > Non apre niente: senza GRANT e con RLS attiva, `anon` e `authenticated`
-- > continuano a non vedere una riga. Esporre lo schema serve solo a far
-- > funzionare il client service_role delle route.
-- > Su Supabase gestito lo stesso elenco sta in Settings → API → Exposed
-- > schemas: modificarlo di lì sovrascrive questo comando, e viceversa.

-- ============================================================
-- 0) SCHEMA E PORTALE
-- ============================================================
CREATE SCHEMA IF NOT EXISTS vettori;

COMMENT ON SCHEMA vettori IS
  'Portale Controllo Vettori: listini, spedizioni attese, fatture dei vettori e riconciliazione.';

INSERT INTO portali (nome, slug, descrizione, icona, colore, ordine, is_attivo)
VALUES (
  'Controllo Vettori',
  'vettori',
  'Controllo delle fatture dei vettori, riaddebito al cliente e simulazione della spedizione',
  'Truck',
  '#00a1be',
  4,
  true
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO permessi_portale (portale_id, ruolo, can_access, can_export, can_approve)
SELECT id, 'admin', true, true, true
FROM portali WHERE slug = 'vettori'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 1) RUOLI FUNZIONALI
-- ============================================================
-- Stessa separazione del Preventivatore (vedi 039 e il commento in 064): il
-- livello di portale stabilisce SE vedi il portale, il ruolo funzionale stabilisce
-- COSA puoi farci. Senza questa distinzione il magazzino, per registrare tre
-- misure, dovrebbe ricevere i permessi pieni sul portale — e vedrebbe gli importi.
CREATE TABLE IF NOT EXISTS vettori.ruoli_funzionali (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  nome        text NOT NULL,
  descrizione text,
  colore      text,
  ordine      int  NOT NULL DEFAULT 0,
  is_attivo   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO vettori.ruoli_funzionali (slug, nome, descrizione, colore, ordine) VALUES
  ('amministrazione', 'Amministrazione',
   'Carica le fatture, decide le anomalie, aggiorna i listini e chiude i mesi', '#00a1be', 10),
  ('magazzino',       'Magazzino',
   'Registra peso, colli e misure all''arrivo della merce. Non vede importi né listini', '#f59e0b', 20),
  ('direzione',       'Direzione',
   'Consulta cruscotto e simulazioni. Nessuna modifica a listini o controlli chiusi', '#64748b', 30)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS vettori.utente_ruoli_funzionali (
  utente_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ruolo_id     uuid NOT NULL REFERENCES vettori.ruoli_funzionali(id) ON DELETE CASCADE,
  assegnato_da uuid REFERENCES auth.users(id),
  assegnato_il timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (utente_id, ruolo_id)
);

-- ============================================================
-- 2) ANAGRAFICA VETTORI
-- ============================================================
CREATE TABLE IF NOT EXISTS vettori.vettori (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codice                 text UNIQUE NOT NULL,          -- slug stabile: 'gls', 'tnt', 'fedex', 'trading_post'
  nome                   text NOT NULL,
  ragione_sociale        text,
  partita_iva            text,
  -- Modello di calcolo
  modello_tariffa        text NOT NULL DEFAULT 'scaglioni'
                           CHECK (modello_tariffa IN ('scaglioni', 'quintale')),
  divisore_volumetrico   numeric(10,2) NOT NULL DEFAULT 300,   -- kg per metro cubo
  peso_minimo_tassabile  numeric(10,3) NOT NULL DEFAULT 0,     -- Trading Post: 3 kg
  arrotondamento_kg      numeric(10,3) NOT NULL DEFAULT 0,     -- 0 = nessun arrotondamento
  arrotondamento_da_kg   numeric(10,3) NOT NULL DEFAULT 0,     -- l'arrotondamento vale solo da questo peso in su
  -- Operatività
  attivo                 boolean NOT NULL DEFAULT true,
  a_nostro_carico        boolean NOT NULL DEFAULT true,        -- false = vettore del cliente, non ci fattura
  email_anomalie         text,
  note                   text,
  creato_il              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE vettori.vettori IS
  'I vettori con cui si lavora. `a_nostro_carico=false` per quelli che compaiono sulle bolle ma li paga il cliente (BRT, DHL, Trascoop...): servono al cruscotto, non al controllo fatture.';
COMMENT ON COLUMN vettori.vettori.divisore_volumetrico IS
  'Kg per metro cubo con cui si converte il volume in peso tassabile. Verificato sui contratti: 300 per GLS e Trading Post, 250 per TNT e FedEx.';
COMMENT ON COLUMN vettori.vettori.modello_tariffa IS
  '`scaglioni` = importo fisso per fascia di peso (GLS, TNT, FedEx). `quintale` = tariffa al quintale scalare (Trading Post).';
COMMENT ON COLUMN vettori.vettori.peso_minimo_tassabile IS
  'Peso sotto il quale si fattura comunque questo peso. Trading Post: 3 kg da contratto — sulla fattura una spedizione da 1 kg risulta infatti tassata 3.';
COMMENT ON COLUMN vettori.vettori.arrotondamento_da_kg IS
  'Soglia oltre la quale scatta l''arrotondamento. Trading Post arrotonda ai 100 kg ma solo sopra il quintale («scalare ai 100,0 - oltre ai 100,0 Kg»): in fattura 170 kg e 172,8 kg diventano entrambi 200, mentre 57 kg restano 57. Senza questa soglia un collo da 5 kg verrebbe tassato 100.';

-- Mappatura verso i codici del gestionale ------------------------------------
-- L'anagrafica del gestionale contiene 26 voci nel campo vettore, ma otto di
-- queste NON sono vettori: sono regole di scelta scritte a mano nel nome, del
-- tipo «GLS fino a 30 Kg-FEDEX oltre» o «TNT per scatole - GLS per pallet».
-- Vanno conservate perché sono, letteralmente, il simulatore fatto a mano da
-- chi spedisce: sono l'input di partenza della pagina di simulazione.
CREATE TABLE IF NOT EXISTS vettori.codici_gestionale (
  codice_gestionale text PRIMARY KEY,                    -- es. 'VT010005'
  ragione_sociale   text NOT NULL,                       -- come scritta nel gestionale
  vettore_id        uuid REFERENCES vettori.vettori(id) ON DELETE SET NULL,
  tipo              text NOT NULL DEFAULT 'da_mappare'
                      CHECK (tipo IN ('vettore', 'regola', 'non_nostro', 'da_mappare')),
  regola_testo      text,                                -- il testo della regola, se tipo='regola'
  note              text,
  aggiornato_il     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE vettori.codici_gestionale IS
  'Mappa i codici vettore del gestionale sui vettori del portale. `tipo=regola` sono voci che non sono vettori ma criteri di scelta scritti a mano nel nome; `non_nostro` sono i vettori dei clienti in porto assegnato.';

-- ============================================================
-- 3) ZONE TARIFFARIE
-- ============================================================
-- GLS ha tre zone (Italia, Calabria-Sicilia, Sardegna); Trading Post copre solo
-- Emilia, Lombardia e Piemonte. La copertura serve sia al controllo (quale
-- tariffa applicare) sia al simulatore (chi NON può andarci, e perché).
CREATE TABLE IF NOT EXISTS vettori.zone (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vettore_id  uuid NOT NULL REFERENCES vettori.vettori(id) ON DELETE CASCADE,
  codice      text NOT NULL,                    -- 'IT', 'CAL_SIC', 'SARD', 'ER_LOM_PIE'
  nome        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,   -- zona di ripiego per le province non elencate
  ordine      int NOT NULL DEFAULT 0,
  UNIQUE (vettore_id, codice)
);

-- Una sola zona di ripiego per vettore: se ce ne fossero due, la scelta della
-- tariffa dipenderebbe dall'ordine di lettura, cioè da niente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_zone_default_per_vettore
  ON vettori.zone (vettore_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS vettori.zone_province (
  zona_id   uuid NOT NULL REFERENCES vettori.zone(id) ON DELETE CASCADE,
  provincia char(2) NOT NULL,
  PRIMARY KEY (zona_id, provincia)
);

COMMENT ON TABLE vettori.zone_province IS
  'Province coperte da ciascuna zona. Una provincia assente da tutte le zone di un vettore, e senza zona di ripiego, significa che quel vettore non ci arriva: il simulatore lo dice invece di calcolare un prezzo inventato.';

-- ============================================================
-- 4) LISTINI — LA VERSIONE È LA COSA IMPORTANTE
-- ============================================================
CREATE TABLE IF NOT EXISTS vettori.listini (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vettore_id  uuid NOT NULL REFERENCES vettori.vettori(id) ON DELETE CASCADE,
  etichetta   text NOT NULL,                    -- 'Tariffe 2026 dal 19 gennaio'
  valido_dal  date NOT NULL,
  valido_al   date,                             -- NULL = versione in vigore
  origine     text,                             -- 'Politiche Commerciali GLS 2026', numero di protocollo, ecc.
  note        text,
  creato_da   uuid REFERENCES public.utenti(id) ON DELETE SET NULL,
  creato_il   timestamptz NOT NULL DEFAULT now(),
  CHECK (valido_al IS NULL OR valido_al >= valido_dal)
);

-- Un solo listino aperto per vettore. È l'invariante che conta: senza questo,
-- «quale listino vale oggi» diventa ambiguo e il costo atteso cambia a seconda
-- di come il database ordina le righe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_listini_aperto_per_vettore
  ON vettori.listini (vettore_id) WHERE valido_al IS NULL;

CREATE INDEX IF NOT EXISTS idx_listini_vettore_periodo
  ON vettori.listini (vettore_id, valido_dal DESC);

COMMENT ON TABLE vettori.listini IS
  'Una versione di listino di un vettore. Aggiornare le tariffe crea una versione nuova: la precedente si chiude il giorno prima della decorrenza e resta consultabile, perché serve a ricalcolare i mesi che copriva.';

-- Fasce di peso ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vettori.listini_fasce (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listino_id  uuid NOT NULL REFERENCES vettori.listini(id) ON DELETE CASCADE,
  zona_id     uuid NOT NULL REFERENCES vettori.zone(id)    ON DELETE CASCADE,
  peso_da     numeric(10,3) NOT NULL DEFAULT 0,
  peso_a      numeric(10,3),                    -- NULL = fascia finale, "oltre"
  importo     numeric(12,4) NOT NULL,
  tipo        text NOT NULL DEFAULT 'fisso'
                CHECK (tipo IN ('fisso', 'quintale')),
  -- Fascia "oltre": GLS aggiunge 18,10 € ogni 50 kg, TNT 16,06 € ogni 50 kg.
  scatto_kg      numeric(10,3),
  scatto_importo numeric(12,4),
  ordine      int NOT NULL DEFAULT 0,
  CHECK (peso_a IS NULL OR peso_a > peso_da),
  CHECK ((scatto_kg IS NULL) = (scatto_importo IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_fasce_listino_zona
  ON vettori.listini_fasce (listino_id, zona_id, peso_da);

COMMENT ON COLUMN vettori.listini_fasce.tipo IS
  '`fisso` = l''importo è il nolo della fascia. `quintale` = l''importo è al quintale e va moltiplicato per il peso (modello Trading Post).';
COMMENT ON COLUMN vettori.listini_fasce.scatto_kg IS
  'Solo sulla fascia finale: ogni quanti kg si aggiunge `scatto_importo`. GLS: 50 kg / 18,10 €.';

-- Supplementi -----------------------------------------------------------------
-- Sono la ragione principale per cui il costo atteso dell'Excel non torna: il
-- foglio calcola il nolo e basta, la fattura contiene anche handling, autostrade,
-- oversized, assicurazione, ZTL, etichettatura manuale e triangolazione.
CREATE TABLE IF NOT EXISTS vettori.listini_supplementi (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listino_id    uuid NOT NULL REFERENCES vettori.listini(id) ON DELETE CASCADE,
  codice        text NOT NULL,                  -- 'handling', 'autostrade', 'oversized', 'assicurazione', ...
  nome          text NOT NULL,
  tipo_calcolo  text NOT NULL
                  CHECK (tipo_calcolo IN ('fisso_spedizione', 'per_kg', 'per_collo', 'percentuale_nolo')),
  valore        numeric(12,4) NOT NULL,
  -- Fa parte della base su cui si calcolano adeguamento e carburante?
  --
  -- Non è un dettaglio contabile: cambia il totale. Sulla fattura GLS di luglio
  -- 2026 la voce "Nolo 1.013,22" comprende già handling, autostrade, oversized,
  -- safety & energy e bollettazione manuale; l'adeguamento ISTAT (73,03) si
  -- calcola su quella cifra, e il carburante sul risultato — 1.086,25 x 13% =
  -- 141,21, che è esattamente l'importo stampato. L'assicurazione (11,00) resta
  -- invece fuori da entrambi. Modellarla dentro gonfierebbe il costo atteso di
  -- un paio di punti su ogni spedizione assicurata.
  base_nolo     boolean NOT NULL DEFAULT true,
  -- Quando si applica: 'sempre' oppure solo se la spedizione ha quella condizione
  condizione    text NOT NULL DEFAULT 'sempre',
  importo_minimo numeric(12,4),
  importo_massimo numeric(12,4),
  soglia_kg_da  numeric(10,3),                  -- assicurazione GLS: solo oltre 10 kg
  soglia_kg_a   numeric(10,3),
  ordine        int NOT NULL DEFAULT 0,
  UNIQUE (listino_id, codice)
);

COMMENT ON COLUMN vettori.listini_supplementi.condizione IS
  'Slug della condizione della spedizione che attiva il supplemento: sempre, bancale, non_sovrapponibile, oversized, ztl, etichetta_manuale, triangolazione, fuori_provincia, giacenza. Le condizioni vere di una spedizione le registra il magazzino (migration 088).';

-- Adeguamento contrattuale (ISTAT) --------------------------------------------
-- Solo GLS lo applica. Sulla fattura di luglio 2026 vale 13,97 € per l'anno in
-- corso e 59,06 € di arretrati degli anni precedenti: il 7,2% del nolo, cioè da
-- solo più dello scarto mediano che l'Excel considerava "anomalia".
CREATE TABLE IF NOT EXISTS vettori.adeguamenti (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vettore_id  uuid NOT NULL REFERENCES vettori.vettori(id) ON DELETE CASCADE,
  valido_dal  date NOT NULL,
  valido_al   date,
  percentuale numeric(8,5) NOT NULL,            -- 0.072 = 7,2% sul nolo
  descrizione text,
  creato_il   timestamptz NOT NULL DEFAULT now(),
  CHECK (valido_al IS NULL OR valido_al >= valido_dal)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_adeguamento_aperto_per_vettore
  ON vettori.adeguamenti (vettore_id) WHERE valido_al IS NULL;

COMMENT ON TABLE vettori.adeguamenti IS
  'Adeguamento contrattuale applicato sul nolo, in percentuale. GLS lo espone in fattura distinto tra anno corrente e arretrati: qui si registra la percentuale complessiva effettivamente applicata, che è quella con cui si ricalcola.';

-- Carburante ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vettori.carburante (
  vettore_id  uuid NOT NULL REFERENCES vettori.vettori(id) ON DELETE CASCADE,
  anno        int  NOT NULL,
  mese        int  NOT NULL CHECK (mese BETWEEN 1 AND 12),
  percentuale numeric(8,5) NOT NULL,            -- 0.243 = 24,30%
  fonte       text NOT NULL DEFAULT 'comunicazione'
                CHECK (fonte IN ('comunicazione', 'letto_da_fattura', 'stimato')),
  note        text,
  inserito_da uuid REFERENCES public.utenti(id) ON DELETE SET NULL,
  inserito_il timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vettore_id, anno, mese)
);

COMMENT ON TABLE vettori.carburante IS
  'Percentuale di supplemento carburante per vettore e mese. Cambia ogni mese e arriva per email. Luglio 2026: 6,51% Trading Post, 13,00% GLS, 24,30% TNT e FedEx — stesso mese, stessa merce.';
COMMENT ON COLUMN vettori.carburante.fonte IS
  '`comunicazione` = inserita dalla mail del vettore. `letto_da_fattura` = ricavata dalla fattura in assenza della comunicazione: il controllo la usa ma non può più verificare la percentuale, e lo segnala.';

-- ============================================================
-- 5) RIADDEBITO AL CLIENTE
-- ============================================================
-- Il porto della bolla dice chi paga, ed è compilato sul 100% dei documenti:
-- «franco addebito fattura» = paghiamo noi e riaddebitiamo, «porto assegnato»
-- = paga il cliente al vettore. Nel 2026 la regola risulta rispettata in 230
-- casi su 233, con 11 bolle a nostro carico rimaste senza alcun riaddebito.
CREATE TABLE IF NOT EXISTS vettori.riaddebito_scaglioni (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valido_dal date NOT NULL,
  valido_al  date,
  peso_da    numeric(10,3) NOT NULL DEFAULT 0,
  peso_a     numeric(10,3),
  importo    numeric(12,4),                     -- NULL = "chiedere offerta"
  nota       text,
  CHECK (peso_a IS NULL OR peso_a > peso_da),
  CHECK (valido_al IS NULL OR valido_al >= valido_dal)
);

CREATE INDEX IF NOT EXISTS idx_riaddebito_periodo
  ON vettori.riaddebito_scaglioni (valido_dal DESC, peso_da);

COMMENT ON TABLE vettori.riaddebito_scaglioni IS
  'Quanto si addebita al cliente per fascia di peso. ATTENZIONE: sui 233 addebiti del 2026 la tabella è applicata alla lettera in meno della metà dei casi (69 spedizioni a 16,00 € contro 53 a 16,50). Chi addebita arrotonda: lo scostamento va esposto come informazione, non come anomalia, altrimenti si rifà l''errore del foglio di calcolo di partenza.';

-- Condizioni particolari per singolo cliente ----------------------------------
CREATE TABLE IF NOT EXISTS vettori.riaddebito_clienti (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codice_cliente text NOT NULL,                 -- codice soggetto del gestionale
  ragione_sociale text,
  valido_dal     date NOT NULL,
  valido_al      date,
  modalita       text NOT NULL DEFAULT 'tabella'
                   CHECK (modalita IN ('tabella', 'importo_fisso', 'nessun_addebito')),
  importo        numeric(12,4),
  nota           text,
  CHECK (valido_al IS NULL OR valido_al >= valido_dal),
  CHECK (modalita <> 'importo_fisso' OR importo IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_riaddebito_clienti_codice
  ON vettori.riaddebito_clienti (codice_cliente, valido_dal DESC);

COMMENT ON TABLE vettori.riaddebito_clienti IS
  'Accordi di trasporto diversi dalla tabella generale. `nessun_addebito` è il caso del cliente a cui il trasporto è compreso: senza questa riga il controllo lo segnalerebbe ogni mese come riaddebito mancante.';

-- ============================================================
-- 6) SICUREZZA
-- ============================================================
-- RLS su tutto, nessun GRANT ad authenticated o anon: come per il Preventivatore
-- dopo la 062, la lettura passa solo dalle route server con service_role, che
-- verificano prima livello di portale e ruolo funzionale.
ALTER TABLE vettori.ruoli_funzionali        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.utente_ruoli_funzionali ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.vettori                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.codici_gestionale       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.zone                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.zone_province           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.listini                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.listini_fasce           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.listini_supplementi     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.adeguamenti             ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.carburante              ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.riaddebito_scaglioni    ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.riaddebito_clienti      ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA vettori TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA vettori TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA vettori
  GRANT ALL PRIVILEGES ON TABLES TO service_role;

-- ============================================================
-- 7) RPC CONTESTO PERMESSI
-- ============================================================
-- Un solo round-trip per autorizzare una richiesta, come `get_preventivatore_context`
-- della 064. SECURITY DEFINER perché `authenticated` non ha grant su vettori.*.
CREATE OR REPLACE FUNCTION public.get_vettori_context(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'livello', public.get_portale_livello(p_user_id, 'vettori'),
    'ruoli', coalesce(
      (SELECT array_agg(rf.slug ORDER BY rf.slug)
         FROM vettori.utente_ruoli_funzionali urf
         JOIN vettori.ruoli_funzionali rf ON rf.id = urf.ruolo_id
        WHERE urf.utente_id = p_user_id),
      array[]::text[]
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_vettori_context(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_vettori_context(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
