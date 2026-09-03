-- row_history_drop_conversation_state — stop auditing coaching_sessions.conversation_state.
--
-- Measured in production 27 minutes after the audit went live (410 rows):
--
--   WITH conversation_state:  180 rows -> 210.8 kB  (1,199 B/row)
--   everything else:          238 rows ->  17.0 kB  (    73 B/row)
--
-- 43% of the rows, 93% of the bytes, 16x heavier per row than anything else,
-- because each diff stores the entire conversation object TWICE — the full Urdu
-- question text, the classroom photo URLs, the whole nested state. Left in, the
-- table runs at ~36 MB/day (~12.8 GB/year); without it, ~2-3 MB/day.
--
-- It is also the least useful column in the set. The audit exists to answer "what
-- did this row used to say" about decisions people later dispute — the status
-- transitions. conversation_state is ephemeral session scratch, rewritten on
-- every turn: exactly what chat_sessions was excluded for. Including it here was
-- a mistake justified by it being nominally one of coaching_sessions' four state
-- machines; the production numbers settled that.
--
-- The three status columns stay. Every transition anyone would query is still
-- recorded — 270 of the 410 rows were `status` alone.
--
-- Existing conversation_state rows are left in place: they are real history, and
-- deleting audit rows to reclaim space is a decision for a retention policy, not
-- a side effect of narrowing an allowlist.

DROP TRIGGER IF EXISTS coaching_sessions_history_trigger ON public.coaching_sessions;
CREATE TRIGGER coaching_sessions_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.coaching_sessions
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'status','lesson_plan_extraction_status','debrief_status');
