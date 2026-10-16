-- requires: web_quiz_message_ledger_capped.sql
-- Migration: the first-touch door's three reply names on the web quiz's send ledger (message_ledger).
--
-- ADDITIVE. The trigger CHECK is re-made with the seven names it holds plus door_reply, maker_reply and family_reply
-- (the chooser, the maker cta, the family door: every reply an unknown phone's quiz request gets, counted per PKT day
-- like the others). No row changes; every existing name still passes; any other name is still refused. Re-runnable.
-- ONE statement (drop and add in the same ALTER TABLE), so there is never a moment without the check; no BEGIN/COMMIT.
-- Apply after web_quiz_message_ledger_capped.sql. One env = one DB. Apply to sandbox first; staging and prod only on a go.

alter table public.message_ledger
  drop constraint if exists message_ledger_trigger_check,
  add constraint message_ledger_trigger_check check (trigger in ('home_reply','bind_reply','guest_reply','class_link',
                                                                 'class_round','teacher_queue','teacher_refusal',
                                                                 'door_reply','maker_reply','family_reply'));
