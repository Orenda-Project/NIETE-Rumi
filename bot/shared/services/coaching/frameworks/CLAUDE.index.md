# frameworks — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/frameworks -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fico-s/` | (no description yet) → `fico-s/CLAUDE.md` |
| `fico17-v6/` | (no description yet) → `fico17-v6/CLAUDE.md` |
| `obs612/` | (no description yet) → `obs612/CLAUDE.md` |
| `fico-framework.js` | FICO v4 rubric: prompt, indicator definitions and per-session computeScores with subject-gated denominator |
| `fico-s-framework.js` | (unmapped) |
| `fico17-v6-framework.js` | (unmapped) |
| `framework-registry.js` | Lazy-loading registry mapping a framework key to its observation framework module |
| `framework-selector.js` | Chooses a user's framework: explicit preference, then region default, then env deployment default |
| `hots-framework.js` | HOTS (PESRP/PECTAA) framework: 16 indicators, scale 1-3, prompt and scoring |
| `indicator-lines.js` | (unmapped) |
| `indicator-lines.json` | (unmapped) |
| `mewaka-framework.js` | MEWAKA Tanzanian CPD framework: 25 indicators in 6 domains, scale 0-3, prompt and scoring |
| `oecd-framework.js` | OECD high-quality teaching framework: 5 goals, classroom plus debrief criteria, prompt and scoring |
| `own-rubric.js` | (unmapped) |
| `teach-framework.js` | World Bank Teach Primary framework: 9 elements scored 1-5 plus time on task, prompt and scoring |

## Who reads this (all, generated)
- `fico-framework.js` ← imported by `bot/shared/services/coaching/coaching-breakdown.service.js:173:3f55b568` · `bot/shared/services/coaching/coaching-card/prioritized-action.service.js:55:e626b151` · `bot/shared/services/coaching/fidelity/fidelity-recompute.service.js:78:8e4d729b` · `bot/shared/services/coaching/fidelity/section-b-backfill.service.js:122:8e4d729b` (+9: `python3 kg/kg.py who-reads fico-framework.js`)
- `fico-s-framework.js` ← imported by `bot/shared/services/observe/obs612/fico-s-dc.js:82:5cd96c1b` · `bot/shared/services/observe/obs612/fico-s-flow.js:547:ad42dca6` · `bot/shared/services/coaching/frameworks/framework-registry.js:23:d957e3ae`
- `fico17-v6-framework.js` ← imported by `bot/shared/services/observe/observe-fico17-v6.js:103:3284512b` · `bot/shared/services/observe/observe-framework.js:242:e5bf8808` · `bot/shared/services/coaching/frameworks/fico17-v6/informed.js:59:f823793f` · `bot/shared/services/coaching/frameworks/fico17-v6/shadow.js:59:51e7204d` (+1: `python3 kg/kg.py who-reads fico17-v6-framework.js`)
- `framework-registry.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:338:6e4834fb` · `bot/shared/services/coaching/frameworks/framework-selector.js:28:49aa8acd`
- `framework-selector.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:26:3466a896`
- `hots-framework.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/hots-adapter.js:9:a6cc910e` · `bot/shared/services/observe/observe-framework.js:28:908f5abe` · `bot/shared/services/coaching/frameworks/framework-registry.js:16:b63c8eac`
- `indicator-lines.js` ← imported by `bot/shared/services/observe/obs612/fico-s-flow.js:35:664d2a9e` · `bot/shared/services/observe/portal-observe.service.js:912:f5b52a8d`
- `indicator-lines.json` ← imported by `bot/shared/services/coaching/frameworks/indicator-lines.js:16:4dd5f680`
- `mewaka-framework.js` ← imported by `bot/scripts/generate-observe-flow-json.js:31:df211ba3` · `bot/shared/services/coaching/report-v2/score-adapters/mewaka-adapter.js:14:159130a0` · `bot/shared/services/observe/observe-framework.js:27:56a95d34` · `bot/shared/services/coaching/frameworks/framework-registry.js:26:7318445b`
- `oecd-framework.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/oecd-adapter.js:10:6fddfa12` · `bot/shared/services/coaching/frameworks/framework-registry.js:15:a3ede969`
- `own-rubric.js` ← imported by `bot/shared/services/coaching/coaching-trend.service.js:47:ae7e414a` · `bot/shared/services/coaching/report-v2/hero-report.service.js:26:5e4ef125` · `bot/shared/services/observe/assignment/leader-source.js:268:bbf6923d` · `bot/shared/services/observe/observe-debrief.service.js:570:8a073e9f` (+2: `python3 kg/kg.py who-reads own-rubric.js`)
- `teach-framework.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/teach-adapter.js:10:8084d2e6` · `bot/shared/services/coaching/frameworks/framework-registry.js:17:283df1bd`

