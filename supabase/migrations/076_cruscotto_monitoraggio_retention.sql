-- ============================================================================
-- 076 — Monitoraggio e retention del Cruscotto articoli (Fase 10)
--
-- Applicata in produzione come 076a…076c.
--
-- Aggiunge:
--   FK RESTRICT sullo storico    protezione contro cancellazioni distruttive
--   bi.v_cruscotto_runs          elenco run con esito e volumi
--   bi.cruscotto_health()        semaforo ok / attenzione / critico
--   bi.cruscotto_retention()     pulizia conservativa
--   public.bi_cruscotto_*        wrapper per il chiamante esterno
--
-- Verifiche eseguite in transazione con rollback:
--   - cancellare un run che ha prodotto storico → impedita dal database
--   - retention: elimina il run vecchio SENZA storico e lo staging orfano,
--     lascia intatti il run con storico e quello fallito di recente
-- ============================================================================

-- ── Protezione dello storico ────────────────────────────────────────────────
-- Le FK verso bi.cruscotto_runs erano ON DELETE CASCADE. Ogni riga di storico
-- appartiene al run che ha RILEVATO il cambiamento, quindi una retention sui
-- run più vecchi — la cosa più naturale da scrivere — avrebbe cancellato
-- proprio i cambiamenti più antichi, cioè il patrimonio che questa pipeline
-- esiste per costruire. Un banale
--   delete from bi.cruscotto_runs where received_at < ...
-- sarebbe bastato, senza alcun avviso.
--
-- Con RESTRICT il database rifiuta: si possono cancellare solo i run che non
-- hanno prodotto storico (falliti, prove), che è esattamente ciò che serve.

alter table bi.costi_storico
  drop constraint costi_storico_run_id_fkey,
  add constraint costi_storico_run_id_fkey
    foreign key (run_id) references bi.cruscotto_runs(run_id) on delete restrict;

alter table bi.giacenze_storico
  drop constraint giacenze_storico_run_id_fkey,
  add constraint giacenze_storico_run_id_fkey
    foreign key (run_id) references bi.cruscotto_runs(run_id) on delete restrict;

comment on constraint costi_storico_run_id_fkey on bi.costi_storico is
  'RESTRICT di proposito: cancellare un run non deve poter cancellare lo storico che ha prodotto.';
comment on constraint giacenze_storico_run_id_fkey on bi.giacenze_storico is
  'RESTRICT di proposito: cancellare un run non deve poter cancellare lo storico che ha prodotto.';

-- ── Stato ───────────────────────────────────────────────────────────────────

create or replace view bi.v_cruscotto_runs as
select r.run_id,
       r.status,
       r.source,
       r.captured_at,
       r.received_at,
       r.published_at,
       r.row_count,
       r.articoli_count,
       round(extract(epoch from now() - r.received_at) / 3600.0, 1) as ore_fa,
       (r.metadata->>'costi_aperti')::bigint    as costi_aperti,
       (r.metadata->>'costi_chiusi')::bigint    as costi_chiusi,
       (r.metadata->>'giacenze_aperte')::bigint as giacenze_aperte,
       (r.metadata->>'giacenze_chiuse')::bigint as giacenze_chiuse,
       coalesce(jsonb_array_length(r.metadata->'anomalie'), 0) as n_anomalie,
       r.error_message
  from bi.cruscotto_runs r;

comment on view bi.v_cruscotto_runs is
  'Elenco dei run Cruscotto con esito e volumi, per monitoraggio e pagina admin.';

-- ── Semaforo ────────────────────────────────────────────────────────────────
-- Un solo oggetto: stato complessivo più i numeri che lo motivano. Pensato per
-- un job di allerta o una pagina admin, senza dover interpretare più query.
--
-- Nota: `array || 'testo'` senza cast viene letto come concatenazione fra due
-- array e fallisce a runtime con "malformed array literal". Da qui i ::text.

create or replace function bi.cruscotto_health(p_max_ore numeric default 30)
returns jsonb
language plpgsql
stable
set search_path to 'bi', 'preventivatore', 'public', 'pg_temp'
as $fn$
declare
  v_cur        record;
  v_ore        numeric;
  v_falliti    bigint;
  v_ultimo_err text;
  v_stato      text;
  v_motivi     text[] := array[]::text[];
