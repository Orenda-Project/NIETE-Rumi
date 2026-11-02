-- bd-arghnv.2 — I-SAPS locks the CERTIFICATE, not the level (operator, 2026-11-02).
--
-- "Make the lock only on the certificate. Before issuing the new certificate for
-- Level 2, make sure Level 1 is there. So they have to go back and get that first."
--
-- training_vendors.level_unlock_logic is the LEVEL axis (teacher-training-endpoint.js
-- isLevelChainLocked): 'chain' locks Level N until Level N-1 is passed, 'parallel'
-- opens every level, as Beacon House already does. I-SAPS goes to 'parallel'; the
-- ladder moves to the certificate (certificate.service.js previousLevelCertified),
-- so a Level 2 certificate is issued only to a teacher holding Level 1's.
--
-- Ships WITH the code change that stops one passed module exam from reading as a
-- passed level: with that fix and 'chain' still set, the 51 production teachers
-- already studying Level 2 would be locked out of it.
--
-- unlock_logic (the certification axis, 'all_modules') does not change.
-- Idempotent: re-running changes nothing.
BEGIN;

UPDATE training_vendors
   SET level_unlock_logic = 'parallel'
 WHERE key = 'ISAPS'
   AND level_unlock_logic IS DISTINCT FROM 'parallel';

COMMIT;

-- Rollback:
--   UPDATE training_vendors SET level_unlock_logic = 'chain' WHERE key = 'ISAPS';
