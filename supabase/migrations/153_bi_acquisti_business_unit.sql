-- ════════════════════════════════════════════════════════════════════════════
-- 153 — Business unit e categoria sugli ordini di acquisto
-- ════════════════════════════════════════════════════════════════════════════
--
-- Gli articoli che si comprano sono gli stessi che si vendono, quindi hanno la
-- loro business unit: finora la vista bi_acquisti portava solo il gruppo
-- (COMPONENTI / SISTEMI / IMPIANTI) e il filtro «Business unit» delle dashboard
-- non aveva niente su cui agire sugli acquisti: tutto restava uguale.
--
-- Si aggiungono in coda alla vista due colonne, prese dall'anagrafica articoli
-- (public.bi_articoli_corrente) con la STESSA regola delle viste di vendita
-- (migration 148):
--
--     categoria COSTRUITO / STRUTTURE   -> quella
--     altrimenti gruppo SISTEMI         -> COSTRUITO
--     altrimenti                        -> il gruppo
--
-- Il gruppo e' quello dell'anagrafica; se l'articolo non c'e' (circa il 6% delle
-- righe, il 7% del valore: articoli non piu' in anagrafica) si ripiega sul
-- gruppo che la riga si porta dietro dal gestionale.
--
-- `categoria` e' quella dell'anagrafica ('-' se manca). Nessuna colonna
-- esistente cambia: CREATE OR REPLACE VIEW accetta solo colonne in coda, e i
-- permessi restano quelli della vista.
--
-- Rollback: ricreare la vista senza le due colonne (vedi 118_bi_acquisti.sql);
-- l'applicazione ripiega da sola sul solo gruppo.
-- ════════════════════════════════════════════════════════════════════════════

create or replace view public.bi_acquisti as
with anagrafica as (
  select upper(btrim(a."Codice Articolo")) as codice,
         max(nullif(btrim(a."Categoria"), '')) as categoria,
         max(nullif(btrim(a."Gruppo"), ''))    as gruppo
    from public.bi_articoli_corrente a
   group by 1
)
select r.id_riga, r.profilo, r.numero_ordine, r.data_ordine, r.creato_il,
       r.codice_fornitore, r.fornitore, r.buyer_utente, r.buyer,
       r.codice_articolo, r.descrizione, r.gruppo_articoli,
       r.quantita, r.qta_evasa, r.prezzo_netto, r.valore,
       r.data_prevista, r.data_confermata, r.data_richiesta,
       r.riga_evasa, r.chiusa_forzata,
       r.primo_arrivo, r.ultimo_arrivo, r.qta_arrivata,
       r.aggiornato_il,
       coalesce(g.categoria, '-') as categoria,
       case
         when upper(g.categoria) in ('COSTRUITO', 'STRUTTURE') then upper(g.categoria)
         when coalesce(g.gruppo, nullif(btrim(r.gruppo_articoli), '')) = 'SISTEMI' then 'COSTRUITO'
         else coalesce(g.gruppo, nullif(btrim(r.gruppo_articoli), ''), '-')
       end as business_unit
  from bi.acquisti_righe r
  left join anagrafica g on g.codice = r.codice_articolo;

comment on view public.bi_acquisti is
  'Righe d''ordine a fornitore per lo snapshot BI, con categoria e business unit dell''articolo (regola delle viste di vendita, migration 148). Lo schema bi non e'' esposto da PostgREST: questa vista e'' la via di lettura.';

notify pgrst, 'reload schema';
