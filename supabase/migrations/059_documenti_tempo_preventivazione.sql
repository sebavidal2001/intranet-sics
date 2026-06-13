-- 059_documenti_tempo_preventivazione.sql
-- Tempo di preventivazione (cronometro builder) salvato sul documento come
-- misura di produttività: quanti secondi sono stati impiegati a costruire il
-- preventivo. Valorizzato dalla route POST /documenti dopo la creazione, leggendo
-- il cronometro client (vedi components/portali/preventivatore/preventivo-timer.tsx).
-- NULL = non misurato (preventivi storici, import, o builder senza cronometro avviato).

alter table preventivatore.documenti
  add column if not exists tempo_preventivazione_sec integer;

comment on column preventivatore.documenti.tempo_preventivazione_sec is
  'Secondi di lavoro cronometrati nel builder per redigere il preventivo (produttività). NULL = non misurato.';

-- Vincolo prudente: niente valori negativi.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'documenti_tempo_preventivazione_sec_nonneg'
  ) then
    alter table preventivatore.documenti
      add constraint documenti_tempo_preventivazione_sec_nonneg
      check (tempo_preventivazione_sec is null or tempo_preventivazione_sec >= 0);
  end if;
end $$;

notify pgrst, 'reload schema';
