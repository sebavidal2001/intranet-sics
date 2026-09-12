-- ============================================================================
-- 099 — Ingest atomico dei documenti di trasporto
--
-- Aggiunge:
--   bi.trasporti_runs              tracciamento dei tentativi live/riconciliazione
--   bi.trasporti_documenti_staging atterraggio del CSV a 68 colonne
--   bi.valida_trasporti_staging()  controlli prima delle scritture definitive
--   bi.ingest_trasporti()          upsert atomico su id_documento
--   public.bi_trasporti_*           RPC PostgREST per il receiver Linux
--
-- Garanzie:
--   - advisory lock dedicato: due ingest Trasporti non si sovrappongono
--   - upsert, mai append e mai DELETE dalla tabella definitiva
--   - soltanto la riconciliazione a 90 giorni può marcare una riga assente
--   - data_creazione e data_modifica restano timestamp SENZA fuso orario
--   - le 68 colonne seguono esattamente l'ordine della query collaudata
--     scripts/bi-bridge/query/TRASPORTI_DOCUMENTI.sql
-- ============================================================================

-- ─── Stato di assenza logica ─────────────────────────────────────────────────

alter table bi.trasporti_documenti
  add column if not exists assente_dal_gestionale boolean not null default false;

comment on column bi.trasporti_documenti.assente_dal_gestionale is
  'True quando l''ultima riconciliazione a 90 giorni non ha più trovato il documento pur ricadendo nella finestra verificata. Solo il ramo riconciliazione aggiorna questo stato; il live non può dedurre assenze. La riga non viene mai cancellata fisicamente.';

-- ─── Run ─────────────────────────────────────────────────────────────────────

create table if not exists bi.trasporti_runs (
  run_id          text primary key,
  profilo         text not null check (profilo in ('live', 'riconciliazione')),
  source          text not null default 'SRVWOA',
  captured_at     timestamptz,
  finestra_dal    date,
  received_at     timestamptz not null default now(),
  published_at    timestamptz,
  row_count       bigint,
  inserted_count  bigint,
  updated_count   bigint,
  missing_count   bigint,
  sha256          text,
  status          text not null default 'loading'
                    check (status in ('loading', 'validated', 'current', 'failed', 'archived')),
  error_message   text,
  metadata        jsonb,
  created_at      timestamptz not null default now(),
  constraint trasporti_runs_finestra_profilo_check check (
    (profilo = 'live' and finestra_dal is null)
    or (profilo = 'riconciliazione' and finestra_dal is not null)
  )
);

create unique index if not exists trasporti_runs_one_current_per_profile_idx
  on bi.trasporti_runs (profilo) where status = 'current';
create index if not exists trasporti_runs_received_idx
  on bi.trasporti_runs (received_at desc);

comment on table bi.trasporti_runs is
  'Un record per ingest di trasporti_documenti. I profili live e riconciliazione hanno ciascuno il proprio run corrente.';
comment on column bi.trasporti_runs.finestra_dal is
  'Primo giorno incluso dalla query a 90 giorni. Obbligatorio solo per riconciliazione e usato per delimitare le assenze deducibili.';

-- ─── Staging ─────────────────────────────────────────────────────────────────
-- UNLOGGED: il contenuto è rigenerabile e viene eliminato dopo un ingest
-- riuscito. Dopo run_id e riga_num, nomi/ordine/tipi ricalcano il CSV e la 090.

