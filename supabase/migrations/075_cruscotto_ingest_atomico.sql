-- ============================================================================
-- 075 — Ingest atomico del Cruscotto articoli (Fase 3)
--
-- Aggiunge:
--   bi.cruscotto_staging          tabella di atterraggio del CSV (unlogged)
--   bi.valida_cruscotto_staging() controlli, ritorna le anomalie
--   bi.ingest_cruscotto()         staging → storico → produzione → activate
--                                 in UNA SOLA transazione
--
-- Garanzie:
--   - advisory lock: due ingest non si sovrappongono mai
--   - o passa tutto o non passa niente: in caso di errore la transazione
--     rollbacca e la produzione resta sul run precedente
--   - nessun prodotto viene mai cancellato: solo attivo = false
--   - Ult_Costo vuoto resta NULL: mai ereditato dall'ultimo costo conosciuto
--   - storico change-only: si scrive solo dove il valore è davvero cambiato
--
-- Non tocca: movimenta_giacenza, le 7 pipeline commerciali, il forecasting.
--
-- Applicata in produzione come 075a…075e (staging, validazione, ingest,
-- soglie sulla produzione attuale, temp table rieseguibili). Questo file è la
-- versione consolidata: rieseguirlo su un DB pulito produce lo stesso stato.
--
-- Verifiche eseguite su copia della produzione (26.171 righe, 24.573 articoli),
-- tutte in transazione con rollback finale:
--
--   1. File parziale (33 righe) → RIFIUTATO da tre controlli indipendenti
--      (calo righe, calo articoli, crollo costi).
--   2. Staging identico alla produzione → 0 giacenze riscritte, 0 eliminate,
--      0 prodotti nuovi, 0 disattivati. Baseline storico: 14.122 costi e
--      35.156 giacenze aperte, in 5,5 s.
--   3. Secondo run con tre modifiche mirate su 26.171 righe → rilevate
--      esattamente quelle: 1 esistenza (+7, delta corretto), 1 costo
--      (raddoppiato, intervallo precedente chiuso), 1 articolo nuovo,
--      1 articolo sparito → disattivato con giacenze rimosse. 3,4 s.
--
-- Nota sul primo run reale: ~1.200 prodotti (5%) risulteranno "aggiornati"
-- senza che nulla sia cambiato. hash_riga era stato calcolato in JavaScript
-- con una serializzazione dei numeri diversa da quella SQL; dal secondo run
-- in poi il confronto è stabile.
-- ============================================================================

-- ── Staging ─────────────────────────────────────────────────────────────────
-- UNLOGGED: contenuto rigenerabile a ogni run, non serve nel WAL né nei backup.
-- Le colonne ricalcano nome e ordine delle 40 del CSV, così il caricamento è
-- una copia diretta senza rimappature.

create unlogged table if not exists bi.cruscotto_staging (
  run_id    text    not null,
  riga_num  integer not null,

  codice                       text,
  descrizione                  text,
  codice_uc                    text,
  cat_com_articolo_codice      text,
  cat_com_articolo_descrizione text,
  cat_merceologica_codice      text,
  cat_merceologica_descrizione text,
  gruppo_articoli_codice       text,
  gruppo_articoli_descrizione  text,
  reparto_codice               text,
  reparto_descrizione          text,
  cat_fiscale_codice           text,
  cat_fiscale_descrizione      text,
  cat_esposizione_codice       text,
  cat_esposizione_descrizione  text,
  ult_costo                    numeric,
  data_ult_costo               date,
  magazzino                    text,
  qta_rim_iniziale             numeric,
  qta_caricata                 numeric,
  qta_scaricata                numeric,
  qta_altri_carichi            numeric,
  qta_altri_scarichi           numeric,
  qta_imp_produzione           numeric,
  qta_ord_clienti              numeric,
  qta_ord_fornitori            numeric,
  qta_vis_clienti              numeric,
  qta_vis_fornitori            numeric,
  qta_reso_clienti             numeric,
  qta_reso_fornitori           numeric,
  qta_ord_produzione           numeric,
  qta_cl_clienti               numeric,
  qta_cl_fornitori             numeric,
  qta_cl_terzi                 numeric,
  qta_gruppo_lib_1             numeric,
  qta_gruppo_lib_2             numeric,
  qta_gruppo_lib_3             numeric,
  qta_gruppo_lib_4             numeric,
  esistenza                    numeric,
  disponibilita                numeric,

  primary key (run_id, riga_num)
);

create index if not exists cruscotto_staging_chiave_idx
  on bi.cruscotto_staging (run_id, codice, magazzino);

comment on table bi.cruscotto_staging is
  'Atterraggio del CSV Cruscotto. Una riga per (codice, magazzino). Svuotata a fine ingest.';

-- ── Normalizzazione codice ──────────────────────────────────────────────────
-- Deve restare identica a normCodice() in scripts/import-cruscotto.mjs:
-- maiuscolo, via spazi . - _ / \ * ?

