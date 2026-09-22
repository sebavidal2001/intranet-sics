-- Attribuisce il vettore alle bolle che nel gestionale non ce l'hanno,
-- usando i fogli dell'amministrazione.
--
--   psql -d intranet -v csv=/percorso/storico_spedizioni_2026.csv \
--        --single-transaction -f scripts/vettori/vettore-dai-fogli.sql
--
-- Il CSV è quello prodotto da `scripts/vettori/estrai-storico-excel.py`.
--
-- ============================================================================
-- PERCHE'
-- ============================================================================
-- 2.471 spedizioni su 4.163 non hanno un vettore, e la ragione non è il
-- portale: è che il gestionale non lo contiene. Sugli arrivi, in particolare,
-- il documento è un DDT di acquisto del fornitore — il trasporto lo organizza
-- lui, e nessuno digita il vettore in un campo che descrive il nostro.
--
-- Il dato però esiste, ed è nei fogli: sono divisi PER VETTORE, quindi ogni
-- riga porta il vettore per costruzione. Su 1.009 righe estratte dai tre
-- workbook, 998 si ritrovano fra le spedizioni; le 11 che non si ritrovano
-- hanno un numero di bolla inutilizzabile sul foglio stesso (`XXX`, `??`, `-`,
-- oppure vuoto). Foglio e gestionale, sulle cose identificabili, dicono la
-- stessa cosa.
--
-- ============================================================================
-- QUANDO IL FOGLIO NON BASTA, E IL GESTIONALE COMPLETA
-- ============================================================================
-- Il foglio TNT-FEDEX mescola i due vettori senza una colonna che li distingua,
-- quindi da solo direbbe soltanto «uno dei due». Ma il gestionale, su quelle
-- stesse bolle, porta spesso un codice che è a sua volta una regola:
--
--   VT010063  «TNT per scatole - GLS per pallet»   → TNT oppure GLS
--   VT010015  «GLS fino a 30 Kg-FEDEX oltre»       → GLS oppure FedEx
--
-- Nessuno dei due basta da solo. Insieme sì, perché l'intersezione è un
-- vettore unico:
--
--   foglio TNT/FedEx  ∩  codice «TNT o GLS»   =  TNT
--   foglio GLS        ∩  codice «GLS o FedEx» =  GLS   (e il peso lo conferma:
--                                                 tutte sotto i 30 kg)
--
-- Dove l'intersezione resta di due vettori — foglio TNT/FedEx e nessun codice
-- nel gestionale — non si attribuisce niente. Si scrive nella nota che il
-- foglio dice «TNT o FedEx», e si lascia la casella vuota: un vettore messo a
-- indovinare sarebbe peggio di un vettore mancante, perché nessuno saprebbe
-- più che era stato indovinato.
--
-- Il vettore assegnato finisce in `campi_forzati` con l'origine dichiarata, e
-- questo non è un dettaglio: senza quella marca la prima sincronizzazione con
-- il gestionale lo riporterebbe a NULL, perché il gestionale continua a non
-- averlo. È lo stesso meccanismo dei campi corretti a mano dal banco.
--
-- Rieseguibile: al secondo giro non trova più niente da assegnare.

\set ON_ERROR_STOP on

create temp table foglio_2026 (
  vettore text, direzione text, data date, controparte text, numero_ddt text,
  colli numeric, peso_kg numeric, lunghezza_cm numeric, larghezza_cm numeric,
  altezza_cm numeric, peso_volumetrico_kg numeric, importo_fattura numeric, foglio text
) on commit drop;

-- COPY e non \copy: il file sta sul server, accanto al database, e psql qui
-- gira come `postgres`. Con `\copy` la sostituzione della variabile non
-- avviene in tutte le versioni, e l'errore che ne esce («Permission denied» su
-- un file chiamato «:») non somiglia per niente alla sua causa.
copy foglio_2026 from :'csv' with (format csv, header true, delimiter ';', null '');

-- Il nome ridotto a ciò che i due sistemi hanno in comune.
create or replace function pg_temp.nome_confronto(v text) returns text
language sql immutable as $$
  select nullif(
    regexp_replace(
      regexp_replace(upper(coalesce(v, '')),
        '\m(SRL|S\.R\.L|SPA|S\.P\.A|SNC|SAS|SS|SOCIETA|A SOCIO UNICO|UNIPERSONALE|GROUP|ITALIA|ITALY)\M',
        ' ', 'g'),
      '[^A-Z0-9]', '', 'g'),
    '');
$$;

-- La stessa normalizzazione del riferimento che usa il portale.
create or replace function pg_temp.norma(v text) returns text
language sql immutable as $$
  select nullif(ltrim(regexp_replace(upper(coalesce(v, '')), '[^A-Z0-9]', '', 'g'), '0'), '');
