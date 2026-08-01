-- ============================================================================
-- BACKUP PREFLIGHT — pipeline BI Cruscotto articoli
-- Generato: 2026-08-01
-- Progetto Supabase: sowzewrfkoxernnvhzgg
--
-- SCOPO: stato PRECEDENTE degli oggetti toccati dalla migrazione. Serve al
-- ROLLBACK. NON eseguire integralmente: contiene definizioni da ripristinare
-- solo se si torna indietro.
--
-- Stato quantitativo pre-migrazione:
--   preventivatore.prodotti           = 24.573 righe
--   preventivatore.prodotti_giacenze  = 26.171 righe
--   preventivatore.movimenti_giacenza = 9 righe   (NON vuota: 9 movimenti reali,
--                                                  ultimo 31/05/2026)
--   public.bi_documenti_raw           = 127.384 righe
--   dimensione database               = 150 MB / 500 MB
-- ============================================================================


-- ============================================================================
-- 1) FUNZIONE DA MODIFICARE: movimenta_giacenza (versione ORIGINALE)
--    La migrazione la declassa a "solo log": qui resta la versione che
--    AGGIORNA le quantità, da ripristinare in caso di rollback.
-- ============================================================================
CREATE OR REPLACE FUNCTION preventivatore.movimenta_giacenza(
  p_codice text, p_magazzino text, p_delta numeric,
  p_causale text DEFAULT NULL::text, p_rif_attivita uuid DEFAULT NULL::uuid)
 RETURNS TABLE(codice text, magazzino text, esistenza numeric, disponibilita numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'preventivatore', 'service', 'public'
AS $function$
declare
  v_disp numeric;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Utente non autenticato' using errcode = '28000';
  end if;

  v_role := service.current_user_ruolo();

  if v_role not in ('superadmin', 'amministratore')
     and not exists (
       select 1
       from service.operatori_abilitati oa
       where oa.utente_id = auth.uid()
     ) then
    raise exception 'Utente non autorizzato alla movimentazione magazzino' using errcode = '42501';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'Delta non valido' using errcode = '22023';
  end if;

  select g.disponibilita
    into v_disp
  from preventivatore.prodotti_giacenze g
  where g.codice = p_codice
    and g.magazzino = p_magazzino
  for update;

  if not found then
    raise exception 'Giacenza inesistente: % / %', p_codice, p_magazzino using errcode = 'P0002';
  end if;

  if p_delta < 0 and (v_disp + p_delta) < 0 then
    raise exception 'Disponibilita insufficiente: % disponibili, richiesti %', v_disp, -p_delta using errcode = 'P0001';
  end if;

  update preventivatore.prodotti_giacenze g
     set esistenza = g.esistenza + p_delta,
         disponibilita = g.disponibilita + p_delta,
         aggiornato_il = now()
   where g.codice = p_codice
     and g.magazzino = p_magazzino;

  insert into preventivatore.movimenti_giacenza(codice, magazzino, delta, causale, rif_attivita)
  values (p_codice, p_magazzino, p_delta, p_causale, p_rif_attivita);

  return query
    select g.codice, g.magazzino, g.esistenza, g.disponibilita
    from preventivatore.prodotti_giacenze g
    where g.codice = p_codice
      and g.magazzino = p_magazzino;
end;
$function$;


-- ============================================================================
-- 2) CONTRATTI DA NON ROMPERE (invariati dalla migrazione, qui per riferimento)
-- ============================================================================

-- preventivatore.articoli_service  (esposta anche ad anon — contratto sics_service)
CREATE OR REPLACE VIEW preventivatore.articoli_service AS
  SELECT g.codice, g.magazzino, g.esistenza, g.disponibilita,
         p.descrizione, p.uc, p.categoria, p.gruppo, p.cat_merc, p.ult_costo,
         COALESCE(p.attivo, true) AS attivo
    FROM preventivatore.prodotti_giacenze g
    JOIN preventivatore.prodotti p ON p.codice = g.codice;

-- preventivatore.v_prodotti_completo  (usata da search_prodotti / builder)
CREATE OR REPLACE VIEW preventivatore.v_prodotti_completo AS
  SELECT p.codice, p.codice_norm, p.descrizione, p.uc, p.categoria, p.gruppo,
         p.cat_merc, p.reparto_codice, p.reparto_desc, p.ult_costo,
         p.data_ult_costo, p.attivo, p.aggiornato_il,
         COALESCE(g.esistenza_totale, 0::numeric)     AS esistenza_totale,
         COALESCE(g.disponibilita_totale, 0::numeric) AS disponibilita_totale,
         COALESCE(g.n_magazzini, 0)                   AS n_magazzini,
         g.magazzini
    FROM preventivatore.prodotti p
    LEFT JOIN LATERAL (
      SELECT (sum(gg.esistenza))::numeric(14,3)     AS esistenza_totale,
             (sum(gg.disponibilita))::numeric(14,3) AS disponibilita_totale,
             (count(*))::integer                    AS n_magazzini,
             array_agg(gg.magazzino ORDER BY gg.magazzino) AS magazzini
        FROM preventivatore.prodotti_giacenze gg
       WHERE gg.codice = p.codice) g ON true;