create or replace function bi.norm_codice(p_codice text)
returns text
language sql
immutable
as $$
  select regexp_replace(upper(coalesce(p_codice, '')), '[[:space:]._/\\*?-]+', '', 'g');
$$;

-- ── Validazione ─────────────────────────────────────────────────────────────
-- Ritorna una riga per anomalia. `bloccante = true` ferma l'ingest.
-- Pensata per essere chiamabile da sola, prima di scrivere qualsiasi cosa.

create or replace function bi.valida_cruscotto_staging(p_run_id text)
returns table (bloccante boolean, tipo text, occorrenze bigint, dettaglio text)
language plpgsql
stable
set search_path to 'bi', 'preventivatore', 'public', 'pg_temp'
as $$
declare
  v_righe        bigint;
  v_righe_prec   bigint;
  v_righe_prod   bigint;
  v_righe_soglia bigint;
  v_art          bigint;
  v_art_prod     bigint;
  v_costi        bigint;
  v_costi_prec   bigint;
begin
  select count(*), count(distinct s.codice) into v_righe, v_art
    from bi.cruscotto_staging s where s.run_id = p_run_id;

  if v_righe = 0 then
    return query select true, 'staging_vuota', 0::bigint,
      'Nessuna riga caricata per il run indicato';
    return;
  end if;

  -- Chiave assente: senza codice o magazzino la riga non è collocabile.
  return query
  select true, 'chiave_mancante', count(*),
         'righe senza codice o senza magazzino'
    from bi.cruscotto_staging s
   where s.run_id = p_run_id
     and (nullif(btrim(s.codice), '') is null or nullif(btrim(s.magazzino), '') is null)
  having count(*) > 0;

  -- Duplicati: la coppia (codice, magazzino) è la chiave primaria in produzione.
  return query
  select true, 'duplicato_codice_magazzino', count(*),
         'coppie (codice, magazzino) presenti più di una volta'
    from (
      select 1 from bi.cruscotto_staging s
       where s.run_id = p_run_id
       group by s.codice, s.magazzino having count(*) > 1
    ) d
  having count(*) > 0;

  -- Crollo delle righe: estrazione troncata, filtro sbagliato, file parziale.
  -- Il riferimento è il più alto fra il run corrente e la produzione attuale.
  -- Guardare solo il run precedente lascerebbe scoperto il PRIMO ingest, che
  -- accetterebbe un file parziale e disattiverebbe l'intera anagrafica:
  -- bi_activate_cruscotto non lo intercetta, perché confronta il DB con lo
  -- snapshot appena caricato e se sono entrambi piccoli il rapporto torna.
  select r.row_count into v_righe_prec
    from bi.cruscotto_runs r where r.status = 'current';
  select count(*) into v_righe_prod from preventivatore.prodotti_giacenze;
  v_righe_soglia := greatest(coalesce(v_righe_prec, 0), coalesce(v_righe_prod, 0));

  if v_righe_soglia > 100 and v_righe < (v_righe_soglia * 0.8)::bigint then
    return query select true, 'calo_righe_anomalo', v_righe,
      format('%s righe contro un riferimento di %s (run corrente: %s, giacenze in produzione: %s): calo oltre il 20%%',
             v_righe, v_righe_soglia, coalesce(v_righe_prec::text, 'n/d'), v_righe_prod);
  end if;

  -- Stessa logica sugli articoli: protegge dalla disattivazione di massa.
  select count(*) into v_art_prod from preventivatore.prodotti where attivo;
  if v_art_prod > 100 and v_art < (v_art_prod * 0.8)::bigint then
    return query select true, 'calo_articoli_anomalo', v_art,
      format('%s articoli nel file contro %s attivi in produzione: calo oltre il 20%%',
             v_art, v_art_prod);
  end if;

  -- Crollo degli articoli valorizzati: sintomo di join sul listino andato a vuoto.
  -- Senza questo controllo un'estrazione difettosa azzererebbe i costi in
  -- anagrafica e lo storico registrerebbe migliaia di finti azzeramenti.
  select count(distinct s.codice) into v_costi
    from bi.cruscotto_staging s
   where s.run_id = p_run_id and s.ult_costo is not null;

  select greatest(
           (select count(*) from bi.costi_storico c where c.valid_to is null and c.costo is not null),
           (select count(*) from preventivatore.prodotti p where p.attivo and p.ult_costo is not null)
         ) into v_costi_prec;

  if v_costi_prec > 100 and v_costi < (v_costi_prec * 0.8)::bigint then
    return query select true, 'crollo_costi', v_costi,
      format('%s articoli con costo contro un riferimento di %s: calo oltre il 20%%',
             v_costi, v_costi_prec);
  end if;

  -- Da qui in giù: segnalazioni, non blocchi.

  return query
  select false, 'disponibilita_non_coerente', count(*),
         'disponibilità diversa dalla formula sulle quantità (tolleranza 0,001)'
    from bi.cruscotto_staging s
   where s.run_id = p_run_id
     and abs(
       bi.disponibilita_attesa(
         coalesce(s.esistenza, 0), coalesce(s.qta_ord_fornitori, 0),
         coalesce(s.qta_ord_clienti, 0), coalesce(s.qta_imp_produzione, 0),
         coalesce(s.qta_ord_produzione, 0), coalesce(s.qta_vis_clienti, 0),
         coalesce(s.qta_cl_fornitori, 0)
       ) - coalesce(s.disponibilita, 0)
     ) > 0.001
  having count(*) > 0;

  return query
  select false, 'articolo_senza_costo', count(distinct s.codice),
         'articoli con Ult_Costo vuoto: resteranno NULL'
    from bi.cruscotto_staging s
   where s.run_id = p_run_id and s.ult_costo is null
  having count(distinct s.codice) > 0;

  -- Importi molto alti con data antecedente all'euro: quasi sempre lire
  -- mai convertite rimaste in anagrafica.
  return query
  select false, 'costo_sospetto', count(distinct s.codice),
         'costo oltre 50.000 con data anteriore al 2002: possibili lire non convertite'
    from bi.cruscotto_staging s
   where s.run_id = p_run_id
     and s.ult_costo > 50000
     and (s.data_ult_costo is null or s.data_ult_costo < date '2002-01-01')
  having count(distinct s.codice) > 0;

  return query
  select false, 'magazzino_nuovo', count(distinct s.magazzino),
         'magazzini non ancora presenti in prodotti_giacenze'
    from bi.cruscotto_staging s
   where s.run_id = p_run_id
     and s.magazzino is not null
     and not exists (
       select 1 from preventivatore.prodotti_giacenze g where g.magazzino = s.magazzino
     )
  having count(distinct s.magazzino) > 0;
