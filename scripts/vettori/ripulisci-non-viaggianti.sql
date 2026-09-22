-- Toglie dal livello operativo le bolle che non viaggiano con un vettore.
--
--   psql -d intranet --single-transaction -f scripts/vettori/ripulisci-non-viaggianti.sql
--
-- Dal 18 settembre la fusione non crea più una spedizione per i documenti con
-- `tras_mezzo` = D (ritira il destinatario) o M (consegniamo col nostro mezzo):
-- nessun vettore le fatturerà mai, e sulla pagina dove il magazzino misura i
-- colli erano rumore. Ne erano però già entrate 185, create fra il 12 e il 18
-- settembre, prima che la regola ci fosse.
--
-- Si cancellano invece di essere marcate «ignorate» — la via scelta per i
-- doppioni dei fogli — perché qui non si perde niente: la riga operativa non
-- porta nessun dato che il grezzo non abbia già, e `bi.trasporti_documenti`
-- resta intatto. Un doppione del foglio invece portava misure e numero di
-- bolla scritti a mano, e buttarlo sarebbe stato un altro discorso.
--
-- Si toccano solo quelle che non hanno nulla attaccato. Se una di queste
-- avesse un controllo, una misura o un congelamento, vorrebbe dire che
-- qualcuno ci ha lavorato sopra, e allora il presupposto — «non viaggia,
-- quindi non interessa» — sarebbe sbagliato: meglio lasciarla e guardarla.

\set ON_ERROR_STOP on

create temp table da_togliere on commit drop as
select distinct s.id
from vettori.spedizioni s
join vettori.spedizioni_documenti sd on sd.spedizione_id = s.id
join bi.trasporti_documenti td on td.id_documento = sd.id_documento
where td.tras_mezzo in ('D', 'M')
  and s.origine = 'gestionale'
  and not s.congelata
  and s.vettore_id is null
  and not exists (select 1 from vettori.controlli c   where c.spedizione_id = s.id)
  and not exists (select 1 from vettori.bolla_misure m where m.spedizione_id = s.id)
  and not exists (select 1 from vettori.rilevazioni r  where r.spedizione_id = s.id)
  and not exists (select 1 from vettori.simulazioni si where si.spedizione_id = s.id)
  and not exists (select 1 from vettori.spedizioni_congelamenti sc where sc.spedizione_id = s.id)
  and not exists (select 1 from vettori.spedizioni_scostamenti ss  where ss.spedizione_id = s.id);

delete from vettori.spedizioni s using da_togliere t where s.id = t.id;

select (select count(*) from da_togliere)                                     as tolte,
       (select count(*) from vettori.spedizioni where stato <> 'ignorata')     as spedizioni_attive;