-- NOTA: preventivatore.clienti_service e preventivatore.search_prodotti NON
-- vengono toccate dalla migrazione (definizioni omesse per brevità: ricavabili
-- con pg_get_viewdef / pg_get_functiondef).


-- ============================================================================
-- 3) POLICY RLS PRE-ESISTENTI (oggetti coinvolti)
-- ============================================================================
-- preventivatore.prodotti            | prodotti_select            | SELECT | public          | auth.role() = 'authenticated'
-- preventivatore.prodotti_giacenze   | prodotti_giacenze_select   | SELECT | public          | auth.role() = 'authenticated'
-- preventivatore.prodotti_import_log | prodotti_import_log_select | SELECT | public          | auth.role() = 'authenticated'
-- preventivatore.movimenti_giacenza  | movimenti_giacenza_read    | SELECT | authenticated   | ruolo in (superadmin, amministratore)
-- public.bi_documenti_raw            | powerbi_current_documents  | SELECT | powerbi_reader  | run corrente (bi_runs.status='current')
-- public.bi_aggregati_mensili        | powerbi_current_aggregates | SELECT | powerbi_reader  | current_daily_run_id
-- public.bi_forecast_righe/cv        | powerbi_current_forecast_* | SELECT | powerbi_reader  | current_forecast_run_id
-- public.bi_runs                     | powerbi_current_runs       | SELECT | powerbi_reader  | status='current'
-- public.bi_publication_state        | powerbi_publication_state  | SELECT | powerbi_reader  | singleton


-- ============================================================================
-- 4) GRANT NON-service_role PRE-ESISTENTI (i service_role sono uniformi)
-- ============================================================================
-- anon          -> preventivatore.articoli_service   : SELECT
-- authenticated -> preventivatore.articoli_service   : SELECT
-- authenticated -> preventivatore.clienti_service    : SELECT
-- authenticated -> preventivatore.movimenti_giacenza : SELECT
-- powerbi_reader-> public.bi_* (21 viste/tabelle)    : SELECT
-- powerbi_reader NON ha alcun grant sullo schema preventivatore (lockdown 062).


-- ============================================================================
-- 5) INDICI PRE-ESISTENTI sulle tabelle riusate (NON rimuovere: GIN trigram
--    servono all'autocomplete del builder)
-- ============================================================================
-- CREATE UNIQUE INDEX prodotti_pkey ON preventivatore.prodotti USING btree (codice);
-- CREATE INDEX idx_prodotti_descr_trgm ON preventivatore.prodotti USING gin (descrizione gin_trgm_ops);   -- 9,2 MB
-- CREATE INDEX idx_prodotti_codice_trgm ON preventivatore.prodotti USING gin (codice gin_trgm_ops);        -- 5,8 MB
-- CREATE INDEX idx_prodotti_codice_norm ON preventivatore.prodotti USING btree (codice_norm);
-- CREATE INDEX idx_prodotti_categoria ON preventivatore.prodotti USING btree (categoria);
-- CREATE INDEX idx_prodotti_gruppo ON preventivatore.prodotti USING btree (gruppo);
-- CREATE INDEX idx_prodotti_attivo ON preventivatore.prodotti USING btree (attivo) WHERE attivo;
-- CREATE INDEX prodotti_fornitore_codice ON preventivatore.prodotti USING btree (fornitore_codice) WHERE fornitore_codice IS NOT NULL;
-- CREATE INDEX prodotti_fornitore_lower ON preventivatore.prodotti USING btree (lower(fornitore)) WHERE fornitore IS NOT NULL;
-- CREATE UNIQUE INDEX prodotti_giacenze_pkey ON preventivatore.prodotti_giacenze USING btree (codice, magazzino);
-- CREATE INDEX idx_prodotti_giacenze_codice ON preventivatore.prodotti_giacenze USING btree (codice);
-- CREATE INDEX idx_prodotti_giacenze_mag ON preventivatore.prodotti_giacenze USING btree (magazzino);
-- CREATE INDEX giacenze_mag_esistenza_idx ON preventivatore.prodotti_giacenze USING btree (magazzino, esistenza);
-- CREATE INDEX giacenze_mag_disponibilita_idx ON preventivatore.prodotti_giacenze USING btree (magazzino, disponibilita);


-- ============================================================================
-- 6) CATENA DI ATTIVAZIONE PRE-ESISTENTE (da NON alterare)
-- ============================================================================
-- bi_activate_complete_run(run_id, include_forecast)
--   └─> bi_activate_run(run_id)        -- LEGACY, valida ESATTAMENTE 7 dataset
--                                      -- in bi_documenti_raw. È ancora VIVA.
--   └─> bi_activate_daily(run_id)      -- valida 5 dataset aggregati mensili,
--                                      -- sposta current_daily_run_id
--   └─> bi_activate_forecast(run_id)   -- valida 4 dataset forecast,
--       (solo se include_forecast)     -- sposta current_forecast_run_id
--
-- CONSEGUENZA: il Cruscotto NON può entrare in bi_documenti_raw (il CHECK
-- elenca i 7 dataset e bi_activate_run fallirebbe). Serve un flusso separato
-- con bi_activate_cruscotto + current_cruscotto_run_id, modellato su
-- bi_activate_daily.
