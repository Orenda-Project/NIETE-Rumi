-- Rollback for V1.10.4. Drops the replica check and puts the two-value trigger_mode list back.
-- Roll back only with the code that writes 'in_app' switched off, and only once no 'in_app' row exists: the re-added
-- CHECK fails on such a row (move them first: UPDATE lp_feedback SET trigger_mode = NULL WHERE trigger_mode = 'in_app').
DROP FUNCTION IF EXISTS public.db_is_replica();
ALTER TABLE lp_feedback DROP CONSTRAINT IF EXISTS lp_feedback_trigger_mode_check;
ALTER TABLE lp_feedback ADD CONSTRAINT lp_feedback_trigger_mode_check
  CHECK (trigger_mode IN ('after_voice_note', 'after_pdf_only'));
NOTIFY pgrst, 'reload schema';
