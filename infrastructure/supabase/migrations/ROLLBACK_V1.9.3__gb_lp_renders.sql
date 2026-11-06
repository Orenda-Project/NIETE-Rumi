-- Rollback for V1.9.3 (bd-rj6w0n.14.16). Drops GB's lesson-plan cache. R2 objects under gb-lp/ are left in place.
DROP FUNCTION IF EXISTS gb_lp_claim_waiters(UUID);
DROP FUNCTION IF EXISTS gb_lp_join_waiters(UUID, JSONB);
DROP TABLE IF EXISTS niete_gb_lp_renders;
NOTIFY pgrst, 'reload schema';
