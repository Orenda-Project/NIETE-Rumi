# report-transformers — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/report-transformers -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `_shared.js` | Shared helpers for report transformers: date format, fidelity extraction, partial-session note |
| `fico-report-transformer.js` | Turns FICO analysis_data into the generic reportData (4 sections, focus area) used by PDF and hero renderers |
| `fico17-v6-report-transformer.js` | (unmapped) |
| `hots-report-transformer.js` | Turns HOTS analysis into the generic reportData (5 areas, scale 1-3) consumed by the PDF report |
| `mewaka-report-transformer.js` | Turns MEWAKA analysis into reportData, adding focus area and top-level strengths; exports domain config and max marks |
| `obs612-report-transformer.js` | (unmapped) |
| `oecd-report-transformer.js` | Turns OECD analysis into reportData with lesson-plan evidence snippets, extracted from report-generator |
| `report-transformer-dispatch.js` | Maps framework key to its report transformer, falling back to OECD for unknown frameworks |
| `teach-report-transformer.js` | Turns World Bank Teach analysis into reportData (3 areas plus time on task) with behaviour ratings |

## Who reads this (all, generated)
- `_shared.js` ← imported by `bot/shared/services/coaching/report-v2/hero-report.service.js:24:bcfdf58b` · `bot/shared/services/coaching/report-transformers/fico-report-transformer.js:26:67d49e41` · `bot/shared/services/coaching/report-transformers/fico17-v6-report-transformer.js:17:67d49e41` · `bot/shared/services/coaching/report-transformers/hots-report-transformer.js:12:67d49e41` (+3: `python3 kg/kg.py who-reads _shared.js`)
- `fico-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:14:65440201`
- `fico17-v6-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:16:a680a2e6`
- `hots-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:12:490c950b`
- `mewaka-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:15:1e7cf8a8`
- `obs612-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:17:bed414db`
- `oecd-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:11:d8971ea3`
- `report-transformer-dispatch.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:144:f4dbdc25`
- `teach-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:13:10ca1a56`

## Tests (all, generated)
- `_shared.js` ← `tests/coaching/bd-60106-reflection-count-single-source.test.js` · `tests/coaching/fidelity/fidelity-report-block.test.js`
- `fico-report-transformer.js` ← `tests/coaching/fico17-v6-hitl-report-evidence.test.js` · `tests/coaching/report-transformers/coach-role-label-in-transformers.test.js` · `tests/coaching/report-transformers/fico-report-transformer.test.js` · `tests/observe2/fico17-v6-check.test.js` · `tests/observe2/fico17-v6-report.test.js`
- `fico17-v6-report-transformer.js` ← `tests/coaching/fico17-v6-hitl-report-evidence.test.js` · `tests/coaching/fico17-v6-na-per-indicator.test.js`
- `hots-report-transformer.js` ← `tests/coaching/hots-framework-alignment.test.js` · `tests/coaching/hots-framework.test.js` · `tests/coaching/report-transformers/coach-role-label-in-transformers.test.js` · `tests/coaching/report-transformers/hots-report-transformer.test.js`
- `mewaka-report-transformer.js` ← `tests/coaching/report-transformers/coach-role-label-in-transformers.test.js` · `tests/reports/mewaka-report.test.js`
- `obs612-report-transformer.js` ← `tests/observe/fico-s-form.test.js`
- `oecd-report-transformer.js` ← `tests/coaching/fico17-v6-observe-report.test.js` · `tests/coaching/report-transformers/coach-role-label-in-transformers.test.js` · `tests/coaching/report-transformers/obs612-report-transformer.test.js`
- `report-transformer-dispatch.js` ← `tests/coaching/fico-framework-ict.test.js` · `tests/coaching/fico17-v6-dc-report-on-v6.test.js` · `tests/coaching/fico17-v6-observe-report.test.js` · `tests/coaching/framework-wiring.test.js` · `tests/coaching/multi-framework-report-integration.test.js` · `tests/coaching/report-transformers/obs612-report-transformer.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js`)
- `teach-report-transformer.js` ← `tests/coaching/report-transformers/coach-role-label-in-transformers.test.js`

## Related (all, generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`?
