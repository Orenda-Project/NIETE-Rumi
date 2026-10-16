-- Rollback of web_quiz_message_ledger_first_touch.sql: the trigger CHECK back to the seven names. It refuses (and
-- changes nothing) while a row of door_reply, maker_reply or family_reply exists, so no count is silently dropped:
-- export or delete those rows first. Re-runnable. ONE statement; no BEGIN/COMMIT.

alter table public.message_ledger
  drop constraint if exists message_ledger_trigger_check,
  add constraint message_ledger_trigger_check check (trigger in ('home_reply','bind_reply','guest_reply','class_link',
                                                                 'class_round','teacher_queue','teacher_refusal'));