$$;

-- Una riga di foglio per spedizione: la più vicina di data, e il gestionale
-- prima dello storico quando entrambi sono candidati.
create temp table riga_foglio on commit drop as
with righe as (select f.*, row_number() over () as rn from foglio_2026 f)
select distinct on (s.id)
  s.id                as spedizione_id,
  r.vettore           as vettore_foglio,
  r.foglio            as foglio,
  r.data              as data_foglio,
  s.peso_bolla        as peso
from righe r
join vettori.spedizioni s
  on lower(r.direzione) = s.direzione
 and pg_temp.norma(r.numero_ddt) = s.numero_riferimento_norm
 and abs(r.data - s.data_documento) <= 7
 and pg_temp.nome_confronto(r.controparte) is not null
 and pg_temp.nome_confronto(s.controparte_nome) is not null
 and (pg_temp.nome_confronto(s.controparte_nome) like pg_temp.nome_confronto(r.controparte) || '%'
   or pg_temp.nome_confronto(r.controparte) like pg_temp.nome_confronto(s.controparte_nome) || '%'
   or similarity(pg_temp.nome_confronto(r.controparte),
                 pg_temp.nome_confronto(s.controparte_nome)) >= 0.5)
where s.vettore_id is null
  and s.stato <> 'ignorata'
  and not s.congelata
order by s.id, abs(r.data - s.data_documento);

-- Il codice che il gestionale porta sulla stessa bolla, quando c'è.
create temp table con_codice on commit drop as
select rf.*,
       (select max(upper(trim(td.vettore_codice)))
          from vettori.spedizioni_documenti sd
          join bi.trasporti_documenti td on td.id_documento = sd.id_documento
         where sd.spedizione_id = rf.spedizione_id
           and td.vettore_codice is not null and td.vettore_codice <> '') as codice_gestionale
from riga_foglio rf;

-- L'incrocio fra quello che dice il foglio e quello che dice il codice.
create temp table attribuzione on commit drop as
select c.*,
  case
    when c.vettore_foglio = 'gls'           then 'gls'
    when c.vettore_foglio = 'trading_post'  then 'trading_post'
    -- Il foglio dice «TNT o FedEx»; VT010063 dice «TNT o GLS». Insieme: TNT.
    when c.vettore_foglio = 'tnt_fedex' and c.codice_gestionale = 'VT010063' then 'tnt'
    -- Il foglio dice «TNT o FedEx»; VT010015 dice «GLS o FedEx». Insieme: FedEx.
    when c.vettore_foglio = 'tnt_fedex' and c.codice_gestionale = 'VT010015' then 'fedex'
    else null
  end as vettore_scelto
from con_codice c;

update vettori.spedizioni s
   set vettore_id = v.id,
       campi_forzati = s.campi_forzati || jsonb_build_object(
         'vettore_id', jsonb_build_object(
           'valore_precedente', 'null'::jsonb,
           'forzato_da', 'fogli 2026 dell''amministrazione',
           'forzato_il', now()::text)),
       note = left(concat_ws(' ', nullif(s.note, ''),
         format('Vettore %s dal foglio «%s»%s.',
                upper(a.vettore_scelto), a.foglio,
                case when a.codice_gestionale is not null
                     then format(', in accordo con il codice %s del gestionale', a.codice_gestionale)
                     else '' end)), 2000),
       aggiornata_il = now()
  from attribuzione a
  join vettori.vettori v on v.codice = a.vettore_scelto
 where s.id = a.spedizione_id
   and a.vettore_scelto is not null
   and s.vettore_id is null;

-- Dove restano due vettori possibili, si scrive che sono due.
update vettori.spedizioni s
   set note = left(concat_ws(' ', nullif(s.note, ''),
         format('Il foglio «%s» la attribuisce a TNT o FedEx, che non distingue; il gestionale non porta un codice vettore.', a.foglio)), 2000),
       aggiornata_il = now()
  from attribuzione a
 where s.id = a.spedizione_id
   and a.vettore_scelto is null
   and s.note is distinct from null
   and position('TNT o FedEx' in coalesce(s.note, '')) = 0;

select
  coalesce(a.vettore_scelto, 'resta da decidere (TNT o FedEx)') as esito,
  a.vettore_foglio,
  coalesce(a.codice_gestionale, '(nessun codice)') as codice_gestionale,
  count(*) as spedizioni
from attribuzione a
group by 1, 2, 3
order by 4 desc;

select count(*) filter (where vettore_id is null) as senza_vettore,
       count(*) filter (where vettore_id is not null) as con_vettore,
       count(*) as totale
from vettori.spedizioni
where stato <> 'ignorata';
