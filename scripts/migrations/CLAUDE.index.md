# migrations — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=scripts/migrations -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `2026-07-21-capstone-import.sql` | Adds capstone answer columns and four Beacon House capstone quizzes with open-ended questions (bd-2233) |
| `2026-07-21-level-scoping.sql` | Creates niete_primary and niete_middle_high training programs with vendor/level scopes for grade-band visibility |
| `2026-08-02-capstone-answer-columns.sql` | Relaxes NOT NULL on chosen_option and is_correct so written capstone answers persist in training_assessment_answers |
| `2026-08-02-capstone-attempt-kind.sql` | Widens the attempts CHECK constraint to allow quiz_kind='capstone', which was rejected for every insert before |
| `2026-08-02-quiz-serving-config.sql` | Adds per-vendor quiz-serving policy columns on training_vendors (question counts, shuffling) to cap WhatsApp quiz length |
| `2026-09-01-capstone-level-swap-repair.sql` | Swaps transposed Science/Computer Science capstone levels and repairs attempts and certificates (bd-60011) |
| `2026-09-10-module-order-index-backfill.sql` | Gives the two AI literacy courses a real module order_index; deliberately leaves four other courses alone (bd-u2td8) |
| `2026-09-14-observation-schedules-teacher-fk.sql` | Adds observation_schedules teacher foreign key column and backfill, first half of replacing phone-as-identity |
| `2026-09-17-capstone-points-per-vendor.sql` | Adds nullable training_vendors.capstone_points_per_question; NULL keeps the 5-mark default (bd-60113) |
| `2026-09-17-isaps-crq-seed.py` | Seeds I-SAPS Level 1 constructed-response questions as capstone items with 10-mark rubrics (bd-60113) |
| `2026-09-17-isaps-level1-seed.py` | Seeds the I-SAPS vendor, Level 1, nine module courses, unit videos and formative/summative questions (bd-60113) |
| `2026-09-17-isaps-rekey-per-module.py` | Moves I-SAPS summative MCQs and CRQs from level-wide to per-module quizzes; sandbox only (bd-60119) |
| `2026-09-17-per-module-summative.sql` | Widens training_grand_quizzes uniqueness with source_quiz_id so a level holds one summative quiz per module (bd-60119) |
| `2026-09-17-question-option-images.sql` | Adds nullable training_questions column holding picture-option image URLs in option order (bd-60118) |
| `2026-09-17-split-m1-item-1-6-options.py` | Splits the M1 item 1.6 option grid image into four numbered panels for WhatsApp delivery (bd-60118) |
| `2026-09-18-isaps-fold-crqs-into-module-bank.py` | Folds each I-SAPS module's CRQs into its MCQ quiz after the MCQs and retires empty capstones; sandbox only (bd-60128) |
| `2026-10-01-attempt-status-pending-review.sql` | Adds 'pending_review' to training_attempt_status for graded-but-held I-SAPS exams; no transaction block (bd-hxm7a) |
| `2026-10-01-isaps-copy-prod-to-staging.py` | Copies I-SAPS Level 1 content from production into staging by content with id remapping (bd-vej4h) |
| `2026-10-13-rename-training-vendors.sql` | Renames partner training vendors' display names (keys unchanged); idempotent, mirrored in portal trainingApi (bd-2gia5l) |
| `2026-10-23-isaps-level2-seed.py` | Seeds I-SAPS Level 2 in one pass: level, nine courses, unit modules, formative questions, per-module quizzes (bd-yef5iq) |

