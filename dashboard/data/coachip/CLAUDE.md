# coachip — COACHIP library, copy and crosswalk JSON loaded by services and the nightly seed

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/data/coachip kg=a8d992175352 gen=fd199d153ee6 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `INTERVENTIONS.json` — frozen v1 intervention library (34 weaknesses)
- `crosswalk.json` — weakness to FICO/LP-fidelity indicator mapping and hit rules
- `copy.json` — generated EN/UR weakness copy
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `INTERVENTIONS.json` | Frozen COACHIP intervention library v1 (34 weaknesses, intervention cards) loaded by the coachip services; bd-sex15q.22. |
| `crosswalk.json` | COACHIP crosswalk xw-1.0: maps each weakness id to its source indicator (lp_fidelity, fico_v3), scale and hit rule. |
| `copy.json` | Generated EN/UR copy for COACHIP weakness short names and sentences (from contracts/COPY.md); do not hand-edit. |

## Who reads this (generated)
- `INTERVENTIONS.json` ← imported by `dashboard/lib/insights/job.js:30:a6fd313d`
- `crosswalk.json` ← imported by `dashboard/lib/insights/job.js:31:0a5614f4`

## Never (human)
- Never hand-edit copy.json; regenerate it from COPY.md (`copy.json:2`)
- Never change the frozen library in place; it was frozen for R4 (`INTERVENTIONS.json:6`, bd-sex15q.22)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `dashboard/tests/insights/rollups.service.test.js` (INTERVENTIONS.json, crosswalk.json)
- `dashboard/tests/insights/seed.service.test.js` (INTERVENTIONS.json, crosswalk.json)
- `dashboard/tests/insights/signals.service.test.js` (INTERVENTIONS.json, crosswalk.json)
- `dashboard/tests/insights/ranking.service.test.js` (INTERVENTIONS.json)

## Related (generated)
- docs: `dashboard/data/CLAUDE.md`?
