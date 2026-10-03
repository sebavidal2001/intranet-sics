-- 131_portale_campagne.sql
--
-- PORTALE CAMPAGNE MARKETING — Fase 1: campagne, pubblico, invii al cliente.
--
-- Contesto:
--   Il back office spedisce ai clienti una busta di materiale promozionale
--   (una "campagna": C_01 SICS istituzionale, C_02 ZECA ZETEK, C_03 AIGNEP...).
--   Oggi il registro e' un Excel con una colonna per campagna e il controllo
--   su Impresa e' manuale. Questa migration crea il modello che lo sostituisce.
--   Spec completa: Vault -> Moduli/Campagne Marketing - Spec.md.
--
-- Cosa c'e' qui (Fase 1) e cosa NO:
--   SI   campagne, pubblico standard salvato, destinatari per campagna,
--        invii (uno per cliente+campagna) con stato e date registrate dal
--        programma, suggerimento della prossima campagna per un cliente
--        (campagne_assegnabili), riepilogo e selezione per categoria.
--   NO   il collegamento con Impresa (riga DOCUMENTAZIONE, DDT, anomalie,
--        inversione di ordini). Arriva con la migration di Fase 2, insieme
--        al dataset notturno. Qui `da_spedire` esiste come stato ma in Fase 1
--        nessuno ci porta un invio da solo.
--
-- Scelte che contano:
--
--   1) "DA PREPARARE" NON E' UNO STATO MEMORIZZATO. E' l'assenza di un invio:
--      il programma lo deriva (campagna_suggerita). Memorizzarlo vorrebbe dire
--      una riga per ogni cliente e ogni campagna, e tenerla allineata.
--
--   2) UN INVIO PER CLIENTE E CAMPAGNA, UNA CAMPAGNA PER ORDINE. Sono due
--      indici unici parziali (ignorano gli invii annullati). NON esiste un
--      vincolo "una campagna in corso per cliente": un cliente con due ordini
--      aperti puo' avere due buste in corso, ed e' proprio il caso in cui le
--      campagne vanno riallineate alle date di consegna (Fase 2).
--
--   3) PRECEDENZA = `ordine` DELLA CAMPAGNA. Gli invii si assegnano dalla
--      campagna piu' vecchia alla piu' recente. `ordine` e' un identity, non
--      una data: le tre campagne storiche nascono nello stesso istante.
--
--   4) REFERENTE E NUMERO D'ORDINE OBBLIGATORI per gli invii creati dal
--      programma, tranne la consegna al banco (niente ordine) e le righe
--      importate dall'Excel (che non li hanno mai registrati).
--
--   5) LA DATA DI CONSEGNA E' LA DATA DEL DDT. Verificato il 03/10/2026 su 415
--      invii: la data nelle celle dell'Excel coincide con la data di
--      registrazione del DDT in 403 casi. `data_consegna` e' quindi un date;
--      l'istante in cui il programma l'ha registrata sta a parte.
--
--   6) IL PUBBLICO E' UNA FOTOGRAFIA. Il pubblico standard e' una regola
--      salvata (agente + categoria commerciale + clienti extra); applicarlo a
--      una campagna COPIA i codici in `destinatari`. Cambiare la regola dopo
--      non tocca le campagne gia' create. I rivenditori (Cat Attivita che
--      inizia per RIV) sono esclusi sempre, non e' un'opzione.
--
-- I clienti non si duplicano: `v_clienti` legge preventivatore.clienti_master
-- scegliendo UNA riga per codice (quella senza destinazione). Le destinazioni
-- non servono alle campagne.
--
-- Nessuna RLS aperta: come dopo la 062, l'accesso passa solo dalle route server
-- con service_role, che verificano livello di portale e ruolo funzionale.
--
-- > DOPO L'APPLICAZIONE, SU OGNI AMBIENTE, SERVE UN PASSO IN PIU.
-- > Lo schema `campagne` va aggiunto a pgrst.db_schemas, altrimenti ogni query
-- > torna vuota senza errore. Confrontare prima con l'elenco in uso (sulla VM
-- > comanda il ruolo, non il file di configurazione):
-- >
-- >   ALTER ROLE authenticator
-- >     SET pgrst.db_schemas = 'public, preventivatore, service, bi, bi_direzionale, vettori, campagne';
-- >   NOTIFY pgrst, 'reload config';
-- >   NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 0) SCHEMA E PORTALE
-- ============================================================
CREATE SCHEMA IF NOT EXISTS campagne;

