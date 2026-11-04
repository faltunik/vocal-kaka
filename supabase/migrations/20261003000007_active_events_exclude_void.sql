-- M0.7 active_events should contain only live ledger entries: exclude VOID rows
-- (they are metadata) as well as events that have been voided.

create or replace view public.active_events
with (security_invoker = true)
as
select e.*
from public.events e
where e.type <> 'VOID'
  and not exists (
    select 1
    from public.events v
    where v.type = 'VOID'
      and v.user_id = e.user_id
      and v.payload->>'voided_event_id' = e.event_id::text
);

notify pgrst, 'reload schema';