create unlogged table if not exists bi.trasporti_documenti_staging (
  run_id                      text not null references bi.trasporti_runs(run_id) on delete cascade,
  riga_num                    integer not null,

  id_documento                integer,
  direzione                   text,
  tipo_registro               text,
  codice_profilo              text,
  descrizione_profilo         text,
  numero_progressivo          text,
  numero_documento            text,
  data_documento              date,
  data_registrazione          date,
  data_creazione              timestamp,
  stampato                    text,
  contabilizzato              text,
  sospeso                     text,
  bloccato                    text,
  id_sog_commerciale          integer,
  codice_soggetto             text,
  soggetto                    text,
  soggetto_piva               text,
  soggetto_indirizzo          text,
  soggetto_cap                text,
  soggetto_localita           text,
  soggetto_provincia          text,
  id_destinazione             integer,
  destinazione_codificata     text,
  dest_indirizzo_cod          text,
  dest_cap_cod                text,
  dest_localita_cod           text,
  dest_provincia_cod          text,
  dest_rag_soc                text,
  dest_indirizzo              text,
  dest_cap                    text,
  dest_localita               text,
  dest_provincia              text,
  provincia_destinazione      text,
  zona_cap                    text,
  zona_provincia              text,
  fonte_zona                  text,
  id_tipo_trasporto           integer,
  tipo_trasporto_codice       text,
  tipo_trasporto              text,
  id_caus_trasporto           integer,
  causale_trasporto_codice    text,
  causale_trasporto           text,
  tras_mezzo                  text,
  asp_beni                    text,
  id_sog_commerciale_vettore  integer,
  vettore_codice              text,
  vettore                     text,
  num_colli                   numeric(14,3),
  num_pallet                  numeric(14,3),
  peso_netto                  numeric(14,3),
  peso_lordo                  numeric(14,3),
  volume                      numeric(14,4),
  id_unita_misura_peso        integer,
  um_peso                     text,
  id_unita_misura_volume      integer,
  um_volume                   text,
  val_spese                   numeric(14,4),
  data_trasporto              date,
  data_prev_consegna          date,
  data_consegna_cliente       date,
  note_spedizione             text,
  id_utente_crea              integer,
  codice_utente_creatore      text,
  utente_creatore             text,
  id_utente_modifica          integer,
  data_modifica               timestamp,
  generato_da                 text,

  primary key (run_id, riga_num)
);

create index if not exists trasporti_documenti_staging_chiave_idx
  on bi.trasporti_documenti_staging (run_id, id_documento);

comment on table bi.trasporti_documenti_staging is
  'Atterraggio dei CSV trasporti_documenti live e riconciliazione. Le 68 colonne dati conservano il contratto posizionale della query SQL Anywhere.';
comment on column bi.trasporti_documenti_staging.data_creazione is
  'Timestamp locale del gestionale senza fuso orario; non convertire in UTC.';
comment on column bi.trasporti_documenti_staging.data_modifica is
  'Timestamp locale del gestionale senza fuso orario; non convertire in UTC.';

-- ─── Validazione ─────────────────────────────────────────────────────────────

create or replace function bi.valida_trasporti_staging(p_run_id text)
returns table (bloccante boolean, tipo text, occorrenze bigint, dettaglio text)
language plpgsql
stable
set search_path to 'bi', 'public', 'pg_temp'
as $$
declare
  v_profilo    text;
  v_righe      bigint;
  v_prec       bigint;
begin
  select r.profilo into v_profilo
    from bi.trasporti_runs r
   where r.run_id = p_run_id;

  if not found then
    return query select true, 'run_non_registrato', 0::bigint,
      'Il run indicato non esiste in bi.trasporti_runs';
    return;
  end if;

  select count(*) into v_righe
    from bi.trasporti_documenti_staging s
   where s.run_id = p_run_id;

  if v_righe = 0 then
    return query select true, 'staging_vuota', 0::bigint,
      'Nessuna riga caricata per il run indicato';
    return;
  end if;

  return query
  select true, 'id_documento_mancante', count(*),
         'righe senza id_documento positivo'
    from bi.trasporti_documenti_staging s
   where s.run_id = p_run_id and (s.id_documento is null or s.id_documento <= 0)
  having count(*) > 0;

  return query
  select true, 'duplicato_id_documento', count(*),
         'id_documento presenti più di una volta nello stesso file'
    from (
      select s.id_documento
        from bi.trasporti_documenti_staging s
       where s.run_id = p_run_id
       group by s.id_documento
      having count(*) > 1
    ) duplicati
  having count(*) > 0;

  return query
  select true, 'tipo_registro_non_valido', count(*),
         'righe con tipo_registro diverso da DV o DA'
    from bi.trasporti_documenti_staging s
   where s.run_id = p_run_id
     and (s.tipo_registro is null or s.tipo_registro not in ('DV', 'DA'))
  having count(*) > 0;

  return query
  select true, 'direzione_non_coerente', count(*),
         'direzione diversa da ENTRATA per DA o USCITA per DV'
    from bi.trasporti_documenti_staging s
   where s.run_id = p_run_id
     and s.direzione is distinct from
         case when s.tipo_registro = 'DA' then 'ENTRATA'
              when s.tipo_registro = 'DV' then 'USCITA'
              else null end
  having count(*) > 0;

  -- Il live è per natura piccolo e parziale: non va mai confrontato con uno
  -- snapshot. Solo la riconciliazione usa il precedente run affidabile come
  -- protezione contro file tronchi che produrrebbero false assenze.
  if v_profilo = 'riconciliazione' then
    select r.row_count into v_prec
      from bi.trasporti_runs r
     where r.profilo = 'riconciliazione'
       and r.status in ('current', 'archived')
       and r.row_count is not null
     order by r.published_at desc nulls last
     limit 1;

    if coalesce(v_prec, 0) > 100 and v_righe < (v_prec * 0.8)::bigint then
      return query select true, 'calo_righe_riconciliazione', v_righe,
        format('%s righe contro %s nell''ultima riconciliazione: calo oltre il 20%%',
               v_righe, v_prec);
    end if;
  end if;