end;
$$;

comment on function bi.valida_cruscotto_staging(text) is
  'Controlli sullo staging. Righe con bloccante=true impediscono l''ingest.';

-- ── Ingest ──────────────────────────────────────────────────────────────────

create or replace function bi.ingest_cruscotto(
  p_run_id      text,
  p_captured_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'bi', 'preventivatore', 'public', 'pg_temp'
as $$
declare
  v_inizio       timestamptz := clock_timestamp();
  v_status       text;
  v_blocchi      text;
  v_anomalie     jsonb;
  v_righe        bigint;
  v_articoli     bigint;
  v_costi_chiusi bigint := 0;
  v_costi_aperti bigint := 0;
  v_g_chiusi     bigint := 0;
  v_g_aperti     bigint := 0;
  v_p_nuovi      bigint := 0;
  v_p_agg        bigint := 0;
  v_p_disatt     bigint := 0;
  v_g_scritte    bigint := 0;
  v_g_eliminate  bigint := 0;
begin
  -- Serializza gli ingest fra loro. Si sblocca da solo a fine transazione,
  -- anche se questa fallisce: nessun lock orfano da ripulire a mano.
  perform pg_advisory_xact_lock(hashtext('bi.ingest_cruscotto'));

  select r.status into v_status from bi.cruscotto_runs r where r.run_id = p_run_id;
  if not found then
    raise exception 'Run Cruscotto % non registrato in bi.cruscotto_runs', p_run_id;
  end if;
  if v_status <> 'loading' then
    raise exception 'Run Cruscotto % non è in caricamento (status=%)', p_run_id, v_status;
  end if;

  -- Validazione: le anomalie bloccanti fermano tutto prima di ogni scrittura.
  select string_agg(format('%s (%s: %s)', v.tipo, v.occorrenze, v.dettaglio), '; ')
    into v_blocchi
    from bi.valida_cruscotto_staging(p_run_id) v
   where v.bloccante;

  if v_blocchi is not null then
    raise exception 'Validazione fallita per il run %: %', p_run_id, v_blocchi;
  end if;

  select jsonb_agg(jsonb_build_object(
           'tipo', v.tipo, 'occorrenze', v.occorrenze, 'dettaglio', v.dettaglio))
    into v_anomalie
    from bi.valida_cruscotto_staging(p_run_id) v;

  -- ── Snapshot normalizzato ──
  -- Una riga per (codice, magazzino), con codice e magazzino ripuliti.
  drop table if exists _snap;
  create temp table _snap on commit drop as
  select btrim(s.codice)    as codice,
         btrim(s.magazzino) as magazzino,
         s.descrizione, s.codice_uc,
         s.cat_com_articolo_codice, s.cat_com_articolo_descrizione,
         s.cat_merceologica_codice, s.cat_merceologica_descrizione,
         s.gruppo_articoli_codice, s.gruppo_articoli_descrizione,
         s.reparto_codice, s.reparto_descrizione,
         s.cat_fiscale_codice, s.cat_fiscale_descrizione,
         s.cat_esposizione_codice, s.cat_esposizione_descrizione,
         -- Arrotondamento alla scala delle colonne di destinazione: 4 per i
         -- costi, 3 per le quantità. Lo staging conserva la precisione piena
         -- del CSV (4 decimali sulle quantità, 6 sui costi), ma le tabelle di
         -- arrivo hanno scala fissa. Confrontare i valori grezzi e scriverli
         -- arrotondati faceva risultare "cambiato" ciò che cambiato non era:
         -- 22.8414 contro il 22.841 già in archivio. Da qui in poi confronto
         -- e scrittura vedono gli stessi numeri.
         round(s.ult_costo, 4) as ult_costo, s.data_ult_costo,
         round(s.qta_rim_iniziale, 3)   as qta_rim_iniziale,
         round(s.qta_caricata, 3)       as qta_caricata,
         round(s.qta_scaricata, 3)      as qta_scaricata,
         round(s.qta_altri_carichi, 3)  as qta_altri_carichi,
         round(s.qta_altri_scarichi, 3) as qta_altri_scarichi,
         round(s.qta_imp_produzione, 3) as qta_imp_produzione,
         round(s.qta_ord_clienti, 3)    as qta_ord_clienti,
         round(s.qta_ord_fornitori, 3)  as qta_ord_fornitori,
         round(s.qta_vis_clienti, 3)    as qta_vis_clienti,
         round(s.qta_vis_fornitori, 3)  as qta_vis_fornitori,
         round(s.qta_reso_clienti, 3)   as qta_reso_clienti,
         round(s.qta_reso_fornitori, 3) as qta_reso_fornitori,
         round(s.qta_ord_produzione, 3) as qta_ord_produzione,
         round(s.qta_cl_clienti, 3)     as qta_cl_clienti,
         round(s.qta_cl_fornitori, 3)   as qta_cl_fornitori,
         round(s.qta_cl_terzi, 3)       as qta_cl_terzi,
         round(s.qta_gruppo_lib_1, 3)   as qta_gruppo_lib_1,
         round(s.qta_gruppo_lib_2, 3)   as qta_gruppo_lib_2,
         round(s.qta_gruppo_lib_3, 3)   as qta_gruppo_lib_3,
         round(s.qta_gruppo_lib_4, 3)   as qta_gruppo_lib_4,
         round(s.esistenza, 3)          as esistenza,
         round(s.disponibilita, 3)      as disponibilita
    from bi.cruscotto_staging s
   where s.run_id = p_run_id;

  create unique index on _snap (codice, magazzino);
  analyze _snap;

  select count(*), count(distinct codice) into v_righe, v_articoli from _snap;

  -- ── Storico costi (change-only, chiave: codice) ──
  -- Costo e data sono attributi dell'articolo: identici su ogni magazzino,
  -- quindi si prende una riga sola per codice.
  drop table if exists _costi;
  create temp table _costi on commit drop as
  select distinct on (n.codice)
         n.codice, n.codice_uc as uc, n.ult_costo as costo, n.data_ult_costo as data_costo
    from _snap n
   order by n.codice, n.magazzino;

  drop table if exists _costi_cambi;
  create temp table _costi_cambi on commit drop as
  select c.codice, c.uc, c.costo, c.data_costo, a.id as id_aperto
    from _costi c
    left join bi.costi_storico a on a.codice = c.codice and a.valid_to is null
   where (c.costo, c.data_costo) is distinct from (a.costo, a.data_costo)
     -- Il primo avvistamento di un articolo senza costo non è un evento:
     -- non si apre un intervallo per dire "non lo so".
     and (a.id is not null or c.costo is not null);

  update bi.costi_storico h
     set valid_to = p_captured_at
    from _costi_cambi c
   where h.id = c.id_aperto
     and p_captured_at > h.valid_from;
  get diagnostics v_costi_chiusi = row_count;

  insert into bi.costi_storico (codice, uc, costo, data_costo, valid_from, run_id)
  select c.codice, c.uc, c.costo, c.data_costo, p_captured_at, p_run_id
    from _costi_cambi c
    -- Se l'intervallo aperto ha già valid_from >= captured_at siamo davanti a
    -- uno snapshot più vecchio di quello registrato: non si riscrive la storia.
   where not exists (
     select 1 from bi.costi_storico h
      where h.codice = c.codice and h.valid_to is null
   );
  get diagnostics v_costi_aperti = row_count;

  -- ── Storico giacenze (change-only, formato lungo) ──
  -- Un record per (codice, magazzino, campo) cambiato. `disponibilita` è
  -- esclusa: è derivata dalle altre e si ricalcola quando serve.
  drop table if exists _giac_lungo;
  create temp table _giac_lungo on commit drop as
  select n.codice, n.magazzino, v.campo, v.valore
    from _snap n
    cross join lateral (values
      ('qta_rim_iniziale',   n.qta_rim_iniziale),
      ('qta_caricata',       n.qta_caricata),
      ('qta_scaricata',      n.qta_scaricata),
      ('qta_altri_carichi',  n.qta_altri_carichi),
      ('qta_altri_scarichi', n.qta_altri_scarichi),
      ('qta_imp_produzione', n.qta_imp_produzione),
      ('qta_ord_clienti',    n.qta_ord_clienti),
      ('qta_ord_fornitori',  n.qta_ord_fornitori),
      ('qta_vis_clienti',    n.qta_vis_clienti),
      ('qta_vis_fornitori',  n.qta_vis_fornitori),
      ('qta_reso_clienti',   n.qta_reso_clienti),
      ('qta_reso_fornitori', n.qta_reso_fornitori),
      ('qta_ord_produzione', n.qta_ord_produzione),
      ('qta_cl_clienti',     n.qta_cl_clienti),
      ('qta_cl_fornitori',   n.qta_cl_fornitori),
      ('qta_cl_terzi',       n.qta_cl_terzi),
      ('qta_gruppo_lib_1',   n.qta_gruppo_lib_1),
      ('qta_gruppo_lib_2',   n.qta_gruppo_lib_2),
      ('qta_gruppo_lib_3',   n.qta_gruppo_lib_3),
      ('qta_gruppo_lib_4',   n.qta_gruppo_lib_4),
      ('esistenza',          n.esistenza)
    ) as v(campo, valore);

  drop table if exists _giac_cambi;
  create temp table _giac_cambi on commit drop as
  select l.codice, l.magazzino, l.campo, l.valore,
         a.valore as valore_precedente, a.id as id_aperto
    from _giac_lungo l
    left join bi.giacenze_storico a
      on a.codice = l.codice and a.magazzino = l.magazzino
     and a.campo = l.campo and a.valid_to is null
   where l.valore is distinct from a.valore
     -- Baseline: al primo avvistamento si registrano solo i campi valorizzati.
     -- Seminare 21 zeri per articolo/magazzino gonfierebbe lo storico di
     -- centinaia di migliaia di righe che non dicono nulla.
     and (a.id is not null or (l.valore is not null and l.valore <> 0));

  update bi.giacenze_storico h
     set valid_to = p_captured_at
    from _giac_cambi c
   where h.id = c.id_aperto
     and p_captured_at > h.valid_from;
  get diagnostics v_g_chiusi = row_count;

  insert into bi.giacenze_storico
    (codice, magazzino, campo, valore_precedente, valore, valid_from, run_id)
  select c.codice, c.magazzino, c.campo, c.valore_precedente, c.valore,
         p_captured_at, p_run_id
    from _giac_cambi c
   where not exists (
     select 1 from bi.giacenze_storico h
      where h.codice = c.codice and h.magazzino = c.magazzino
        and h.campo = c.campo and h.valid_to is null
   );
  get diagnostics v_g_aperti = row_count;

  -- ── Anagrafica ──
  -- Il magazzino '1' è il principale: quando c'è, è la fonte più affidabile
  -- per i campi anagrafici.
  drop table if exists _ana;
  create temp table _ana on commit drop as
  select distinct on (n.codice)
         n.codice,
         bi.norm_codice(n.codice)           as codice_norm,
         n.descrizione,
         n.codice_uc                        as uc,
         n.cat_esposizione_descrizione      as categoria,
         n.cat_esposizione_codice,
         n.cat_merceologica_descrizione     as cat_merc,
         n.cat_merceologica_codice          as cat_merc_codice,
         n.gruppo_articoli_descrizione      as gruppo,
         n.gruppo_articoli_codice           as gruppo_codice,
         n.reparto_codice,
         n.reparto_descrizione              as reparto_desc,
         n.cat_fiscale_codice,
         n.cat_fiscale_descrizione          as cat_fiscale_desc,
         n.cat_com_articolo_codice          as fornitore_codice,
         n.cat_com_articolo_descrizione     as fornitore,
         n.ult_costo,
         n.data_ult_costo
    from _snap n
   order by n.codice, (n.magazzino = '1') desc, n.magazzino;

  create index on _ana (codice);
  analyze _ana;

  with upd as (
    insert into preventivatore.prodotti as p (
      codice, codice_norm, descrizione, uc, categoria, cat_esposizione_codice,
      cat_merc, cat_merc_codice, gruppo, gruppo_codice,
      reparto_codice, reparto_desc, cat_fiscale_codice, cat_fiscale_desc,
      fornitore_codice, fornitore, ult_costo, data_ult_costo,
      attivo, hash_riga, aggiornato_il
    )
    select a.codice, a.codice_norm, a.descrizione, a.uc, a.categoria, a.cat_esposizione_codice,
           a.cat_merc, a.cat_merc_codice, a.gruppo, a.gruppo_codice,
           a.reparto_codice, a.reparto_desc, a.cat_fiscale_codice, a.cat_fiscale_desc,
           a.fornitore_codice, a.fornitore, a.ult_costo, a.data_ult_costo,
           true,
           md5(coalesce(a.descrizione,'')||'|'||coalesce(a.uc,'')||'|'||coalesce(a.categoria,'')||'|'||
               coalesce(a.cat_esposizione_codice,'')||'|'||coalesce(a.cat_merc,'')||'|'||
               coalesce(a.cat_merc_codice,'')||'|'||coalesce(a.gruppo,'')||'|'||
               coalesce(a.gruppo_codice,'')||'|'||coalesce(a.reparto_codice,'')||'|'||
               coalesce(a.reparto_desc,'')||'|'||coalesce(a.cat_fiscale_codice,'')||'|'||
               coalesce(a.cat_fiscale_desc,'')||'|'||coalesce(a.fornitore_codice,'')||'|'||
               coalesce(a.fornitore,'')||'|'||coalesce(trim_scale(a.ult_costo)::text,'')||'|'||
               coalesce(a.data_ult_costo::text,'')),
           now()
      from _ana a
    on conflict (codice) do update set
      codice_norm = excluded.codice_norm,
      descrizione = excluded.descrizione,
      uc = excluded.uc,
      categoria = excluded.categoria,
      cat_esposizione_codice = excluded.cat_esposizione_codice,
      cat_merc = excluded.cat_merc,
      cat_merc_codice = excluded.cat_merc_codice,
      gruppo = excluded.gruppo,
      gruppo_codice = excluded.gruppo_codice,
      reparto_codice = excluded.reparto_codice,
      reparto_desc = excluded.reparto_desc,
      cat_fiscale_codice = excluded.cat_fiscale_codice,
      cat_fiscale_desc = excluded.cat_fiscale_desc,
      fornitore_codice = excluded.fornitore_codice,
      fornitore = excluded.fornitore,
      ult_costo = excluded.ult_costo,
      data_ult_costo = excluded.data_ult_costo,
      attivo = true,
      hash_riga = excluded.hash_riga,
      aggiornato_il = now()
    -- Si riscrive solo dove qualcosa è davvero cambiato: il confronto è sui
    -- valori, non sull'hash, così non dipende da come i numeri sono formattati.
    where p.hash_riga is distinct from excluded.hash_riga
       or p.attivo is distinct from true
    returning (xmax = 0) as inserito
  )
  select count(*) filter (where inserito), count(*) filter (where not inserito)
    into v_p_nuovi, v_p_agg
    from upd;

  -- Codici spariti dal Cruscotto: disattivati, mai cancellati. Restano
  -- referenziati dalle righe dei preventivi storici.
  update preventivatore.prodotti p
     set attivo = false, aggiornato_il = now()
   where p.attivo
     and not exists (select 1 from _ana a where a.codice = p.codice);
  get diagnostics v_p_disatt = row_count;

  -- ── Giacenze ──
  insert into preventivatore.prodotti_giacenze as g (
    codice, magazzino, esistenza, disponibilita,
    qta_rim_iniziale, qta_caricata, qta_scaricata, qta_altri_carichi, qta_altri_scarichi,
    qta_imp_produzione, qta_ord_clienti, qta_ord_fornitori, qta_vis_clienti, qta_vis_fornitori,
    qta_reso_clienti, qta_reso_fornitori, qta_ord_produzione,
    qta_cl_clienti, qta_cl_fornitori, qta_cl_terzi,
    qta_gruppo_lib_1, qta_gruppo_lib_2, qta_gruppo_lib_3, qta_gruppo_lib_4,
    aggiornato_il
  )
  select n.codice, n.magazzino, coalesce(n.esistenza, 0), coalesce(n.disponibilita, 0),
         n.qta_rim_iniziale, n.qta_caricata, n.qta_scaricata, n.qta_altri_carichi, n.qta_altri_scarichi,
         n.qta_imp_produzione, n.qta_ord_clienti, n.qta_ord_fornitori, n.qta_vis_clienti, n.qta_vis_fornitori,
         n.qta_reso_clienti, n.qta_reso_fornitori, n.qta_ord_produzione,
         n.qta_cl_clienti, n.qta_cl_fornitori, n.qta_cl_terzi,
         n.qta_gruppo_lib_1, n.qta_gruppo_lib_2, n.qta_gruppo_lib_3, n.qta_gruppo_lib_4,
         now()
    from _snap n
  on conflict (codice, magazzino) do update set
    esistenza = excluded.esistenza,
    disponibilita = excluded.disponibilita,
    qta_rim_iniziale = excluded.qta_rim_iniziale,
    qta_caricata = excluded.qta_caricata,
    qta_scaricata = excluded.qta_scaricata,
    qta_altri_carichi = excluded.qta_altri_carichi,
    qta_altri_scarichi = excluded.qta_altri_scarichi,
    qta_imp_produzione = excluded.qta_imp_produzione,
    qta_ord_clienti = excluded.qta_ord_clienti,
    qta_ord_fornitori = excluded.qta_ord_fornitori,
    qta_vis_clienti = excluded.qta_vis_clienti,
    qta_vis_fornitori = excluded.qta_vis_fornitori,
    qta_reso_clienti = excluded.qta_reso_clienti,
    qta_reso_fornitori = excluded.qta_reso_fornitori,
    qta_ord_produzione = excluded.qta_ord_produzione,
    qta_cl_clienti = excluded.qta_cl_clienti,
    qta_cl_fornitori = excluded.qta_cl_fornitori,
    qta_cl_terzi = excluded.qta_cl_terzi,
    qta_gruppo_lib_1 = excluded.qta_gruppo_lib_1,
    qta_gruppo_lib_2 = excluded.qta_gruppo_lib_2,
    qta_gruppo_lib_3 = excluded.qta_gruppo_lib_3,
    qta_gruppo_lib_4 = excluded.qta_gruppo_lib_4,
    aggiornato_il = now()
  where (g.esistenza, g.disponibilita, g.qta_rim_iniziale, g.qta_caricata, g.qta_scaricata,
         g.qta_altri_carichi, g.qta_altri_scarichi, g.qta_imp_produzione, g.qta_ord_clienti,
         g.qta_ord_fornitori, g.qta_vis_clienti, g.qta_vis_fornitori, g.qta_reso_clienti,
         g.qta_reso_fornitori, g.qta_ord_produzione, g.qta_cl_clienti, g.qta_cl_fornitori,
         g.qta_cl_terzi, g.qta_gruppo_lib_1, g.qta_gruppo_lib_2, g.qta_gruppo_lib_3, g.qta_gruppo_lib_4)
     is distinct from
        (excluded.esistenza, excluded.disponibilita, excluded.qta_rim_iniziale, excluded.qta_caricata,
         excluded.qta_scaricata, excluded.qta_altri_carichi, excluded.qta_altri_scarichi,
         excluded.qta_imp_produzione, excluded.qta_ord_clienti, excluded.qta_ord_fornitori,
         excluded.qta_vis_clienti, excluded.qta_vis_fornitori, excluded.qta_reso_clienti,
         excluded.qta_reso_fornitori, excluded.qta_ord_produzione, excluded.qta_cl_clienti,
         excluded.qta_cl_fornitori, excluded.qta_cl_terzi, excluded.qta_gruppo_lib_1,
         excluded.qta_gruppo_lib_2, excluded.qta_gruppo_lib_3, excluded.qta_gruppo_lib_4);
  get diagnostics v_g_scritte = row_count;

  -- Riga sparita = articolo non più registrato in quel magazzino.
  -- Diverso da "registrato a zero", che resta con esistenza = 0.
  delete from preventivatore.prodotti_giacenze g
   where not exists (
     select 1 from _snap n where n.codice = g.codice and n.magazzino = g.magazzino
   );
  get diagnostics v_g_eliminate = row_count;

  -- ── Chiusura run ──
  update bi.cruscotto_runs r
     set row_count      = v_righe,
         articoli_count = v_articoli,
         captured_at    = coalesce(r.captured_at, p_captured_at at time zone 'UTC'),
         status         = 'validated',
         metadata       = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
                            'anomalie', coalesce(v_anomalie, '[]'::jsonb),
                            'costi_chiusi', v_costi_chiusi, 'costi_aperti', v_costi_aperti,
                            'giacenze_chiuse', v_g_chiusi, 'giacenze_aperte', v_g_aperti)
   where r.run_id = p_run_id;

  perform public.bi_activate_cruscotto(p_run_id);

  delete from bi.cruscotto_staging s where s.run_id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id,
    'righe', v_righe,
    'articoli', v_articoli,
    'prodotti_nuovi', v_p_nuovi,
    'prodotti_aggiornati', v_p_agg,
    'prodotti_disattivati', v_p_disatt,
    'giacenze_scritte', v_g_scritte,
    'giacenze_eliminate', v_g_eliminate,
    'storico_costi_chiusi', v_costi_chiusi,
    'storico_costi_aperti', v_costi_aperti,
    'storico_giacenze_chiuse', v_g_chiusi,
    'storico_giacenze_aperte', v_g_aperti,
    'anomalie', coalesce(v_anomalie, '[]'::jsonb),
    'durata_ms', round(extract(epoch from clock_timestamp() - v_inizio) * 1000)
  );
