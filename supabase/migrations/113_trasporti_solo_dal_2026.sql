-- 113_trasporti_solo_dal_2026.sql
--
-- Le bolle del portale sono quelle del 2026. Tutto il resto esce.
--
-- ============================================================================
-- PERCHE'
-- ============================================================================
-- `bi.trasporti_documenti` conteneva 15.943 documenti, dal 1954 al 2026: 10.547
-- non c'entrano niente con il controllo delle fatture dei vettori. Non e' un
-- errore della pipeline, e' il suo disegno: la finestra della riconciliazione
-- guarda `data_registrazione` **e** `data_modifica`, quindi un documento del
-- 2019 corretto la settimana scorsa rientra ogni volta. Sulla pagina dove il
-- magazzino misura i colli quelle righe sono rumore, e nel conteggio delle
-- spedizioni da controllare sono un errore.
--
-- Due cose, quindi, non una:
--   1) si cancella dal grezzo quello che e' gia' entrato;
--   2) si mette il filtro nell'ingest, perche' la prossima riconciliazione non
--      lo riporti dentro il giorno dopo.
--
-- Il livello operativo non viene toccato: nessuna `vettori.spedizioni` e'
-- legata a un documento anteriore al 2026 (verificato: zero righe in
-- `vettori.spedizioni_documenti`). Il grezzo, comunque, e' una copia: se un
-- giorno servisse il pregresso, si riprende dal gestionale allargando la
-- finestra della riconciliazione.
--
-- La soglia e' scritta in chiaro, `2026-01-01`, e non calcolata sull'anno in
-- corso: quando l'amministrazione vorra' conservare anche il 2027 non dovra'
-- succedere da solo a Capodanno, ma perche' qualcuno lo ha deciso.

delete from bi.trasporti_documenti
 where coalesce(data_documento, data_registrazione::date) < date '2026-01-01';

-- Lo staging non si ripulisce qui: lo riscrive ogni run, e la retention se ne
-- occupa gia'.

CREATE OR REPLACE FUNCTION bi.ingest_trasporti(p_run_id text, p_profilo text, p_captured_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'bi', 'public', 'pg_temp'
AS $function$
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
  where s.run_id = p_run_id
    -- Lo storico delle bolle comincia con il 2026, e quello che arriva prima
    -- non entra nemmeno nel livello grezzo. La finestra della riconciliazione
    -- guarda anche `data_modifica`: senza questo filtro basta una correzione a
    -- un documento del 2019 per riportarsi in casa mezzo archivio, e sulla
    -- pagina dove il magazzino misura i colli comparirebbero bolle di sette
    -- anni fa. Il criterio usa la data di registrazione quando il documento
    -- non ha una data propria: sono 150 documenti su 496, quasi tutti
    -- lavorazioni esterne.
    and coalesce(s.data_documento, s.data_registrazione::date) >= date '2026-01-01';

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
$function$;


notify pgrst, 'reload schema';
