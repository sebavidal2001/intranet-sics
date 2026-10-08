-- 148_bi_sistemi_in_costruito.sql
--
-- La business unit SISTEMI non deve comparire: le sue righe vanno in COSTRUITO.
--
-- ============================================================================
-- COSA SUCCEDEVA
-- ============================================================================
-- Il gestionale ha tre gruppi merceologici (COMPONENTI, IMPIANTI, SISTEMI), ma
-- l'azienda ragiona per quattro business unit: SISTEMI si spezza in COSTRUITO e
-- STRUTTURE secondo la CATEGORIA della riga. La regola sta in otto viste
-- `public.bi_*` ed era:
--
--     CASE WHEN upper(trim(categoria)) IN ('COSTRUITO','STRUTTURE')
--          THEN upper(trim(categoria))
--          ELSE gruppo_descrizione END
--
-- Le righe di SISTEMI con una categoria diversa da quelle due (all'08/10/2026:
-- 36 righe di fatturato, 30 di ordinato, 28 di consegnato, 5 di preventivi — tutte
-- «ADDEBITO CONCORDATO PER PROCEDURA D'URGENZA», circa 1.400 euro in tutto)
-- restavano SISTEMI, una quinta business unit che non esiste e che finiva nei
-- grafici e nei filtri.
--
-- ============================================================================
-- COSA FA
-- ============================================================================
-- Aggiunge il ramo `WHEN gruppo = 'SISTEMI' THEN 'COSTRUITO'`. Riscrive il testo
-- di ciascuna vista in un solo punto, con la stessa espressione, invece di
-- ricopiare a mano otto definizioni: il DO block legge la definizione che c'e'
-- davvero nel database, cambia solo quel pezzo e FALLISCE se non lo trova (e se
-- la vista non e' gia' stata corretta), cosi' non puo' lasciarne una a meta'.
-- Idempotente: rieseguita non cambia niente.
--
-- NON tocca `powerbi.*`: quelle viste non applicano la regola (il report Power BI
-- ha la propria) e sono un'altra decisione.
--
-- Rollback: reinserire il ramo ELSE originale con lo stesso procedimento.
-- ============================================================================

do $migrazione$
declare
  v_vista text;
  v_def   text;
  v_nuova text;
  v_fatte int := 0;
  v_opzioni text[];
  -- ...THEN upper(TRIM(BOTH FROM <alias>.categoria_descrizione)) ELSE <alias>.gruppo_descrizione END
  v_schema constant text :=
    '(ARRAY\[''COSTRUITO''::text, ''STRUTTURE''::text\]\)\)\s+THEN\s+upper\(TRIM\(BOTH FROM\s+(?:[a-z_]+\.)?categoria_descrizione\)\)\s+)ELSE\s+((?:[a-z_]+\.)?gruppo_descrizione)(\s+END)';
begin
  foreach v_vista in array array[
    'bi_consegnato', 'bi_consegnato_futuro_per_mese', 'bi_controllo_banco', 'bi_fatturato',
    'bi_ordinato', 'bi_portafoglio', 'bi_preventivi_aperti', 'bi_preventivi_backoffice'
  ] loop
    v_def := pg_get_viewdef(format('public.%I', v_vista)::regclass, false);
    select c.reloptions into v_opzioni from pg_class c where c.oid = format('public.%I', v_vista)::regclass;

    if v_def ~ 'THEN\s+''COSTRUITO''::text\s+ELSE' and v_def ~ '''SISTEMI''::text' then
      continue; -- gia' corretta
    end if;
    if v_def !~ v_schema then
      raise exception 'Vista % : la regola COSTRUITO/STRUTTURE non ha la forma attesa, nessuna modifica fatta', v_vista;
    end if;

    v_nuova := regexp_replace(
      v_def,
      v_schema,
      E'\\1WHEN \\2 = ''SISTEMI''::text THEN ''COSTRUITO''::text ELSE \\2\\3'
    );
    v_nuova := rtrim(btrim(v_nuova), ';');
    execute format('create or replace view public.%I as %s', v_vista, v_nuova);
    -- CREATE OR REPLACE azzera le opzioni della vista: si rimettono come erano.
    if v_opzioni is not null and 'security_invoker=false' = any (v_opzioni) then
      execute format('alter view public.%I set (security_invoker = false)', v_vista);
    end if;
    v_fatte := v_fatte + 1;
  end loop;

  raise notice 'Viste aggiornate: %', v_fatte;
end
$migrazione$;

notify pgrst, 'reload schema';
