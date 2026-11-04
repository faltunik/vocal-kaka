-- M0.4 Server-only secret access for Edge Functions.
-- The process-recording function runs with the service_role key; this
-- SECURITY DEFINER helper reads Vault without exposing decrypted_secrets
-- to anon/authenticated clients.

create or replace function public.get_app_secret(secret_name text)
returns text
language sql
security definer
set search_path = vault, public
as $$
    select decrypted_secret
    from vault.decrypted_secrets
    where name = secret_name
    limit 1;
$$;

revoke all on function public.get_app_secret(text) from public;
revoke all on function public.get_app_secret(text) from anon;
revoke all on function public.get_app_secret(text) from authenticated;
grant execute on function public.get_app_secret(text) to service_role;
