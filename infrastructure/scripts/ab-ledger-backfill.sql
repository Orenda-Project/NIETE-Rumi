-- ab-ledger-backfill.sql — put the two ICT tests that ran before the ledger into it (bd-9nb6s0.2). Needs V1.10.7 and
-- V1.10.12. Run once, by hand, on the database that holds the tracker (NIETE main, ruling R8: a typed go first).
-- Idempotent: a second run changes nothing. It reads the two draw tables and writes ab_card_lock / ab_assignment only.
--
--   ict-v10-coaching  draw seed coach-ab-v10-2026#11, 340 schools, groups A-D (2x2: plan x report), running to 7 Dec
--   ict-lp-ch3-8      draw seed lp-ab-ch310-2026#6,  374 schools, groups A/B, read 16 Oct: no bar met (inconclusive)
--
-- GUARD. Each draw table must hold exactly its seed's school count, or the whole run stops before writing a row:
-- a different count means a different database or a redraw, and the ledger must not record the wrong schools.
-- sha256: these tests had no frozen v2 card, so it is the SHA-256 of the draw seed (marked in the description).
-- Arms are the draw's group letters, lower-cased (ab_assignment.arm allows a-z only). Unit ids only, no names.

DO $$
DECLARE
  v_coach integer := (SELECT count(*) FROM public.niete_coaching_ab_assignment WHERE seed = 'coach-ab-v10-2026#11');
  v_lp    integer := (SELECT count(*) FROM public.niete_lp_ab_assignment WHERE seed = 'lp-ab-ch310-2026#6');
BEGIN
  IF v_coach <> 340 OR v_lp <> 374 THEN
    RAISE EXCEPTION 'ab-ledger-backfill: expected 340 coaching and 374 LP schools, found % and %; nothing written', v_coach, v_lp;
  END IF;
END $$;

INSERT INTO public.ab_card_lock AS c
       (test_id, sha256, unit_kind, metric_ids, start_on, read_on, ended_at, description, status, default_arm,
        switch_key, owner, feature, arm_a, arm_b, launch_date, planned_n, call, winner, called_at)
VALUES
  ('ict-v10-coaching', encode(sha256(convert_to('coach-ab-v10-2026#11', 'UTF8')), 'hex'), 'school',
   ARRAY['plan_fidelity', 'child_quiz_objectives_secured', 'send_failures'], DATE '2026-10-19', DATE '2026-12-07', NULL,
   'Do ICT teachers record and follow lessons more with the one-page v10 card, the new coaching report, or both? (legacy, no v2 card)',
   'running', 'a', 'ab_v10_enabled', 'ICT team', 'ICT G1-5 coaching: v10 one-page card x new report',
   'a: v9 plan + today''s report (control)',
   'b: v10 card + today''s report; c: v9 plan + new report; d: v10 card + new report',
   DATE '2026-10-19', 340, NULL, NULL, NULL),
  ('ict-lp-ch3-8', encode(sha256(convert_to('lp-ab-ch310-2026#6', 'UTF8')), 'hex'), 'school',
   ARRAY['plan_fidelity', 'teachers_coming_back', 'child_quiz_objectives_secured', 'send_failures'],
   DATE '2026-10-02', DATE '2026-10-16', TIMESTAMPTZ '2026-10-16 23:59:59+05',
   'Do ICT G1-5 teachers follow and come back to the new v9 lesson plans more than the August v8 plans? (legacy, no v2 card)',
   'concluded', NULL, 'ab_lp_ch310_enabled', 'ICT team', 'ICT G1-5 lesson plans, chapters 3-8: v9 vs v8',
   'a: August v8 PDF plan (control)', 'b: v9 phone-width plan',
   DATE '2026-10-02', 374, 'no_bar', NULL, TIMESTAMPTZ '2026-10-16 23:59:59+05')
ON CONFLICT (test_id) DO NOTHING;

INSERT INTO public.ab_assignment (test_id, unit_id, arm, block, assigned_at)
SELECT 'ict-v10-coaching', a.school_id, lower(a.ab_group), a.block, a.drawn_at
  FROM public.niete_coaching_ab_assignment a WHERE a.seed = 'coach-ab-v10-2026#11'
ON CONFLICT (test_id, unit_id) DO NOTHING;

INSERT INTO public.ab_assignment (test_id, unit_id, arm, block, assigned_at)
SELECT 'ict-lp-ch3-8', a.school_id, lower(a.ab_group), a.block, a.drawn_at
  FROM public.niete_lp_ab_assignment a WHERE a.seed = 'lp-ab-ch310-2026#6'
ON CONFLICT (test_id, unit_id) DO NOTHING;

UPDATE public.ab_card_lock AS c
   SET current_n = (SELECT count(*) FROM public.ab_assignment a WHERE a.test_id = c.test_id), updated_at = now()
 WHERE c.test_id IN ('ict-v10-coaching', 'ict-lp-ch3-8');

ANALYZE public.ab_assignment;
