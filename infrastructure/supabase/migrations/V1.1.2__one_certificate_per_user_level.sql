-- V1.1.2 — bd-2670. ONE certificate per (user_id, level_id).
--
-- Reported from the field: the portal listed several certificates against the
-- same training level. Not a rendering fault — the rows were really there.
--
-- Measured on production (NIETE) before this migration:
--   17,183  certificate rows
--   14,070  distinct (user_id, level_id)
--    3,113  SURPLUS rows
--      830  teachers affected
--       56  certificates on the worst single level
--
-- HOW IT RATCHETED. `training_certificates` carried UNIQUE on certificate_code
-- and nothing on (user_id, level_id). Two code defects then compounded:
--
--   1. issueCertificate() deduped on attempt_id alone, so every fresh passing
--      attempt at an already-certified level minted another certificate.
--
--   2. The per-level guard in maybeIssueQuizScoreCertificate() was a
--      `.maybeSingle()`. PostgREST answers 406/PGRST116 when a single-object
--      read matches several rows, so once a teacher held two certificates the
--      guard ERRORED, the error was swallowed, and it failed OPEN — minting one
--      more each time. Two became fifty-six.
--
-- Both are fixed in bot/shared/services/training/certificate.service.js. This
-- migration is the backstop that makes the bug unrepresentable, so no future
-- write path can reintroduce it.
--
-- KEEP-RULE: EARLIEST. The teacher keeps the certificate they first earned
-- (ties broken by id for determinism). Confirmed as the intended rule with the
-- NIETE operator on 2026-08-13. The application code orders `issued_at ASC` and
-- takes the first row, so code and data agree on WHICH certificate survives.
--
-- Rule-15 note — alternatives considered:
--
-- REJECTED  a new `certificate_duplicates` archive table. It would be the 74th
--             table for data that is, by definition, garbage we never query
--             again. The deleted rows are reproducible from
--             training_assessment_attempts (each surplus row carries its
--             attempt_id), so the audit trail already exists upstream.
--
-- REJECTED  a soft-delete flag (`superseded_at`). Every read path would then
--             need the predicate forever, and the one that forgot it would
--             reintroduce exactly the reported bug. A constraint that makes the
--             state impossible beats a column every reader must remember.
--
-- REJECTED  keeping the LATEST certificate. It reads as "your most recent pass
--             counts", but it would churn certificate codes teachers may
--             already have downloaded, screenshotted, or been issued against.
--             The first-earned code is the one in the wild.
--
-- ACCEPTED  delete the surplus, then a plain UNIQUE constraint.
--
-- Idempotent: re-running is a no-op once the constraint exists.

BEGIN;

-- 1. Delete the surplus, keeping the earliest certificate per (user, level).
--    `id` breaks issued_at ties so the choice is deterministic on re-run.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id, level_id
               ORDER BY issued_at ASC, id ASC
           ) AS rn
    FROM training_certificates
)
DELETE FROM training_certificates tc
USING ranked r
WHERE tc.id = r.id
  AND r.rn > 1;

-- 2. The backstop. Applied AFTER the cleanup, so it cannot fail on live data.
--    A duplicate insert now raises 23505 instead of silently landing.
ALTER TABLE training_certificates
    DROP CONSTRAINT IF EXISTS training_certificates_user_level_uniq;

ALTER TABLE training_certificates
    ADD CONSTRAINT training_certificates_user_level_uniq
    UNIQUE (user_id, level_id);

COMMIT;