## Tests (all, generated)
- `fico-framework.js` ← `bot/tests/observe/bd-2383-b4-b10-evidence-gates.test.js` · `bot/tests/observe/fico-v3-framework.test.js` · `bot/tests/observe/observe-fico-flow.test.js` · `tests/coaching/analysis-unreadable-reply-retried.test.js` · `tests/coaching/bd-0c01q-fico-v4.test.js` · `tests/coaching/bd-0c01q-observe-scale.test.js` (+41: `python3 kg/kg.py who-reads bot/shared/services/coaching/frameworks/fico-framework.js`)
- `fico-s-framework.js` ← `tests/coaching/fico-s-dc-prompt.test.js` · `tests/coaching/fico-s-v1-2.test.js` · `tests/coaching/q184-starred-e3-checklist.test.js` · `tests/observe/q251-evidence-once.test.js`
- `fico17-v6-framework.js` ← `tests/coaching/fico17-v6-1-version.test.js` · `tests/coaching/fico17-v6-d2-wording.test.js` · `tests/coaching/fico17-v6-dc-report-on-v6.test.js` · `tests/coaching/fico17-v6-dc11-report-path.test.js` · `tests/coaching/fico17-v6-dc11.test.js` · `tests/coaching/fico17-v6-framework.test.js` (+9: `python3 kg/kg.py who-reads bot/shared/services/coaching/frameworks/fico17-v6-framework.js`)
- `framework-registry.js` ← `bot/tests/observe/observe-framework-pack.test.js` · `tests/coaching/fico-framework-ict.test.js` · `tests/coaching/fico-s-dc-prompt.test.js` · `tests/coaching/fico-s-v1-2.test.js` · `tests/coaching/fico17-v6-framework.test.js` · `tests/coaching/framework-registry.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/coaching/frameworks/framework-registry.js`)
- `framework-selector.js` ← `bot/tests/observe/observe-pipeline-fork.test.js` · `tests/coaching/framework-registry.test.js` · `tests/coaching/framework-selection-reason.test.js` · `tests/coaching/framework-wiring.test.js`
- `hots-framework.js` ← `bot/tests/observe/observe-endpoint-hots.test.js` · `tests/coaching/hots-framework-alignment.test.js` · `tests/coaching/hots-framework.test.js`
- `indicator-lines.js` ← `tests/observe/bd-o15qnr.37-indicator-about.test.js` · `tests/observe/bd-o15qnr.39.1-dc-evidence-hint.test.js`
- `mewaka-framework.js` ← `bot/tests/observe/observe-draft.service.test.js` · `bot/tests/observe/observe-endpoint-hots.test.js` · `bot/tests/observe/observe-endpoint.test.js` · `bot/tests/observe/observe-flow-json.test.js` · `bot/tests/observe/observe-framework-pack.test.js` · `bot/tests/observe/observe-subject-flags.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/coaching/frameworks/mewaka-framework.js`)
- `oecd-framework.js` ← `tests/coaching/analyze-pedagogy-framework-dispatch.test.js` · `tests/coaching/oecd-framework.test.js`
- `own-rubric.js` ← `tests/coaching/fico-s-v1-1-rubric.test.js` · `tests/coaching/fico-s-v1-2.test.js` · `tests/coaching/obs612-never-averaged.test.js` · `tests/observe/fico-s-form.test.js`
- `teach-framework.js` ← `tests/coaching/teach-framework.test.js`

## Related (all, generated)
- skills: `coaching`?
- docs: `bot/shared/services/coaching/CLAUDE.md`? · `docs/customization.md`?
