-- 132_campagne_controllo_impresa.sql
--
-- PORTALE CAMPAGNE MARKETING — Fase 2: il collegamento con Impresa.
--
-- ============================================================================
-- NESSUNA NUOVA ESTRAZIONE: SI RICICLANO QUELLE NOTTURNE
-- ============================================================================
-- Verificato il 03/10/2026 sul database della VM. Le tre estrazioni commerciali
-- che gia' girano ogni notte contengono tutto cio' che serve al controllo:
--
--   public.bi_ordinato     475 righe DOCUMENTAZIONE (OC 319, OCB 156), dal 2025
--   public.bi_portafoglio   29 righe DOCUMENTAZIONE = ESATTAMENTE le 29 righe
--                           ancora aperte misurate direttamente su Impresa.
--                           "Evasa" = assente dal portafoglio.
--   public.bi_consegnato   449 righe DOCUMENTAZIONE sui DDT (profilo BC)
--
-- Cosa NON c'e': il campo di derivazione riga d'ordine -> riga DDT
-- (`riga_documento.id_riga_doc_provenienza`) e l'utente che ha inserito la riga.
-- Le colonne `id_riga_documento` e `codice_utente_creatore` esistono in
-- `bi_documenti_raw` ma sono VUOTE per i dataset ordinato/consegnato (popolate
-- solo per i preventivi). La derivazione si ricostruisce: abbinando ogni riga
-- evasa al DDT dello stesso cliente per data di consegna confermata, sul 2026
-- si ottengono 425 abbinamenti giusti su 425 verificabili contro il campo vero
-- di Impresa. L'abbinamento e' marcato `ddt_metodo = 'euristico'`: se in futuro
-- arrivera' la derivazione vera, diventera' 'provenienza' senza altro da cambiare.
-- L'estrazione dedicata (derivazione + utente) resta una rifinitura possibile,
-- non una condizione.
--
-- Cadenza: i dati sono quelli del run notturno, quindi il controllo e'
-- notturno (dopo il caricamento delle 01:30). Un ordine inserito oggi si vede
-- domani: fino ad allora l'invio e' "in attesa dei dati", NON un'anomalia.
--
-- Cosa c'e' qui:
--   - colonne di collegamento su campagne.invii (ordine, riga vista, DDT);
--   - campagne.anomalie e campagne.controlli (storico delle esecuzioni);
--   - funzioni di LETTURA sui dati Impresa gia' caricati (impresa_*);
--   - campagne.da_preparare, campagne.ordini_aperti_cliente;
--   - campagne.riassegna_ordini: lo scambio di ordini fra invii, atomico.
-- La logica del controllo (stati, anomalie, inversioni) sta in TypeScript, dove
-- si prova: src/lib/portali/campagne/controllo.ts.
--
-- Dipendenze: 131 e le viste public.bi_* (create dal loader della pipeline sulla
-- VM). Dove non esistono la migration si ferma con un messaggio che lo spiega.
--
-- Rollback: DROP TABLE campagne.controlli, campagne.anomalie; poi le funzioni
-- elencate in fondo e le colonne aggiunte a campagne.invii.

-- ============================================================
-- 0) PRECONDIZIONE
-- ============================================================
DO $$
BEGIN
  IF to_regclass('campagne.invii') IS NULL THEN
    RAISE EXCEPTION 'Manca campagne.invii: applicare prima la migration 131.';
  END IF;
  IF to_regclass('public.bi_ordinato') IS NULL
     OR to_regclass('public.bi_portafoglio') IS NULL
     OR to_regclass('public.bi_consegnato') IS NULL
     OR to_regclass('public.bi_runs') IS NULL THEN
    RAISE EXCEPTION
      'Mancano le viste public.bi_ordinato / bi_portafoglio / bi_consegnato o la tabella bi_runs. '
      'Sono create dal loader della pipeline BI sulla VM (non da una migration): su un database '
      'che non le ha (per esempio il Supabase di sviluppo vuoto) questa migration non si applica.';
  END IF;
