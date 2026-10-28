# migrations — Hand-applied data and schema migrations, dated; mostly training-content seeds
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=scripts/migrations kg=5f8ce2daa906 gen=62326d572325 overflow=30 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `2026-10-01-attempt-status-pending-review.sql` — an additive enum-value migration (ADD VALUE IF NOT EXISTS)
- `2026-10-23-isaps-level2-seed.py` — latest one-pass seed in production's final shape
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `2026-07-21-capstone-import.sql` | Adds capstone answer columns and four Beacon House capstone quizzes with open-ended questions (bd-2233) |
| `2026-07-21-level-scoping.sql` | Creates niete_primary and niete_middle_high training programs with vendor/level scopes for grade-band visibility |
| `2026-08-02-capstone-answer-columns.sql` | Relaxes NOT NULL on chosen_option and is_correct so written capstone answers persist in training_assessment_answers |
| `2026-08-02-capstone-attempt-kind.sql` | Widens the attempts CHECK constraint to allow quiz_kind='capstone', which was rejected for every insert before |
| … | 18 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `training_vendors` (written by `2026-08-02-quiz-serving-config.sql` (+2)) ← read by `bot/shared/routes/teacher-training-endpoint.js:1177:1ff52097`? · `bot/shared/services/training/capstone-delivery.service.js:153:f399b197`? (+9)
- table `training_grand_quizzes` (written by `2026-07-21-capstone-import.sql` (+1)) ← read by `bot/shared/routes/teacher-training-endpoint.js:1223:4dbdc689`? · `bot/shared/services/training/capstone-delivery.service.js:76:9543a8dd`? (+8)
- … 12 more → `CLAUDE.index.md`

## Never (human)
- Enum ADD VALUE files carry no BEGIN/COMMIT on purpose (2026-10-01-attempt-status-pending-review.sql:8)
- I-SAPS rekey/fold scripts are sandbox-only, dry run unless --yes-write (2026-09-17-isaps-rekey-per-module.py:17)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `.claude/qa/fixtures/whatsapp/niete/training-seed-plan.md`? · `scripts/CLAUDE.index.md`? · `scripts/CLAUDE.md`? · `scripts/migrations/CLAUDE.index.md`? · `scripts/migrations/CLAUDE.md`?
