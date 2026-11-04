# Security

## Reporting

Email the maintainer privately. Do not open a public issue for a vulnerability.

## Secrets policy

- **No provider key ever ships in the client bundle.** Keys live in Supabase Vault
  (`groq_api_key`, `openrouter_api_key`, `model_api_key`) and are read only by the
  service-role Edge Function through `get_app_secret(text)`, which is revoked from
  `public`, `anon` and `authenticated`.
- **No `EXPO_PUBLIC_*` variable may contain a secret.** Only the Supabase URL and the
  RLS-scoped anon key are public by design.
- **Recordings are private and short-lived.** Audio is uploaded to a user-scoped path,
  read by the Edge Function, and deleted from Storage after processing.

## Tenant isolation

Every table with store data has Row Level Security enabled. Policies enforce
`is_store_member(store_id)`. Legacy per-user rows are scoped with
`user_id = auth.uid() AND store_id IS NULL` so a multi-store owner can never read
merged tenants through a personal-scope query.

## Ledger integrity

`events` is append-only: a trigger rejects `UPDATE` and `DELETE`. Corrections are
`VOID` events that reference the original `ledger_event_id`, followed by a replacement.
Idempotency is enforced with a client-generated UUID and a
`pg_advisory_xact_lock(user_id, ledger_event_id)`.
