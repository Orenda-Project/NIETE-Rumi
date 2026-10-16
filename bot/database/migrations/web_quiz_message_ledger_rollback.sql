-- Rollback of web_quiz_message_ledger.sql: drops the send ledger's function and table (no other table references it).
DROP FUNCTION IF EXISTS public.message_ledger_add(date, text, uuid, text, text, integer, numeric);
DROP INDEX IF EXISTS public.message_ledger_key;
DROP TABLE IF EXISTS public.message_ledger;
