# llm — LLM routing: per-job model override, model registry, direct Anthropic lane, cost events
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/llm kg=e5e7aa0160ab gen=db7153441d0c overflow=16 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `job-model-override.test.js` — the per-job override with its kill switch (bd-gr4fy.1); start here
- `single-source-guard.test.js` — every in-scope model lives only in model-registry (bd-gr4fy.8)
- Covers llm-client, model-settings, anthropic facade, cost. Root jest (tests/jest.config.js): from repo root `node tests/run.js tests/llm --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `cost-user-attribution.test.js` | bd-b0qwk: pins api.cost.incurred events carrying the user id (webhook, queued worker job context) |
| `observe2-moments-job.test.js` | bd-08qvls.1: pins /observe2 moments and label check as their own job observe2.moments, movable by app_settings |
| `job*` | 3 files; most used `job-override-hardening.test.js`: bd-gr4fy.6: pins fixes from the override audits: fallback to current model for vision/assessment, always a model behind |
| `CLAUDE.md` | (unmapped) |
| `observe-debrief-split.test.js` | bd-gr4fy.15: pins observe-debrief guide/card calls labelled coaching.observeDebrief, separate from completeJson |
| `single-source-e2e.test.js` | bd-gr4fy.8: end to end through real call sites: registry model by default, settings row moves each job, kill switch |
| … | 16 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `ASSESSMENT_GEN_MODEL` · `LLM_MODEL` · `LP612_EDIT_INTENT_MODEL` · `LP_AUTHOR_MODEL` · `LP_EXTRACTION_VISION_MODEL` · `LP_FIDELITY_MODEL` · `ROSTER_VISION_MODEL` · `TRANSCRIPT_QUIZ_MODEL` · `TRANSCRIPT_QUIZ_VERIFY_MODEL` · `VISION_MODEL`

## Never (human)
- No in-scope call site may write its own model; it asks model-registry for its job (single-source-guard.test.js:1-12)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.index.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.md`? · `bot/shared/services/observe/observe2/CLAUDE.index.md`? · `bot/shared/services/queue/CLAUDE.index.md`? · `bot/shared/services/queue/CLAUDE.md`? (+10)
