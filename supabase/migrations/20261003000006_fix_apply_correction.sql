-- M0.6 Fix apply_correction: gen_random_bytes lives in the extensions schema,
-- so the replacement insert failed with 42883. Use built-in gen_random_uuid().

create or replace function public.apply_correction(
    p_voided_event_id uuid,
    p_replacement_type text,
    p_replacement_payload jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
    uid uuid := auth.uid();
begin
    if uid is null then
        raise exception 'not authenticated';
    end if;

    if not exists (
        select 1 from public.events
        where event_id = p_voided_event_id and user_id = uid
    ) then
        raise exception 'event not found';
    end if;

    -- Deterministic ledger id makes the void idempotent
    insert into public.events (user_id, type, payload, ledger_event_id)
    values (uid, 'VOID', jsonb_build_object('voided_event_id', p_voided_event_id), 'void-' || p_voided_event_id::text)
    on conflict (user_id, ledger_event_id) do nothing;

    if p_replacement_type is not null then
        insert into public.events (user_id, type, payload, ledger_event_id)
        values (
            uid,
            p_replacement_type,
            coalesce(p_replacement_payload, '{}'::jsonb),
            'edit-' || p_voided_event_id::text || '-' || replace(gen_random_uuid()::text, '-', '')
        );
    end if;

    return true;
end;
$$;

revoke all on function public.apply_correction(uuid, text, jsonb) from public, anon;
grant execute on function public.apply_correction(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