end;
$$;

comment on function bi.ingest_cruscotto(text, timestamptz) is
  'Ingest atomico: valida lo staging, aggiorna gli storici change-only, riallinea anagrafica e giacenze, attiva il run. O tutto o niente.';

-- Nessun accesso diretto: l''ingest passa dal service role del receiver.
revoke all on function bi.ingest_cruscotto(text, timestamptz) from public, anon, authenticated;
revoke all on function bi.valida_cruscotto_staging(text) from public, anon, authenticated;
revoke all on table bi.cruscotto_staging from public, anon, authenticated;

-- ── Accesso dal caricatore ──────────────────────────────────────────────────
-- PostgREST serve solo gli schemi dichiarati (qui: public). Anziché aggiungere
-- 'bi' alla superficie dell'API — il che pubblicherebbe anche staging, storici
-- e runs — si espongono cinque funzioni in public, SECURITY DEFINER e concesse
-- al solo service_role: anon e authenticated non le vedono nemmeno.

create or replace function public.bi_cruscotto_run_start(
  p_run_id      text,
  p_source      text default 'SRVWOA',
  p_captured_at timestamptz default null,
  p_sha256      text default null,
  p_metadata    jsonb default null
)
returns text
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  insert into bi.cruscotto_runs (run_id, source, captured_at, sha256, status, metadata)
  values (p_run_id, p_source, (p_captured_at at time zone 'UTC'), p_sha256, 'loading', p_metadata);
  return p_run_id;
