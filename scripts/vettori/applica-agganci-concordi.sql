-- Applica gli agganci su cui due metodi indipendenti concordano: il foglio
-- dell'amministrazione (agganci-dai-fogli.sql) e la proposta del modello
-- (vettori.agganci_proposti). Nessuna chiamata al modello.
--
--   psql -d intranet -v csv=/percorso/storico.csv --single-transaction \
--        -f scripts/vettori/applica-agganci-concordi.sql
--
-- Stessi passi di applica-agganci-proposti.sql: bolla 'abbinata' e vettore,
-- controllo legato con abbinamento 'manuale', congelamento dal trigger,
-- proposta 'applicata'. Le bolle gia' congelate o ignorate si saltano.
-- Dopo, rilanciare il ricalcolo dei controlli.

\ir agganci-dai-fogli.sql

create temp table da_applicare as
select c.proposta_id, c.riga_id as fattura_riga_id, c.bolla as spedizione_id, c.controllo_id, f.vettore_id
  from confronto c
  join vettori.fatture_righe r on r.id = c.riga_id
  join vettori.fatture f on f.id = r.fattura_id
  join vettori.spedizioni s on s.id = c.bolla
 where c.bolla is not null
   and c.bolla = c.ai_bolla
   and s.stato <> 'ignorata'
   and not s.congelata;

delete from da_applicare d
 where (select count(*) from da_applicare x where x.spedizione_id = d.spedizione_id) > 1;

update vettori.spedizioni s
   set stato = 'abbinata',
       vettore_id = coalesce(s.vettore_id, d.vettore_id),
       aggiornata_il = now()
  from da_applicare d
 where s.id = d.spedizione_id;

update vettori.controlli c
   set spedizione_id = d.spedizione_id,
       abbinamento = 'manuale'
  from da_applicare d
 where c.id = d.controllo_id;

update vettori.agganci_proposti a
   set stato = 'applicata',
       decisa_il = now(),
       motivo = a.motivo || ' [Confermata dal foglio dell''amministrazione.]'
  from da_applicare d
 where a.id = d.proposta_id;

select count(*) as applicate from da_applicare;
