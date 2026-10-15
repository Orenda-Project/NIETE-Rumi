-- Migration: the web quiz's send ledger (message_ledger).
--
-- NON-DESTRUCTIVE. One new table, its unique index and one function; nothing existing changes. Re-runnable.
--
-- One row per Pakistan day x trigger x class x initiator x recipient: how many WhatsApp messages the web quiz's
-- flows sent and what they cost (US$0.015 each, a service reply in Pakistan). Written only by
-- message_ledger_add() below, called (supabase.rpc) by bot/shared/services/quiz/message-ledger.js record(), which logs
-- web_quiz.msg_sent in the same call, so the count here equals the msg_sent count per trigger. Written whenever a
-- sender calls it (the sender's own switch decides whether it sends).
--   message_ledger_add(day, trigger, class_id, initiated, recipient, n, usd_each = 0.015): one atomic upsert that
--   adds n to the count and round(usd_each * n, 4) to usd (the price is the caller's: a service reply is 0.015, a
--   template to a teacher another price), and returns the row's new count. The table's CHECKs apply to it.
--   class_id   the class the send was for (a teacher's class link or a class invitation), else NULL
--   no row may say initiated='bot' AND recipient='family': the web quiz never starts a conversation with a family
-- No phone, no name, no child id: counts only. Service role only (RLS on, no policy).
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

begin;

create table if not exists public.message_ledger (
  day        date          not null,                 -- Pakistan day (UTC+5)
  trigger    text          not null check (trigger in ('home_reply','bind_reply','guest_reply','class_link',
                                                       'class_round','teacher_queue','teacher_refusal')),
  class_id   uuid,
  initiated  text          not null check (initiated in ('user','bot')),
  recipient  text          not null check (recipient in ('family','teacher')),
  count      integer       not null default 0 check (count >= 0),
  usd        numeric(10,4) not null default 0,
  updated_at timestamptz   not null default now(),
  constraint message_ledger_no_bot_to_family check (not (initiated = 'bot' and recipient = 'family'))
);

create unique index if not exists message_ledger_key
  on public.message_ledger (day, trigger, coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid), initiated, recipient);

alter table public.message_ledger enable row level security;

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

comment on table public.message_ledger is
  'web quiz sends per Pakistan day, trigger, class, initiator and recipient (counts and US$ only); written by the bot (service role)';

commit;
