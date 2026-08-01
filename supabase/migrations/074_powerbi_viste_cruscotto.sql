-- 074_powerbi_viste_cruscotto.sql
-- ============================================================================
-- Fase 6 — Viste Power BI per il Cruscotto articoli.
--
-- SCELTA DI SICUREZZA (deviazione motivata dalla convenzione security_invoker):
--   Le viste del Cruscotto leggono da `preventivatore` (stato corrente) e da
--   `bi` (storico). Il ruolo powerbi_reader NON ha — e NON deve avere — grant
--   su quegli schemi (lockdown migration 062 + vincolo esplicito).
--   Con `security_invoker = true` la vista girerebbe con i privilegi di
--   powerbi_reader e fallirebbe con "permission denied".
--   Quindi queste viste restano SECURITY DEFINER (default): eseguono con i
--   privilegi del proprietario ed espongono SOLO le colonne elencate qui.
--   Risultato: powerbi_reader vede le viste e nient'altro; nessun grant su
--   `preventivatore` né su `bi`. È l'opzione con la superficie minima.
--   (Le viste dei 7 dataset commerciali restano invariate, con invoker=true,
--   perché leggono da public.bi_documenti_raw su cui powerbi_reader ha grant.)
--
-- Additiva: non modifica oggetti esistenti.
-- Rollback: DROP SCHEMA powerbi CASCADE.
-- ============================================================================

create schema if not exists powerbi;
comment on schema powerbi is
  'Viste di sola lettura per Power BI (Cruscotto articoli). Nessuna tabella: solo proiezioni controllate su preventivatore e bi.';

-- ── 1) Calendario ───────────────────────────────────────────────────────────
-- Copre lo storico BI (dal 2013) fino a +2 anni, per gli assi temporali.
create or replace view powerbi.bi_calendario as
select
  d::date                                             as "Data",
  extract(year from d)::int                           as "Anno",
  extract(quarter from d)::int                        as "Trimestre",
  extract(month from d)::int                          as "NumeroMese",
  to_char(d, 'TMMonth')                               as "Mese",
  to_char(d, 'YYYY-MM')                               as "AnnoMese",
  date_trunc('month', d)::date                        as "InizioMese",
  extract(isodow from d)::int                         as "GiornoSettimana",
  to_char(d, 'TMDay')                                 as "NomeGiorno",
  (extract(isodow from d) >= 6)                       as "Weekend"
from generate_series(date '2013-01-01',
                     (date_trunc('year', now()) + interval '2 years - 1 day')::date,
                     interval '1 day') d;

comment on view powerbi.bi_calendario is 'Tabella date per Power BI: dal 2013 a +2 anni.';

-- ── 2) Stato corrente articolo/magazzino ────────────────────────────────────
create or replace view powerbi.bi_cruscotto_articoli_corrente as
select
  p.codice                        as "Codice Articolo",
  p.descrizione                   as "Descrizione",
  p.uc                            as "UC",
  p.categoria                     as "Categoria",
  p.cat_esposizione_codice        as "Categoria Codice",
  p.cat_merc                      as "Cat Merceologica",
  p.cat_merc_codice               as "Cat Merceologica Codice",
  p.gruppo                        as "Gruppo",
  p.gruppo_codice                 as "Gruppo Codice",
  p.reparto_desc                  as "Reparto",
  p.reparto_codice                as "Reparto Codice",
  p.cat_fiscale_desc              as "Cat Fiscale",
  p.cat_fiscale_codice            as "Cat Fiscale Codice",
  p.fornitore                     as "Fornitore",
  p.fornitore_codice              as "Fornitore Codice",
  p.attivo                        as "Attivo",
  p.ult_costo                     as "Ultimo Costo",
  p.data_ult_costo                as "Data Ultimo Costo",
  (p.ult_costo is null)           as "Costo Mancante",
  g.magazzino                     as "Magazzino",
  g.esistenza                     as "Esistenza",
  g.disponibilita                 as "Disponibilita",
  bi.disponibilita_attesa(g.esistenza, g.qta_ord_fornitori, g.qta_ord_clienti,
                          g.qta_imp_produzione, g.qta_ord_produzione,
                          g.qta_vis_clienti, g.qta_cl_fornitori) as "Disponibilita Calcolata",
  g.qta_rim_iniziale              as "Qta Rim Iniziale",
  g.qta_caricata                  as "Qta Caricata",
  g.qta_scaricata                 as "Qta Scaricata",
  g.qta_altri_carichi             as "Qta Altri Carichi",
  g.qta_altri_scarichi            as "Qta Altri Scarichi",
  g.qta_imp_produzione            as "Qta Imp Produzione",
  g.qta_ord_clienti               as "Qta Ord Clienti",
  g.qta_ord_fornitori             as "Qta Ord Fornitori",
  g.qta_vis_clienti               as "Qta Vis Clienti",
  g.qta_vis_fornitori             as "Qta Vis Fornitori",
  g.qta_reso_clienti              as "Qta Reso Clienti",
  g.qta_reso_fornitori            as "Qta Reso Fornitori",
  g.qta_ord_produzione            as "Qta Ord Produzione",
  g.qta_cl_clienti                as "Qta Cl Clienti",
  g.qta_cl_fornitori              as "Qta Cl Fornitori",
  g.qta_cl_terzi                  as "Qta Cl Terzi",
  g.aggiornato_il                 as "Aggiornato Il",
  (select s.current_cruscotto_run_id from public.bi_publication_state s where s.singleton) as "Run"
