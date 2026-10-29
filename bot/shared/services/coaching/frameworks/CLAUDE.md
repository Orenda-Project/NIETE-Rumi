# frameworks — Observation frameworks (FICO, OECD, HOTS, MEWAKA, Teach): prompts and scoring
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/frameworks kg=7f3c6a22d8a2 gen=940b5e33c75f overflow=49 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `framework-registry.js` — key to module lookup
- `framework-selector.js` — preference, region, env default order
- `fico-framework.js` — the ICT canonical FICO rubric, v4 (26 indicators, scale 0-2)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fico-framework.js` | FICO v4 rubric: prompt, indicator definitions and per-session computeScores with subject-gated denominator |
| `mewaka-framework.js` | MEWAKA Tanzanian CPD framework: 25 indicators in 6 domains, scale 0-3, prompt and scoring |
| `framework-selector.js` | Chooses a user's framework: explicit preference, then region default, then env deployment default |
| `hots-framework.js` | HOTS (PESRP/PECTAA) framework: 16 indicators, scale 1-3, prompt and scoring |
| `framework-registry.js` | Lazy-loading registry mapping a framework key to its observation framework module |
| … | 2 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `fico-framework.js` ← imported by `bot/shared/services/coaching/coaching-breakdown.service.js:166:3f55b568` · `bot/shared/services/coaching/coaching-card/prioritized-action.service.js:53:e626b151` (+11)
- `mewaka-framework.js` ← imported by `bot/scripts/generate-observe-flow-json.js:27:df211ba3` · `bot/shared/services/coaching/report-v2/score-adapters/mewaka-adapter.js:14:159130a0` (+2)
- `hots-framework.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/hots-adapter.js:9:a6cc910e` · `bot/shared/services/observe/observe-framework.js:28:908f5abe` (+1)
- … 4 more → `CLAUDE.index.md`

## Never (human)
- Score adapters read the scale from the framework, never a local copy (report-v2/score-adapters/fico-adapter.js:11)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/observe/observe-endpoint-hots.test.js` (hots-framework.js, mewaka-framework.js)
- `bot/tests/observe/observe-framework-pack.test.js` (framework-registry.js, mewaka-framework.js)
- … 43 more → `CLAUDE.index.md`

## Related (generated)
- skills: `coaching`?
- docs: `bot/shared/services/coaching/CLAUDE.md`? · `docs/customization.md`?
