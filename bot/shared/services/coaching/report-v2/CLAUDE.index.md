# report-v2 — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/report-v2 -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `score-adapters/` | One score adapter per framework, turning analysis into scorecard groups → `score-adapters/CLAUDE.md` |
| `classroom-photo-vm.js` | Downloads up to 2 teacher photos as base64 data URIs for the hero report strip; broken photos skipped (bd-pv2tl) |
| `hero-report.service.js` | Hero report pipeline: score adapter, narrative, commitment action, trend, template, image render to PNG plus caption |
| `hero-report.style.js` | Hero template data: brand palettes (incl. NIETE green/navy), marks words and per-language chrome copy |
| `hero-report.template.js` | Builds the hero report HTML (score header, scorecard, moment, horizon, trend) with embedded fonts for en/sw/ur |
| `narrative-store.js` | Read-merge-writes hero narrative into analysis_data.report_narrative for the app report page (bd-fmf24g.10) |
| `narrative.service.js` | LLM celebration-narrative pass (headline, moments, strength, horizon, section whys) over transcript and scores |
| `observe2-horizon.js` | Pins an /observe2 report's growth area to the coach's "Work on first" pick instead of the lowest section |
| `photo-note.js` | Builds one caption per framed classroom photo from the first clause of its own vision description (bd-1mcpe) |
| `report-language.js` | Decides the hero report language, refusing STT labels not offered by the deployment (bd-gipr1) |
| `score-adapter.service.js` | Normalises any framework's analysis_data into one ScoreViewModel for the hero renderer |
| `slim-card.template.js` | HTML for the slim WhatsApp report image groups C/D get: header score, wells, try-one-thing box (bd-v0toag.57) |
| `uptake-line.js` | Builds the report's "Last time we asked" block, shared by the image and the portal report page (bd-z3cadk) |