end;
$$;

comment on function bi.valida_trasporti_staging(text) is
  'Controlla chiavi, duplicati, classificazione e completezza della riconciliazione. Il profilo live non viene mai trattato come snapshot.';

-- ─── Ingest ──────────────────────────────────────────────────────────────────

create or replace function bi.ingest_trasporti(
  p_run_id      text,
  p_profilo     text,
  p_captured_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $$
declare
  v_inizio             timestamptz := clock_timestamp();
  v_status             text;
  v_profilo_run        text;
  v_finestra_dal       date;
  v_blocchi            text;
  v_anomalie           jsonb;
  v_righe              bigint;
  v_inserite           bigint;
  v_aggiornate         bigint;
  v_presenti_smarcati  bigint := 0;
  v_assenti_marcati    bigint := 0;
begin
  -- Chiave bigint dedicata a Trasporti. È maggiore del massimo int4, mentre
  -- hashtext('bi.ingest_cruscotto') usato dalla 075 restituisce sempre int4:
  -- le due chiavi sono quindi certamente distinte, non solo improbabili.
  perform pg_advisory_xact_lock(9900990001);

  if p_profilo not in ('live', 'riconciliazione') then
    raise exception 'Profilo Trasporti non valido: %', p_profilo;
  end if;

  select r.status, r.profilo, r.finestra_dal
    into v_status, v_profilo_run, v_finestra_dal
    from bi.trasporti_runs r
   where r.run_id = p_run_id;

  if not found then
    raise exception 'Run Trasporti % non registrato in bi.trasporti_runs', p_run_id;
  end if;
  if v_status <> 'loading' then
    raise exception 'Run Trasporti % non è in caricamento (status=%)', p_run_id, v_status;
  end if;
  if v_profilo_run <> p_profilo then
    raise exception 'Profilo % diverso da quello registrato per il run % (%)',
      p_profilo, p_run_id, v_profilo_run;
  end if;
  if p_profilo = 'riconciliazione' and v_finestra_dal is null then
    raise exception 'Il run di riconciliazione % non dichiara finestra_dal', p_run_id;
  end if;

  select string_agg(format('%s (%s: %s)', v.tipo, v.occorrenze, v.dettaglio), '; ')
    into v_blocchi
    from bi.valida_trasporti_staging(p_run_id) v
   where v.bloccante;

  if v_blocchi is not null then
    raise exception 'Validazione fallita per il run %: %', p_run_id, v_blocchi;
  end if;

  select jsonb_agg(jsonb_build_object(
           'tipo', v.tipo, 'occorrenze', v.occorrenze, 'dettaglio', v.dettaglio))
    into v_anomalie
    from bi.valida_trasporti_staging(p_run_id) v;

  drop table if exists _trasporti_snap;
  create temp table _trasporti_snap on commit drop as
  select
    s.id_documento, s.direzione, s.tipo_registro, s.codice_profilo,
    s.descrizione_profilo, s.numero_progressivo, s.numero_documento,
    s.data_documento, s.data_registrazione, s.data_creazione,
    s.stampato, s.contabilizzato, s.sospeso, s.bloccato,
    s.id_sog_commerciale, s.codice_soggetto, s.soggetto, s.soggetto_piva,
    s.soggetto_indirizzo, s.soggetto_cap, s.soggetto_localita,
    s.soggetto_provincia, s.id_destinazione, s.destinazione_codificata,
    s.dest_indirizzo_cod, s.dest_cap_cod, s.dest_localita_cod,
    s.dest_provincia_cod, s.dest_rag_soc, s.dest_indirizzo, s.dest_cap,
    s.dest_localita, s.dest_provincia, s.provincia_destinazione,
    s.zona_cap, s.zona_provincia, s.fonte_zona,
    s.id_tipo_trasporto, s.tipo_trasporto_codice, s.tipo_trasporto,
    s.id_caus_trasporto, s.causale_trasporto_codice, s.causale_trasporto,
    s.tras_mezzo, s.asp_beni, s.id_sog_commerciale_vettore,
    s.vettore_codice, s.vettore, s.num_colli, s.num_pallet, s.peso_netto,
    s.peso_lordo, s.volume, s.id_unita_misura_peso, s.um_peso,
    s.id_unita_misura_volume, s.um_volume, s.val_spese,
    s.data_trasporto, s.data_prev_consegna, s.data_consegna_cliente,
    s.note_spedizione, s.id_utente_crea, s.codice_utente_creatore,
    s.utente_creatore, s.id_utente_modifica, s.data_modifica, s.generato_da
  from bi.trasporti_documenti_staging s
  where s.run_id = p_run_id;

  create unique index on _trasporti_snap (id_documento);
  analyze _trasporti_snap;

  select count(*) into v_righe from _trasporti_snap;
  select count(*) into v_aggiornate
    from _trasporti_snap s
    join bi.trasporti_documenti d using (id_documento);
  v_inserite := v_righe - v_aggiornate;

  insert into bi.trasporti_documenti (
    id_documento, direzione, tipo_registro, codice_profilo,
    descrizione_profilo, numero_progressivo, numero_documento,
    data_documento, data_registrazione, data_creazione,
    stampato, contabilizzato, sospeso, bloccato,
    id_sog_commerciale, codice_soggetto, soggetto, soggetto_piva,
    soggetto_indirizzo, soggetto_cap, soggetto_localita, soggetto_provincia,
    id_destinazione, destinazione_codificata, dest_indirizzo_cod,
    dest_cap_cod, dest_localita_cod, dest_provincia_cod, dest_rag_soc,
    dest_indirizzo, dest_cap, dest_localita, dest_provincia,
    provincia_destinazione, zona_cap, zona_provincia, fonte_zona,
    id_tipo_trasporto, tipo_trasporto_codice, tipo_trasporto,
    id_caus_trasporto, causale_trasporto_codice, causale_trasporto,
    tras_mezzo, asp_beni, id_sog_commerciale_vettore, vettore_codice, vettore,
    num_colli, num_pallet, peso_netto, peso_lordo, volume,
    id_unita_misura_peso, um_peso, id_unita_misura_volume, um_volume,
    val_spese, data_trasporto, data_prev_consegna, data_consegna_cliente,
    note_spedizione, id_utente_crea, codice_utente_creatore, utente_creatore,
    id_utente_modifica, data_modifica, generato_da,
    ultimo_visto_run, aggiornato_il
  )
  select
    s.id_documento, s.direzione, s.tipo_registro, s.codice_profilo,
    s.descrizione_profilo, s.numero_progressivo, s.numero_documento,
    s.data_documento, s.data_registrazione, s.data_creazione,
    s.stampato, s.contabilizzato, s.sospeso, s.bloccato,
    s.id_sog_commerciale, s.codice_soggetto, s.soggetto, s.soggetto_piva,
    s.soggetto_indirizzo, s.soggetto_cap, s.soggetto_localita,
    s.soggetto_provincia, s.id_destinazione, s.destinazione_codificata,
    s.dest_indirizzo_cod, s.dest_cap_cod, s.dest_localita_cod,
    s.dest_provincia_cod, s.dest_rag_soc, s.dest_indirizzo, s.dest_cap,
    s.dest_localita, s.dest_provincia, s.provincia_destinazione,
    s.zona_cap, s.zona_provincia, s.fonte_zona,
    s.id_tipo_trasporto, s.tipo_trasporto_codice, s.tipo_trasporto,
    s.id_caus_trasporto, s.causale_trasporto_codice, s.causale_trasporto,
    s.tras_mezzo, s.asp_beni, s.id_sog_commerciale_vettore,
    s.vettore_codice, s.vettore, s.num_colli, s.num_pallet, s.peso_netto,
    s.peso_lordo, s.volume, s.id_unita_misura_peso, s.um_peso,
    s.id_unita_misura_volume, s.um_volume, s.val_spese,
    s.data_trasporto, s.data_prev_consegna, s.data_consegna_cliente,
    s.note_spedizione, s.id_utente_crea, s.codice_utente_creatore,
    s.utente_creatore, s.id_utente_modifica, s.data_modifica, s.generato_da,
    p_run_id, clock_timestamp()
  from _trasporti_snap s
  on conflict (id_documento) do update set
    direzione = excluded.direzione,
    tipo_registro = excluded.tipo_registro,
    codice_profilo = excluded.codice_profilo,
    descrizione_profilo = excluded.descrizione_profilo,
    numero_progressivo = excluded.numero_progressivo,
    numero_documento = excluded.numero_documento,
    data_documento = excluded.data_documento,
    data_registrazione = excluded.data_registrazione,
    data_creazione = excluded.data_creazione,
    stampato = excluded.stampato,
    contabilizzato = excluded.contabilizzato,
    sospeso = excluded.sospeso,
    bloccato = excluded.bloccato,
    id_sog_commerciale = excluded.id_sog_commerciale,
    codice_soggetto = excluded.codice_soggetto,
    soggetto = excluded.soggetto,
    soggetto_piva = excluded.soggetto_piva,
    soggetto_indirizzo = excluded.soggetto_indirizzo,
    soggetto_cap = excluded.soggetto_cap,
    soggetto_localita = excluded.soggetto_localita,
    soggetto_provincia = excluded.soggetto_provincia,
    id_destinazione = excluded.id_destinazione,
    destinazione_codificata = excluded.destinazione_codificata,
    dest_indirizzo_cod = excluded.dest_indirizzo_cod,
    dest_cap_cod = excluded.dest_cap_cod,
    dest_localita_cod = excluded.dest_localita_cod,
    dest_provincia_cod = excluded.dest_provincia_cod,
    dest_rag_soc = excluded.dest_rag_soc,
    dest_indirizzo = excluded.dest_indirizzo,
    dest_cap = excluded.dest_cap,
    dest_localita = excluded.dest_localita,
    dest_provincia = excluded.dest_provincia,
    provincia_destinazione = excluded.provincia_destinazione,
    zona_cap = excluded.zona_cap,
    zona_provincia = excluded.zona_provincia,
    fonte_zona = excluded.fonte_zona,
    id_tipo_trasporto = excluded.id_tipo_trasporto,
    tipo_trasporto_codice = excluded.tipo_trasporto_codice,
    tipo_trasporto = excluded.tipo_trasporto,
    id_caus_trasporto = excluded.id_caus_trasporto,
    causale_trasporto_codice = excluded.causale_trasporto_codice,
    causale_trasporto = excluded.causale_trasporto,
    tras_mezzo = excluded.tras_mezzo,
    asp_beni = excluded.asp_beni,
    id_sog_commerciale_vettore = excluded.id_sog_commerciale_vettore,
    vettore_codice = excluded.vettore_codice,
    vettore = excluded.vettore,
    num_colli = excluded.num_colli,
    num_pallet = excluded.num_pallet,
    peso_netto = excluded.peso_netto,
    peso_lordo = excluded.peso_lordo,
    volume = excluded.volume,
    id_unita_misura_peso = excluded.id_unita_misura_peso,
    um_peso = excluded.um_peso,
    id_unita_misura_volume = excluded.id_unita_misura_volume,
    um_volume = excluded.um_volume,
    val_spese = excluded.val_spese,
    data_trasporto = excluded.data_trasporto,
    data_prev_consegna = excluded.data_prev_consegna,
    data_consegna_cliente = excluded.data_consegna_cliente,
    note_spedizione = excluded.note_spedizione,
    id_utente_crea = excluded.id_utente_crea,
    codice_utente_creatore = excluded.codice_utente_creatore,
    utente_creatore = excluded.utente_creatore,
    id_utente_modifica = excluded.id_utente_modifica,
    data_modifica = excluded.data_modifica,
    generato_da = excluded.generato_da,
    ultimo_visto_run = excluded.ultimo_visto_run,
    aggiornato_il = excluded.aggiornato_il;

  -- Questo è l'unico blocco che scrive assente_dal_gestionale. Il live passa
  -- dallo stesso upsert ma non può né marcare né smarcare alcun documento.
  if p_profilo = 'riconciliazione' then
    update bi.trasporti_documenti d
       set assente_dal_gestionale = false,
           aggiornato_il = clock_timestamp()
     where d.assente_dal_gestionale
       and exists (
         select 1 from _trasporti_snap s where s.id_documento = d.id_documento
       );
    get diagnostics v_presenti_smarcati = row_count;

    update bi.trasporti_documenti d
       set assente_dal_gestionale = true,
           aggiornato_il = clock_timestamp()
     where not d.assente_dal_gestionale
       and (
         d.data_registrazione >= v_finestra_dal
         or d.data_modifica::date >= v_finestra_dal
       )
       and not exists (
         select 1 from _trasporti_snap s where s.id_documento = d.id_documento
       );
    get diagnostics v_assenti_marcati = row_count;
  end if;

  update bi.trasporti_runs
     set status = 'validated'
   where run_id = p_run_id;

  update bi.trasporti_runs
     set status = 'archived'
   where profilo = p_profilo and status = 'current' and run_id <> p_run_id;

  update bi.trasporti_runs
     set status = 'current',
         captured_at = coalesce(p_captured_at, captured_at),
         published_at = now(),
         row_count = v_righe,
         inserted_count = v_inserite,
         updated_count = v_aggiornate,
         missing_count = v_assenti_marcati,
         error_message = null
   where run_id = p_run_id;

  delete from bi.trasporti_documenti_staging where run_id = p_run_id;

  return jsonb_build_object(
    'profilo', p_profilo,
    'righe', v_righe,
    'inserite', v_inserite,
    'aggiornate', v_aggiornate,
    'presenti_smarcati', v_presenti_smarcati,
    'assenti_marcati', v_assenti_marcati,
    'anomalie', coalesce(v_anomalie, '[]'::jsonb),
    'durata_ms', round(extract(epoch from clock_timestamp() - v_inizio) * 1000)
  );
end;
$$;

comment on function bi.ingest_trasporti(text, text, timestamptz) is
  'Ingest atomico con upsert su id_documento. Solo il profilo riconciliazione aggiorna assente_dal_gestionale; nessun profilo cancella righe definitive.';

-- Nessun accesso diretto: l'ingest passa dal service role del receiver.
revoke all on function bi.ingest_trasporti(text, text, timestamptz) from public, anon, authenticated;
revoke all on function bi.valida_trasporti_staging(text) from public, anon, authenticated;
revoke all on table bi.trasporti_documenti_staging from public, anon, authenticated;
revoke all on table bi.trasporti_runs from public, anon, authenticated;

alter table bi.trasporti_documenti_staging enable row level security;
alter table bi.trasporti_runs enable row level security;

-- ─── Accesso dal caricatore ──────────────────────────────────────────────────
-- PostgREST espone public, non bi. I wrapper SECURITY DEFINER sono l'unica
-- superficie RPC e vengono concessi esclusivamente al service_role.

create or replace function public.bi_trasporti_run_start(
  p_run_id       text,
  p_profilo      text,
  p_source       text default 'SRVWOA',
  p_captured_at  timestamptz default null,
  p_finestra_dal date default null,
  p_sha256       text default null,
  p_metadata     jsonb default null
)
returns text
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  if p_profilo not in ('live', 'riconciliazione') then
    raise exception 'Profilo Trasporti non valido: %', p_profilo;
  end if;
  if p_profilo = 'live' and p_finestra_dal is not null then
    raise exception 'Il profilo live non accetta finestra_dal';
  end if;
  if p_profilo = 'riconciliazione' and p_finestra_dal is null then
    raise exception 'Il profilo riconciliazione richiede finestra_dal';
  end if;

  insert into bi.trasporti_runs (
    run_id, profilo, source, captured_at, finestra_dal, sha256, status, metadata
  ) values (
    p_run_id, p_profilo, p_source, p_captured_at, p_finestra_dal,
    p_sha256, 'loading', p_metadata
  );
  return p_run_id;
end;
$fn$;

create or replace function public.bi_trasporti_staging_load(
  p_run_id text,
  p_righe  jsonb
)
returns bigint
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
declare
  v_n bigint;
begin
  if jsonb_typeof(p_righe) <> 'array' then
    raise exception 'p_righe deve essere un array JSON';
  end if;
  if not exists (
    select 1 from bi.trasporti_runs r
     where r.run_id = p_run_id and r.status = 'loading'
  ) then
    raise exception 'Run Trasporti % assente o non in caricamento', p_run_id;
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_righe) elemento
     where (elemento->>'run_id') is distinct from p_run_id
  ) then
    raise exception 'Il payload contiene righe con run_id diverso da %', p_run_id;
  end if;

  insert into bi.trasporti_documenti_staging
  select riga.*
    from jsonb_populate_recordset(
      null::bi.trasporti_documenti_staging, p_righe
    ) riga;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function public.bi_trasporti_valida(p_run_id text)