## Who reads this (all, generated)
- column `training_assessment_answers.answer_score` (written by `2026-07-21-capstone-import.sql`) ← read by `bot/shared/services/training/capstone-delivery.service.js:640:7c1a4b38` · `bot/shared/services/training/isaps-held-release.service.js:131:20ebd565` · `bot/shared/services/training/isaps-level-grade.service.js:99:ac4ec5f5` · `bot/shared/services/training/quiz-delivery.service.js:2041:331dd634` (+1: `python3 kg/kg.py who-reads training_assessment_answers.answer_score`)
- column `training_assessment_answers.answer_text` (written by `2026-07-21-capstone-import.sql`) ← read by `bot/shared/services/training/isaps-held-release.service.js:131:20ebd565` · `bot/shared/services/training/quiz-delivery.service.js:2620:8e6bf883` · `dashboard/routes/portal.routes.js:4521:b39d33b0`
- column `training_assessment_answers.feedback_text` (written by `2026-07-21-capstone-import.sql`) ← read by `bot/shared/services/training/isaps-held-release.service.js:131:20ebd565` · `bot/shared/services/training/quiz-delivery.service.js:2912:8d4da586` · `dashboard/routes/portal.routes.js:4521:b39d33b0`
- column `training_questions.option_images` (written by `2026-09-17-question-option-images.sql`) ← read by `bot/shared/services/training/quiz-delivery.service.js:910:a569785f`
- column `training_vendors.capstone_points_per_question` (written by `2026-09-17-capstone-points-per-vendor.sql`) ← read by `bot/shared/services/training/capstone-delivery.service.js:341:34408b73` · `bot/shared/services/training/isaps-held-release.service.js:150:ba297998` · `bot/shared/services/training/quiz-delivery.service.js:1822:34408b73` · `dashboard/routes/portal.routes.js:4176:33c4d7c2`
- column `training_vendors.exam_question_cap` (written by `2026-08-02-quiz-serving-config.sql`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1739:4b2716b5` · `bot/shared/services/training/quiz-delivery.service.js:245:19180690` · `dashboard/routes/portal.routes.js:5872:19180690`
- column `training_vendors.module_quiz_strategy` (written by `2026-08-02-quiz-serving-config.sql`) ← read by `bot/shared/services/training/quiz-delivery.service.js:245:19180690` · `dashboard/routes/portal.routes.js:5872:19180690`
- column `training_vendors.shuffle_options` (written by `2026-08-02-quiz-serving-config.sql`) ← read by `bot/shared/services/training/quiz-delivery.service.js:245:19180690` · `dashboard/routes/portal.routes.js:5872:19180690`
- table `teacher_training_assignments` (written by `2026-07-21-level-scoping.sql`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1151:1d73b094`? · `bot/shared/services/training/band-selection.service.js:238:1d73b094`? · `bot/shared/services/training/capstone-delivery.service.js:269:1d73b094`? · `bot/shared/services/training/quiz-delivery.service.js:463:1d73b094`? (+2: `python3 kg/kg.py who-reads teacher_training_assignments`)
- table `training_grand_quizzes` (written by `2026-07-21-capstone-import.sql`, `2026-09-01-capstone-level-swap-repair.sql`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1223:4dbdc689`? · `bot/shared/services/training/capstone-delivery.service.js:76:9543a8dd`? · `bot/shared/services/training/certificate.service.js:238:9543a8dd`? · `bot/shared/services/training/content-delivery.service.js:434:750fdfc2`? (+6: `python3 kg/kg.py who-reads training_grand_quizzes`)
- table `training_program_scopes` (written by `2026-07-21-level-scoping.sql`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1161:b51002c7`? · `dashboard/routes/portal.routes.js:3416:b51002c7`? · `scripts/verify-partition-bd2102.js:31:232830b6`?
- table `training_programs` (written by `2026-07-21-level-scoping.sql`) ← read by `bot/shared/services/training/band-selection.service.js:228:eff9a6de`? · `scripts/backfill-training-assignments.js:123:eff9a6de`? · `scripts/migrate-training-attempts.py:100:07857c9e`?
- table `training_questions` (written by `2026-07-21-capstone-import.sql`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1531:a56028e9`? · `bot/shared/services/training/capstone-delivery.service.js:88:fc84136d`? · `bot/shared/services/training/content-delivery.service.js:440:a56028e9`? · `bot/shared/services/training/isaps-held-release.service.js:186:979793a2`? (+6: `python3 kg/kg.py who-reads training_questions`)
- table `training_vendors` (written by `2026-08-02-quiz-serving-config.sql`, `2026-09-17-capstone-points-per-vendor.sql`, `2026-10-13-rename-training-vendors.sql`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1177:1ff52097`? · `bot/shared/services/training/capstone-delivery.service.js:153:f399b197`? · `bot/shared/services/training/certificate-pdf.service.js:623:d5d65e5a`? · `bot/shared/services/training/certificate.service.js:233:20479baf`? (+7: `python3 kg/kg.py who-reads training_vendors`)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `.claude/qa/fixtures/whatsapp/niete/training-seed-plan.md`? · `scripts/CLAUDE.md`?