from preventivatore.prodotti p
join preventivatore.prodotti_giacenze g on g.codice = p.codice;

comment on view powerbi.bi_cruscotto_articoli_corrente is
  'Stato corrente: una riga per articolo/magazzino. "Disponibilita Calcolata" permette di verificare la coerenza col gestionale.';

-- ── 3) Storico costo: intervalli di validità ────────────────────────────────
create or replace view powerbi.bi_ultimo_costo_storico as
select
  c.codice                                   as "Codice Articolo",
  p.descrizione                              as "Descrizione",
  c.uc                                       as "UC",
  c.costo                                    as "Costo",
  c.data_costo                               as "Data Costo Gestionale",
  c.valid_from                               as "Valido Da",
  c.valid_to                                 as "Valido A",
  (c.valid_to is null)                       as "Corrente",
  c.first_seen_at                            as "Prima Osservazione",
  c.detected_at                              as "Rilevato Il",
  c.run_id                                   as "Run",
  (c.costo is null)                          as "Costo Mancante"
from bi.costi_storico c
left join preventivatore.prodotti p on p.codice = c.codice;

comment on view powerbi.bi_ultimo_costo_storico is
  'Intervalli di validità del costo. "Valido A" è ESCLUSIVO: il costo vale per data >= "Valido Da" e < "Valido A".';

-- ── 4) Eventi di variazione costo ───────────────────────────────────────────
create or replace view powerbi.bi_variazioni_ultimo_costo as
select
  c.codice                                       as "Codice Articolo",
  p.descrizione                                  as "Descrizione",
  c.valid_from::date                             as "Data Variazione",
  prec.costo                                     as "Costo Precedente",
  c.costo                                        as "Costo Nuovo",
  (c.costo - prec.costo)                         as "Delta",
  case when prec.costo is not null and prec.costo <> 0
       then round(((c.costo - prec.costo) / abs(prec.costo)) * 100, 2) end as "Delta %",
  c.data_costo                                   as "Data Costo Gestionale",
  c.run_id                                       as "Run"
from bi.costi_storico c
left join lateral (
  select c2.costo
  from bi.costi_storico c2
  where c2.codice = c.codice and c2.valid_to = c.valid_from
  order by c2.valid_from desc
  limit 1
) prec on true
left join preventivatore.prodotti p on p.codice = c.codice
where prec.costo is distinct from c.costo;

comment on view powerbi.bi_variazioni_ultimo_costo is 'Un record per ogni cambio di costo, con delta assoluto e percentuale.';

-- ── 5) Variazioni giacenze (formato lungo: campo = slicer in Power BI) ──────
create or replace view powerbi.bi_variazioni_giacenze as
select
  s.codice                     as "Codice Articolo",
  p.descrizione                as "Descrizione",
  s.magazzino                  as "Magazzino",
  s.campo                      as "Campo",
  s.valore_precedente          as "Valore Precedente",
  s.valore                     as "Valore",
  s.delta                      as "Delta",
  s.valid_from::date           as "Data Variazione",
  s.valid_from                 as "Variazione Timestamp",
  s.valid_to                   as "Valido A",
  (s.valid_to is null)         as "Corrente",
  s.first_seen_at              as "Prima Osservazione",
  s.detected_at                as "Rilevato Il",
  s.run_id                     as "Run"
from bi.giacenze_storico s
left join preventivatore.prodotti p on p.codice = s.codice;

comment on view powerbi.bi_variazioni_giacenze is
  'Eventi di variazione giacenza in formato lungo: una riga per campo variato. Usare "Campo" come slicer.';

