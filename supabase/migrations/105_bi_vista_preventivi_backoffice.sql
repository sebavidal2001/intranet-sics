-- 105_bi_vista_preventivi_backoffice.sql
--
-- Fase 1 del BI Direzionale — la vista che mancava in produzione.
--
-- ============================================================================
-- PERCHE' QUESTA MIGRATION ESISTE
-- ============================================================================
-- `public.bi_preventivi_backoffice` risultava "applicata in produzione il
-- 29/08/2026", e lo era: su SUPABASE. Sulla VM NON C'E'. La migrazione del
-- database verso la VM e' avvenuta lo stesso giorno, e la vista e' rimasta di
-- la'. Verificato il 12/09/2026: delle 13 viste che servono al BI, dodici
-- esistono sulla VM e questa no.
--
-- Senza, il BI non vede i preventivi: e' il dataset `preventivi_aperti`, cioe'
-- tasso di conversione, carico back office, giorni di risposta e anzianita'
-- della pipeline. Su 6,4 milioni di euro preventivati.
--
-- E' anche il motivo per cui le viste `bi_*` vanno versionate: erano tutte
-- fuori da questa cartella, e la differenza fra i due database non l'aveva
-- notata nessuno per due settimane.
--
-- ============================================================================
-- UNA DIFFERENZA VOLUTA RISPETTO AL FILE ORIGINALE
-- ============================================================================
-- L'originale (prototipo-bi/sql/002_vista_preventivi_backoffice.sql) crea la
-- vista con `security_invoker = true`, dicendo di fare "come le altre viste".
-- Sulla VM le altre viste hanno `security_invoker = FALSE` — verificato su
-- bi_ordinato, bi_fatturato, bi_consegnato.
--
-- La differenza non e' estetica: con `security_invoker = true` la vista gira
-- coi privilegi di chi la interroga, e `powerbi_reader` — che ha SELECT sulle
-- viste ma NON su `public.bi_documenti_raw` — riceverebbe "permission denied"
-- proprio su questa e su nessun'altra. Il motore SQL del BI funzionerebbe su
-- dodici viste su tredici, con un errore che sembra un caso isolato.
--
-- Qui si replica il comportamento reale della produzione, non quello descritto.
--
-- Additiva, sola lettura, filtra sul run corrente come le sorelle.
-- Rollback: DROP VIEW public.bi_preventivi_backoffice;
-- ============================================================================

create or replace view public.bi_preventivi_backoffice as
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

-- Il GRANT che la 104 ha saltato: quando e' stata applicata questa vista non
-- esisteva ancora, e il suo ciclo ha correttamente avvisato invece di fallire.
-- Qui si chiude il cerchio.
grant select on public.bi_preventivi_backoffice to powerbi_reader;
