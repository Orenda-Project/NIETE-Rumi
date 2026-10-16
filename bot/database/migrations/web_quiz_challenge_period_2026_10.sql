-- requires: web_quiz_challenge_registry.sql (creates challenge_periods)
-- Migration: the October 2026 Challenge period, one challenge_periods row.
--
-- Why: web_quiz_challenge_registry_seed.sql ships the November and December 2026 periods only. The first counted
-- month is October 2026, from the go day to the month's end: with web_quiz_challenge_period on and no row holding
-- now(), every serve writes period_id and record NULL and logs web_quiz.ch_period_missing.
-- The row is a Pakistan calendar month, as the seed's rows are (the 1st 00:00 PKT = the prior day 19:00Z):
--   2026-10  2026-09-30T19:00:00Z -> 2026-10-31T19:00:00Z  (ends where the November row starts: no gap, no overlap)
-- Anchor block, weights and bank version are the November row's. The go decision of 16 Oct 2026 is recorded in the
-- operations log, not here.
--
-- ADDITIVE and re-runnable: one INSERT, ON CONFLICT DO NOTHING, so a second run changes nothing and a row already
-- there is never rewritten. No table, column or other row is touched. No BEGIN/COMMIT: the tool that applies
-- migrations owns the transaction.
-- One env = one DB. Apply after web_quiz_challenge_registry.sql; staging first, then prod.
-- Rollback: web_quiz_challenge_period_2026_10_rollback.sql (refuses while a run or a draw names the period).

INSERT INTO public.challenge_periods (period_id, starts_at, ends_at, anchor_block_version, weights_v, bank_version, created_by) VALUES ('2026-10', '2026-09-30T19:00:00Z', '2026-10-31T19:00:00Z', 'A1', 'w1', 'child-test-items-v4', 'seed') ON CONFLICT (period_id) DO NOTHING;
