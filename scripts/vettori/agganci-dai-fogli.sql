-- Aggancio fattura -> bolla usando i fogli dell'amministrazione.
--
--   psql -d intranet -v csv=/percorso/storico.csv -f scripts/vettori/agganci-dai-fogli.sql
--
-- SOLA LETTURA: produce la tabella temporanea `esito_fogli` e un riepilogo.
--
-- Perche' funziona: per ogni spedizione che paga, l'amministrazione scrive sul
-- foglio del vettore data, peso, numero del DDT e l'importo letto in fattura.
-- E' l'abbinamento fatto a mano. Sulle righe di fattura senza bolla (arrivi GLS
-- senza numero di DDT, TNT con il codice cliente al posto del numero) il foglio
-- da' il pezzo che manca: il numero del DDT.
--
-- Riga di fattura <-> riga di foglio: stesso vettore e verso, date entro 3
-- giorni, stesso peso (entro 50 g o il 2%), e in piu' il nome compatibile
-- oppure l'importo uguale (entro l'1%, sul totale o sul nolo). Il solo peso
-- non basta: lo stesso giorno arrivano colli da 1,5 kg da fornitori diversi.
-- Vale solo se la coppia e' unica nei due sensi.
--
-- Riga di foglio <-> bolla: numero del DDT (il primo, se il foglio ne somma
-- piu' d'uno, «716+717») uguale al riferimento o al nostro protocollo, stesso
-- verso, date entro 10 giorni, bolla non ignorata. Unica.

\set ON_ERROR_STOP on

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

create or replace function pg_temp.norma(v text) returns text
language sql immutable as $$
  select nullif(ltrim(regexp_replace(upper(coalesce(v, '')), '[^A-Z0-9]', '', 'g'), '0'), '');
$$;

-- Il numero del DDT come lo scrive il foglio: il primo se ne somma piu' d'uno
-- («716+717»), senza il profilo davanti («RIPEF 12»).
create or replace function pg_temp.ddt(v text) returns text
language sql immutable as $$
  select pg_temp.norma(regexp_replace(split_part(regexp_replace(coalesce(v, ''), '\.0$', ''), '+', 1),
         '^\s*(RIPEF|RIPUF|RIPEC|RIPUC|RVC|RVF|RF|RC|VC|VF)\s*', '', 'i'));
$$;

create or replace function pg_temp.nomi_ok(a text, b text) returns boolean
language sql immutable as $$
  select pg_temp.nome_confronto(a) is not null and pg_temp.nome_confronto(b) is not null and (
       pg_temp.nome_confronto(a) like left(pg_temp.nome_confronto(b), greatest(4, least(length(pg_temp.nome_confronto(b)), 8))) || '%'
    or pg_temp.nome_confronto(b) like left(pg_temp.nome_confronto(a), greatest(4, least(length(pg_temp.nome_confronto(a)), 8))) || '%'
    or similarity(pg_temp.nome_confronto(a), pg_temp.nome_confronto(b)) >= 0.4);
$$;

create temp table foglio (
  vettore text, direzione text, data date, controparte text, numero_ddt text,
  colli numeric, peso_kg numeric, lunghezza_cm numeric, larghezza_cm numeric,
  altezza_cm numeric, peso_volumetrico_kg numeric, importo_fattura numeric, foglio text
);
copy foglio from :'csv' with (format csv, header true, delimiter ';', null '');
alter table foglio add column n serial;

create temp table righe as
select c.id controllo_id, r.id riga_id, v.codice vettore, r.direzione, r.data_spedizione data,
       r.peso, r.nolo, r.totale, r.controparte_testo, f.numero fattura, r.riga_numero
  from vettori.controlli c
  join vettori.fatture_righe r on r.id = c.fattura_riga_id
  join vettori.fatture f on f.id = r.fattura_id
  join vettori.vettori v on v.id = f.vettore_id
 where c.spedizione_id is null;

create temp table coppie_rf as
select r.riga_id, f.n,
       pg_temp.nomi_ok(r.controparte_testo, f.controparte) nome_ok,
       (f.importo_fattura > 0 and (abs(f.importo_fattura - r.totale) <= greatest(0.02, r.totale * 0.01)
                                or abs(f.importo_fattura - r.nolo) <= greatest(0.02, r.nolo * 0.01))) importo_ok
  from righe r
  join foglio f
    on f.vettore = case when r.vettore in ('tnt', 'fedex') then 'tnt_fedex' else r.vettore end
   and upper(f.direzione) = upper(r.direzione)
   and abs(f.data - r.data) <= 3
   and f.peso_kg is not null and r.peso is not null
   and abs(f.peso_kg - r.peso) <= greatest(0.05, r.peso * 0.02);
delete from coppie_rf where not (nome_ok or importo_ok);
delete from coppie_rf c where (select count(*) from coppie_rf x where x.riga_id = c.riga_id) > 1
                          or (select count(*) from coppie_rf x where x.n = c.n) > 1;

create temp table esito_fogli as
select r.*, f.n foglio_n, f.numero_ddt, f.controparte foglio_controparte, f.data foglio_data, f.foglio,
       cr.nome_ok, cr.importo_ok,
       (select array_agg(s.id) from vettori.spedizioni s
         where s.direzione = r.direzione
           and s.stato <> 'ignorata'
           and abs(s.data_documento - f.data) <= 10
           and (s.numero_riferimento_norm = pg_temp.ddt(f.numero_ddt)
                or pg_temp.norma(s.numero_protocollo) = pg_temp.ddt(f.numero_ddt)
                -- il gestionale con anno e lettere davanti: «2600582», «26SW03838»
                or (length(pg_temp.ddt(f.numero_ddt)) >= 3
                    and s.numero_riferimento_norm ~ ('^[0-9]{2}[A-Z]*0*' || pg_temp.ddt(f.numero_ddt) || '$')))
       ) bolle
  from righe r
  left join coppie_rf cr on cr.riga_id = r.riga_id
  left join foglio f on f.n = cr.n;

alter table esito_fogli add column bolla uuid;
update esito_fogli set bolla = bolle[1] where array_length(bolle, 1) = 1;

-- confronto con la proposta del modello
create temp table confronto as
select e.*, a.spedizione_id ai_bolla, a.sicurezza ai_sicurezza, a.esito ai_esito, a.id proposta_id
  from esito_fogli e
  left join vettori.agganci_proposti a on a.fattura_riga_id = e.riga_id and a.stato = 'proposta';

select vettore,
       count(*) righe_senza_bolla,
       count(foglio_n) trovate_sul_foglio,
       count(bolla) bolla_univoca,
       count(*) filter (where foglio_n is not null and bolla is null and coalesce(array_length(bolle,1),0) = 0) foglio_senza_bolla,
       count(*) filter (where array_length(bolle,1) > 1) bolle_ambigue,
       count(*) filter (where bolla is not null and bolla = ai_bolla) concorda_ai,
       count(*) filter (where bolla is not null and ai_bolla is not null and bolla <> ai_bolla) discorda_ai,
       count(*) filter (where bolla is not null and ai_bolla is null) ai_senza_scelta
  from confronto group by 1 order by 1;
