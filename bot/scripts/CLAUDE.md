# scripts — Operator scripts: LP corpus builds, backfills, template and Flow registration
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts kg=cdefe6d77293 gen=0ebed21896f8 overflow=99 rendered=2026-11-11 kg.py=1.1.0 -->

## Entry points
- `check-syntax.js` — parse every tracked JS file before deploy
- `validate-env.js` — required vs optional env check
- `build-lp-catalog.js` — builds bot/data/lp_catalog.json offline
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 18 sub-dirs, each with `CLAUDE.md` | `assessment/` · `assets/` · `audit/` · `child-test/` · `deployment/` · `docs/` · `e2e/` · `load/` · `migration/` · `onboarding/` · `ops/` · `quiz/` · `render/` · `setup/` · `sheet-lps/` · `templates/` · `testing/` · `video-reco/` |
| `import-lp612-segments.js` | Loads the Grades 6-12 segmentation corpus JSONs into the serving menu; supports corpus version and dry-run |
| … | 73 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `niete_lp_assets` (written by `sync-sheet-lps.js` (+1)) ← read by `bot/shared/calls/call-tools.repo.js:179:c7464c20`? · `bot/shared/services/coaching/live-moves/card-store.js:51:c7464c20`? (+15)
- column `niete_lp_assets.asset_kind` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/shared/calls/call-tools.repo.js:182:bcc39851` · `bot/shared/services/coaching/live-moves/card-store.js:54:6d6b56b2` (+13)
- … 47 more → `CLAUDE.index.md`

## Never (human)
- Parse-check all JS before a push; an unbootable entry file once shipped green (check-syntax.js:4, bd-wpx18)
- Grades 6-12 uploads share a bucket with PK production; keys stay under lp612/ (upload-lp612-figures.js:9)
- Never add a per-region or per-generation lesson-plan table or env flag; extend the existing one, book as separator (docs/lesson-plan-data-model-debt.md)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/lp-v8/elective-catalog-merge.test.js` (build-lp-catalog.js, lp-catalog-merge.js)
- `bot/tests/lp-v8/uploader-r2-only.test.js` (upload-lp-v8-to-r2.js, verify-lp-v8-r2.js)
- … 42 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/CLAUDE.md`? · `docs/LP_PATHS.md`? · `docs/e2e-mock-lane.md`? · `docs/lesson-plan-data-model-debt.md`? · `docs/lp612/video-enhancement-test.md`?
