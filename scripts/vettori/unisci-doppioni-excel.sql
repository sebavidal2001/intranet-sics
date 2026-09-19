-- Unisce le spedizioni dei fogli Excel alle bolle del gestionale.
--
-- ============================================================================
-- IL PROBLEMA
-- ============================================================================
-- L'importazione dei fogli ha creato 978 spedizioni con `origine =
-- 'excel_storico'`. Quando poi il grezzo del gestionale e' stato rifuso per
-- intero, la fusione ha riusato solo le righe con la chiave IDENTICA
-- (direzione + riferimento normalizzato + data), e fra foglio e gestionale la
-- data balla: sul foglio l'amministrazione scrive il giorno in cui la merce e'
-- arrivata, il gestionale porta quello del documento. Uno o due giorni, a volte
-- una settimana. Risultato: 576 spedizioni contate due volte.
--
-- ============================================================================
-- COME SI ACCOPPIANO, SENZA INDOVINARE
-- ============================================================================
-- Stesso numero di bolla e stessa direzione non bastano: i numeri di bolla dei
-- fornitori ripartono da 1 ogni anno e si ripetono fra fornitori diversi. Con
-- il solo numero si uniscono per sbaglio TELLURE ROTA con TINTI ENZO, o
-- ATLAS FILTRI con DEBEM — e il foglio ha perfino una riga segnaposto
-- «inizio», che finirebbe addosso a R.T.I. srl.
--
-- Serve quindi anche la controparte, confrontata dopo aver tolto quello che
-- cambia fra i due sistemi: il foglio abbrevia («BIANCHI IND», «FMI»), il
-- gestionale porta la ragione sociale intera («BIANCHI INDUSTRIAL spa a socio
-- unico», «F.M.I. FRANCESCHI srl»). Via la punteggiatura e le forme
-- societarie, uno dei due nomi deve essere il prefisso dell'altro, oppure i due
-- devono somigliarsi almeno al 50% (`similarity` di pg_trgm) — soglia che
-- recupera gli errori di battitura del foglio, «APO LUID FORCE» per «APO FLUID
-- FORCE», «SENSERMATIC» per «SENSORMATIC».
--
-- Un accoppiamento vale solo se e' 1 a 1: se due righe del foglio puntano alla
-- stessa bolla, o viceversa, si tiene quella con le date piu' vicine e le altre
-- restano dove sono. Meglio un doppione in piu' che una spedizione attribuita
-- alla bolla sbagliata.
--
-- ============================================================================
-- COSA SUCCEDE ALLA RIGA DEL FOGLIO
-- ============================================================================
-- Non si butta: si travasa, e solo dopo si cancella.
--
--  * COLLI E PESO. Sugli arrivi il gestionale non li ha quasi mai — la merce
--    in entrata li prende dalla registrazione a magazzino — mentre il foglio
--    sì, perche' l'amministrazione li copiava dal documento del fornitore.
--    Dove la bolla e' vuota e il foglio no, il valore passa e viene marcato in
--    `campi_forzati`: senza quella marca la prima sincronizzazione con il
--    gestionale lo riazzererebbe, ed e' esattamente il meccanismo che il
--    modulo usa per i campi corretti a mano.
--  * LE MISURE dei colli seguono la spedizione, se la bolla non ne ha gia'.
--  * I CONTROLLI e le ANOMALIE delle fatture gia' acquisite vengono ripuntati
--    sulla bolla: se si cancellasse la riga senza farlo, la chiave esterna
--    andrebbe a NULL e quella riga di fattura perderebbe la sua spedizione.
--  * LA NOTA della bolla registra da dove arriva quello che ha assorbito.
--
-- ============================================================================
-- QUANDO LA BOLLA E' CONGELATA
-- ============================================================================
-- Acquisire le fatture del 2026 ha congelato 501 spedizioni: da quel momento i
-- loro numeri sono quelli su cui il controllo e' stato fatto, e non si toccano
-- piu'. Sono anche la meta' delle coppie da unire, perche' le bolle fatturate
-- sono esattamente quelle che l'amministrazione teneva sul foglio.
--
-- Li' non si fonde: travasare colli e peso cambierebbe i numeri sotto un
-- controllo gia' emesso, che e' precisamente cio' che il congelamento vieta, e
-- il trigger lo impedirebbe comunque. La riga del foglio pero' non ha piu'
-- niente da dire: viene messa in `stato = 'ignorata'`, con la nota che rimanda
-- alla bolla. Resta consultabile, sparisce dall'elenco delle spedizioni da
-- controllare, e nessun dato viene buttato.
--
-- Rieseguibile: al secondo giro non trova piu' niente da unire.
--
--   psql -d intranet --single-transaction -f scripts/vettori/unisci-doppioni-excel.sql

-- Il nome ridotto a cio' che i due sistemi hanno in comune.
create or replace function pg_temp.nome_confronto(v text) returns text
language sql immutable as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        upper(coalesce(v, '')),
        '\m(SRL|S\.R\.L|SPA|S\.P\.A|SNC|SAS|SS|SOCIETA|A SOCIO UNICO|UNIPERSONALE|GROUP|ITALIA|ITALY)\M',
        ' ', 'g'),
      '[^A-Z0-9]', '', 'g'),
    '');
$$;

create temp table coppie_candidate on commit drop as
select
  e.id                     as excel_id,
  g.id                     as bolla_id,
  g.congelata              as bolla_congelata,
  g.numero_riferimento     as bolla_riferimento,
  g.data_documento         as bolla_data,
  e.data_documento         as excel_data,
  e.controparte_nome       as excel_controparte,
  e.colli_bolla            as excel_colli,
  e.peso_bolla             as excel_peso,
  abs(g.data_documento - e.data_documento) as distanza_giorni
from vettori.spedizioni e
join vettori.spedizioni g
  on g.origine = 'gestionale'
 and g.direzione = e.direzione
 and g.numero_riferimento_norm = e.numero_riferimento_norm
 and abs(g.data_documento - e.data_documento) <= 7
where e.origine = 'excel_storico'
  and not e.congelata
  and e.stato <> 'ignorata'
  and pg_temp.nome_confronto(e.controparte_nome) is not null
  and pg_temp.nome_confronto(g.controparte_nome) is not null
  and (
        pg_temp.nome_confronto(g.controparte_nome) like pg_temp.nome_confronto(e.controparte_nome) || '%'
     or pg_temp.nome_confronto(e.controparte_nome) like pg_temp.nome_confronto(g.controparte_nome) || '%'
     or similarity(pg_temp.nome_confronto(e.controparte_nome),
                   pg_temp.nome_confronto(g.controparte_nome)) >= 0.5
  );

-- Una riga del foglio per una bolla, e una bolla per una riga del foglio.
create temp table accoppiate on commit drop as
select distinct on (bolla_id) *
from (
  select distinct on (excel_id) *
  from coppie_candidate
  order by excel_id, distanza_giorni, bolla_id
) uno_per_excel
order by bolla_id, distanza_giorni, excel_id;

-- Le bolle libere si fondono; quelle congelate si limitano a spegnere la riga
-- del foglio.
create temp table coppie on commit drop as
select * from accoppiate where not bolla_congelata;

create temp table coppie_congelate on commit drop as
select * from accoppiate where bolla_congelata;

-- 1. Colli e peso che la bolla non ha.
update vettori.spedizioni g
   set colli_bolla = coalesce(g.colli_bolla, c.excel_colli::int),
       peso_bolla  = coalesce(g.peso_bolla, c.excel_peso),
       campi_forzati = g.campi_forzati
         || case when g.colli_bolla is null and c.excel_colli is not null then
              jsonb_build_object('colli_bolla', jsonb_build_object(
                'valore_precedente', 'null'::jsonb,
                'forzato_da', 'storico Excel 2026',
                'forzato_il', now()::text))
            else '{}'::jsonb end
         || case when g.peso_bolla is null and c.excel_peso is not null then
              jsonb_build_object('peso_bolla', jsonb_build_object(
                'valore_precedente', 'null'::jsonb,
                'forzato_da', 'storico Excel 2026',
                'forzato_il', now()::text))
            else '{}'::jsonb end,
       aggiornata_il = now()
  from coppie c
 where g.id = c.bolla_id
   and (
        (g.colli_bolla is null and c.excel_colli is not null)
     or (g.peso_bolla  is null and c.excel_peso  is not null)
   );

-- 2. Le misure dei colli seguono la spedizione.
update vettori.bolla_misure m
   set spedizione_id = c.bolla_id,
       modificato_il = now()
  from coppie c
 where m.spedizione_id = c.excel_id
   and not exists (
     select 1 from vettori.bolla_misure b where b.spedizione_id = c.bolla_id
   );

-- 3. Controlli e anomalie delle fatture gia' acquisite.
update vettori.controlli x set spedizione_id = c.bolla_id
  from coppie c where x.spedizione_id = c.excel_id;

update vettori.anomalie x set spedizione_id = c.bolla_id
  from coppie c where x.spedizione_id = c.excel_id;

-- 4. Da dove arriva quello che la bolla ha assorbito.
update vettori.spedizioni g
   set note = left(
         concat_ws(' ',
           nullif(g.note, ''),
           format('Storico Excel 2026 confluito: riga del %s, controparte «%s».',
                  to_char(c.excel_data, 'DD/MM/YYYY'),
                  coalesce(c.excel_controparte, 'non indicata'))
         ), 2000)
  from coppie c
 where g.id = c.bolla_id;

-- 5. La riga del foglio ha finito il suo lavoro.
delete from vettori.spedizioni e
 using coppie c
 where e.id = c.excel_id;

-- 6. Dove la bolla e' congelata la riga del foglio resta, ma smette di contare.
update vettori.spedizioni e
   set stato = 'ignorata',
       note = left(
         concat_ws(' ',
           nullif(e.note, ''),
           format('Doppione della bolla %s del %s, gia'' controllata e congelata: non si fonde per non cambiare i numeri sotto il controllo.',
                  coalesce(c.bolla_riferimento, '(senza numero)'),
                  to_char(c.bolla_data, 'DD/MM/YYYY'))
         ), 2000),
       aggiornata_il = now()
  from coppie_congelate c
 where e.id = c.excel_id;

select
  (select count(*) from coppie)                                              as unite,
  (select count(*) from coppie_congelate)                                    as ignorate,
  (select count(*) from vettori.spedizioni where origine = 'excel_storico')  as excel_rimaste,
  (select count(*) from vettori.spedizioni where origine = 'gestionale')     as gestionale,
  (select count(*) from vettori.spedizioni where stato <> 'ignorata')        as spedizioni_attive,
  (select count(*) from vettori.bolla_misure)                                as misure;
