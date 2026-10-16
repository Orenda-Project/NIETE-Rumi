-- requires: web_quiz_message_ledger_capped.sql
-- Migration: two more counted replies on the web quiz's send ledger (message_ledger): the one /quiz reply
-- (`one_door_reply`, switch quiz_one_door) and the quiz-maker page's reply (`maker_reply`, switch quiz_maker_page).
--
-- NON-DESTRUCTIVE. The trigger CHECK is widened (the seven triggers it allowed are still allowed, every existing row
-- still passes); nothing else changes. Re-runnable. One transaction. Without it the bot still sends these replies
-- (a refused ledger row is logged as web_quiz.ledger_write_failed and the reply goes out); with it they are counted.
-- Apply after web_quiz_message_ledger_capped.sql. One env = one DB. Apply to sandbox first; staging and prod only on a go.

begin;

alter table public.message_ledger drop constraint if exists message_ledger_trigger_check;
alter table public.message_ledger add constraint message_ledger_trigger_check
  check (trigger in ('home_reply','bind_reply','guest_reply','class_link','class_round','teacher_queue','teacher_refusal',
                     'one_door_reply','maker_reply'));

commit;
