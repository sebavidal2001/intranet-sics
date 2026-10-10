-- ════════════════════════════════════════════════════════════════════════════
-- 152 — Articoli, variazioni di costo e spedizioni leggibili dal BI
-- ════════════════════════════════════════════════════════════════════════════
--
-- Dati che c'erano gia' nel database ma il builder non vedeva:
--
--   public.bi_articoli_corrente   fotografia degli articoli per magazzino: esistenza,
--                                 disponibilita', ordinato da clienti e a fornitori,
--                                 impegni di produzione, ultimo costo (da
--                                 powerbi.bi_cruscotto_articoli_corrente);
--   public.bi_variazioni_costo    le variazioni dell'ultimo costo (da
--                                 powerbi.bi_variazioni_ultimo_costo);
--   public.bi_spedizioni          i documenti di trasporto (DDT) con vettore, colli,
--                                 peso, volume, destinazione (da bi.trasporti_documenti,
--                                 che e' del Portale Vettori: qui solo in lettura).
--
-- Lo schema powerbi e lo schema bi non sono esposti da PostgREST (una query su uno
-- schema non esposto torna VUOTA SENZA ERRORE): le viste in `public` sono la via di
-- lettura. Ordine totale (`order by t::text`): PostgREST legge a pagine da 1.000 e
-- senza un ordine stabile una riga puo' saltare o ripetersi.
--
-- Non toccano nulla: solo viste, sola lettura. Rollback: drop view.
-- ════════════════════════════════════════════════════════════════════════════

create or replace view public.bi_articoli_corrente as
select a.*
  from powerbi.bi_cruscotto_articoli_corrente a
 order by a::text;
comment on view public.bi_articoli_corrente is
  'Articoli per magazzino, fotografia dell''ultimo caricamento del Cruscotto articoli.';

create or replace view public.bi_variazioni_costo as
select v."Codice Articolo", v."Descrizione", v."Data Variazione", v."Costo Precedente",
       v."Costo Nuovo", v."Delta", v."Delta %"
  from powerbi.bi_variazioni_ultimo_costo v
 order by v::text;
comment on view public.bi_variazioni_costo is
  'Variazioni dell''ultimo costo di acquisto degli articoli.';

create or replace view public.bi_spedizioni as
select t.id_documento, t.direzione, t.tipo_registro, t.codice_profilo, t.descrizione_profilo,
       t.numero_progressivo, t.numero_documento, t.data_documento, t.data_registrazione,
       t.codice_soggetto, t.soggetto, t.soggetto_provincia,
       t.dest_provincia, t.provincia_destinazione, t.zona_provincia, t.dest_localita,
       t.tipo_trasporto, t.causale_trasporto, t.tras_mezzo,
       t.vettore_codice, t.vettore,
       t.num_colli, t.num_pallet, t.peso_netto, t.peso_lordo, t.volume, t.val_spese,
       t.data_trasporto, t.data_prev_consegna, t.data_consegna_cliente,
       t.utente_creatore
  from bi.trasporti_documenti t
 where not coalesce(t.assente_dal_gestionale, false)
 order by t.id_documento;
comment on view public.bi_spedizioni is
  'Documenti di trasporto (DDT) di vendita e acquisto: vettore, colli, peso, volume, destinazione. In sola lettura: la tabella e'' del Portale Vettori.';

revoke all on public.bi_articoli_corrente from public, anon, authenticated;
revoke all on public.bi_variazioni_costo  from public, anon, authenticated;
revoke all on public.bi_spedizioni        from public, anon, authenticated;
grant select on public.bi_articoli_corrente to service_role;
grant select on public.bi_variazioni_costo  to service_role;
grant select on public.bi_spedizioni        to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'powerbi_reader') then
    grant select on public.bi_articoli_corrente to powerbi_reader;
    grant select on public.bi_variazioni_costo  to powerbi_reader;
    grant select on public.bi_spedizioni        to powerbi_reader;
  end if;
end;
$$;

notify pgrst, 'reload schema';
