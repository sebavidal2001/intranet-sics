-- Migration 043: RPC per nuovi tool AI redazione preventivi (2026-05-26)
--
-- Aggiunge 5 RPC chiamabili dai tool della chat AI per supportare lo studio
-- e la redazione di nuovi preventivi:
--  1) storia_prezzi_articolo(codice, anni)   — andamento ult_costo + prezzi nelle distinte
--  2) analisi_margini(cliente?, categoria?, anno?, limit?) — scostamento preventivo→ordinato
--  3) hit_rate(cliente?, categoria?, mesi?, limit?) — ordinati / (ordinati+falliti)
--  4) info_cliente(ragione, limit_preventivi?) — master + ultimi N preventivi + stats
--  5) articoli_associati(codice, min_freq?, limit?) — market basket
--
-- Le RPC sono STABLE / immutabili (no scritture), LEFT JOIN a clienti_master per
-- la ragione canonica. Filtro stati sia legacy ('ordinato'/'rifiutato') che
-- workflow nuovo ('ordinata'/'fallita') per retrocompatibilità.
--
-- Il file completo è applicato via MCP — vedi storia migrazioni Supabase.
-- Per il diff funzionale: tutte e 5 le RPC sono nuove (nessuna sostituisce
-- niente di esistente).

SELECT 1;