end;
$fn$;

-- Le chiavi del JSON devono chiamarsi come le colonne di staging:
-- jsonb_populate_recordset fa mappatura e conversione dei tipi, così un numero
-- illeggibile fallisce qui e non a metà ingest.
create or replace function public.bi_cruscotto_staging_load(
  p_run_id text,
  p_righe  jsonb
)
returns bigint
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
declare v_n bigint;
begin
  if jsonb_typeof(p_righe) <> 'array' then
    raise exception 'p_righe deve essere un array JSON';
  end if;

  insert into bi.cruscotto_staging
  select * from jsonb_populate_recordset(null::bi.cruscotto_staging, p_righe);
  get diagnostics v_n = row_count;

  -- Difesa contro un run_id incoerente fra parametro e payload.
  if exists (select 1 from bi.cruscotto_staging s
              where s.run_id is distinct from p_run_id
                and s.run_id in (select (e->>'run_id') from jsonb_array_elements(p_righe) e)) then
    raise exception 'Il payload contiene righe con run_id diverso da %', p_run_id;
  end if;

  return v_n;
end;
$fn$;

create or replace function public.bi_cruscotto_valida(p_run_id text)
returns table (bloccante boolean, tipo text, occorrenze bigint, dettaglio text)
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select v.bloccante, v.tipo, v.occorrenze, v.dettaglio
    from bi.valida_cruscotto_staging(p_run_id) v;
