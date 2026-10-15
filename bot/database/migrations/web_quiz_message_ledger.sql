-- Migration: the web quiz's send ledger (message_ledger).
--
-- NON-DESTRUCTIVE. One new table and its unique index; nothing existing changes. Re-runnable.
--
-- One row per Pakistan day x trigger x class x initiator x recipient: how many WhatsApp messages the web quiz's
-- flows sent and what they cost (US$0.015 each, a service reply in Pakistan). Written only by
-- bot/shared/services/quiz/web-quiz-ledger.js recordSend(), which logs web_quiz.msg_sent in the same call, so the
-- count here equals the msg_sent count per trigger. Behind app_settings web_quiz_events_v2 (nothing is written
-- while it is off).
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

comment on table public.message_ledger is
  'web quiz sends per Pakistan day, trigger, class, initiator and recipient (counts and US$ only); written by the bot (service role)';

commit;
