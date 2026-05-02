-- Migration 005: aggiorna il trigger handle_new_user per includere username
-- Quando il superadmin crea utenti via interfaccia, potrà passare username nei metadati

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.utenti (id, email, nome, cognome, ruolo, reparto, username)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', 'Nome'),
    coalesce(new.raw_user_meta_data->>'cognome', 'Cognome'),
    coalesce(new.raw_user_meta_data->>'ruolo', 'addetto'),
    new.raw_user_meta_data->>'reparto',
    new.raw_user_meta_data->>'username'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;