COMMENT ON SCHEMA campagne IS
  'Portale Campagne Marketing: campagne, pubblico, invii ai clienti e (Fase 2) controllo su Impresa.';

INSERT INTO portali (nome, slug, descrizione, icona, colore, ordine, is_attivo)
VALUES (
  'Campagne Marketing',
  'campagne',
  'Invio del materiale promozionale ai clienti: campagne, buste da preparare e stato di consegna',
  'Target',
  '#00a1be',
  5,
  true
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO permessi_portale (portale_id, ruolo, can_access, can_export, can_approve)
SELECT id, 'admin', true, true, true
FROM portali WHERE slug = 'campagne'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 1) RUOLO FUNZIONALE
-- ============================================================
-- Il livello di portale dice SE vedi il portale; il ruolo funzionale dice COSA
-- ci fai. L'admin del portale gestisce campagne e pubblico e vede l'Analisi
-- (Fase 3); il `backoffice` lavora sui clienti e sugli invii, e non vede ne'
-- configurazione ne' analisi. Admin e superadmin bypassano sempre.
CREATE TABLE IF NOT EXISTS campagne.ruoli_funzionali (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  nome        text NOT NULL,
  descrizione text,
  colore      text,
  ordine      int  NOT NULL DEFAULT 0,
  is_attivo   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO campagne.ruoli_funzionali (slug, nome, descrizione, colore, ordine) VALUES
  ('backoffice', 'Back office',
   'Cerca il cliente, assegna la campagna suggerita, inserisce referente e ordine, segna la consegna al banco', '#f59e0b', 10)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS campagne.utente_ruoli_funzionali (
  utente_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ruolo_id     uuid NOT NULL REFERENCES campagne.ruoli_funzionali(id) ON DELETE CASCADE,
  assegnato_da uuid REFERENCES auth.users(id),
  assegnato_il timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (utente_id, ruolo_id)
);

-- ============================================================
-- 2) CLIENTI (una riga per codice, niente destinazioni)
-- ============================================================
-- clienti_master ha una riga per (codice, destinazione). Qui si tiene quella
-- senza destinazione, o in sua assenza la piu' vecchia. `rivenditore` e' la
-- regola di esclusione: nell'Excel la scritta RIVENDITORE e' battuta a mano e
-- su 346 rivenditori reali ne marca 334; la categoria e' l'unica fonte affidabile.
CREATE OR REPLACE VIEW campagne.v_clienti AS
SELECT DISTINCT ON (cm.codice_cliente)
       cm.codice_cliente,
       cm.ragione_sociale,
       cm.cat_commerciale,
       cm.cat_attivita,
       cm.cat_zona,
       cm.agente_nome,
       (coalesce(cm.cat_attivita, '') ~* '^\s*riv') AS rivenditore
FROM preventivatore.clienti_master cm
WHERE cm.attivo
ORDER BY cm.codice_cliente, (cm.id_destinazione IS NOT NULL), cm.created_at;

COMMENT ON VIEW campagne.v_clienti IS
  'Un cliente per codice, senza destinazioni. rivenditore = Cat Attivita che inizia per RIV (RIVEND-..., RIV. RIVENDITORI).';

