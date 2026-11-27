# frameworks — Observation frameworks (FICO, OECD, HOTS, MEWAKA, Teach): prompts and scoring
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/frameworks kg=f68311e9e4b5 gen=70e66a2d3266 overflow=97 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `framework-registry.js` — key to module lookup
- `framework-selector.js` — preference, region, env default order
- `fico-framework.js` — the ICT canonical FICO rubric, v4 (26 indicators, scale 0-2)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fico-s/` | (no description yet) → `fico-s/CLAUDE.md` |
| `fico17-v6/` | (no description yet) → `fico17-v6/CLAUDE.md` |
| `obs612/` | (no description yet) → `obs612/CLAUDE.md` |
| `fico-framework.js` | FICO v4 rubric: prompt, indicator definitions and per-session computeScores with subject-gated denominator |
| `fico17-v6-framework.js` | (unmapped) |
| `mewaka-framework.js` | MEWAKA Tanzanian CPD framework: 25 indicators in 6 domains, scale 0-3, prompt and scoring |
| `own-rubric.js` | (unmapped) |
| `framework-registry.js` | Lazy-loading registry mapping a framework key to its observation framework module |
| `fico-s-framework.js` | (unmapped) |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `fico-framework.js` ← imported by `bot/shared/services/coaching/coaching-breakdown.service.js:173:3f55b568` · `bot/shared/services/coaching/coaching-card/prioritized-action.service.js:55:e626b151` (+11)
- `own-rubric.js` ← imported by `bot/shared/services/coaching/coaching-trend.service.js:47:ae7e414a` · `bot/shared/services/coaching/report-v2/hero-report.service.js:26:5e4ef125` (+4)
- `fico17-v6-framework.js` ← imported by `bot/shared/services/observe/observe-fico17-v6.js:103:3284512b` · `bot/shared/services/observe/observe-framework.js:242:e5bf8808` (+3)
- … 9 more → `CLAUDE.index.md`

## Never (human)
- Score adapters read the scale from the framework, never a local copy (report-v2/score-adapters/fico-adapter.js:11)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/fico-s-v1-2.test.js` (fico-s-framework.js, framework-registry.js, own-rubric.js)
- `bot/tests/observe/observe-endpoint-hots.test.js` (hots-framework.js, mewaka-framework.js)
- … 82 more → `CLAUDE.index.md`

## Related (generated)
- skills: `coaching`?
- docs: `bot/shared/services/coaching/CLAUDE.md`? · `docs/customization.md`?
