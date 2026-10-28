# insights — COACHIP nightly insight job: stage modules run by job.js, writing coachip_* tables
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/lib/insights kg=49af51c92891 gen=c15d1b165f03 overflow=73 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `job.js` — stage order facts to glosses; read first
- `constants.js` — PIPELINE_VERSION and the PROD_WRITES_ALLOWED guard
- `allowlist.js` — only reader of analysis_data
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `prompts/` | Model prompts for COACHIP glosses, re-check, homework and phonics detection → `prompts/CLAUDE.md` |
| `constants.js` | Named constants every COACHIP nightly stage reads, incl. PIPELINE_VERSION and the PROD_WRITES_ALLOWED guard. |
| `store.js` | COACHIP job writer: SupabaseStore and MemoryStore (dry run) share one interface; small-batch upserts after env check. |
| … | 27 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `constants.js` ← imported by `dashboard/lib/insights/circle.js:16:642d7dc6` · `dashboard/lib/insights/env.js:9:642d7dc6` (+14)
- `predicates.js` ← imported by `dashboard/lib/insights/facts.js:9:aea0feda` · `dashboard/lib/insights/legs.js:8:aea0feda` (+3)
- `windows.js` ← imported by `dashboard/jobs/coachip-nightly.js:63:5cf6ad13` · `dashboard/lib/insights/circle.js:17:fbc8ff9e` (+3)
- `safety.js` ← imported by `dashboard/jobs/coachip-nightly.js:26:76f2f10b` · `dashboard/lib/insights/clip-stage.js:12:1f937b2c` (+2)
- … 21 more → `CLAUDE.index.md`

## Never (human)
- Never enable prod writes except by the one-line PR; the flag is false (`constants.js:14`, enforced `env.js:51`)
- Never read analysis_data outside allowlist.js (`allowlist.js:3`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `dashboard/tests/insights/model-concurrency.service.test.js` (allowlist.js, model-stage.js, model.js, safety.js, store.js)
- `dashboard/tests/insights/rollups.service.test.js` (constants.js, rollups.js, signals.js, windows.js)
- … 25 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/lib/CLAUDE.index.md`? · `dashboard/lib/CLAUDE.md`? · `dashboard/lib/insights/CLAUDE.index.md`? · `dashboard/lib/insights/CLAUDE.md`? · `dashboard/lib/insights/prompts/CLAUDE.md`? · `dashboard/tests/insights/CLAUDE.index.md`? (+3)