returns table (bloccante boolean, tipo text, occorrenze bigint, dettaglio text)
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select v.bloccante, v.tipo, v.occorrenze, v.dettaglio
    from bi.valida_trasporti_staging(p_run_id) v;
$fn$;

create or replace function public.bi_trasporti_ingest(
  p_run_id      text,
  p_profilo     text,
  p_captured_at timestamptz default now()
)
returns jsonb
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select bi.ingest_trasporti(p_run_id, p_profilo, p_captured_at);
$fn$;

create or replace function public.bi_trasporti_run_fail(
  p_run_id  text,
  p_errore  text,
  p_pulisci boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  update bi.trasporti_runs
     set status = 'failed', error_message = left(p_errore, 4000)
   where run_id = p_run_id and status in ('loading', 'validated');
  if p_pulisci then
    delete from bi.trasporti_documenti_staging where run_id = p_run_id;
  end if;
end;
$fn$;

-- ─── Privilegi ───────────────────────────────────────────────────────────────

revoke all on function public.bi_trasporti_run_start(text, text, text, timestamptz, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.bi_trasporti_staging_load(text, jsonb) from public, anon, authenticated;
revoke all on function public.bi_trasporti_valida(text) from public, anon, authenticated;
revoke all on function public.bi_trasporti_ingest(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.bi_trasporti_run_fail(text, text, boolean) from public, anon, authenticated;

grant usage on schema bi to service_role;
grant execute on function bi.ingest_trasporti(text, text, timestamptz) to service_role;
grant execute on function bi.valida_trasporti_staging(text) to service_role;
grant select, insert, update, delete on bi.trasporti_documenti_staging to service_role;
grant select, insert, update on bi.trasporti_runs to service_role;

grant execute on function public.bi_trasporti_run_start(text, text, text, timestamptz, date, text, jsonb) to service_role;
grant execute on function public.bi_trasporti_staging_load(text, jsonb) to service_role;
grant execute on function public.bi_trasporti_valida(text) to service_role;
grant execute on function public.bi_trasporti_ingest(text, text, timestamptz) to service_role;
grant execute on function public.bi_trasporti_run_fail(text, text, boolean) to service_role;

NOTIFY pgrst, 'reload schema';
