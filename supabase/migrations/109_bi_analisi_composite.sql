-- Le analisi storiche restano semplici con serie = null; i nuovi confronti
-- conservano tutte le SpecQuery nello stesso record senza duplicare risultati.
alter table bi_direzionale.analisi
  add column if not exists serie jsonb;

comment on column bi_direzionale.analisi.serie is
  'SerieAnalisi validate dall''applicazione; null mantiene il formato storico basato su spec.';

notify pgrst, 'reload schema';
