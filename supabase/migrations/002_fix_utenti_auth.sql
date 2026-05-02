-- Fix: rimuovi default UUID e usa auth.uid()
-- L'id della tabella utenti deve corrispondere all'id di auth.users

alter table utenti alter column id drop default;

-- Trigger per creare automaticamente un record in utenti quando viene creato un utente auth
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.utenti (id, email, nome, cognome, ruolo, reparto)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', 'Nome'),
    coalesce(new.raw_user_meta_data->>'cognome', 'Cognome'),
    coalesce(new.raw_user_meta_data->>'ruolo', 'addetto'),
    new.raw_user_meta_data->>'reparto'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Trigger su auth.users (solo se non esiste già)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