$fn$;

create or replace function public.bi_cruscotto_ingest(
  p_run_id      text,
  p_captured_at timestamptz default now()
)
returns jsonb
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select bi.ingest_cruscotto(p_run_id, p_captured_at);
$fn$;

create or replace function public.bi_cruscotto_run_fail(
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
  update bi.cruscotto_runs
     set status = 'failed', error_message = left(p_errore, 4000)
   where run_id = p_run_id;
  if p_pulisci then
    delete from bi.cruscotto_staging where run_id = p_run_id;
  end if;
end;
$fn$;

-- ── Privilegi ───────────────────────────────────────────────────────────────
-- Il revoke da PUBLIC toglie il privilegio anche a service_role, che lo
-- eredita: senza i grant espliciti il caricatore prende "permission denied".
revoke all on function public.bi_cruscotto_run_start(text, text, timestamptz, text, jsonb) from public, anon, authenticated;
revoke all on function public.bi_cruscotto_staging_load(text, jsonb) from public, anon, authenticated;
revoke all on function public.bi_cruscotto_valida(text) from public, anon, authenticated;
revoke all on function public.bi_cruscotto_ingest(text, timestamptz) from public, anon, authenticated;
revoke all on function public.bi_cruscotto_run_fail(text, text, boolean) from public, anon, authenticated;

grant usage on schema bi to service_role;
grant execute on function bi.ingest_cruscotto(text, timestamptz) to service_role;
grant execute on function bi.valida_cruscotto_staging(text) to service_role;
grant execute on function bi.norm_codice(text) to service_role;
grant select, insert, update, delete on bi.cruscotto_staging to service_role;

grant execute on function public.bi_cruscotto_run_start(text, text, timestamptz, text, jsonb) to service_role;
grant execute on function public.bi_cruscotto_staging_load(text, jsonb) to service_role;
grant execute on function public.bi_cruscotto_valida(text) to service_role;
grant execute on function public.bi_cruscotto_ingest(text, timestamptz) to service_role;
grant execute on function public.bi_cruscotto_run_fail(text, text, boolean) to service_role;
