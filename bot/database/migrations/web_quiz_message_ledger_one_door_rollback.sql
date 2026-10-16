-- Rollback of web_quiz_message_ledger_one_door.sql: the trigger CHECK back to its seven triggers.
-- Rows of the two new triggers are removed first (they would fail the narrower CHECK); they are counts only.
delete from public.message_ledger where trigger in ('one_door_reply','maker_reply');
alter table public.message_ledger drop constraint if exists message_ledger_trigger_check;
alter table public.message_ledger add constraint message_ledger_trigger_check
  check (trigger in ('home_reply','bind_reply','guest_reply','class_link','class_round','teacher_queue','teacher_refusal'));
