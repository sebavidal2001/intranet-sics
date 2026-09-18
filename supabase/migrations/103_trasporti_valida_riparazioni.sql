-- 103_trasporti_valida_riparazioni.sql
--
-- Il caricatore rifiutava le bolle di riparazione appena estratte.
--
-- ============================================================================
-- COSA E' SUCCESSO
-- ============================================================================
-- L'estrazione e' stata allargata ai quattro profili di riparazione (RIPEF,
-- RIPEC, RIPUF, RIPUC): 114 documenti che viaggiano davvero, con porto, colli e
-- nella maggior parte dei casi un vettore. Alla prima riconciliazione il
-- caricatore li ha respinti tutti e diciassette quelli in finestra, con
-- `tipo_registro_non_valido`.
--
-- Il rifiuto e' il comportamento giusto: la validazione ha fatto il suo mestiere
-- invece di ingoiare righe che non riconosceva. Quello che mancava era
-- aggiornarla insieme alla query, ed e' un pezzo del piano che era stato
-- dimenticato.
--
-- Due regole vanno riviste, non una.
--
-- 1) `tipo_registro_non_valido` — le riparazioni stanno nei registri GA e GV.
--    Si ammettono, ma SOLO per quei quattro profili: un registro sconosciuto
--    con un profilo qualunque deve continuare a bloccare, altrimenti la regola
--    smette di proteggere da qualsiasi cosa.
--
-- 2) `direzione_non_coerente` — la query ricava la direzione dal registro
--    (`DA` = entrata, tutto il resto = uscita). Per le riparazioni quel calcolo
--    sbaglia: RIPEF e RIPEC sono ENTRATE, e verrebbero registrate come uscite.
--    La query e' stata corretta per leggere il profilo, e la regola deve
--    verificare la stessa cosa — altrimenti approva un dato sbagliato oppure
--    boccia quello giusto.
--
-- Il verso conta: sbagliarlo significa cercare il numero di bolla dalla parte
-- sbagliata (sulle uscite la fattura cita il nostro numero, sugli arrivi quello
-- del fornitore) e non agganciare mai la riga alla fattura.

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
  -- I profili di riparazione, unici ammessi fuori dai registri DV e DA.
  v_riparazioni text[] := array['RIPEF', 'RIPEC', 'RIPUF', 'RIPUC'];
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
         'righe con tipo_registro diverso da DV o DA, e profilo non di riparazione'
    from bi.trasporti_documenti_staging s
   where s.run_id = p_run_id
     and (
       s.tipo_registro is null
       or (s.tipo_registro not in ('DV', 'DA')
           and coalesce(s.codice_profilo, '') <> all (v_riparazioni))
     )
  having count(*) > 0;

  return query
  select true, 'direzione_non_coerente', count(*),
         'direzione incoerente con il registro, o con il profilo per le riparazioni'
    from bi.trasporti_documenti_staging s
   where s.run_id = p_run_id
     and s.direzione is distinct from
         case when s.tipo_registro = 'DA' then 'ENTRATA'
              when s.tipo_registro = 'DV' then 'USCITA'
              -- Fuori dai due registri decide il profilo: la riparazione che
              -- entra e quella che esce hanno lo stesso registro.
              when s.codice_profilo in ('RIPEF', 'RIPEC') then 'ENTRATA'
              when s.codice_profilo in ('RIPUF', 'RIPUC') then 'USCITA'
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
  'Controlla chiavi, duplicati, classificazione e completezza della riconciliazione. Ammette i registri GA e GV solo per i quattro profili di riparazione, e per quelli legge la direzione dal profilo. Il profilo live non viene mai trattato come snapshot.';

notify pgrst, 'reload schema';
