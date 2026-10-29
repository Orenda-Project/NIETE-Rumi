# coaching — Root jest suite for the AI coaching pipeline: analysis, reports, reflection, LP linking
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/coaching kg=bc2f829f5bb4 gen=5ce6deedd375 overflow=193 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `bd-s192t-roles-threading.test.js` — model of a test that runs the real chain, not a helper plus a grep
- `framework-registry.test.js` — how FICO/HOTS/OECD/Teach frameworks are selected, the base of most scoring tests
- Covers bot/shared/services/coaching/*. Run from repo root: `node tests/run.js tests/coaching --maxWorkers=2` (tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fidelity/` | → (no door; 27 tests) |
| `live-moves/` | → (no door; 9 files: 8 test + 1 support) |
| `report-transformers/` | → (no door; 3 tests) |
| `video-reco/` | Tests for video recommendation: clip pick, copy, name redaction, strip, send and A/B → `video-reco/CLAUDE.md` |
| `coaching*` | 7 files; most used `coaching-flow-integration.test.js`: bd-622/bd-618 wiring: LP selection list vs buttons in the coaching flow and the coaching card in the report flow |
| `bd-9h2mm-section-b-not-assessed.test.js` | bd-9h2mm: Section B leaves the FICO total when no fidelity was measured and every surface says so |
| `bd-v0toag.38.9-agree-ping-service.test.js` | bd-v0toag.38.9: Do you agree coach ping via template coach_visit_request_v2 (six params), reasons and card link |
| … | 256 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Do not test a changed line only via a pure helper plus a source grep; run the real path (`bd-s192t-roles-threading.test.js:2-4`, the 44fe3ae ReferenceError)
- Classroom audio must never write a teacher's stored language (`audio-never-writes-language.test.js:2`; `reflective-language-no-global-write.test.js:27`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.md`? · `bot/shared/services/coaching/coaching-card/CLAUDE.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.md`? · `bot/shared/services/coaching/report-renderers/CLAUDE.md`? (+6)
