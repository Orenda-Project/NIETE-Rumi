-- bd-60011 — Beacon House capstone level transposition: swap + repair.
--
-- WHAT WAS WRONG
--   2026-07-21-capstone-import.sql attached the 4 BH capstones to levels in
--   ascending source-quiz-id order (8->18, 9->19, 10->20, 11->21). In the legacy
--   FDE platform those quizzes are NOT in level order:
--       quiz 10 = "…(Computer Science)"  -> legacy level 8 = Computer Science -> level 21
--       quiz 11 = "…(Science/STEM)"      -> legacy level 7 = General Science  -> level 20
--   so the last two landed transposed. Consequences, both live:
--     (a) the level-20 "General Science" exam served Computer Science prompts
--         (and vice versa) to every teacher who sat it in the bot;
--     (b) sync-training-from-fde.py takes level_id from the NIETE quiz row
--         (:493-554), so every CS pass it imported was filed as General Science
--         and every Science pass as Computer Science — 546 exact-matched attempts.
--
-- WHAT THIS DOES
--   1. Restores the capstone -> level mapping to the legacy truth. This alone
--      fixes exam content and every future sync.
--   2. Re-files the IMPORTED attempts (quiz_kind='grand') onto the level their
--      quiz actually belongs to, and their certificates with it — level_id,
--      level_name_snapshot, and pdf_r2_key=NULL so the PDF re-mints with the
--      right subject on next download (fetch-or-mint, certificate-pdf.service.js
--      :666-680; the R2 key is deterministic, so the stale object is overwritten).
--
-- WHAT THIS DELIBERATELY LEAVES ALONE
--   * NATIVE in-bot attempts (quiz_kind='capstone', 127 rows from 2026-08-04).
--     A capstone only unlocks after all of that level's modules are complete
--     (unlock_logic='all_modules'), so those teachers studied the subject named
--     on their certificate and were served the wrong subject's prompts. Their
--     answers are real (387+451 answer rows, avg 526-708 chars). Relabelling
--     would hand them a credential for a course they never took. The mis-served
--     content is a partner-facing incident, not a certificate to rewrite.
--   * 7 certificates whose target (user_id, level_id) is already held by a
--     NATIVE certificate. Resolving those means deleting a certificate, which
--     is a human call. They are listed by the verification query at the bottom.
--
-- Idempotent: the guard in step 1 aborts if the mapping is already correct.
BEGIN;

-- ---------------------------------------------------------------- 1. guard
DO $$
DECLARE q31 bigint; q32 bigint;
BEGIN
  SELECT level_id INTO q31 FROM training_grand_quizzes WHERE source_quiz_id = 10 AND quiz_type = 'capstone';
  SELECT level_id INTO q32 FROM training_grand_quizzes WHERE source_quiz_id = 11 AND quiz_type = 'capstone';
  IF q31 IS NULL OR q32 IS NULL THEN
    RAISE EXCEPTION 'BH capstones for source quiz 10/11 not found — wrong database?';
  END IF;
  IF q31 = 21 AND q32 = 20 THEN
    RAISE EXCEPTION 'Mapping is already correct (quiz 10 -> 21, quiz 11 -> 20). Nothing to do.';
  END IF;
  IF q31 <> 20 OR q32 <> 21 THEN
    RAISE EXCEPTION 'Unexpected mapping: quiz10 -> level %, quiz11 -> level %. Re-verify before running.', q31, q32;
  END IF;
END $$;

-- ------------------------------------------- 2. defer the per-level cert uniq
-- 184 teachers passed BOTH subjects, so their two certificates swap places and
-- each blocks the other row-by-row. UNIQUE(user_id, level_id) was not
-- deferrable, which makes such a swap impossible in a single statement.
-- Re-created as DEFERRABLE INITIALLY IMMEDIATE: unchanged for every normal
-- writer, deferrable inside a transaction that asks.
ALTER TABLE training_certificates DROP CONSTRAINT training_certificates_user_level_uniq;
ALTER TABLE training_certificates ADD CONSTRAINT training_certificates_user_level_uniq
  UNIQUE (user_id, level_id) DEFERRABLE INITIALLY IMMEDIATE;
SET CONSTRAINTS training_certificates_user_level_uniq DEFERRED;

-- ------------------------------------------------- 3. swap quiz -> level
-- UNIQUE(level_id, quiz_type) blocks a direct swap too, so park one on level 1
-- (which has no capstone) and land both from there.
UPDATE training_grand_quizzes SET level_id = 1  WHERE source_quiz_id = 11 AND quiz_type = 'capstone';
UPDATE training_grand_quizzes SET level_id = 21 WHERE source_quiz_id = 10 AND quiz_type = 'capstone';
UPDATE training_grand_quizzes SET level_id = 20 WHERE source_quiz_id = 11 AND quiz_type = 'capstone';

-- --------------------------------------- 4. re-file the IMPORTED attempts
UPDATE training_assessment_attempts a
   SET level_id = g.level_id
  FROM training_grand_quizzes g
 WHERE g.id = a.grand_quiz_id
   AND g.source_quiz_id IN (10, 11)
   AND g.quiz_type = 'capstone'
   AND a.quiz_kind = 'grand'
   AND a.level_id IS DISTINCT FROM g.level_id;

-- ------------------------------------ 5. re-file their certificates with them
-- A certificate can only move onto (user, target level) if nothing else of that
-- teacher's is sitting there and STAYING. Anything already on the target blocks
-- the move UNLESS it is itself one of the certificates moving away in this same
-- statement. Blockers are not only native capstone certs: one is a certificate
-- issued off a module quiz (quiz_kind='training_module', Hira 923015957125), so
-- the test is "is the blocker itself moving?", never "what kind is the blocker?".
-- COALESCE(..., FALSE) matters: a blocker with no attempt row yields NULL for
-- that predicate, and an unguarded NOT(NULL) would silently treat it as
-- not-a-blocker and let a duplicate through at COMMIT.
UPDATE training_certificates c
   SET level_id            = a.level_id,
       level_name_snapshot = l.name,
       pdf_r2_key          = NULL
  FROM training_assessment_attempts a
  JOIN training_grand_quizzes g ON g.id = a.grand_quiz_id
  JOIN training_levels l ON l.id = a.level_id
 WHERE a.id = c.attempt_id
   AND g.source_quiz_id IN (10, 11)
   AND g.quiz_type = 'capstone'
   AND a.quiz_kind = 'grand'
   AND c.level_id IS DISTINCT FROM a.level_id
   AND NOT EXISTS (
     SELECT 1
       FROM training_certificates blk
       LEFT JOIN training_assessment_attempts ba ON ba.id = blk.attempt_id
       LEFT JOIN training_grand_quizzes bg ON bg.id = ba.grand_quiz_id
      WHERE blk.user_id = c.user_id
        AND blk.level_id = a.level_id
        AND blk.id <> c.id
        AND NOT COALESCE(
              ba.quiz_kind = 'grand'
              AND bg.source_quiz_id IN (10, 11)
              AND bg.quiz_type = 'capstone'
              AND blk.level_id IS DISTINCT FROM ba.level_id,
            FALSE)
   );

COMMIT;
