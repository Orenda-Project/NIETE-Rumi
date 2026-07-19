# Portal Quiz-Taking UI — Implementation Report (BUG-131 Phase 2)

Branch: `portal-quiz-ui`

## What was built

Teachers can now take module quizzes directly on the portal Training page, with
server-side grading writing the same tables as the WhatsApp quiz, so both
surfaces stay in parity.

### Files changed

| File | Change |
|---|---|
| `dashboard/routes/portal.routes.js` | **New endpoint** `GET /api/portal/training/module/:id/questions` — serves the module's active questions (id, question_text, options normalised to strings, order_index; **`correct_option` deliberately never selected**). Same auth, level-lockdown gate, `is_active` filter, and `order_index` ascending ordering as the WhatsApp-side fetch and the existing POST grader. Inserted between the existing GET attempts and POST quiz-attempts routes; purely additive. |
| `portal/src/portal/components/ModuleQuizPanel.tsx` | **New component** — the whole quiz lifecycle: Take Quiz / Retake Quiz button (hidden entirely when the module has no active questions), one-screen MCQ form with radio groups + answered-count progress bar, submit (disabled until every question is answered — the backend rejects partial answer sets), score result card using the same green ≥80 / amber ≥50 / red colour ladder as the existing QuizScoreBadge, and a retake path. |
| `portal/src/portal/pages/PortalTraining.tsx` | **Minimal additive edits** (parallel work happens on this file): one import, one `handleQuizSubmitted` callback (refetches the module's attempts so the score badge updates, and marks the module complete locally — the backend upserts progress on submit), and one `<ModuleQuizPanel/>` mount at the bottom of the module detail card. No existing lines modified. |
| `tests/training/portal-quiz-questions.test.js` | **New test suite** (7 tests) for the questions endpoint, using the same mock-supabase router harness as `portal-quiz-submit.test.js`. |

## Endpoint contract used (existing, PR #7)

`POST /api/portal/training/module/:id/quiz-attempts`

- Body: `{ answers: [{ question_id, chosen_option }, ...] }` — one entry per
  active question, order-agnostic, `chosen_option` is the 1-indexed option
  position as a string (`'1'`, `'2'`, …) matching the WhatsApp convention that
  `training_questions.correct_option` is stored against.
- Response: `{ success: true, attempt: { id, score, max_score, is_passed, completed_at } }`
- Server-side grading; writes `training_assessment_attempts`
  (quiz_kind='training_module') + `training_assessment_answers`, upserts
  `teacher_training_progress` (module counts complete). Non-blocking: `status`
  is always 'passed'; `is_passed` = perfect score.
- Errors surfaced in the UI via toast: 400 (count mismatch / no questions),
  403 (level locked), 401 (session).

New read-side contract added in this PR:

`GET /api/portal/training/module/:id/questions`
→ `{ success: true, questions: [{ id, question_text, options: [string], order_index }] }`
(`[]` when the module has no active questions — the frontend hides the button).

## Retake semantics

The WhatsApp side allows re-running module quizzes (non-blocking self-checks,
no cooldown) and the existing badge displays best-of-attempts. Mirrored here:
the button reads "Take Quiz" on first visit, "Retake Quiz" once attempts
exist, and the result card offers an immediate retake. The badge continues to
show the best attempt.

## Test results

- New suite `tests/training/portal-quiz-questions.test.js`: **7/7 pass**
  (auth 401, bad-id 400, missing-module 404, ordering + option normalisation,
  a security assertion that `correct_option` never appears in the response,
  empty-questions shape, and query-filter assertions).
- Existing `portal-quiz-submit.test.js` (6 tests) and
  `portal-training-attempts.test.js`: still green.
- Full root suite: **no new failures.** 17 suites / 28 tests fail identically
  on a clean `main` checkout (verified by diffing the failing-suite sets with
  the work stashed vs applied — byte-identical). Those pre-existing failures
  are hygiene/conformance guards tripped by recently merged work (e.g. ticket
  refs in `bot/scripts/seed-*.js`), unrelated to this change.
- Frontend: `tsc --noEmit` reports no errors in the changed/new files (the
  only 2 errors are pre-existing in PortalVideos/PortalVideoDetail);
  `vite build` succeeds; eslint clean on the new component (2 pre-existing
  errors on untouched PortalTraining lines).

## Verified locally (end-to-end, staging-safe)

Driving the real backend locally would write attempt rows to the production
database, so the flow was verified with the real frontend against a local
stub API implementing these exact contracts (no DB touched):

- Vite dev portal + Playwright (Chromium), full flow: Level → Course → Module
  cascade → module detail → Take Quiz → answer → submit → result → badge
  refresh → retake. **16/16 checks passed**, including: button label
  first-visit vs retake, all questions on one screen, submit disabled until
  fully answered, progress text 0/3 → 2/3 → 3/3, 2/3 result rendered amber
  with 67%, header badge refresh to "Quiz: 2 / 3", module flips to
  Completed, perfect retake rendered green with "Perfect score" copy, badge
  best-of showing 3 / 3.

## Not verified locally

- The POST endpoint against a real database (covered by the existing
  `portal-quiz-submit.test.js` suite and already live from PR #7).
- Level-lockdown 403 path in the browser (covered by unit tests; the UI
  surfaces the server's error message via toast).
- The vendor-card "Quiz avg" rollup does not live-refresh after a submit (it
  comes from `/training/vendors`, fetched on page load); it updates on next
  visit. The per-module badge and completion state do refresh immediately.

## Deployment-specific strings

None added — no vendor/deployment names, no region names, no hardcoded IDs.
All new UI copy is deployment-neutral; colours come from the existing theme
tokens (`text-primary`, `bg-muted`, etc.).

## PR

(URL added after `gh pr create` — see PR description.)
