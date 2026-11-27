# scripts — Operator scripts: LP corpus builds, backfills, template and Flow registration
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts kg=ce5d83184e6c gen=18e2c38e7ddd overflow=129 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `check-syntax.js` — parse every tracked JS file before deploy
- `validate-env.js` — required vs optional env check
- `build-lp-catalog.js` — builds bot/data/lp_catalog.json offline
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 19 sub-dirs, each with `CLAUDE.md` | `assessment/` · `assets/` · `audit/` · `child-test/` · `data-analyst/` · `deployment/` · `docs/` · `e2e/` · `load/` · `migration/` · `onboarding/` · `ops/` · `quiz/` · `render/` · `setup/` · `sheet-lps/` · `templates/` · `testing/` · `video-reco/` |
| `build*` | 4 files; most used `build-lp-catalog.js`: Offline build of bot/data/lp_catalog.json from the K-5 ingestion tree; the LP Flow endpoint reads the output at runtime |
| … | 85 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `quizzes` (written by `quiz-teacher-edit-revert.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:229:2c6afb51`? · `bot/shared/routes/teacher-report-internal.routes.js:255:3b7858e9`? (+74)
- table `quiz_questions` (written by `quiz-teacher-edit-revert.js`) ← read by `bot/shared/services/first-touch/maker.bank.js:89:ec1258c5`? · `bot/shared/services/quiz/lp-quiz-cache.js:163:2421430e`? (+22)
- … 67 more → `CLAUDE.index.md`

## Never (human)
- Parse-check all JS before a push; an unbootable entry file once shipped green (check-syntax.js:4, bd-wpx18)
- Grades 6-12 uploads share a bucket with PK production; keys stay under lp612/ (upload-lp612-figures.js:9)
- Never add a per-region or per-generation lesson-plan table or env flag; extend the existing one, book as separator (docs/lesson-plan-data-model-debt.md)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/lp-v8/catalog-splits.test.js` (build-lp-catalog.js, lp-catalog-splits.js)
- `bot/tests/lp-v8/elective-catalog-merge.test.js` (build-lp-catalog.js, lp-catalog-merge.js)
- … 57 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/CLAUDE.md`? · `docs/LP_PATHS.md`? · `docs/ab-tracker-store.md`? · `docs/e2e-mock-lane.md`? · `docs/fico17-v6.md`? · `docs/lesson-plan-data-model-debt.md`? (+1)
