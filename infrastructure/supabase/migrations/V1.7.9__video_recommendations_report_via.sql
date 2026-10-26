-- V1.7.9 — video_recommendations.report_via: how the coaching report went (bd-gzfdu9 R7p-b, COS 20261026T044621 §1).
-- Versioned migration, additive only. Applied per environment, in order, by hand with a ledger row (PROD_PLAN §7);
-- never through --apply-all-pending on prod. Never reuse 1.7.7.
--
-- WHAT. One nullable column on the V1.7.0 table: the path the hero report took to the teacher once it went —
-- image (the full image, window open), slim (the v10 C/D image), template (window closed: share_dc_report_v1, no
-- follow-ups), pdf. Written on EVERY row (shown, shadow, none) by video-reco/report-via.js; NULL = not recorded
-- (an older engine, the report never went, or a database without this column — the writer probes it and skips the key).
--
-- WHY A COLUMN, NOT A TABLE (root CLAUDE.md rule 15). 0 new tables. No existing column holds it: sent_via is the CLIP
-- message's channel (overloading it breaks the H9 no-double-send guard); it is not computable from any table (only the
-- Axiom event coaching.report.template_sent, ungoverned and retention-bound). The A/B reads exposure per path from here.
-- DATA. An enumerated string. No names, no phones, no teacher text.
-- LOAD. None beyond V1.7.0: same rows, one UPDATE per report.
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS. Rollback: ROLLBACK_V1.7.9__video_recommendations_report_via.sql

ALTER TABLE video_recommendations ADD COLUMN IF NOT EXISTS report_via TEXT
  CHECK (report_via IS NULL OR report_via IN ('image', 'slim', 'template', 'pdf'));

COMMENT ON COLUMN video_recommendations.report_via IS
  'bd-gzfdu9 R7p-b: how the coaching report went once it went — image | slim | template | pdf; NULL when not recorded.';

NOTIFY pgrst, 'reload schema';