-- ── 6) Marginalità documenti (join temporale risolto in SQL) ────────────────
-- Power BI non sa fare join per intervallo: qui il costo valido alla data del
-- documento è già agganciato. Se manca, margine e % restano NULL con flag.
create or replace view powerbi.bi_marginalita_documenti as
select
  d.dataset                                   as "Tipo Documento",
  d.data_documento                            as "Data Documento",
  d.data_documento::date                      as "Data",
  d.numero_documento                          as "Numero Doc.",
  d.codice_articolo                           as "Codice Articolo",
  d.descrizione_articolo                      as "Descrizione articolo",
  d.codice_cliente                            as "Codice Cliente",
  d.nome_cliente                              as "Nome Cliente",
  d.codice_agente                             as "Codice Agente",
  d.agente                                    as "Agente",
  d.gruppo_descrizione                        as "Gruppo Descrizione",
  d.categoria_descrizione                     as "Categoria Descrizione",
  d.quantita                                  as "Quantita",
  d.importo                                   as "Ricavo",
  c.costo                                     as "Costo Unitario",
  case when c.costo is not null then round(c.costo * coalesce(d.quantita,0), 4) end as "Costo Totale",
  case when c.costo is not null then round(d.importo - (c.costo * coalesce(d.quantita,0)), 4) end as "Margine",
  case when c.costo is not null and d.importo is not null and d.importo <> 0
       then round(((d.importo - (c.costo * coalesce(d.quantita,0))) / d.importo) * 100, 2) end as "Margine %",
  (c.costo is null)                           as "Costo Mancante",
  c.valid_from                                as "Costo Valido Da",
  c.data_costo                                as "Data Costo Gestionale"
from public.bi_documenti_raw d
join public.bi_runs r on r.run_id = d.run_id and r.status = 'current'
left join lateral (
  select cs.costo, cs.valid_from, cs.data_costo
  from bi.costi_storico cs
  where cs.codice = d.codice_articolo
    and d.data_documento >= cs.valid_from
    and (cs.valid_to is null or d.data_documento < cs.valid_to)
  order by cs.valid_from desc
  limit 1
) c on true
where d.dataset in ('ordinato', 'fatturato');

comment on view powerbi.bi_marginalita_documenti is
  'Righe di ordinato e fatturato con costo valido ALLA DATA del documento. Nessuna retroattività: se il costo non copre la data, "Costo Mancante" = true e margine NULL.';

-- ── 7) Copertura costi (qualità del dato per la marginalità) ────────────────
create or replace view powerbi.bi_copertura_costi as
select
  d.dataset                                              as "Tipo Documento",
  date_trunc('month', d.data_documento)::date            as "Mese",
  count(*)                                               as "Righe",
  count(*) filter (where c.costo is not null)            as "Righe Con Costo",
  count(*) filter (where c.costo is null)                as "Righe Senza Costo",
  round(100.0 * count(*) filter (where c.costo is not null) / nullif(count(*), 0), 2) as "Copertura %",
  sum(d.importo)                                         as "Ricavo Totale",
  sum(d.importo) filter (where c.costo is not null)      as "Ricavo Con Costo"
from public.bi_documenti_raw d
join public.bi_runs r on r.run_id = d.run_id and r.status = 'current'
left join lateral (
  select cs.costo
  from bi.costi_storico cs
  where cs.codice = d.codice_articolo
    and d.data_documento >= cs.valid_from
    and (cs.valid_to is null or d.data_documento < cs.valid_to)
  order by cs.valid_from desc
  limit 1
) c on true
where d.dataset in ('ordinato', 'fatturato')
group by 1, 2;

comment on view powerbi.bi_copertura_costi is
  'Percentuale di righe con costo valido, per mese e tipo documento: misura quanto è attendibile la marginalità in ciascun periodo.';

-- ── 8) Giacenze a una data (funzione: evita la matrice giorno×articolo) ─────
-- Non è una vista perché materializzare articolo×magazzino×campo×giorno
-- esploderebbe. Con gli intervalli la ricostruzione è immediata.
create or replace function powerbi.giacenze_alla_data(p_data timestamptz)
returns table (
  "Codice Articolo" text,
  "Magazzino" text,
  "Campo" text,
  "Valore" numeric
)
language sql stable
as $$
  select s.codice, s.magazzino, s.campo, s.valore
  from bi.giacenze_storico s
  where s.valid_from <= p_data
    and (s.valid_to is null or p_data < s.valid_to);
$$;

comment on function powerbi.giacenze_alla_data is
  'Snapshot delle giacenze a una data qualsiasi, ricostruito dagli intervalli. Da usare in Power BI con query nativa parametrica.';

-- ── 9) Sicurezza: powerbi_reader vede SOLO queste viste ────────────────────
revoke all on schema powerbi from public, anon, authenticated;
grant usage on schema powerbi to powerbi_reader;

revoke all on all tables in schema powerbi from public, anon, authenticated;
grant select on
  powerbi.bi_calendario,
  powerbi.bi_cruscotto_articoli_corrente,
  powerbi.bi_ultimo_costo_storico,
  powerbi.bi_variazioni_ultimo_costo,
  powerbi.bi_variazioni_giacenze,
  powerbi.bi_marginalita_documenti,
  powerbi.bi_copertura_costi
to powerbi_reader;

revoke all on function powerbi.giacenze_alla_data(timestamptz) from public, anon, authenticated;
grant execute on function powerbi.giacenze_alla_data(timestamptz) to powerbi_reader;

notify pgrst, 'reload schema';
