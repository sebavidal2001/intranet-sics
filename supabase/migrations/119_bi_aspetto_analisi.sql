-- ════════════════════════════════════════════════════════════════════════════
-- 119 — Aspetto dei riquadri del BI: colori, legenda, assi, totali di tabella
-- ════════════════════════════════════════════════════════════════════════════
--
-- Le scelte di resa di un'analisi (non entrano mai nella query). null = segue
-- le impostazioni generali dei grafici, quindi le analisi esistenti non
-- cambiano aspetto. Validato dall'applicazione (validaAspetto in
-- src/lib/prototipo-bi/aspetto.ts): i colori finiscono in attributi SVG e
-- vengono accettati solo nella forma #rrggbb.
--
-- dashboard_completa() usa to_jsonb(a) sull'analisi: il campo arriva ai
-- riquadri senza modificare la funzione.
-- ════════════════════════════════════════════════════════════════════════════

alter table bi_direzionale.analisi
  add column if not exists aspetto jsonb;

comment on column bi_direzionale.analisi.aspetto is
  'AspettoGrafico validato dall''applicazione (colori, legenda, assi, totali). null = impostazioni generali.';

notify pgrst, 'reload schema';
