-- Rollback of web_quiz_message_ledger_minutes.sql: drops the eight-argument message_ledger_add, recreates the
-- seven-argument one exactly as web_quiz_message_ledger.sql made it (and its grants), and drops the minutes column.
-- Counts and US$ are kept. Re-runnable. One transaction.

begin;

drop function if exists public.message_ledger_add(date, text, uuid, text, text, integer, numeric, numeric);

create or replace function public.message_ledger_add(
  p_day date, p_trigger text, p_class_id uuid, p_initiated text, p_recipient text, p_n integer, p_usd_each numeric default 0.015
) returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.message_ledger (day, trigger, class_id, initiated, recipient, count, usd)
  values (p_day, p_trigger, p_class_id, p_initiated, p_recipient, p_n, round(p_usd_each * p_n, 4))
  on conflict (day, trigger, coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid), initiated, recipient)
  do update set count = message_ledger.count + excluded.count,
                usd = message_ledger.usd + excluded.usd,
                updated_at = now()
  returning count
$$;

revoke all on function public.message_ledger_add(date, text, uuid, text, text, integer, numeric) from public, anon, authenticated;
grant execute on function public.message_ledger_add(date, text, uuid, text, text, integer, numeric) to service_role;

alter table public.message_ledger drop column if exists minutes;

commit;
