-- 066_auto_avanza_sessione_su_config.sql
--
-- [BUGFIX] Schede valutazione bloccate in stato `programmata`.
--
-- Causa: la config admin (saveSessioneSkills) popola `sessione_skills` ma NON
-- tocca mai `sessioni_utente.stato`. L'unica transizione programmata→resp_in_corso
-- era il pulsante manuale "Avvia valutazione" del responsabile → 23/26 schede
-- restavano ferme perché il click non veniva fatto. Il flusso a valle
-- (salvaRisposteResponsabile con completa=true) richiede stato='resp_in_corso',
-- quindi senza avanzamento la valutazione è impossibile.
--
-- Fix robusto: trigger AFTER INSERT su `sessione_skills` che porta
-- automaticamente la sessione da `programmata` a `resp_in_corso` non appena
-- la scheda risulta configurata. Deterministico e indipendente dal comportamento
-- del responsabile. Idempotente (avanza SOLO da 'programmata', mai regressione).
--
-- Nota: le schede configurate SOLO con mansioni (senza skill) non passano da qui
-- e restano gestite dalla rete di sicurezza lato pagina responsabile + dal
-- pulsante "Avvia valutazione". Il sanamento dei dati esistenti è nella parte 2.

-- ── 1) Funzione + trigger ─────────────────────────────────────────────────────
create or replace function public.avanza_sessione_su_config()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.sessioni_utente
     set stato = 'resp_in_corso'
   where id = new.sessione_id
     and stato = 'programmata';
  return new;
end;
$$;

drop trigger if exists trg_sessione_skills_avanza on public.sessione_skills;
create trigger trg_sessione_skills_avanza
  after insert on public.sessione_skills
  for each row
  execute function public.avanza_sessione_su_config();

-- ── 2) Sanamento schede già configurate ma ferme in `programmata` ─────────────
-- Solo quelle con almeno una skill collegata (config completa). Le 2 senza skill
-- vanno configurate a parte.
update public.sessioni_utente su
   set stato = 'resp_in_corso'
 where su.stato = 'programmata'
   and exists (
     select 1 from public.sessione_skills ss where ss.sessione_id = su.id
   );
