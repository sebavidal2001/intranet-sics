-- 108_bi_cruscotto_di_sistema.sql
--
-- Le chiavi stabili rendono ripetibile la semina del Cruscotto e il flag di
-- sistema impedisce che la copia condivisa venga scambiata per una dashboard
-- personale modificabile.

alter table bi_direzionale.dashboard
  add column if not exists chiave text,
  add column if not exists di_sistema boolean not null default false;
alter table bi_direzionale.dashboard_pagine add column if not exists chiave text;
alter table bi_direzionale.dashboard_riquadri add column if not exists chiave text;
alter table bi_direzionale.analisi add column if not exists chiave text;

alter table bi_direzionale.dashboard
  drop constraint if exists dashboard_chiave_key,
  add constraint dashboard_chiave_key unique (chiave);
alter table bi_direzionale.dashboard_pagine
  drop constraint if exists dashboard_pagine_dashboard_chiave_key,
  add constraint dashboard_pagine_dashboard_chiave_key unique (dashboard_id, chiave);
alter table bi_direzionale.dashboard_riquadri
  drop constraint if exists dashboard_riquadri_pagina_chiave_key,
  add constraint dashboard_riquadri_pagina_chiave_key unique (pagina_id, chiave);
alter table bi_direzionale.analisi
  drop constraint if exists analisi_chiave_key,
  add constraint analisi_chiave_key unique (chiave);

comment on column bi_direzionale.dashboard.di_sistema is
  'Dashboard condivisa e immutabile: per personalizzarla va duplicata.';
comment on column bi_direzionale.dashboard.chiave is
  'Identità stabile usata dalla semina idempotente.';

notify pgrst, 'reload schema';
