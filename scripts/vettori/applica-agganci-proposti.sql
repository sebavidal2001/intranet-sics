-- Applica le proposte di aggancio fattura -> bolla salvate in
-- vettori.agganci_proposti, senza richiamare il modello.
--
--   psql -d intranet -v sicurezza=alta --single-transaction \
--        -f scripts/vettori/applica-agganci-proposti.sql
--
-- Fa quello che fa l'acquisizione (`acquisisci_fattura`, 091) quando aggancia:
--   1. la bolla passa ad 'abbinata' e prende il vettore della fattura se non
--      ne ha uno (prima del punto 2: dopo e' congelata);
--   2. il controllo punta alla bolla, con abbinamento 'manuale' — non e' un
--      aggancio per numero, e' una scelta fatta fuori dall'automatismo; la
--      provenienza (modello, motivo) resta nella proposta;
--   3. il trigger congela la bolla, come per ogni aggancio;
--   4. la proposta passa ad 'applicata'.
--
-- Salta le proposte la cui riga nel frattempo ha gia' una bolla, e quelle che
-- puntano a una bolla ignorata o gia' congelata da un'altra fattura: quelle
-- restano 'proposta' e le decide una persona.
-- Dopo, rilanciare il ricalcolo dei controlli (ricalcola-controlli.test.ts).

\set ON_ERROR_STOP on

create temp table da_applicare on commit drop as
select a.id as proposta_id, a.fattura_riga_id, a.spedizione_id, c.id as controllo_id, f.vettore_id
  from vettori.agganci_proposti a
  join vettori.controlli c on c.fattura_riga_id = a.fattura_riga_id
  join vettori.fatture_righe r on r.id = a.fattura_riga_id
  join vettori.fatture f on f.id = r.fattura_id
  join vettori.spedizioni s on s.id = a.spedizione_id
 where a.stato = 'proposta'
   and a.esito = 'scelta'
   and a.sicurezza = :'sicurezza'
   and c.spedizione_id is null
   and s.stato <> 'ignorata'
   and not s.congelata;

-- Una bolla, una riga: se due proposte puntano alla stessa bolla non si
-- sceglie qui.
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
       decisa_il = now()
  from da_applicare d
 where a.id = d.proposta_id;

select count(*) as applicate from da_applicare;
