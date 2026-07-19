# Portal Grand Quiz (Level Exam) + Certificate — Phase 3 Report

Branch: `portal-grand-quiz` · PR: https://github.com/Orenda-Project/NIETE-Rumi/pull/33

Phase 3 of the portal quiz-parity build: the grand quiz (level exam) and
certificate path on the teacher portal, writing the **same tables with the
same semantics** as the WhatsApp bot so a teacher can do coursework and exams
on either surface with synced progress.

---

## 1. Semantics parity table (bot vs portal)

Reference implementation: `bot/shared/services/training/quiz-delivery.service.js`
(grading/cooldown/cert) and `bot/shared/routes/teacher-training-endpoint.js`
`loadGrandQuizState()` (eligibility). Every row below was read from that code,
not assumed.

| Semantic | WhatsApp bot | Portal (this PR) | Identical? |
|---|---|---|---|
| Eligibility to sit the exam | `loadGrandQuizState`: every **active course** in the level has >=1 module in `teacher_training_progress` (the documented phase-1 "started" proxy), and quiz exists + active | `_loadGrandQuizGate`: same queries, same `allDone` criterion, enforced server-side on questions-fetch AND submit | YES |
| Level chain-lock | Flow: `locked` until previous level's exam passed (`unlock_logic='chain'`) | `_assertLevelUnlocked` (pre-existing shared gate) on all 3 new endpoints | YES |
| Pass bar | 100% — `is_passed = (score === total_questions)` | Same expression | YES |
| Grading comparator | `String(q.correct_option).trim() === String(chosen).trim()`, `chosen_option` = 1-based option index as string | Same comparator, same 1-based payload; empty/missing answer counts wrong (defensive, unreachable from the UI) | YES |
| Attempt row on pass | `quiz_kind='grand'`, `status='passed'`, `score`, `is_passed=true`, `cooldown_until=null`, `completed_at`, `total_score=total_questions` | Same row, written one-shot (`started_at=completed_at`, `current_question_index=total_questions`) | YES |
| Attempt row on fail | `status='failed'`, `is_passed=false`, `cooldown_until = now + 24h` | Same, same 24h constant (`GRAND_QUIZ_COOLDOWN_HOURS` mirrors `COOLDOWN_HOURS`) | YES |
| Cooldown gate on retry | Latest attempt `status='failed'` AND `cooldown_until > now` blocks a new attempt | Same predicate; expired cooldown does NOT block (tested) | YES |
| Abandonment | In-progress attempt is resumed on next start; **never** sets cooldown. (The `abandoned` enum value + `idx_taa_abandon_sweep` index exist in the schema, but **no sweep worker writes it yet** — verified by grep, nothing in `bot/workers/`.) | Portal submits one-shot: an abandoned form writes nothing at all, so no cooldown either | YES (no cooldown without a graded fail, on either surface) |
| Answer rows | One `training_assessment_answers` row per question: `(attempt_id, question_index[0-based canonical order], question_id, chosen_option, is_correct)` | Same; `question_index` = 0-based position in the `order_index`-sorted list, matching the WhatsApp Q-by-Q loop (note: the module-quiz endpoint from Phase 1 uses raw `order_index` here — 1-based for migrated data; grand-quiz uses the exact WhatsApp value) | YES |
| Certificate issuance | `training_certificates` insert with code + name/level snapshots; PDF rendering separate (`pdf_r2_key` null until a renderer exists) | **Same code path** — extracted into `bot/shared/services/training/certificate.service.js`; the bot's `gradeAttempt` and the portal both call `issueCertificate()`. Not reimplemented. Now idempotent per `attempt_id`. | YES (shared function) |
| Certificate code format | Was `<deployment-name>-YYYYMMDD-XXXXXX` (hardcoded prefix) | `<PREFIX>-YYYYMMDD-XXXXXX` where PREFIX = `CERT_CODE_PREFIX` -> `BOT_NAME` -> `ORG_NAME` -> `CERT`. The live deployment has `BOT_NAME` set to the same value, so issued codes are byte-identical; the hardcoded deployment name is removed from source (CI hard rule) | YES (same output in this deployment) |
| Program enrollment required | `startGrandQuiz` aborts without an active `teacher_training_assignments` row | 400 without one; `program_id` written from it | YES |
| Retake after pass | Flow surface never offers the exam again ("Passed" badge); `startGrandQuiz` itself doesn't re-check | Portal blocks at the API too: 409 `already_passed` (strictly tighter than the bot's *service* layer, identical to what its *surface* allows) | YES (surface-equivalent) |
| Passed/cooldown attempt scan | CAUTION: Flow scans ALL attempts on the level (`is_passed=true` of ANY kind) — a **perfect per-module quiz** (which also carries `level_id` + `is_passed=true`) would wrongly mark the level passed | Portal filters `quiz_kind='grand'` | Deliberate divergence-from-latent-bug, documented in code, tested ("a perfect per-module attempt does NOT count as a level pass"). Recommend backporting the filter to the Flow's `loadGrandQuizState`/`_computeLevelStates`. |

## 2. Endpoints added (`dashboard/routes/portal.routes.js`)

