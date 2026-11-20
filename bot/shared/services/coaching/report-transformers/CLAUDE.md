# report-transformers — Per-framework transformers from analysis_data to the generic reportData
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/report-transformers kg=cba1ee92bd48 gen=3721421a53d5 overflow=26 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `report-transformer-dispatch.js` — picks the transformer, OECD fallback
- `fico-report-transformer.js` — the FICO shape
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `_shared.js` | Shared helpers for report transformers: date format, fidelity extraction, partial-session note |
| `report-transformer-dispatch.js` | Maps framework key to its report transformer, falling back to OECD for unknown frameworks |
| `fico-report-transformer.js` | Turns FICO analysis_data into the generic reportData (4 sections, focus area) used by PDF and hero renderers |
| `hots-report-transformer.js` | Turns HOTS analysis into the generic reportData (5 areas, scale 1-3) consumed by the PDF report |
| `fico17-v6-report-transformer.js` | (unmapped) |
| … | 4 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `_shared.js` ← imported by `bot/shared/services/coaching/report-v2/hero-report.service.js:24:bcfdf58b` · `bot/shared/services/coaching/report-transformers/fico-report-transformer.js:26:67d49e41` (+5)
- `fico-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:14:65440201`
- `fico17-v6-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:16:a680a2e6`
- `hots-report-transformer.js` ← imported by `bot/shared/services/coaching/report-transformers/report-transformer-dispatch.js:12:490c950b`
- … 5 more → `CLAUDE.index.md`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/report-transformers/coach-role-label-in-transformers.test.js` (fico-report-transformer.js, hots-report-transformer.js, mewaka-report-transformer.js, oecd-report-transformer.js, teach-report-transformer.js)
- `tests/coaching/fico17-v6-hitl-report-evidence.test.js` (fico-report-transformer.js, fico17-v6-report-transformer.js)
- … 17 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`?
