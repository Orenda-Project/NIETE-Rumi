# frameworks — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/frameworks -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fico-framework.js` | FICO v4 rubric: prompt, indicator definitions and per-session computeScores with subject-gated denominator |
| `framework-registry.js` | Lazy-loading registry mapping a framework key to its observation framework module |
| `framework-selector.js` | Chooses a user's framework: explicit preference, then region default, then env deployment default |
| `hots-framework.js` | HOTS (PESRP/PECTAA) framework: 16 indicators, scale 1-3, prompt and scoring |
| `mewaka-framework.js` | MEWAKA Tanzanian CPD framework: 25 indicators in 6 domains, scale 0-3, prompt and scoring |
| `oecd-framework.js` | OECD high-quality teaching framework: 5 goals, classroom plus debrief criteria, prompt and scoring |
| `teach-framework.js` | World Bank Teach Primary framework: 9 elements scored 1-5 plus time on task, prompt and scoring |

## Who reads this (all, generated)
- `fico-framework.js` ← imported by `bot/shared/services/coaching/coaching-breakdown.service.js:166:3f55b568` · `bot/shared/services/coaching/coaching-card/prioritized-action.service.js:53:e626b151` · `bot/shared/services/coaching/fidelity/fidelity-recompute.service.js:78:8e4d729b` · `bot/shared/services/coaching/fidelity/section-b-backfill.service.js:122:8e4d729b` (+9: `python3 kg/kg.py who-reads fico-framework.js`)
- `framework-registry.js` ← imported by `bot/shared/services/coaching/frameworks/framework-selector.js:28:49aa8acd`
- `framework-selector.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:21:3466a896`
- `hots-framework.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/hots-adapter.js:9:a6cc910e` · `bot/shared/services/observe/observe-framework.js:28:908f5abe` · `bot/shared/services/coaching/frameworks/framework-registry.js:16:b63c8eac`
- `mewaka-framework.js` ← imported by `bot/scripts/generate-observe-flow-json.js:27:df211ba3` · `bot/shared/services/coaching/report-v2/score-adapters/mewaka-adapter.js:14:159130a0` · `bot/shared/services/observe/observe-framework.js:27:56a95d34` · `bot/shared/services/coaching/frameworks/framework-registry.js:19:7318445b`
- `oecd-framework.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/oecd-adapter.js:10:6fddfa12` · `bot/shared/services/coaching/frameworks/framework-registry.js:15:a3ede969`
- `teach-framework.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/teach-adapter.js:10:8084d2e6` · `bot/shared/services/coaching/frameworks/framework-registry.js:17:283df1bd`

## Tests (all, generated)
- `fico-framework.js` ← `bot/tests/observe/bd-2383-b4-b10-evidence-gates.test.js` · `bot/tests/observe/fico-v3-framework.test.js` · `bot/tests/observe/observe-fico-flow.test.js` · `tests/coaching/bd-0c01q-fico-v4.test.js` · `tests/coaching/bd-0c01q-observe-scale.test.js` · `tests/coaching/bd-2457-niete-lever-constraint.test.js` (+24: `python3 kg/kg.py who-reads bot/shared/services/coaching/frameworks/fico-framework.js`)
- `framework-registry.js` ← `bot/tests/observe/observe-framework-pack.test.js` · `tests/coaching/fico-framework-ict.test.js` · `tests/coaching/framework-registry.test.js` · `tests/coaching/framework-wiring.test.js`
- `framework-selector.js` ← `bot/tests/observe/observe-pipeline-fork.test.js` · `tests/coaching/framework-registry.test.js` · `tests/coaching/framework-selection-reason.test.js` · `tests/coaching/framework-wiring.test.js`
- `hots-framework.js` ← `bot/tests/observe/observe-endpoint-hots.test.js` · `tests/coaching/hots-framework-alignment.test.js` · `tests/coaching/hots-framework.test.js`
- `mewaka-framework.js` ← `bot/tests/observe/observe-draft.service.test.js` · `bot/tests/observe/observe-endpoint-hots.test.js` · `bot/tests/observe/observe-endpoint.test.js` · `bot/tests/observe/observe-flow-json.test.js` · `bot/tests/observe/observe-framework-pack.test.js` · `bot/tests/observe/observe-subject-flags.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/coaching/frameworks/mewaka-framework.js`)
- `oecd-framework.js` ← `tests/coaching/analyze-pedagogy-framework-dispatch.test.js` · `tests/coaching/oecd-framework.test.js`
- `teach-framework.js` ← `tests/coaching/teach-framework.test.js`

## Related (all, generated)
- skills: `coaching`?
- docs: `bot/shared/services/coaching/CLAUDE.md`? · `docs/customization.md`?