## Who reads this (all, generated)
- `classroom-photo-vm.js` ← imported by `bot/shared/services/coaching/report-v2/hero-report.service.js:18:7b84ecf3`
- `hero-report.service.js` ← imported by `bot/shared/services/coaching/report-renderers/renderer-registry.js:48:35f8be35` · `bot/shared/services/observe/observe-send.service.js:1201:6179311a`
- `hero-report.style.js` ← imported by `bot/shared/services/coaching/report-v2/hero-report.template.js:37:bd02679c` · `bot/shared/services/coaching/report-v2/uptake-line.js:11:39daee76`
- `hero-report.template.js` ← imported by `bot/shared/services/coaching/video-reco/card-image.js:15:d7d80ec3` · `scripts/render-sample-report.js:25:cabfbec2` · `bot/shared/services/coaching/report-v2/hero-report.service.js:14:1db96725` · `bot/shared/services/coaching/report-v2/slim-card.template.js:15:3d2d6c69`
- `narrative-store.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:36:1abad5bc` · `bot/shared/services/observe/observe-send.service.js:1230:8c5f075b`
- `narrative.service.js` ← imported by `bot/shared/services/coaching/coaching-card/commitment-card.service.js:42:9c2bae23` · `bot/shared/services/remark/remark-narrative.service.js:42:809c80c5` · `bot/shared/services/coaching/report-v2/hero-report.service.js:13:47a90ca2`
- `observe2-horizon.js` ← imported by `bot/shared/services/coaching/report-v2/hero-report.service.js:23:ee435e99`
- `photo-note.js` ← imported by `bot/shared/services/coaching/report-v2/hero-report.service.js:19:21e3d3bd`
- `report-language.js` ← imported by `bot/shared/services/coaching/coaching-breakdown.service.js:30:53277c45` · `bot/shared/services/coaching/report-generator.service.js:1042:53277c45` · `bot/shared/services/coaching/report-v2/hero-report.service.js:20:e35c272d`
- `score-adapter.service.js` ← imported by `bot/shared/services/coaching/coaching-breakdown.service.js:29:c8558feb` · `bot/shared/services/coaching/report-v2/hero-report.service.js:12:30c9abce`
- `slim-card.template.js` ← imported by `bot/shared/services/coaching/report-v2/hero-report.service.js:15:164aea42`
- `uptake-line.js` ← imported by `dashboard/services/report-extras.js:13:be57ffc1` · `bot/shared/services/coaching/report-v2/hero-report.service.js:80:f3bbdf75`
- column `coaching_sessions.analysis_data` (written by `narrative-store.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:53:c286009d` · `bot/shared/routes/observe2-check-endpoint.js:297:ed6f6cd9` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:285:4fa90499` (+32: `python3 kg/kg.py who-reads coaching_sessions.analysis_data`)
- table `coaching_sessions` whole row (`*`) (written by `narrative-store.js`) ← read by `bot/shared/handlers/text-message.handler.js:1921:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? · `bot/shared/routes/observe-mewaka-endpoint.js:152:d2b02c3e`? · `bot/shared/services/coaching-orchestrator.service.js:225:d2b02c3e`? (+5: `python3 kg/kg.py who-reads coaching_sessions`)
- table `coaching_sessions` (written by `narrative-store.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+85: `python3 kg/kg.py who-reads coaching_sessions`)

## Tests (all, generated)
- `classroom-photo-vm.js` ← `tests/coaching/bd-1mcpe-per-photo-captions.test.js` · `tests/coaching/bd-b3pop-report-photo-strip.test.js` · `tests/coaching/bd-pv2tl-classroom-photo-vm.test.js`
- `hero-report.service.js` ← `bot/tests/observe/bd-dy7hs-one-language-owner.test.js` · `bot/tests/observe/bd-zpyf0-confirm-names-recipient.test.js` · `bot/tests/observe/observe-send-processor.test.js` · `tests/coaching/bd-1t1wz-hero-why-render.test.js` · `tests/coaching/bd-5lrgh-lp-mismatch-reason.test.js` · `tests/coaching/bd-9h2mm-section-b-not-assessed.test.js` (+10: `python3 kg/kg.py who-reads bot/shared/services/coaching/report-v2/hero-report.service.js`)
- `hero-report.style.js` ← `bot/tests/unit/hero-report-style.test.js` · `tests/portal/bd-z3cadk-report-extras.test.js`
- `hero-report.template.js` ← `bot/tests/coaching/latin-runs-coaching-print.test.js` · `bot/tests/unit/bd-2452-niete-hero-brand.test.js` · `bot/tests/unit/bd-d26qh-bidi-mixed-latin-digit.test.js` · `tests/coaching/bd-1t1wz-hero-why-render.test.js` · `tests/coaching/bd-5lrgh-lp-mismatch-reason.test.js` · `tests/coaching/bd-8s2xb-photo-surfaces.test.js` (+10: `python3 kg/kg.py who-reads bot/shared/services/coaching/report-v2/hero-report.template.js`)
- `narrative-store.js` ← `tests/coaching/bd-fmf24g.10-report-narrative.test.js` · `tests/coaching/hero-partial-note.test.js`
- `narrative.service.js` ← `tests/coaching/bd-1t1wz-fico-domain-whys.test.js` · `tests/coaching/bd-1t1wz-translit-net.test.js` · `tests/coaching/bd-5lrgh-lp-mismatch-reason.test.js` · `tests/coaching/bd-5lrgh-mismatch-line-only.test.js` · `tests/coaching/bd-9h2mm-section-b-not-assessed.test.js` · `tests/coaching/bd-xc6jv-narrative-applicable.test.js` (+6: `python3 kg/kg.py who-reads bot/shared/services/coaching/report-v2/narrative.service.js`)
- `observe2-horizon.js` ← `tests/observe2/work-on-coaching-areas.test.js`
- `photo-note.js` ← `tests/coaching/bd-1mcpe-per-photo-captions.test.js` · `tests/coaching/bd-47vud-caption-no-dangling-cut.test.js`
- `report-language.js` ← `tests/coaching/hero-report-language-resolution.test.js`
- `score-adapter.service.js` ← `tests/coaching/bd-1t1wz-fico-bilingual-headings.test.js` · `tests/coaching/bd-5n1a2-overall-pct-zero.test.js` · `tests/coaching/bd-9h2mm-section-b-not-assessed.test.js` · `tests/coaching/score-adapters.test.js` · `tests/observe2/end-of-visit.test.js`
- `slim-card.template.js` ← `tests/coaching/bd-v0toag.57-slim-report.test.js` · `tests/coaching/video-reco/report-image-strip.test.js`
- `uptake-line.js` ← `tests/portal/bd-z3cadk-report-extras.test.js`

## Related (all, generated)
- skills: `coaching`?
- docs: `bot/shared/services/coaching/CLAUDE.md`? · `docs/customization.md`?
