# scripts — Operator scripts: LP corpus builds, backfills, template and Flow registration
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts kg=b3ea00120d74 gen=930f2af1a553 overflow=82 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `check-syntax.js` — parse every tracked JS file before deploy
- `validate-env.js` — required vs optional env check
- `build-lp-catalog.js` — builds bot/data/lp_catalog.json offline
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 17 sub-dirs, each with `CLAUDE.md` | `assessment/` · `assets/` · `audit/` · `child-test/` · `deployment/` · `docs/` · `e2e/` · `load/` · `migration/` · `onboarding/` · `ops/` · `quiz/` · `render/` · `setup/` · `templates/` · `testing/` · `video-reco/` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `build-lp-catalog.js` | Offline build of bot/data/lp_catalog.json from the K-5 ingestion tree; the LP Flow endpoint reads the output at runtime |
| … | 36 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `niete_lp_assets` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/shared/calls/call-tools.repo.js:174:c7464c20`? · `bot/shared/services/coaching/live-moves/card-store.js:46:c7464c20`? (+13)
- column `niete_lp_assets.asset_kind` (written by `upload-lp-v8-to-r2.js`) ← read by `bot/shared/calls/call-tools.repo.js:177:bcc39851` · `bot/shared/services/coaching/live-moves/card-store.js:49:6d6b56b2` (+12)
- … 12 more → `CLAUDE.index.md`

## Never (human)
- Parse-check all JS before a push; an unbootable entry file once shipped green (check-syntax.js:4, bd-wpx18)
- Grades 6-12 uploads share a bucket with PK production; keys stay under lp612/ (upload-lp612-figures.js:9)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/lp-v8/elective-catalog-merge.test.js` (build-lp-catalog.js, lp-catalog-merge.js)
- `bot/tests/lp-v8/uploader-r2-only.test.js` (upload-lp-v8-to-r2.js, verify-lp-v8-r2.js)
- … 34 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/scripts/CLAUDE.index.md`? · `bot/scripts/CLAUDE.md`? · `bot/scripts/assessment/CLAUDE.index.md`? · `bot/scripts/assessment/CLAUDE.md`? (+47)