END $$;

-- ============================================================
-- 1) COLONNE DI COLLEGAMENTO SU invii
-- ============================================================
ALTER TABLE campagne.invii
  -- L'ordine in Impresa, risolto dal controllo: il profilo non lo digita
  -- nessuno (l'operatrice scrive solo numero e anno).
  ADD COLUMN IF NOT EXISTS ordine_profilo        text
    CHECK (ordine_profilo IS NULL OR ordine_profilo IN ('OC', 'OCA', 'OCB')),
  ADD COLUMN IF NOT EXISTS ordine_data           date,
  -- Data di consegna della RIGA documentazione (confermata, altrimenti richiesta):
  -- e' quella che decide l'ordine di partenza delle buste.
  ADD COLUMN IF NOT EXISTS ordine_data_consegna  date,
  ADD COLUMN IF NOT EXISTS riga_vista_il         timestamptz,
  ADD COLUMN IF NOT EXISTS ddt_numero            text,
  ADD COLUMN IF NOT EXISTS ddt_metodo            text
    CHECK (ddt_metodo IS NULL OR ddt_metodo IN ('provenienza', 'euristico')),
  ADD COLUMN IF NOT EXISTS ultimo_controllo_il   timestamptz,
  -- Cosa ha trovato l'ultimo controllo, per spiegarlo a chi guarda la scheda.
  ADD COLUMN IF NOT EXISTS controllo_esito       text
    CHECK (controllo_esito IS NULL OR controllo_esito IN (
      'attesa_dati', 'riga_trovata', 'consegnata', 'ordine_non_trovato',
      'riga_mancante', 'campagna_incoerente', 'evasa_senza_ddt'));

COMMENT ON COLUMN campagne.invii.ddt_metodo IS
  'Come e'' stato abbinato il DDT: provenienza = campo di derivazione di Impresa; euristico = stesso cliente, per data di consegna confermata (425/425 sul 2026).';

-- ============================================================
-- 2) ANOMALIE
-- ============================================================
-- Visibili anche al back office: sono loro che le correggono. Il controllo le
-- ricalcola ogni notte: una che non si ripresenta si chiude da sola
-- (`risolta_con = 'automatica'`), una che l'operatrice sceglie di lasciare
-- resta `ignorata` finche' la condizione dura, e non si riapre ogni notte.
CREATE TABLE IF NOT EXISTS campagne.anomalie (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo             text NOT NULL CHECK (tipo IN (
                     'ordine_non_trovato', 'riga_mancante', 'campagna_incoerente',
                     'riga_senza_campagna', 'evasa_senza_ddt',
                     'documentazione_senza_busta', 'ordine_invertito')),
  gravita          text NOT NULL DEFAULT 'errore' CHECK (gravita IN ('errore', 'avviso')),
  -- Identita' logica: stessa condizione = stessa chiave, cosi' una notte dopo
  -- l'altra non si accumulano copie.
  chiave           text NOT NULL,
  codice_cliente   text NOT NULL,
  ragione_sociale  text,
  invio_id         uuid REFERENCES campagne.invii(id) ON DELETE SET NULL,
  campagna_id      uuid REFERENCES campagne.campagne(id) ON DELETE SET NULL,
  ordine_numero    text,
  ordine_anno      smallint,
  dettaglio        jsonb NOT NULL DEFAULT '{}'::jsonb,
  stato            text NOT NULL DEFAULT 'aperta' CHECK (stato IN ('aperta', 'risolta', 'ignorata')),
  aperta_il        timestamptz NOT NULL DEFAULT now(),
  ultima_vista_il  timestamptz NOT NULL DEFAULT now(),
  risolta_il       timestamptz,
  risolta_con      text CHECK (risolta_con IS NULL OR risolta_con IN ('automatica', 'manuale', 'scambio')),
  risolta_da       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nota             text,
  CONSTRAINT anomalie_chiusa_coerente CHECK ((stato = 'aperta') = (risolta_il IS NULL) OR stato = 'ignorata')
);

