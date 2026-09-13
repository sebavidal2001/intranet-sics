-- 106_bi_portale_solo_su_abilitazione.sql
--
-- Il BI diventa un portale come gli altri: si accende, e chi lo vede lo decide
-- il superadmin utente per utente da /superadmin/portali/[id]/permessi.
--
-- ============================================================================
-- CORREGGE UNA SCELTA SBAGLIATA DELLA 103
-- ============================================================================
-- La 103 aveva inserito quattro righe in `permessi_portale` (superadmin,
-- amministratore, responsabile, responsabile_intermedio con can_access=true),
-- e teneva il portale spento per compensare. Il risultato era il peggio dei
-- due mondi: finche' spento non entrava nessuno, e appena acceso sarebbero
-- entrati **tutti** quelli con quei ruoli, in blocco, senza che nessuno lo
-- decidesse. Da li' la guardia di runtime come ultima rete.
--
-- Ma il meccanismo giusto esiste gia' ed e' quello di ogni altro portale:
-- `permessi_utente` (override per singolo utente), gestito dall'interfaccia
-- superadmin. Con zero righe in `permessi_portale`, `get_portale_livello`
-- risponde NULL a chiunque **tranne** al superadmin di piattaforma, che
-- bypassa sempre per il primo CASE della funzione.
--
-- Quindi: portale acceso, nessun accesso per ruolo, e Sebastiano abilita chi
-- vuole quando vuole. Nessuna barriera speciale da ricordarsi di togliere.
--
-- Rollback: reinserire le righe in permessi_portale e rimettere is_attivo=false.
-- ============================================================================

-- 1) Via gli accessi per ruolo: l'abilitazione e' per persona, non per categoria.
delete from public.permessi_portale pp
using public.portali p
where pp.portale_id = p.id and p.slug = 'bi';

-- 2) Il portale si accende. Da solo non apre niente a nessuno: senza righe in
--    permessi_portale e senza override, l'unico che entra e' il superadmin.
update public.portali
set is_attivo = true
where slug = 'bi';

-- 3) Il perimetro del superadmin: vede tutta l'azienda.
--    Senza questa riga l'applicazione sarebbe fail-closed anche per lui — che
--    e' il comportamento giusto in generale, ma il primo utente che entra deve
--    poter vedere qualcosa, altrimenti il cruscotto e' vuoto e sembra rotto.
insert into bi_direzionale.perimetro_utente (utente_id, tipo, valori, nota)
select u.id, 'tutto', '{}', 'Superadmin di piattaforma: perimetro completo.'
from public.utenti u
where u.ruolo = 'superadmin'
on conflict (utente_id) do nothing;

-- Verifica: chi vede il BI adesso.
do $$
declare v_righe text;
begin
  select coalesce(string_agg(u.nome||' '||u.cognome||' ('||u.ruolo||') -> '||
                             coalesce(public.get_portale_livello(u.id,'bi'),'nessun accesso'), E'\n  '), '(nessuno)')
    into v_righe
  from public.utenti u
  where public.get_portale_livello(u.id, 'bi') is not null;

  raise notice E'Utenti con accesso al BI dopo questa migration:\n  %', v_righe;
end $$;

notify pgrst, 'reload schema';