begin
  select * into v_cur from bi.cruscotto_runs where status = 'current';

  select count(*) into v_falliti
    from bi.cruscotto_runs
   where status = 'failed' and received_at > now() - interval '48 hours';

  select error_message into v_ultimo_err
    from bi.cruscotto_runs
   where status = 'failed'
   order by received_at desc limit 1;

  if v_cur.run_id is null then
    v_stato := 'critico';
    v_motivi := v_motivi || 'nessun run pubblicato'::text;
  else
    v_ore := round(extract(epoch from now() - coalesce(v_cur.published_at, v_cur.received_at)) / 3600.0, 1);
    if v_ore > p_max_ore * 2 then
      v_stato := 'critico';
      v_motivi := v_motivi || format('ultimo aggiornamento %s ore fa', v_ore)::text;
    elsif v_ore > p_max_ore then
      v_stato := 'attenzione';
      v_motivi := v_motivi || format('ultimo aggiornamento %s ore fa', v_ore)::text;
    else
      v_stato := 'ok';
    end if;
  end if;

  -- Un fallimento recente merita attenzione anche se il dato pubblicato è
  -- fresco: vuol dire che qualcosa ha smesso di funzionare a monte.
  if v_falliti > 0 and v_stato = 'ok' then
    v_stato := 'attenzione';
  end if;
  if v_falliti > 0 then
    v_motivi := v_motivi || format('%s run falliti nelle ultime 48 ore', v_falliti)::text;
  end if;

  return jsonb_build_object(
    'stato', v_stato,
    'motivi', to_jsonb(v_motivi),
    'run_corrente', v_cur.run_id,
    'pubblicato_il', v_cur.published_at,
    'ore_dall_aggiornamento', v_ore,
    'righe', v_cur.row_count,
    'articoli', v_cur.articoli_count,
    'run_falliti_48h', v_falliti,
    'ultimo_errore', v_ultimo_err,
    'storico', jsonb_build_object(
      'costi_totali',    (select count(*) from bi.costi_storico),
      'costi_aperti',    (select count(*) from bi.costi_storico where valid_to is null),
      'giacenze_totali', (select count(*) from bi.giacenze_storico),
      'giacenze_aperte', (select count(*) from bi.giacenze_storico where valid_to is null)
    ),
    'produzione', jsonb_build_object(
      'prodotti_attivi', (select count(*) from preventivatore.prodotti where attivo),
      'giacenze',        (select count(*) from preventivatore.prodotti_giacenze)
    )
  );
end;
$fn$;

comment on function bi.cruscotto_health(numeric) is
  'Semaforo della pipeline Cruscotto: ok / attenzione / critico, con i numeri che lo motivano.';

-- ── Retention ───────────────────────────────────────────────────────────────
-- Cancella solo ciò che non ha valore storico: staging orfano e run che non
-- hanno prodotto nulla. I run che hanno generato storico non si toccano — sono
-- pochi (uno al giorno) e la FK RESTRICT li protegge comunque.

create or replace function bi.cruscotto_retention(
  p_giorni_falliti integer default 90,
  p_giorni_staging integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
declare
  v_staging bigint := 0;
  v_run     bigint := 0;
begin
  -- Staging lasciato indietro da run conclusi: l'ingest riuscito lo svuota da
  -- sé, questo raccoglie i resti dei falliti — utili per l'analisi, non per
  -- sempre.
  delete from bi.cruscotto_staging s
   where exists (
     select 1 from bi.cruscotto_runs r
      where r.run_id = s.run_id
        and r.status <> 'loading'
        and r.received_at < now() - make_interval(days => p_giorni_staging)
   );
  get diagnostics v_staging = row_count;

  -- Run vecchi che non hanno prodotto storico. Quelli che ne hanno prodotto
  -- restano: sono righe minuscole e servono a spiegare da dove viene un dato.
  delete from bi.cruscotto_runs r
   where r.status in ('failed', 'archived')
     and r.received_at < now() - make_interval(days => p_giorni_falliti)
     and not exists (select 1 from bi.costi_storico c where c.run_id = r.run_id)
     and not exists (select 1 from bi.giacenze_storico g where g.run_id = r.run_id);
  get diagnostics v_run = row_count;

  return jsonb_build_object(
    'staging_eliminate', v_staging,
    'run_eliminati', v_run,
    'eseguita_il', now()
  );
end;
$fn$;

comment on function bi.cruscotto_retention(integer, integer) is
  'Pulizia conservativa: staging orfano e run senza storico. Non tocca mai lo storico.';

-- ── Esposizione ─────────────────────────────────────────────────────────────
-- Lo schema bi resta fuori da PostgREST: wrapper in public, come per l'ingest.

create or replace function public.bi_cruscotto_health(p_max_ore numeric default 30)
returns jsonb
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select bi.cruscotto_health(p_max_ore);
$fn$;

create or replace function public.bi_cruscotto_retention(
  p_giorni_falliti integer default 90,
  p_giorni_staging integer default 7
)
returns jsonb
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select bi.cruscotto_retention(p_giorni_falliti, p_giorni_staging);
$fn$;

revoke all on function public.bi_cruscotto_health(numeric) from public, anon, authenticated;
revoke all on function public.bi_cruscotto_retention(integer, integer) from public, anon, authenticated;
revoke all on function bi.cruscotto_health(numeric) from public, anon, authenticated;
revoke all on function bi.cruscotto_retention(integer, integer) from public, anon, authenticated;

grant execute on function public.bi_cruscotto_health(numeric) to service_role;
grant execute on function public.bi_cruscotto_retention(integer, integer) to service_role;
grant execute on function bi.cruscotto_health(numeric) to service_role;
grant execute on function bi.cruscotto_retention(integer, integer) to service_role;
grant select on bi.v_cruscotto_runs to service_role;
