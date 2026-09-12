-- ============================================================================
-- Vista `public.bi_preventivi_backoffice`
--
-- SCOPO: eliminare la duplicazione della regola di riconciliazione delle
-- business unit, oggi scritta due volte — nelle viste di produzione (SQL) e
-- in `src/lib/prototipo-bi/business-unit.ts` (TypeScript).
--
-- Il prototipo legge i preventivi dalla tabella grezza perché la vista
-- `public.bi_preventivi_aperti` non espone i campi back office aggiunti di
-- recente (utente creatore, data creazione, data richiesta cliente) e lo
-- schema `powerbi` non è raggiungibile via PostgREST. Leggendo la tabella
-- grezza si salta però la regola che spezza SISTEMI in COSTRUITO e STRUTTURE,
-- ed è per questo che la regola era stata riscritta in TypeScript.
--
-- Questa vista espone gli stessi campi di `bi_preventivi_aperti` PIÙ quelli
-- di back office, applicando la STESSA identica espressione già usata dalle
-- altre viste. Con questa, il TypeScript non deve più conoscere la regola.
--
-- NATURA DELLA MODIFICA
--   · Additiva: crea un solo oggetto nuovo, non tocca viste, tabelle,
--     policy o funzioni esistenti.
--   · Sola lettura: una vista, nessuna scrittura, nessun trigger.
--   · Filtra sul run corrente, come tutte le altre viste `bi_*`.
--   · Rollback: DROP VIEW public.bi_preventivi_backoffice;
--
-- security_invoker = true, come le altre viste sui 7 dataset commerciali:
-- legge `public.bi_documenti_raw`, su cui i ruoli hanno già i grant.
-- ============================================================================

create or replace view public.bi_preventivi_backoffice
with (security_invoker = true) as
select
  d.codice_gruppo                                   as "Codice Gruppo",
  -- Stessa espressione di public.bi_ordinato e delle altre viste:
  -- la business unit è la categoria quando vale COSTRUITO o STRUTTURE,
  -- altrimenti il gruppo merceologico.
  case
    when upper(trim(d.categoria_descrizione)) in ('COSTRUITO', 'STRUTTURE')
      then upper(trim(d.categoria_descrizione))
    else d.gruppo_descrizione
  end                                               as "Gruppo Descrizione",
  d.codice_categoria                                as "Codice Categoria",
  d.categoria_descrizione                           as "Categoria Descrizione",
  d.data_documento                                  as "Data Documento",
  d.importo                                         as "Importo Inevaso",
  -- Nel gestionale la colonna si chiama `importo_evaso` ma contiene il valore
  -- TOTALE della riga: vale il totale anche con riga_evasa='N' e quantità
  -- evasa 0. Qui il nome dice cosa è davvero, così nessuno la somma per
  -- sbaglio come se fosse l'evaso.
  d.importo_evaso                                   as "Valore Totale Riga",
  greatest(d.importo_evaso - d.importo, 0)          as "Convertito In Ordine",
  d.codice_articolo                                 as "Codice Articolo",
  d.descrizione_articolo                            as "Descrizione articolo",
  d.quantita                                        as "Quantità",
  d.quantita_evasa                                  as "Quantità evasa",
  d.codice_agente                                   as "Codice Agente",
  d.agente                                          as "Agente",
  d.codice_cliente                                  as "Codice Cliente",
  d.nome_cliente                                    as "Nome Cliente",
  d.profilo_documento                               as "Profilo Documento",
  d.numero_documento                                as "Numero Doc.",
  d.data_consegna_richiesta                         as "Data Consegna Richiesta",
  d.data_consegna_confermata                        as "Data Consegna Confermata",
  d.causale_magazzino_codice                        as "Causale Magazzino Codice",
  d.causale_magazzino_descrizione                   as "Causale Magazzino Descrizione",
  d.riga_evasa                                      as "Riga evasa",
  d.chiusura_forzata                                as "Chiusura forzata",
  -- ── Campi back office ────────────────────────────────────────────────────
  d.utente_creatore                                 as "Creato da",
  d.data_creazione_documento                        as "Data Creazione",
  d.data_richiesta_cliente                          as "Data Richiesta Cliente",
  -- Giorni fra richiesta e registrazione, confrontando le DATE di calendario.
  -- NULL quando la data manca o è incoerente (richiesta successiva alla
  -- registrazione, o distante più di due anni): ~50 documenti su 2.089.
  -- Meglio non calcolabile che negativo — senza questa pulizia un'addetta
  -- risultava con una media di -496 giorni.
  case
    when d.data_richiesta_cliente is null or d.data_creazione_documento is null
      then null
    when (d.data_creazione_documento::date - d.data_richiesta_cliente::date) < 0
      then null
    when (d.data_creazione_documento::date - d.data_richiesta_cliente::date) > 730
      then null
    else (d.data_creazione_documento::date - d.data_richiesta_cliente::date)
  end                                               as "Giorni Risposta"
from public.bi_documenti_raw d
join public.bi_runs r using (run_id)
where r.status = 'current'
  and d.dataset = 'preventivi_aperti';

comment on view public.bi_preventivi_backoffice is
  'Preventivi del run corrente con i campi back office e la business unit gia riconciliata (SISTEMI spezzata in COSTRUITO/STRUTTURE secondo la categoria, come nelle altre viste bi_*). Usata dal prototipo BI Direzionale.';
