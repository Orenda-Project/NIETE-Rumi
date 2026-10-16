-- requires: web_quiz_message_ledger_minutes.sql
-- Migration: cap hits beside sends on the web quiz's send ledger (message_ledger).
--
-- NON-DESTRUCTIVE. One new column (default 0, so every existing row reads 0 capped). Re-runnable. One transaction.
-- A reply the per-phone daily cap refused leaves no send and no cost; until now it left no ledger row either, only a
-- log line, so the cost strip could not say how many replies a day were held back. The bot now adds 1 to `capped` on
-- the day's row (count and usd stay sends only; message_ledger_add is unchanged and never writes it).
--   capped       integer >= 0: replies the cap refused for this row's day x trigger x class x initiator x recipient
-- Apply after web_quiz_message_ledger_minutes.sql. One env = one DB. Apply to sandbox first; staging and prod only on a go.

begin;

alter table public.message_ledger
  add column if not exists capped integer not null default 0 check (capped >= 0);

commit;
