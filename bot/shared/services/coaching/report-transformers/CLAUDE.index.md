# report-transformers — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/report-transformers -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `_shared.js` | Shared helpers for report transformers: date format, fidelity extraction, partial-session note |
| `fico-report-transformer.js` | Turns FICO analysis_data into the generic reportData (4 sections, focus area) used by PDF and hero renderers |
| `hots-report-transformer.js` | Turns HOTS analysis into the generic reportData (5 areas, scale 1-3) consumed by the PDF report |
| `mewaka-report-transformer.js` | Turns MEWAKA analysis into reportData, adding focus area and top-level strengths; exports domain config and max marks |
| `oecd-report-transformer.js` | Turns OECD analysis into reportData with lesson-plan evidence snippets, extracted from report-generator |
| `report-transformer-dispatch.js` | Maps framework key to its report transformer, falling back to OECD for unknown frameworks |
| `teach-report-transformer.js` | Turns World Bank Teach analysis into reportData (3 areas plus time on task) with behaviour ratings |

## Who reads this (all, generated)
- `_shared.js` ← imported by `bot/shared/services/coaching/report-v2/hero-report.service.js:24:bcfdf58b` · `bot/shared/services/coaching/report-transformers/fico-report-transformer.js:26:67d49e41` · `bot/shared/services/coaching/report-transformers/hots-report-transformer.js:12:67d49e41` · `bot/shared/services/coaching/report-transformers/mewaka-report-transformer.js:22:86ab6909` (+1: `python3 kg/kg.py who-reads _shared.js`)
- `fico-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:14:65440201`
- `hots-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:12:490c950b`
- `mewaka-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:15:1e7cf8a8`
- `oecd-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:11:d8971ea3`
- `report-transformer-dispatch.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:123:f4dbdc25`
- `teach-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:13:10ca1a56`

## Tests (all, generated)
- `_shared.js` ← `tests/coaching/bd-60106-reflection-count-single-source.test.js` · `tests/coaching/fidelity/fidelity-report-block.test.js`
- `fico-report-transformer.js` ← `tests/coaching/report-transformers/coach-role-label-in-transformers.test.js` · `tests/coaching/report-transformers/fico-report-transformer.test.js`
- `hots-report-transformer.js` ← `tests/coaching/hots-framework-alignment.test.js` · `tests/coaching/hots-framework.test.js` · `tests/coaching/report-transformers/coach-role-label-in-transformers.test.js` · `tests/coaching/report-transformers/hots-report-transformer.test.js`
- `mewaka-report-transformer.js` ← `tests/coaching/report-transformers/coach-role-label-in-transformers.test.js` · `tests/reports/mewaka-report.test.js`
- `oecd-report-transformer.js` ← `tests/coaching/report-transformers/coach-role-label-in-transformers.test.js`
- `report-transformer-dispatch.js` ← `tests/coaching/fico-framework-ict.test.js` · `tests/coaching/framework-wiring.test.js` · `tests/coaching/multi-framework-report-integration.test.js` · `tests/reports/mewaka-report.test.js`
- `teach-report-transformer.js` ← `tests/coaching/report-transformers/coach-role-label-in-transformers.test.js`

## Related (all, generated)
- docs: `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.index.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.md`? · `tests/coaching/CLAUDE.index.md`? · `tests/coaching/fidelity/CLAUDE.index.md`? · `tests/coaching/fidelity/CLAUDE.md`? · `tests/coaching/report-transformers/CLAUDE.md`? · `tests/reports/CLAUDE.md`?
