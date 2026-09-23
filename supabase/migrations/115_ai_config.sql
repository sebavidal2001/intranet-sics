-- 115_ai_config.sql
--
-- Quali modelli usa l'intranet, scritto in una tabella invece che nel codice.
--
-- ============================================================================
-- PERCHE'
-- ============================================================================
-- Il modello buono per un lavoro cambia ogni pochi mesi, e cambiarlo oggi vuol
-- dire toccare il codice, ricompilare e rifare il deploy. E' un'operazione che
-- non ha niente di tecnico — si sostituisce una stringa — ma che di fatto la
-- puo' fare una persona sola. Qui diventa una riga di tabella, modificabile
-- dalla pagina `/superadmin/ai`.
--
-- ============================================================================
-- COSA NON STA QUI
-- ============================================================================
-- **La chiave API.** Resta in `.env.local` sulla VM, dove stanno le altre
-- credenziali. Una chiave in tabella finisce nei backup, nei dump di sviluppo
-- e nei log di chi interroga il database per sbaglio; e comunque il giorno in
-- cui va cambiata bisogna entrare sulla macchina lo stesso. La pagina mostra se
-- la chiave c'e' e quanto credito resta, che e' l'informazione utile.
--
-- ============================================================================
-- DUE MODELLI PER USO, NON UNO
-- ============================================================================
-- `modello_primario` e' quello che si prova per primo, `modello_riserva` quello
-- a cui si passa se il primo non basta. Non e' un capriccio: sulle fatture dei
-- corrieri il modello economico legge perfettamente le FedEx e sbaglia otto
-- righe su ventitre della Trading Post di gennaio — ma quando sbaglia **la
-- quadratura non torna**, e questo si vede senza doverlo indovinare. Il
-- passaggio al modello piu' capace avviene solo quando serve davvero, deciso
-- da una prova aritmetica e non da una regola scritta a priori.
--
-- Chi non vuole il ripiego mette `modello_riserva` a NULL e resta un tentativo
-- solo.

create table if not exists public.ai_config (
  chiave            text primary key,
  descrizione       text        not null,
  modello_primario  text        not null,
  modello_riserva   text,
  -- Parametri del lavoro, non del modello: risoluzione delle pagine, pagine
  -- massime, timeout. Sono qui perche' cambiano insieme al modello.
  parametri         jsonb       not null default '{}'::jsonb,
  attivo            boolean     not null default true,
  aggiornato_il     timestamptz not null default now(),
  aggiornato_da     uuid references public.utenti(id) on delete set null,

  constraint ai_config_parametri_oggetto check (jsonb_typeof(parametri) = 'object'),
  constraint ai_config_modelli_non_vuoti check (
    length(trim(modello_primario)) > 0
    and (modello_riserva is null or length(trim(modello_riserva)) > 0)
  )
);

comment on table public.ai_config is
  'Modelli AI per ciascun uso dell''intranet. La chiave API sta nell''ambiente, non qui.';
comment on column public.ai_config.modello_riserva is
  'Usato solo quando il primario produce un risultato che non supera la verifica del chiamante.';

alter table public.ai_config enable row level security;
-- Nessuna policy: ci arriva soltanto il server con la service role, come per le
-- altre tabelle di configurazione del portale.

insert into public.ai_config (chiave, descrizione, modello_primario, modello_riserva, parametri)
values (
  'vettori.lettura_fattura',
  'Lettura delle fatture dei corrieri che arrivano come immagine, senza testo estraibile',
  'google/gemini-3.5-flash-lite',
  'google/gemini-3.6-flash',
  jsonb_build_object('dpi', 200, 'massimo_pagine', 8, 'timeout_secondi', 120)
)
on conflict (chiave) do nothing;

notify pgrst, 'reload schema';
