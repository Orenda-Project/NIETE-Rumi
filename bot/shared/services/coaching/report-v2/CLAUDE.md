# report-v2 — Hero report: score view model, narrative, templates, PNG image
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/report-v2 kg=9de205d4fdc1 gen=a360b8dd701a overflow=62 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `hero-report.service.js` — the render pipeline
- `score-adapter.service.js` — normalises any framework's scores
- `narrative.service.js` — LLM celebration copy
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `score-adapters/` | One score adapter per framework, turning analysis into scorecard groups → `score-adapters/CLAUDE.md` |
| `hero*` | 3 files; most used `hero-report.template.js`: Builds the hero report HTML (score header, scorecard, moment, horizon, trend) with embedded fonts for en/sw/ur |
| `narrative.service.js` | LLM celebration-narrative pass (headline, moments, strength, horizon, section whys) over transcript and scores |
| `score-adapter.service.js` | Normalises any framework's analysis_data into one ScoreViewModel for the hero renderer |
| … | 9 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `narrative-store.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:56:4a173bcd`? (+88)
- column `coaching_sessions.analysis_data` (written by `narrative-store.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:58:c286009d` (+35)
- table `coaching_sessions` whole row (`*`) (written by `narrative-store.js`) ← read by `bot/shared/handlers/text-message.handler.js:1951:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:770:d2b02c3e`? (+7)
- … 12 more → `CLAUDE.index.md`

## Never (human)
- Narrative must stay at analysis_data.report_narrative for the app report page (narrative-store.js, bd-fmf24g.10)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/bd-9h2mm-section-b-not-assessed.test.js` (hero-report.service.js, hero-report.template.js, narrative.service.js, score-adapter.service.js)
- `tests/coaching/bd-5lrgh-lp-mismatch-reason.test.js` (hero-report.service.js, hero-report.template.js, narrative.service.js)
- … 43 more → `CLAUDE.index.md`

## Related (generated)
- skills: `coaching`?
- docs: `bot/shared/services/coaching/CLAUDE.md`? · `docs/customization.md`?
