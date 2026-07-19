# Beacon House Quiz Migration — Report (2026-07-19)

Script: `scripts/migrate-beacon-house-quizzes.py` (dry-run by default, `--apply` to write).
Companion to `scripts/migrate-beacon-house.py` (which migrated the BH curriculum tree on Jul 16 but skipped quiz content). Question mapping mirrors `scripts/migrate-teacher-training.py` step 6.

## Dry-run counts vs expected

| Metric | Expected | Dry run | Gate |
|---|---|---|---|
| BH active module MCQ questions (active chains, per Kamal Jul 16 decision) | ~326 (±10) | **326** | PASS |
| Malformed (failed the >=2-options / valid-1-indexed-answer gate) | — | **0** | — |
| Unmapped to a NIETE module | — | **0** | — |
| Source BH grand quizzes | 4 | **4 found** | PASS (but see semantic flag) |

## Applied

`--apply` run inserted **326 rows** into `training_questions` (batches of 200), all linked via `training_modules.source_module_id` -> `teacher_training_training.id`. **0 grand quizzes inserted** (see flag below). Idempotency confirmed: an immediate re-run reports `To insert: 0 (326 already present)`.

## Verification (live NIETE Supabase, post-apply)

Per-vendor active module-question counts:

| Vendor | module questions | modules with questions | total modules |
|---|---|---|---|
| BEACONHOUSE | **326** (was 0) | **206 / 206** | 206 |
| OXBRIDGE | 69 (unchanged) | 7 / 7 | 7 |
| TALEEMABAD | 1,695 (unchanged) | 171 / 171 | 171 |

Grand-quiz-linked questions: TALEEMABAD 411 (unchanged); BH/Oxbridge 0. Grand quizzes: TALEEMABAD 7, BEACONHOUSE 0, OXBRIDGE 0.

Spot-checks (3 random BH modules, render-ability): modules 342, 207, 185 — all questions have `training_module_id` wired, `options` arrays with >=2 entries, `correct_option` present and in range, and contiguous `order_index` 1..N (`[1,2]`, `[1,2]`, `[1,2,3]`). All OK. Zero BH questions with empty options or missing correct_option. Zero duplicate `(training_module_id, order_index)` pairs for BH.

## Semantic flag 1 — BH grand quizzes are NOT MCQ quizzes (NOT migrated)

The 4 source BH `teacher_training_grandquiz` rows (ids 8, 9, 10, 11 — one per subject level) are **"Capstone Project: AI-Enhanced Lesson Design"** assessments: document-submission projects ("Submit a document with all 8 sections clearly labeled"), not question banks. All **33 active questions** linked to them have `options=[]` and `answers=NULL` — open-ended writing prompts ("Define your Lesson Objective…", "Write your AI Prompt…", "Create an original Analytic Rubric…"). A further 221 linked questions are inactive.

This differs semantically from Taleemabad's grand quizzes (auto-graded MCQ banks, vendor `passing_pct=100`): every BH grand-quiz question fails the MCQ validity gate the migration and the runtime rely on; `training_grand_quizzes` has no columns for the capstone title/description/instructions; and the delivery flow (`quiz-delivery.service.js`) grades by `correct_option` — these have none. The BH vendor row is also `has_grand_quiz=FALSE` (set deliberately in the Jul 16 migration), so the runtime would not serve them anyway.

**Per the task instruction, this portion was STOPPED, not guessed.** Importing the 4 quiz rows + 33 optionless prompts would create unanswerable MCQ quizzes if `has_grand_quiz` ever flips. Needs a product/partner decision: either (a) BH keeps no grand quiz in NIETE (status quo — module quizzes only + `unlock_logic='all_modules'`), or (b) a document-submission capstone feature is built, at which point these 4 capstones + 33 prompts can be migrated into whatever shape that feature defines.

## Deliberate deviation (documented)

`order_index` is synthesised 1..N per module (sorted by source question id) instead of copying the source `index` (which is `1` on 325/326 rows). Rationale: `bot/shared/services/training/quiz-delivery.service.js` paginates questions with `.order('order_index').range(N,N)` and its comment (~line 324) documents order_index as "synthesised 1..N per grand quiz / per module during migration" — tied indices make that pagination non-deterministic. (Note: live TALEEMABAD module questions do currently have tied indices — 171 modules with all-1 order_index — a pre-existing latent issue outside this migration's scope, flagged here for awareness.)

## PR

https://github.com/Orenda-Project/NIETE-Rumi/pull/30 — branch `bh-quiz-migration`. **Not merged.**
