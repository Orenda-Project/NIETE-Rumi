# coaching — Root jest suite for the AI coaching pipeline: analysis, reports, reflection, LP linking
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/coaching kg=b2de4d4e1942 gen=3828470ab0cb overflow=197 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `bd-s192t-roles-threading.test.js` — model of a test that runs the real chain, not a helper plus a grep
- `framework-registry.test.js` — how FICO/HOTS/OECD/Teach frameworks are selected, the base of most scoring tests
- Covers bot/shared/services/coaching/*. Run from repo root: `node tests/run.js tests/coaching --maxWorkers=2` (tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fidelity/` | Tests for lesson-plan fidelity: grader, scorer, orchestrator, LP linking and selection → `fidelity/CLAUDE.md` |
| `live-moves/` | Tests for live moves: the live list of v10 card moves ticked during a lesson → `live-moves/CLAUDE.md` |
| `report-transformers/` | Tests for per-framework report transformers that shape analysis into reportData → `report-transformers/CLAUDE.md` |
| `video-reco/` | Tests for video recommendation: clip pick, copy, name redaction, strip, send and A/B → `video-reco/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| … | 197 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `DEFAULT_COACH_ROLE_LABEL` · `ELEVENLABS_API_KEY` · `INTERNAL_API_KEY` · `LP_EXTRACTION_VISION_MODEL` · `LP_FIDELITY_ENABLED` · `OBSERVE_FICO_FLOW_HAS_FIDELITY` · `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `REGION_COACH_ROLE_LABEL_MAP` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL` · `UPTAKE_ACCEPTANCE` (+1)

## Never (human)
- Do not test a changed line only via a pure helper plus a source grep; run the real path (`bd-s192t-roles-threading.test.js:2-4`, the 44fe3ae ReferenceError)
- Classroom audio must never write a teacher's stored language (`audio-never-writes-language.test.js:2`; `reflective-language-no-global-write.test.js:27`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? (+39)
