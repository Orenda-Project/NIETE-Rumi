# lp612 — Grade 6-12 LP lane: author ladder, render, catalogue, Urdu overlay, religious gate
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/lp612 kg=67e0355dfd06 gen=590a35a6ff46 overflow=147 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `serving.test.js` — tap to PDF: cache hit vs author now; the lane's front door
- `author-worker.test.js` — the worker that authors, renders, stores and delivers, with failure paths
- ~200 suites over lp612-* services and vendored lp-v9. Root jest (tests/jest.config.js): from repo root `node tests/run.js tests/lp612 --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__fixtures__/` | → (no door; 7 files: 0 test + 7 support) |
| `helpers/` | Shared harnesses and doubles for the lp612 E2E and unit suites → `helpers/CLAUDE.md` |
| `fbise-slo-chips.test.js` | bd-f01ob: pins each FBISE SLO showing its own Summative/Formative chip in the outcome box (template, validate, overlay) |
| `visual*` | 3 files; most used `visual-contract.test.js`: Pins the brief 4b visual contract wired into the gate of record (lint_lp, visual_check, types_manifest) |
| `cost-names-the-lesson.test.js` | bd-b0qwk.6: pins model-call cost events for writing a 6-12 lesson naming its render and segment |
| `vendor-integrity.test.js` | Pins integrity of the vendored bot/vendor/lp-v9 pipeline (brief, schemas, lint, renderer) against its upstream manifest |
| `overlay-backfill-over-cap.e2e.test.js` | bd-0t9ce: e2e: an over-cap lesson is repaired in place by the overlay backfill and served in Urdu |
| `overlay-backfill-over-cap.test.js` | bd-0t9ce: pins overlay repairRow not being stricter than delivery: over-cap renders are written back |
| … | 204 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Nothing this lane writes may leave the lp612/ R2 prefix: bucket is shared with PK prod (r2-prefix-guard.test.js:2)
- LP_612_RELIGIOUS_ENABLED stays a separate flag from LP_612_ENABLED (flags.test.js:5)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/data/CLAUDE.md`? · `bot/vendor/lp-v9/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `bot/vendor/lp-v9/diagrams/CLAUDE.md`? · `bot/vendor/lp-v9/diagrams/lib/CLAUDE.md`? · `bot/vendor/lp-v9/lib/CLAUDE.md`? (+3)
