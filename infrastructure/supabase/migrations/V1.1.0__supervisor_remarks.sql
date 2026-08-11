-- V1.1.0  Supervisor Remark (NIETE STEPS-S: the "S" dimension)
--
-- The missing 10% of every teacher's STEPS/ACR score. A PRINCIPAL completes a
-- quarterly 5-indicator rubric (1-4) for each teacher in her school, adds a
-- closing comment, and submits. On submit the teacher receives a coaching-tone
-- narrative with NO scores; the principal keeps the scored copy; S_pct rides
-- the existing Presence->BigQuery export as a sibling to steps.attendance.
--
-- Sibling of V1.0.7__teacher_attendance.sql (STEPS-P). Same org model:
-- schools + users.role + schools.principal_user_id already exist — this
-- migration adds NO new org entities and NO new role.
--
-- Three new tables (justified per root CLAUDE.md Rule 15):
--   * evaluation_cycles        — the named quarterly window ("Second Quarter 2026").
--                                Cannot be a config flag: remarks FK to it, and
--                                the name is spoken to principals in reminders
--                                ("have you submitted your teachers' forms for
--                                Second Quarter 2026?").
--   * supervisor_remarks       — one per (teacher, cycle). Header: the closing
--                                comment, the submit stamp, the generated narrative.
--   * supervisor_remark_scores — one per (remark, indicator). Per-indicator rows
--                                rather than five columns on the header, because
--                                answers are persisted AS THEY ARRIVE and the
--                                rubric is expected to change (see below).
--
-- Anti-sprawl notes:
--   * NO session/state table. A principal's position in the work is DERIVED from
--     these rows: her teachers, minus those with a submitted remark, and for the
--     in-progress one, the indicators already scored. Interruption is the normal
--     case, not an error path — no expiry, no cleanup job, no "session timed out".
--   * NO rubric table (yet). The 5 indicators are referenced by ordinal 1..5;
--     their EN/اردو text lives in the ux-strings catalog with the rest of the
--     teacher-facing copy. A rubric table earns its place only when indicators
--     become per-region or versioned — which is a real possibility, hence the
--     per-indicator row shape here rather than score_1..score_5 columns.
--   * NO new role. users.role='principal' already exists (V1.0.7) and is already
--     seeded (scripts/seed-niete-leader-roles.js).
--   * S_pct is COMPUTED, never stored — see the note at the foot of this file.

BEGIN;

-- Required for the non-overlap EXCLUDE constraint below: btree_gist lets a GIST
-- index carry the plain-equality/range mix used by exclusion constraints.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── Evaluation cycles ──────────────────────────────────────────────────────
-- The quarterly window. HQ (the persona, not a table) opens and closes it by
-- creating a row here.
--
-- Bounds are HALF-OPEN: [starts_at, ends_at). Start inclusive, end exclusive.
-- That makes back-to-back cycles legal (Q2 ending at the same instant Q3 begins
-- is adjacent, not overlapping) and kills the midnight-boundary ambiguity. The
-- JS resolver (shared/services/remark/remark-gate.js :: resolveActiveCycle) uses
-- the identical `t >= start && t < end` test, so code and storage agree.
CREATE TABLE IF NOT EXISTS evaluation_cycles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(120) NOT NULL,       -- "Second Quarter 2026" — spoken to principals
    starts_at     TIMESTAMPTZ NOT NULL,
    ends_at       TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Two cycles named "Second Quarter 2026" would make every reminder ambiguous.
    CONSTRAINT evaluation_cycles_name_unique UNIQUE (name),
    CONSTRAINT evaluation_cycles_range_sane  CHECK (ends_at > starts_at),

    -- THE load-bearing constraint. "Which cycle is today in?" is only answerable
    -- without asking the principal because at most one cycle can contain any
    -- instant. Enforced HERE rather than in the create-cycle endpoint: a
    -- read-then-insert check loses the race when two requests interleave, and
    -- the resolver's correctness must not depend on the endpoint being careful.
    CONSTRAINT evaluation_cycles_no_overlap
        EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&)
);
CREATE INDEX IF NOT EXISTS idx_evaluation_cycles_window
    ON evaluation_cycles (starts_at, ends_at);

