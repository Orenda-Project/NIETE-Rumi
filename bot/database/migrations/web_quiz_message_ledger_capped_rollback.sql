-- Rollback of web_quiz_message_ledger_capped.sql: drops the capped column. Counts, US$ and minutes are kept.
-- Re-runnable. One transaction.

begin;

alter table public.message_ledger drop column if exists capped;

commit;