| Endpoint | Purpose |
|---|---|
| `GET /api/portal/training/level/:id/grand-quiz` | Gate/state: `no_quiz / passed / cooldown / courses_incomplete / ready` + `question_count`, `pass_mark_pct:100`, `cooldown_hours:24`, `cooldown_until`, courses progress, certificate (when passed) |
| `GET /api/portal/training/level/:id/grand-quiz/questions` | The exam paper, `order_index`-sorted, **`correct_option` never leaves the server**; 403 unless state is `ready` |
| `POST /api/portal/training/level/:id/grand-quiz/attempts` | One-shot submit: server-side grading, attempt + answer rows, cooldown on fail, certificate on pass. Gate order: 400 input -> 403/404 chain-lock -> 404 `no_quiz` -> 409 `already_passed` -> 403 `cooldown` -> 403 `courses_incomplete` -> 400 mismatch |

Shared service extracted: `bot/shared/services/training/certificate.service.js`
(`issueCertificate(supabaseClient, {userId, programId, levelId, attemptId})`,
Supabase client injected so each surface uses its own config against the shared
DB; `quiz-delivery.service.js` refactored to call it — WhatsApp message text
and row shape unchanged).

## 3. UI (portal SPA)

- **New** `portal/src/portal/components/LevelExamCard.tsx` — self-contained
  card rendered when a level is selected on the Training page: ready (with
  "Take Level Exam" CTA + "N questions / 100% required / 24h cooldown" copy),
  locked-coursework, cooldown (retry time, local-formatted), certified
  (certificate code + issue date), full exam form (radio per question, submit
  disabled until all answered), and pass/fail result screens (pass -> cert
  code shown, level list refreshed so the next level unlocks live; fail ->
  score + retry time).
- `portal/src/portal/pages/PortalTraining.tsx` — **minimal additive edit**
  (sibling agents are editing this page): 1 import, 1 memo + 1 refresh
  callback, 1 JSX block mounting the card. No existing lines modified.
- `dashboard/portal-frontend/dist` NOT rebuilt in this PR — two sibling
  branches touch the same SPA; rebuild the bundle once at merge time to avoid
  guaranteed dist conflicts.

## 4. Tests

- `tests/training/portal-grand-quiz.test.js` — 18 tests (same mock harness as
  the Phase-1 `portal-quiz-submit.test.js`): auth x2, gate states x4, paper
  ordering + `correct_option` never exposed, early-fetch 403, input
  validation x3, server-side eligibility, **pass** (row shape + answers +
  cert-service call args), **fail** (cooldown ~ now+24h, no cert),
  active-cooldown block, expired-cooldown allow, already-passed 409
  idempotency, module-attempt/`quiz_kind` isolation, no-program 400.
- `tests/training/certificate-service.test.js` — 7 tests: env-driven prefix
  chain + sanitization (no hardcoded deployment names), code format,
  insert row shape, per-attempt idempotency, snapshot fallbacks.
- **Suite status: green relative to baseline.** Full run: 154 suites pass /
  17 fail — the identical 17 fail on a clean `main` worktree (verified by
  diffing `FAIL` lists AND per-test offender details for
  column-completeness, source-hygiene, env-template-completeness and
  table-usage-conformance: byte-identical). This branch adds 0 offenders and
  25 new passing tests. All 10 `tests/training/*` suites: 81/81 tests pass
  (the 1 pre-existing suite-level failure, `training-home-program-distinct`,
  fails to run on main too).

## 5. Verified vs not verified

**Verified (executed here):**
- All 25 new tests pass; full-suite diff vs clean main = zero new failures.
- `node --check` on all three edited/added JS files.
- Portal SPA `vite build` succeeds; `tsc --noEmit` shows errors only in two
  pre-existing unrelated files (`PortalVideos*.tsx`), none in new/edited files.
- Bot semantics claims: each read from the current source of
  `quiz-delivery.service.js` / `teacher-training-endpoint.js`, not from docs.
- Absence of an abandon sweep (grep over `bot/` — enum + index are schema-only).

**NOT verified (needs staging):**
- End-to-end against a real DB: no live grand-quiz submit was run here (no
  DB writes from this session). Staging smoke: log in as a teacher with all
  courses started, sit the exam, confirm `training_assessment_attempts`
  (`quiz_kind='grand'`), `training_assessment_answers`, and
  `training_certificates` rows, then confirm the WhatsApp certificates
  command lists the portal-issued cert and the WhatsApp Flow shows the level
  as passed.
- Cross-surface race (in-progress WhatsApp attempt + portal submit): policy
  matches Phase 1 (portal writes a new completed row; the stale in-progress
  row is left for resume/sweep) but was not exercised live.
- Certificate **verification URL / PDF in R2**: no renderer or verification
  endpoint exists anywhere in this repo yet (`pdf_r2_key` is schema-only);
  out of scope here, flagged as follow-up.
- SPA bundle not rebuilt (deliberate — see section 3).

## 6. Follow-ups recommended

1. Backport the `quiz_kind='grand'` filter to the Flow's
   `loadGrandQuizState()` and the portal's `_computeLevelStates()` (latent
   perfect-module-quiz => level-certified bug on both existing surfaces).
2. Certificate PDF renderer + public verification endpoint (fills
   `pdf_r2_key`; both surfaces already share issuance).
3. Rebuild `dashboard/portal-frontend/dist` once after the sibling PRs merge.