-- ─── Supervisor remarks (header) ────────────────────────────────────────────
-- One row per (teacher_id, cycle_id) — the UNIQUE below is what makes a
-- double-submit or a client retry idempotent regardless of flow behaviour.
--
-- Created the moment the principal answers her FIRST indicator for a teacher,
-- NOT at submit — the header is what the score rows hang off. So a row here
-- with submitted_at IS NULL is a partial: real work in progress.
--
-- submitted_at is therefore NOT redundant with "has 5 scores". A fifth score
-- arriving is not the same event as the principal COMMITTING, and only the
-- commit may fire the teacher's narrative. Keeping them separate is what stops
-- a teacher being messaged the instant a principal happens to answer question 5.
CREATE TABLE IF NOT EXISTS supervisor_remarks (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id              UUID NOT NULL REFERENCES evaluation_cycles(id),
    teacher_id            UUID NOT NULL REFERENCES users(id),
    principal_user_id     UUID NOT NULL REFERENCES users(id),
    school_id             UUID REFERENCES schools(id),   -- denormalised for query speed (mirrors V1.0.7)

    -- The principal's closing comment. Captured as text or voice; a voice note
    -- is transcribed and the transcript stored here, with the audio id kept for
    -- provenance (same pattern as the attendance voice path).
    comment_text          TEXT,
    comment_audio_id      VARCHAR(128),
    comment_language      VARCHAR(8),                    -- en | ur (see ux-strings catalog)

    submitted_at          TIMESTAMPTZ,                   -- NULL = partial, in progress

    -- The coaching-tone message sent to the TEACHER: strengths -> growth ->
    -- action plan, NO scores. Stored so it is auditable and re-sendable without
    -- re-generating (generation is non-deterministic and costs an LLM call).
    narrative_text        TEXT,
    narrative_generated_at TIMESTAMPTZ,
    narrative_sent_at     TIMESTAMPTZ,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT supervisor_remarks_teacher_cycle_unique UNIQUE (teacher_id, cycle_id),
    -- A teacher cannot remark on anyone, including themselves.
    CONSTRAINT supervisor_remarks_no_self CHECK (teacher_id <> principal_user_id)
);
CREATE INDEX IF NOT EXISTS idx_supervisor_remarks_principal_cycle
    ON supervisor_remarks (principal_user_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_supervisor_remarks_teacher_cycle
    ON supervisor_remarks (teacher_id, cycle_id);
-- Drives the resume query ("which teachers has she not finished?") and the
-- HQ completion report ("who still owes forms for this cycle?").
CREATE INDEX IF NOT EXISTS idx_supervisor_remarks_cycle_pending
    ON supervisor_remarks (cycle_id, principal_user_id)
    WHERE submitted_at IS NULL;

-- ─── Supervisor remark scores (one row per indicator) ───────────────────────
-- Persisted AS THE PRINCIPAL ANSWERS. These rows ARE the session: 3 rows for a
-- remark means she stopped after indicator 3 and resumes at 4.
--
-- indicator_ordinal is 1..5 against the locked 5-indicator rubric; the wording
-- lives in the ux-strings catalog (EN/اردو), NOT here — copy is data, and Rule 20
-- forbids a partial language map. Scores are 1..4.
--
-- UNIQUE (remark_id, indicator_ordinal) makes re-answering an UPSERT, which is
-- exactly what "let me change my answer to question 2" needs — for free.
CREATE TABLE IF NOT EXISTS supervisor_remark_scores (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    remark_id          UUID NOT NULL REFERENCES supervisor_remarks(id) ON DELETE CASCADE,
    indicator_ordinal  SMALLINT NOT NULL,
    score              SMALLINT NOT NULL,
    answered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT supervisor_remark_scores_unique UNIQUE (remark_id, indicator_ordinal),
    CONSTRAINT supervisor_remark_scores_ordinal_valid CHECK (indicator_ordinal BETWEEN 1 AND 5),
    CONSTRAINT supervisor_remark_scores_score_valid   CHECK (score BETWEEN 1 AND 4)
);
CREATE INDEX IF NOT EXISTS idx_supervisor_remark_scores_remark
    ON supervisor_remark_scores (remark_id);

-- ─── Capability grant (permission as DATA, not a conditional) ───────────────
-- /remark is gated on the capability `remark.author`, resolved from the
-- existing feature_permissions(role, feature_key, can_access) matrix — the same
-- table the dashboard's requireFeatureAccess() already uses. See
-- bot/shared/services/authz/capability.js for why this exists rather than a
-- fifth bespoke `role === 'principal'` check.
--
-- Seeding `principal` here is the DEFAULT, not the rule: when ICT decides an
-- AEO may also author remarks, that is ONE INSERT — no code change, no deploy.
-- Equally, revoking is an UPDATE; a principal whose row is pulled is denied by
-- the same path. Default-deny means any role without a row is refused.
--
-- feature_permissions has no FK to dashboard_users, so it holds `users`-table
-- roles (teacher/principal) alongside portal-staff roles without modification.
INSERT INTO feature_permissions (role, feature_key, can_access)
VALUES ('principal', 'remark.author', true)
ON CONFLICT (role, feature_key) DO UPDATE SET can_access = EXCLUDED.can_access;

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Mirrors V1.0.7: portal/bot routes use the service role key (bypasses RLS);
-- policies here are defence-in-depth for ad-hoc analyst queries and future
-- direct-Supabase reads. Application code remains the primary gate.
ALTER TABLE evaluation_cycles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervisor_remarks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervisor_remark_scores   ENABLE ROW LEVEL SECURITY;

-- Cycles: readable by everyone (name + dates only — no teacher data).
DROP POLICY IF EXISTS evaluation_cycles_read_all ON evaluation_cycles;
CREATE POLICY evaluation_cycles_read_all ON evaluation_cycles FOR SELECT USING (true);

-- Remarks: the authoring principal sees the row (scores included). The teacher
-- may read ONLY their own row — and note this exposes the header, which is why
-- the scores live in a SEPARATE table with no teacher-read policy at all. The
-- "teacher never sees a score" rule is thereby structural, not just a SELECT
-- list someone must remember to trim.
DROP POLICY IF EXISTS supervisor_remarks_read_scoped ON supervisor_remarks;
CREATE POLICY supervisor_remarks_read_scoped ON supervisor_remarks
    FOR SELECT USING (
        principal_user_id = auth.uid()
        OR teacher_id = auth.uid()
    );

-- Scores: PRINCIPAL ONLY. No teacher-readable path exists by construction.
DROP POLICY IF EXISTS supervisor_remark_scores_read_principal ON supervisor_remark_scores;
CREATE POLICY supervisor_remark_scores_read_principal ON supervisor_remark_scores
    FOR SELECT USING (
        remark_id IN (
            SELECT id FROM supervisor_remarks WHERE principal_user_id = auth.uid()
        )
    );

-- Writes restricted to service_role (routes do the work).
-- No INSERT/UPDATE/DELETE policies -> default-deny for non-service-role.

-- ─── S_pct view (the ONE definition of the score) ───────────────────────────
-- S      = SUM(5 indicators)  -> 5..20   (floor is 5, NOT 0)
-- S_pct  = S / 20 * 100       -> 25..100 (floor is 25, NOT 0)
-- STEPS applies the 10% weight; we hand it s_pct.
--
-- A VIEW, not stored columns. The design spec's draft stored s_score + s_pct on
-- the remark row, which means the same fact exists twice: five scores and a
-- total. Edit a score without recomputing and they disagree SILENTLY — in the
-- number that feeds a teacher's promotion file. A view cannot drift.
--
-- The two safety rules live HERE so no caller can forget them:
--   * submitted_at IS NOT NULL  — a partial never reaches STEPS.
--   * COUNT(*) = 5              — an incomplete rubric scores NOTHING rather
--                                 than a plausible-looking low percentage
--                                 (3 answered summing to 12 would read 60%).
-- Mirrors bot/shared/services/remark/remark-rubric.js :: computeS(), which
-- enforces the identical rules in JS and throws instead of returning a number.
-- Both are covered by boundary tests (all-4 -> 100, all-1 -> 25, partial -> absent).
--
-- Emits the flat sub-score columns the STEPS export expects (design spec §8),
-- so row-based storage produces the published contract without a second table.
CREATE OR REPLACE VIEW v_supervisor_remark_scores AS
SELECT
    r.id                AS remark_id,
    r.cycle_id,
    r.teacher_id,
    r.principal_user_id,
    r.school_id,
    r.submitted_at,
    MAX(s.score) FILTER (WHERE s.indicator_ordinal = 1) AS score_growth,
    MAX(s.score) FILTER (WHERE s.indicator_ordinal = 2) AS score_collaboration,
    MAX(s.score) FILTER (WHERE s.indicator_ordinal = 3) AS score_leadership,
    MAX(s.score) FILTER (WHERE s.indicator_ordinal = 4) AS score_student_support,
    MAX(s.score) FILTER (WHERE s.indicator_ordinal = 5) AS score_parents,
    SUM(s.score)::INT                                   AS s_score,
    ROUND((SUM(s.score)::NUMERIC / 20) * 100, 1)        AS s_pct
FROM supervisor_remarks r
JOIN supervisor_remark_scores s ON s.remark_id = r.id
WHERE r.submitted_at IS NOT NULL
GROUP BY r.id, r.cycle_id, r.teacher_id, r.principal_user_id, r.school_id, r.submitted_at
HAVING COUNT(s.id) = 5;

COMMENT ON VIEW v_supervisor_remark_scores IS
 'STEPS "S" scores. THE single definition of s_score/s_pct — never store them. '
 'Only submitted, fully-answered (5/5) remarks appear; partials are absent by '
 'construction, so a partial can never be exported as a real score. '
 'JS accessor: bot/shared/services/remark/remark-score.repository.js';

COMMIT;

-- ─── PostgREST reload ───────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ─── Note on S_pct (deliberately NOT a column) ──────────────────────────────
-- S_pct is derived from a SUBMITTED remark's five scores, and it is computed at
-- export time rather than stored — the same way presence_pct is computed by
-- computePresence() rather than persisted on teacher_attendance_records.
--
-- The weighting across the five indicators is a BUSINESS RULE that is NOT yet
-- specified (the design spec's Appendix A was never attached to the card). Equal
-- weighting — avg(score) scaled from the 1..4 range to 0..100 — is the obvious
-- default but has NOT been confirmed by ICT. It is therefore left to the export
-- worker, where it can change without a migration and without rewriting history.
--
-- Only remarks with submitted_at IS NOT NULL are eligible for export. A partial
-- must never reach STEPS.
--
-- DOWN (manual):
--   DROP TABLE IF EXISTS supervisor_remark_scores;
--   DROP TABLE IF EXISTS supervisor_remarks;
--   DROP TABLE IF EXISTS evaluation_cycles;