-- ============================================================
-- 3) CAMPAGNE
-- ============================================================
CREATE TABLE IF NOT EXISTS campagne.campagne (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codice               text NOT NULL UNIQUE
                         CHECK (codice ~ '^[A-Za-z0-9_-]+$'),
  nome                 text NOT NULL CHECK (btrim(nome) <> ''),
  note                 text,
  -- Articolo della riga che l'operatrice inserisce nell'ordine in Impresa.
  -- Fino alle campagne con articolo dedicato e' 'DOCUMENTAZIONE' per tutte e
  -- la campagna si riconosce dal testo della riga (`testo_riconoscimento`).
  -- Regola per il futuro: un articolo dedicato per campagna.
  articolo_codice      text NOT NULL CHECK (btrim(articolo_codice) <> ''),
  -- Parole chiave cercate (senza maiuscole/minuscole, ignorando i caratteri
  -- non stampabili) nella descrizione della riga d'ordine. Transitorio.
  testo_riconoscimento text[] NOT NULL DEFAULT '{}',
  -- Per l'Analisi (Fase 3): marchio e articoli promossi dalla campagna.
  marchio              text,
  articoli_promossi    text[] NOT NULL DEFAULT '{}',
  -- sospesa = non attiva e riattivabile. terminata e' definitiva.
  stato                text NOT NULL DEFAULT 'sospesa'
                         CHECK (stato IN ('attiva', 'sospesa', 'terminata')),
  -- Precedenza di assegnazione: la campagna con `ordine` minore va per prima.
  ordine               integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  stato_cambiato_il    timestamptz NOT NULL DEFAULT now(),
  stato_cambiato_da    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION campagne.trg_campagne_stato()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND NEW.stato IS DISTINCT FROM OLD.stato THEN
    -- PT409: PostgREST lo restituisce come 409 con il messaggio, senza il
    -- ritentativo che riserva ai codici di serializzazione.
    IF OLD.stato = 'terminata' THEN
      RAISE EXCEPTION 'Una campagna terminata non si puo'' riattivare o sospendere'
        USING ERRCODE = 'PT409';
    END IF;
    NEW.stato_cambiato_il := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campagne_stato ON campagne.campagne;
CREATE TRIGGER campagne_stato
  BEFORE INSERT OR UPDATE ON campagne.campagne
  FOR EACH ROW EXECUTE FUNCTION campagne.trg_campagne_stato();

-- Le tre campagne 2026 dell'Excel. Nascono SOSPESE di proposito: vanno prima
-- caricati lo storico e i destinatari dall'Excel, altrimenti il programma
-- suggerirebbe a un cliente una campagna che ha gia' ricevuto. Poi l'admin le
-- attiva. `marchio` e `articoli_promossi` restano da compilare prima dell'Analisi.
-- L'ordine dei VALUES e' l'ordine di assegnazione dell'identity: 1, 2, 3.
INSERT INTO campagne.campagne (codice, nome, note, articolo_codice, testo_riconoscimento) VALUES
  ('C_01_26', 'CP SICS',
   'Campagna istituzionale di presentazione SICS.',
   'DOCUMENTAZIONE', ARRAY['SICS']),
  ('C_02_26', 'ZECA ZETEK',
   NULL,
   'DOCUMENTAZIONE', ARRAY['ZECA', 'ZETEK']),
  ('C_03_26', 'AIGNEP',
   'Campagna mirata: nell''Excel ha circa 60 destinatari, non tutto il pubblico standard.',
   'DOCUMENTAZIONE', ARRAY['AIGNEP'])
ON CONFLICT (codice) DO NOTHING;

-- ============================================================
-- 4) PUBBLICO STANDARD E DESTINATARI
-- ============================================================
-- Una sola riga (id boolean vincolato a true): lo scenario che l'admin configura
-- la prima volta e che viene riproposto a ogni nuova campagna.
CREATE TABLE IF NOT EXISTS campagne.pubblico_standard (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Tutti i clienti di questi agenti, con una di queste categorie commerciali...
  agenti                text[] NOT NULL DEFAULT ARRAY['AIRFLUID'],
  categorie_commerciali text[] NOT NULL DEFAULT ARRAY['Attivo'],
  -- ...piu' questi codici scelti a mano (es. una selezione dei clienti di
  -- VALERIA BATTELANI o DANIELE BONI). I rivenditori restano esclusi.
  clienti_extra         text[] NOT NULL DEFAULT '{}',
  aggiornato_il         timestamptz NOT NULL DEFAULT now(),
  aggiornato_da         uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO campagne.pubblico_standard (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS campagne.destinatari (
  campagna_id    uuid NOT NULL REFERENCES campagne.campagne(id) ON DELETE CASCADE,
  codice_cliente text NOT NULL CHECK (codice_cliente = btrim(codice_cliente) AND codice_cliente <> ''),
  aggiunto_il    timestamptz NOT NULL DEFAULT now(),
  aggiunto_da    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (campagna_id, codice_cliente)
);

CREATE INDEX IF NOT EXISTS destinatari_cliente_idx ON campagne.destinatari (codice_cliente);

-- I codici dei clienti che rientrano nel pubblico standard di oggi. Una sola
-- definizione, usata sia per l'anteprima ("questa regola raggiunge N clienti")
-- sia per applicarla a una campagna: due copie della regola divergono.
CREATE OR REPLACE FUNCTION campagne.pubblico_standard_codici()
RETURNS SETOF text
LANGUAGE sql
STABLE
AS $$
  SELECT c.codice_cliente
    FROM campagne.v_clienti c
    CROSS JOIN campagne.pubblico_standard p
   WHERE NOT c.rivenditore
     AND (
       c.codice_cliente = ANY (p.clienti_extra)
       OR (
         EXISTS (SELECT 1 FROM unnest(p.agenti) a
                  WHERE upper(btrim(a)) = upper(btrim(c.agente_nome)))
         AND EXISTS (SELECT 1 FROM unnest(p.categorie_commerciali) k
                      WHERE upper(btrim(k)) = upper(btrim(c.cat_commerciale)))
       )
     );
$$;

-- Quanti clienti raggiunge il pubblico standard di oggi (anteprima nella pagina
-- di configurazione). Una funzione e non una lettura dei codici: PostgREST
-- tronca le risposte a 1.000 righe e il pubblico ne ha qualche migliaio.
CREATE OR REPLACE FUNCTION campagne.pubblico_standard_conteggio()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::int FROM campagne.pubblico_standard_codici();
$$;

-- Copia nei destinatari della campagna i clienti che rientrano nel pubblico
-- standard. Non rimuove nessuno e non tocca chi c'e' gia': per una campagna
-- mirata si usa direttamente `destinatari`. Restituisce quanti ne ha aggiunti.
CREATE OR REPLACE FUNCTION campagne.applica_pubblico_standard(p_campagna_id uuid, p_utente_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_aggiunti integer;
BEGIN
  INSERT INTO campagne.destinatari (campagna_id, codice_cliente, aggiunto_da)
  SELECT p_campagna_id, codice, p_utente_id
    FROM campagne.pubblico_standard_codici() AS codice
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_aggiunti = ROW_COUNT;
  RETURN v_aggiunti;
END;
$$;

-- ============================================================
-- 5) INVII
-- ============================================================
-- Stati memorizzati (il rosso "da preparare" e' derivato, vedi in testa):
--   preparata         giallo   referente e ordine inseriti, busta preparata
--   da_spedire        arancio  riga DOCUMENTAZIONE trovata nell'ordine (Fase 2)
--   consegnata        verde    DDT emesso: data_consegna = data del DDT
--   consegnata_banco  verde    ritirata dal cliente, confermata a mano
--   annullata                  assegnata per errore: libera cliente e ordine
CREATE TABLE IF NOT EXISTS campagne.invii (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campagna_id            uuid NOT NULL REFERENCES campagne.campagne(id),
  codice_cliente         text NOT NULL CHECK (codice_cliente = btrim(codice_cliente) AND codice_cliente <> ''),
  -- Fotografia del nome al momento dell'assegnazione: lo storico deve restare
  -- leggibile anche se il cliente viene rinominato.
  ragione_sociale        text NOT NULL,
  stato                  text NOT NULL
                           CHECK (stato IN ('preparata', 'da_spedire', 'consegnata', 'consegnata_banco', 'annullata')),
  referente              text CHECK (referente IS NULL OR referente = btrim(referente)),
  -- Numero e anno dell'ordine cliente in Impresa (profili OC, OCA, OCB). Il
  -- numero da solo non e' unico fra i registri: l'ordine e' identificato da
  -- (cliente, anno, numero), perche' un ordine appartiene a un solo cliente.
  ordine_numero          text CHECK (ordine_numero IS NULL OR ordine_numero = btrim(ordine_numero)),
  ordine_anno            smallint CHECK (ordine_anno IS NULL OR ordine_anno BETWEEN 2000 AND 2100),
  -- Registrati dal programma, mai digitati.
  assegnata_il           timestamptz NOT NULL DEFAULT now(),
  assegnata_da           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  data_consegna          date,
  consegna_registrata_il timestamptz,
  consegna_registrata_da uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  fonte_consegna         text CHECK (fonte_consegna IN ('ddt', 'banco', 'manuale', 'import_excel')),
  origine                text NOT NULL DEFAULT 'app' CHECK (origine IN ('app', 'import_excel')),
  note                   text,
  annullata_il           timestamptz,
  annullata_da           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  motivo_annullo         text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- Referente e ordine sono obbligatori: lo dice il flusso. Fanno eccezione il
  -- banco (non c'e' ordine) e lo storico importato, che non li ha mai avuti.
  CONSTRAINT invii_referente_ordine_obbligatori CHECK (
    stato IN ('annullata', 'consegnata_banco')
    OR origine = 'import_excel'
    OR (nullif(referente, '') IS NOT NULL
        AND nullif(ordine_numero, '') IS NOT NULL
        AND ordine_anno IS NOT NULL)
  ),
  -- Una consegna senza data (o una data senza consegna) e' un dato rotto.
  CONSTRAINT invii_data_consegna_coerente CHECK (
    stato = 'annullata'
    OR ((stato IN ('consegnata', 'consegnata_banco')) = (data_consegna IS NOT NULL))
  ),
  CONSTRAINT invii_annullo_coerente CHECK (
    (stato = 'annullata') = (annullata_il IS NOT NULL)
  )
);

-- Un cliente riceve una campagna una volta sola...
CREATE UNIQUE INDEX IF NOT EXISTS invii_campagna_cliente_uq
  ON campagne.invii (campagna_id, codice_cliente)
  WHERE stato <> 'annullata';

-- ...e una sola campagna puo' viaggiare su un dato ordine.
CREATE UNIQUE INDEX IF NOT EXISTS invii_ordine_uq
  ON campagne.invii (codice_cliente, ordine_anno, ordine_numero)
  WHERE stato <> 'annullata' AND ordine_numero IS NOT NULL;

CREATE INDEX IF NOT EXISTS invii_cliente_idx ON campagne.invii (codice_cliente);
CREATE INDEX IF NOT EXISTS invii_aperti_idx  ON campagne.invii (stato)
  WHERE stato IN ('preparata', 'da_spedire');

CREATE OR REPLACE FUNCTION campagne.trg_invii_aggiorna()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  -- L'istante in cui il programma vede la consegna si scrive da solo, cosi'
  -- nessuna route puo' dimenticarlo.
  IF NEW.stato IN ('consegnata', 'consegnata_banco')
     AND NEW.consegna_registrata_il IS NULL THEN
    NEW.consegna_registrata_il := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invii_aggiorna ON campagne.invii;
CREATE TRIGGER invii_aggiorna
  BEFORE INSERT OR UPDATE ON campagne.invii
  FOR EACH ROW EXECUTE FUNCTION campagne.trg_invii_aggiorna();

-- ============================================================
-- 6) SUGGERIMENTO DELLA PROSSIMA CAMPAGNA E ALTRE LETTURE
-- ============================================================
-- Le campagne che si possono assegnare a un cliente: attive, di cui e'
-- destinatario, che non ha ancora ricevuto (un invio annullato non conta), dalla
-- piu' vecchia (`ordine` minimo). La prima e' quella SUGGERITA. Una campagna
-- sospesa o terminata non compare mai. Vuoto = "non c'e' nulla da fare".
CREATE OR REPLACE FUNCTION campagne.campagne_assegnabili(p_codice_cliente text)
RETURNS SETOF campagne.campagne
LANGUAGE sql
STABLE
AS $$
  SELECT c.*
    FROM campagne.campagne c
    JOIN campagne.destinatari d
      ON d.campagna_id = c.id AND d.codice_cliente = btrim(p_codice_cliente)
   WHERE c.stato = 'attiva'
     AND NOT EXISTS (
       SELECT 1 FROM campagne.invii i
        WHERE i.campagna_id = c.id
          AND i.codice_cliente = d.codice_cliente
          AND i.stato <> 'annullata')
   ORDER BY c.ordine;
$$;

CREATE OR REPLACE FUNCTION campagne.campagna_suggerita(p_codice_cliente text)
RETURNS SETOF campagne.campagne
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM campagne.campagne_assegnabili(p_codice_cliente) LIMIT 1;
$$;

-- Riepilogo per la pagina delle campagne: destinatari e invii per stato.
CREATE OR REPLACE VIEW campagne.v_campagne_riepilogo AS
SELECT c.id,
       (SELECT count(*) FROM campagne.destinatari d WHERE d.campagna_id = c.id)::int AS destinatari,
       count(i.id) FILTER (WHERE i.stato = 'preparata')::int        AS preparate,
       count(i.id) FILTER (WHERE i.stato = 'da_spedire')::int       AS da_spedire,
       count(i.id) FILTER (WHERE i.stato = 'consegnata')::int       AS consegnate,
       count(i.id) FILTER (WHERE i.stato = 'consegnata_banco')::int AS consegnate_banco
  FROM campagne.campagne c
  LEFT JOIN campagne.invii i ON i.campagna_id = c.id
 GROUP BY c.id;

-- Selezione dei destinatari di una campagna mirata: prima la categoria, poi i
-- clienti. I rivenditori non compaiono mai (sono esclusi sempre). `ha_invio`
-- dice se il cliente ha gia' un invio per questa campagna: non va tolto.
CREATE OR REPLACE FUNCTION campagne.categorie_clienti(p_campagna_id uuid)
RETURNS TABLE (categoria text, totale integer, selezionati integer)
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(nullif(btrim(c.cat_attivita), ''), '(senza categoria)') AS categoria,
         count(*)::int AS totale,
         count(d.codice_cliente)::int AS selezionati
    FROM campagne.v_clienti c
    LEFT JOIN campagne.destinatari d
      ON d.campagna_id = p_campagna_id AND d.codice_cliente = c.codice_cliente
   WHERE NOT c.rivenditore
   GROUP BY 1
   ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION campagne.clienti_categoria(p_campagna_id uuid, p_categoria text)
RETURNS TABLE (
  codice_cliente text, ragione_sociale text, agente_nome text, cat_commerciale text,
  selezionato boolean, ha_invio boolean
)
LANGUAGE sql
STABLE
AS $$
  SELECT c.codice_cliente, c.ragione_sociale, c.agente_nome, c.cat_commerciale,
         (d.codice_cliente IS NOT NULL) AS selezionato,
         EXISTS (SELECT 1 FROM campagne.invii i
                  WHERE i.campagna_id = p_campagna_id
                    AND i.codice_cliente = c.codice_cliente
                    AND i.stato <> 'annullata') AS ha_invio
    FROM campagne.v_clienti c
    LEFT JOIN campagne.destinatari d
      ON d.campagna_id = p_campagna_id AND d.codice_cliente = c.codice_cliente
   WHERE NOT c.rivenditore
     AND coalesce(nullif(btrim(c.cat_attivita), ''), '(senza categoria)') = p_categoria
   ORDER BY c.ragione_sociale;
$$;

-- ============================================================
-- 7) SICUREZZA
-- ============================================================
ALTER TABLE campagne.ruoli_funzionali        ENABLE ROW LEVEL SECURITY;
ALTER TABLE campagne.utente_ruoli_funzionali ENABLE ROW LEVEL SECURITY;
ALTER TABLE campagne.campagne                ENABLE ROW LEVEL SECURITY;
ALTER TABLE campagne.pubblico_standard       ENABLE ROW LEVEL SECURITY;
ALTER TABLE campagne.destinatari             ENABLE ROW LEVEL SECURITY;
ALTER TABLE campagne.invii                   ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA campagne TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA campagne TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA campagne TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA campagne
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA campagne
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ============================================================
-- 8) RPC CONTESTO PERMESSI
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_campagne_context(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'livello', public.get_portale_livello(p_user_id, 'campagne'),
    'ruoli', coalesce(
      (SELECT array_agg(rf.slug ORDER BY rf.slug)
         FROM campagne.utente_ruoli_funzionali urf
         JOIN campagne.ruoli_funzionali rf ON rf.id = urf.ruolo_id
        WHERE urf.utente_id = p_user_id),
      array[]::text[]
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_campagne_context(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_campagne_context(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