-- Una sola anomalia viva (aperta o ignorata) per condizione.
CREATE UNIQUE INDEX IF NOT EXISTS anomalie_viva_uq
  ON campagne.anomalie (chiave) WHERE stato IN ('aperta', 'ignorata');
CREATE INDEX IF NOT EXISTS anomalie_cliente_idx ON campagne.anomalie (codice_cliente);
CREATE INDEX IF NOT EXISTS anomalie_aperte_idx  ON campagne.anomalie (tipo) WHERE stato = 'aperta';

-- ============================================================
-- 3) STORICO DEI CONTROLLI
-- ============================================================
-- Una riga per esecuzione. Serve a due cose: dire all'operatrice "dati di Impresa
-- del 03/10 alle 01:31, controllati alle 03:30", e impedire che due esecuzioni
-- girino insieme (la seconda trova la prima `in_corso`).
CREATE TABLE IF NOT EXISTS campagne.controlli (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origine            text NOT NULL CHECK (origine IN ('notturno', 'manuale')),
  eseguito_da        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  iniziato_il        timestamptz NOT NULL DEFAULT now(),
  finito_il          timestamptz,
  esito              text NOT NULL DEFAULT 'in_corso' CHECK (esito IN ('in_corso', 'ok', 'errore')),
  -- L'istante dei dati di Impresa su cui ha lavorato (run corrente della pipeline).
  dati_del           timestamptz,
  invii_controllati  integer,
  invii_aggiornati   integer,
  anomalie_aperte    integer,
  anomalie_risolte   integer,
  errore             text
);
CREATE INDEX IF NOT EXISTS controlli_recenti_idx ON campagne.controlli (iniziato_il DESC);

