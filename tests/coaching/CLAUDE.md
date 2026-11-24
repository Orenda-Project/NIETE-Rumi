# coaching — Root jest suite for the AI coaching pipeline: analysis, reports, reflection, LP linking
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/coaching kg=06a80e127099 gen=d61c95d95ca7 overflow=246 rendered=2026-11-24 kg.py=1.1.0 -->

## Entry points
- `bd-s192t-roles-threading.test.js` — model of a test that runs the real chain, not a helper plus a grep
- `framework-registry.test.js` — how FICO/HOTS/OECD/Teach frameworks are selected, the base of most scoring tests
- Covers bot/shared/services/coaching/*. Run from repo root: `node tests/run.js tests/coaching --maxWorkers=2` (tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fidelity/` | → (no door; 28 tests) |
| `live-moves/` | → (no door; 9 files: 8 test + 1 support) |
| `report-transformers/` | → (no door; 5 tests) |
| `video-reco/` | Tests for video recommendation: clip pick, copy, name redaction, strip, send and A/B → `video-reco/CLAUDE.md` |
| `fico*` | 9 files; most used `fico-s-v1-2.test.js`: (unmapped) |
| `coaching*` | 7 files; most used `coaching-flow-integration.test.js`: bd-622/bd-618 wiring: LP selection list vs buttons in the coaching flow and the coaching card in the report flow |
| `bd-9h2mm-section-b-not-assessed.test.js` | bd-9h2mm: Section B leaves the FICO total when no fidelity was measured and every surface says so |
| `bd-r2uzg1.12-mismatch-soft-line.test.js` | (unmapped) |
| `bd-hk2jm3-fde-ict-only.test.js` | (unmapped) |
| `fico17-v6-hitl-report-evidence.test.js` | (unmapped) |
| … | 320 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Do not test a changed line only via a pure helper plus a source grep; run the real path (`bd-s192t-roles-threading.test.js:2-4`, the 44fe3ae ReferenceError)
- Classroom audio must never write a teacher's stored language (`audio-never-writes-language.test.js:2`; `reflective-language-no-global-write.test.js:27`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.md`? · `bot/shared/services/coaching/coaching-card/CLAUDE.md`? · `bot/shared/services/coaching/frameworks/CLAUDE.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.md`? (+9)
