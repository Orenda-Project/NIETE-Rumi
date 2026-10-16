-- requires: web_quiz_message_ledger.sql
-- Migration: teacher minutes beside dollars on the web quiz's send ledger (message_ledger).
--
-- NON-DESTRUCTIVE. One new column (default 0, so every existing row reads 0 minutes) and message_ledger_add gains an
-- eighth argument. Re-runnable. One transaction.
--
-- A class round costs the teacher's time as well as the messages: about a minute per child, one child at a time. The
-- cost line a programme officer reads shows minutes beside US$ for the 'class_round' trigger.
--   minutes      numeric(10,2), >= 0: teacher minutes spent on the sends in this row (0 for every other trigger)
--   message_ledger_add(day, trigger, class_id, initiated, recipient, n, usd_each = 0.015, minutes_each = 0): as before,
--   and adds round(minutes_each * n, 2) to minutes. The seven-argument version is DROPPED first so a call with the old
--   seven (named) arguments resolves to this one, never to two candidates; it adds 0 minutes.
-- Apply after web_quiz_message_ledger.sql. One env = one DB. Apply to sandbox first; staging and prod only on a go.

begin;

alter table public.message_ledger
  add column if not exists minutes numeric(10,2) not null default 0 check (minutes >= 0);

drop function if exists public.message_ledger_add(date, text, uuid, text, text, integer, numeric);

create or replace function public.message_ledger_add(
  p_day date, p_trigger text, p_class_id uuid, p_initiated text, p_recipient text, p_n integer,
  p_usd_each numeric default 0.015, p_minutes_each numeric default 0
) returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.message_ledger (day, trigger, class_id, initiated, recipient, count, usd, minutes)
  values (p_day, p_trigger, p_class_id, p_initiated, p_recipient, p_n, round(p_usd_each * p_n, 4), round(p_minutes_each * p_n, 2))
  on conflict (day, trigger, coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid), initiated, recipient)
  do update set count = message_ledger.count + excluded.count,
                usd = message_ledger.usd + excluded.usd,
                minutes = message_ledger.minutes + excluded.minutes,
                updated_at = now()
  returning count
$$;

revoke all on function public.message_ledger_add(date, text, uuid, text, text, integer, numeric, numeric) from public, anon, authenticated;
grant execute on function public.message_ledger_add(date, text, uuid, text, text, integer, numeric, numeric) to service_role;

comment on column public.message_ledger.minutes is
  'teacher minutes spent on these sends (a class round: about one per child asked); 0 for sends that take no teacher time';

commit;
