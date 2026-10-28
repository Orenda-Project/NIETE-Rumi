# reports — Tests PDF/HTML report rendering: Playwright wrapper, MEWAKA, reading, Oxbridge LP

<!-- kg:meta repo=NIETE-Rumi dir=tests/reports kg=84750cc5050a gen=91acb2ed1f29 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `html-to-pdf.test.js` — Playwright wrapper with virtually mocked playwright-core
- `oxbridge-lp-error-level.test.js` — swallowed LP delivery failure must log at error
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/reports --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `mewaka-report.test.js` | Pins the MEWAKA report transformer, HTML template and report-transformer dispatch wiring |
| `CLAUDE.md` | (unmapped) |
| `oxbridge-lp-error-level.test.js` | Regression guard: deliverOxbridgeLp logs a swallowed PDF render/send failure at level=error, not info |
| `reading-report-service.test.js` | Pins reading report.service routing: Playwright HTML-to-PDF first, PDFKit fallback when it throws |
| `reading-report-template.test.js` | Pins the reading-report HTML template: embedded fonts, Urdu RTL, subtitle, derived performance level |
| `html-to-pdf.test.js` | Pins the Playwright html-to-pdf wrapper (virtual mock): fonts ready, singleton browser, A4 and printBackground |

## Who reads this (generated)
- (none)

## Never (human)
- A swallowed deliverOxbridgeLp failure must log at level=error, not info (oxbridge-lp-error-level.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.index.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.md`? · `bot/shared/services/coaching/templates/CLAUDE.md`? · `bot/shared/services/reading/CLAUDE.index.md`? · `bot/shared/templates/CLAUDE.index.md`? (+3)