-- ============================================================
-- 4) LETTURA DEI DATI IMPRESA GIA' CARICATI
-- ============================================================
-- Il numero dell'ordine e' un testo ("1117"): chi lo digita puo' aggiungere zeri
-- iniziali. Si confronta sempre normalizzato, qui e in TypeScript (stessa regola).
CREATE OR REPLACE FUNCTION campagne.norm_numero(p_numero text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN btrim(coalesce(p_numero, '')) ~ '^0+$' THEN '0'
              ELSE regexp_replace(btrim(coalesce(p_numero, '')), '^0+(?=[0-9])', '') END;
$$;

-- Quando sono stati estratti i dati che il controllo sta guardando. E' l'istante
-- di fine estrazione su Impresa (ora locale, senza fuso) letto come ora di Roma.
CREATE OR REPLACE FUNCTION campagne.impresa_aggiornato_il()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce((source_completed_at AT TIME ZONE 'Europe/Rome'), activated_at)
    FROM public.bi_runs
   WHERE status = 'current'
   ORDER BY activated_at DESC NULLS LAST
   LIMIT 1;
$$;

-- Le righe d'ordine con gli articoli delle campagne, con il flag "aperta": una
-- riga e' aperta se compare ancora nel portafoglio. Senza id di riga si abbinano
-- per (profilo, numero, cliente, articolo, data, descrizione): per la riga
-- DOCUMENTAZIONE e' univoco (verificato: 29 righe aperte su 29).
CREATE OR REPLACE FUNCTION campagne.impresa_righe(
  p_articoli text[],
  p_clienti text[] DEFAULT NULL,
  p_solo_aperte boolean DEFAULT false
)
RETURNS TABLE (
  profilo text, numero text, anno integer, cliente text, nome_cliente text,
  data_doc date, richiesta date, confermata date,
  articolo text, descrizione text, aperta boolean
)
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM (
    SELECT o."Profilo Documento",
           btrim(o."Numero Doc."),
           extract(year FROM o."Data Documento")::integer,
           o."Codice Cliente",
           o."Nome Cliente",
           o."Data Documento"::date,
           o."Data Consegna Richiesta"::date,
           o."Data Consegna Confermata"::date,
           o."Codice Articolo",
           o."Descrizione articolo",
           EXISTS (
             SELECT 1 FROM public.bi_portafoglio p
              WHERE p."Profilo Documento" = o."Profilo Documento"
                AND p."Numero Doc."       = o."Numero Doc."
                AND p."Codice Cliente"    = o."Codice Cliente"
                AND p."Codice Articolo"   = o."Codice Articolo"
                AND p."Data Documento"    = o."Data Documento"
                AND p."Descrizione articolo" IS NOT DISTINCT FROM o."Descrizione articolo"
           ) AS aperta
      FROM public.bi_ordinato o
     WHERE o."Profilo Documento" IN ('OC', 'OCA', 'OCB')
       AND o."Codice Articolo" = ANY (p_articoli)
       AND (p_clienti IS NULL OR o."Codice Cliente" = ANY (p_clienti))
  ) x
  WHERE NOT p_solo_aperte OR x.aperta;
$$;

-- Le testate degli ordini dei clienti: serve a distinguere "l'ordine non esiste"
-- (numero sbagliato) da "l'ordine esiste ma manca la riga DOCUMENTAZIONE".
CREATE OR REPLACE FUNCTION campagne.impresa_ordini(p_clienti text[])
RETURNS TABLE (
  profilo text, numero text, anno integer, cliente text,
  data_doc date, consegna_prevista date, aperto boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH aperti AS (
    SELECT DISTINCT p."Profilo Documento" AS profilo, btrim(p."Numero Doc.") AS numero,
           extract(year FROM p."Data Documento")::integer AS anno, p."Codice Cliente" AS cliente
      FROM public.bi_portafoglio p
     WHERE p."Codice Cliente" = ANY (p_clienti)
  )
  SELECT o."Profilo Documento",
         btrim(o."Numero Doc."),
         extract(year FROM o."Data Documento")::integer,
         o."Codice Cliente",
         min(o."Data Documento")::date,
         min(coalesce(o."Data Consegna Confermata", o."Data Consegna Richiesta"))::date,
         bool_or(a.cliente IS NOT NULL)
    FROM public.bi_ordinato o
    LEFT JOIN aperti a
      ON a.profilo = o."Profilo Documento" AND a.numero = btrim(o."Numero Doc.")
     AND a.anno = extract(year FROM o."Data Documento")::integer
     AND a.cliente = o."Codice Cliente"
   WHERE o."Profilo Documento" IN ('OC', 'OCA', 'OCB')
     AND o."Codice Cliente" = ANY (p_clienti)
   GROUP BY 1, 2, 3, 4;
$$;

-- Le righe dei DDT di vendita (BC) con gli articoli delle campagne.
CREATE OR REPLACE FUNCTION campagne.impresa_ddt(p_articoli text[], p_clienti text[] DEFAULT NULL)
RETURNS TABLE (numero text, cliente text, data_doc date, articolo text, descrizione text)
LANGUAGE sql
STABLE
AS $$
  SELECT btrim(c."Numero Doc."), c."Codice Cliente", c."Data Documento"::date,
         c."Codice Articolo", c."Descrizione articolo"
    FROM public.bi_consegnato c
   WHERE c."Profilo Documento" = 'BC'
     AND c."Codice Articolo" = ANY (p_articoli)
     AND (p_clienti IS NULL OR c."Codice Cliente" = ANY (p_clienti));
$$;

-- ============================================================
-- 5) "DA PREPARARE" E ORDINI APERTI DI UN CLIENTE
-- ============================================================
-- Il rosso della dashboard: un ordine aperto, recente, di un cliente a cui si puo'
-- ancora assegnare una campagna, che non ha ne' un invio collegato ne' gia' la
-- riga DOCUMENTAZIONE (quest'ultimo e' un'anomalia, non un "da preparare").
-- Solo OC e OCA: gli ordini banco (OCB) si chiudono col pulsante BANCO.
-- La finestra (14 giorni) e' un parametro: e' una scelta, non un dato.
CREATE OR REPLACE FUNCTION campagne.da_preparare(p_giorni integer DEFAULT 14)
RETURNS TABLE (
  codice_cliente text, ragione_sociale text, profilo text,
  ordine_numero text, ordine_anno integer, data_ordine date, consegna_prevista date,
  campagna_id uuid, campagna_codice text, campagna_nome text
)
LANGUAGE sql
STABLE
AS $$
  WITH aperti AS (
    SELECT p."Codice Cliente" AS cli,
           max(p."Nome Cliente") AS nome,
           p."Profilo Documento" AS prof,
           btrim(p."Numero Doc.") AS num,
           extract(year FROM p."Data Documento")::integer AS anno,
           min(p."Data Documento")::date AS data_ord,
           min(coalesce(p."Data Consegna Confermata", p."Data Consegna Richiesta"))::date AS cons
      FROM public.bi_portafoglio p
     WHERE p."Profilo Documento" IN ('OC', 'OCA')
       AND p."Data Documento" >= current_date - p_giorni
     GROUP BY 1, 3, 4, 5
  )
  SELECT a.cli, a.nome, a.prof, a.num, a.anno, a.data_ord, a.cons, s.id, s.codice, s.nome
    FROM aperti a
    CROSS JOIN LATERAL campagne.campagna_suggerita(a.cli) s
   WHERE NOT EXISTS (
           SELECT 1 FROM campagne.invii i
            WHERE i.codice_cliente = a.cli
              AND i.ordine_anno = a.anno
              AND campagne.norm_numero(i.ordine_numero) = campagne.norm_numero(a.num)
              AND i.stato <> 'annullata')
     AND NOT EXISTS (
           SELECT 1
             FROM public.bi_ordinato o
             JOIN campagne.campagne c ON c.articolo_codice = o."Codice Articolo"
            WHERE o."Codice Cliente" = a.cli
              AND o."Profilo Documento" = a.prof
              AND btrim(o."Numero Doc.") = a.num
              AND extract(year FROM o."Data Documento")::integer = a.anno)
   ORDER BY a.data_ord DESC, a.nome;
$$;

-- Gli ordini aperti di un cliente, per la scheda: l'operatrice sceglie quello a
-- cui allegare la busta invece di digitarne il numero (e sbagliarlo).
CREATE OR REPLACE FUNCTION campagne.ordini_aperti_cliente(p_cliente text, p_giorni integer DEFAULT 120)
RETURNS TABLE (
  profilo text, numero text, anno integer, data_ordine date, consegna_prevista date,
  invio_id uuid, ha_documentazione boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH aperti AS (
    SELECT p."Profilo Documento" AS prof,
           btrim(p."Numero Doc.") AS num,
           extract(year FROM p."Data Documento")::integer AS anno,
           min(p."Data Documento")::date AS data_ord,
           min(coalesce(p."Data Consegna Confermata", p."Data Consegna Richiesta"))::date AS cons
      FROM public.bi_portafoglio p
     WHERE p."Codice Cliente" = btrim(p_cliente)
       AND p."Profilo Documento" IN ('OC', 'OCA', 'OCB')
       AND p."Data Documento" >= current_date - p_giorni
     GROUP BY 1, 2, 3
  )
  SELECT a.prof, a.num, a.anno, a.data_ord, a.cons, i.id,
         EXISTS (
           SELECT 1 FROM public.bi_ordinato o
             JOIN campagne.campagne c ON c.articolo_codice = o."Codice Articolo"
            WHERE o."Codice Cliente" = btrim(p_cliente)
              AND o."Profilo Documento" = a.prof
              AND btrim(o."Numero Doc.") = a.num
              AND extract(year FROM o."Data Documento")::integer = a.anno)
    FROM aperti a
    LEFT JOIN campagne.invii i
      ON i.codice_cliente = btrim(p_cliente)
     AND i.ordine_anno = a.anno
     AND campagne.norm_numero(i.ordine_numero) = campagne.norm_numero(a.num)
     AND i.stato <> 'annullata'
   ORDER BY a.data_ord DESC, a.num;
$$;

-- ============================================================
-- 6) SCAMBIO DI ORDINI FRA INVII
-- ============================================================
-- Il caso: C1 e' sull'ordine che parte il 31/12, C2 su quello che parte l'01/11.
-- Le campagne devono arrivare in sequenza, quindi si scambiano gli ordini. Lo
-- scambio e' ATOMICO e passa da un valore provvisorio, perche' l'indice unico
-- su (cliente, anno, numero) rifiuterebbe uno scambio diretto: le righe si
-- controllano una per volta. Si scambiano SOLO i riferimenti all'ordine; il
-- referente resta con la busta.
--
-- p_mosse: [{ "invio_id", "ordine_numero", "ordine_anno", "ordine_profilo",
--             "ordine_data", "ordine_data_consegna" }, ...]
CREATE OR REPLACE FUNCTION campagne.riassegna_ordini(p_mosse jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_mossa jsonb;
  v_n integer := 0;
  v_cliente text;
  v_clienti text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(p_mosse) <> 'array' OR jsonb_array_length(p_mosse) < 2 THEN
    RAISE EXCEPTION 'Uno scambio coinvolge almeno due invii' USING ERRCODE = 'PT400';
  END IF;

  -- Tutti invii dello stesso cliente, ancora in lavorazione.
  FOR v_mossa IN SELECT * FROM jsonb_array_elements(p_mosse) LOOP
    SELECT codice_cliente INTO v_cliente
      FROM campagne.invii
     WHERE id = (v_mossa ->> 'invio_id')::uuid AND stato IN ('preparata', 'da_spedire')
     FOR UPDATE;
    IF v_cliente IS NULL THEN
      RAISE EXCEPTION 'Un invio dello scambio non esiste piu'' o e'' gia'' stato spedito' USING ERRCODE = 'PT409';
    END IF;
    v_clienti := v_clienti || v_cliente;
  END LOOP;
  IF (SELECT count(DISTINCT c) FROM unnest(v_clienti) c) <> 1 THEN
    RAISE EXCEPTION 'Lo scambio deve riguardare un solo cliente' USING ERRCODE = 'PT400';
  END IF;

  -- 1) valore provvisorio, 2) valori finali.
  UPDATE campagne.invii
     SET ordine_numero = 'tmp-' || id::text
   WHERE id IN (SELECT (m ->> 'invio_id')::uuid FROM jsonb_array_elements(p_mosse) m);

  FOR v_mossa IN SELECT * FROM jsonb_array_elements(p_mosse) LOOP
    UPDATE campagne.invii
       SET ordine_numero        = v_mossa ->> 'ordine_numero',
           ordine_anno          = (v_mossa ->> 'ordine_anno')::smallint,
           ordine_profilo       = nullif(v_mossa ->> 'ordine_profilo', ''),
           ordine_data          = nullif(v_mossa ->> 'ordine_data', '')::date,
           ordine_data_consegna = nullif(v_mossa ->> 'ordine_data_consegna', '')::date
     WHERE id = (v_mossa ->> 'invio_id')::uuid;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ============================================================
-- 7) SICUREZZA
-- ============================================================
ALTER TABLE campagne.anomalie  ENABLE ROW LEVEL SECURITY;
ALTER TABLE campagne.controlli ENABLE ROW LEVEL SECURITY;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA campagne TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA campagne TO service_role;

NOTIFY pgrst, 'reload schema';
