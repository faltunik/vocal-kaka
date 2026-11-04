-- ============================================================================
-- Migration: 20261004000024_voice_log_hardening.sql
-- Description: voice_command_logs is an internal audit + rate-limit table
--              written exclusively by the process-recording Edge Function
--              (service role). The app never reads or writes it, so all client
--              access is revoked: users must not be able to delete or rewrite
--              their own rate-limit history.
-- ============================================================================

drop policy if exists "voice_logs_owner_all" on public.voice_command_logs;

notify pgrst, 'reload schema';
