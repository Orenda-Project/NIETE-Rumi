# report-renderers — Registry choosing the report renderer (hero PNG or PDFKit fallback)

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/report-renderers kg=c6de0044da31 gen=d6324b2a35cb overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `renderer-registry.js` — framework key to renderer
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `renderer-registry.js` | Routes a framework key to its report renderer: hero Playwright PNG by default, PDFKit fallback |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- `renderer-registry.js` ← imported by `bot/shared/services/observe/observe-debrief.service.js:817:0ae72910` · `bot/shared/services/observe/observe-send.service.js:1202:0ae72910` (+1)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/observe/bd-2453-niete-brand.test.js` (renderer-registry.js)
- `bot/tests/unit/bd-2452-niete-hero-brand.test.js` (renderer-registry.js)
- `tests/coaching/fico-framework-ict.test.js` (renderer-registry.js)
- `tests/coaching/hero-render-fallback.test.js` (renderer-registry.js)
- `tests/coaching/report-renderer-registry.test.js` (renderer-registry.js)

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/report-renderers/CLAUDE.md`? · `bot/tests/observe/CLAUDE.index.md`? · `bot/tests/unit/CLAUDE.md`? · `docs/agent-customization.md`? (+1)
