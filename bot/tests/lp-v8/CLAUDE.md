# lp-v8 — Tests for lesson-plan delivery: v8/v9 corpus, Flow, uploader, LP chat context
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/lp-v8 kg=543e36bd3d34 gen=1712d5dc574c overflow=24 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `delivery.test.js` — deliverV8Lesson, presigned URL and sent rows
- `endpoint-dispatch.test.js` — LP Flow endpoint routing, grades 1-5 vs 6-12
- `lp-context-builder.test.js` — what chat is told about a delivered lesson
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `bd*` | 12 files; most used `bd-oak77-route-all.test.js`: Pins LP_612_ROUTE_ALL/ROUTE_K5 flags: default off, only narrow, old 6-12 picker unreachable from free text (bd-oak77.4) |
| `lp*` | 7 files; most used `lp-shelf-plumbing.test.js`: Pins lp-shelf wiring: deliverV8Lesson pushes an exact-version entry; failures never break delivery (bd-njn7u 1) |
| `ab-ch310.test.js` | Pins the ICT G1-5 ch3-10 lesson-plan A/B: group A gets the v8 PDF, B the v9 render, by school (bd-5o0ay.10.1) |
| `flow-response-telemetry.test.js` | Pins lp612.flow.response telemetry: each data_exchange, INIT, BACK logs outcome, items, bytes, duration (bd-oak77.26) |
| `tick-app-opens.test.js` | Pins that the lesson tick counts lessons opened in the teacher app for both the Flow list and the app list |
| `upload-writes-slide-script.test.js` | Pins that the uploader writes the slide script with the same asset row and hash in one run (PLAN R8 2.2 lane S) |
| `CLAUDE.md` | (unmapped) |
| … | 24 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `ELEVENLABS_API_KEY` · `LP_SEGMENTATION_DIR` · `LP_TOC_DIR` · `LP_V8_MANIFEST` · `LP_V8_SAMPLE_PDF` · `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `PAKISTAN_LP_FLOW_ID` · `PHONE_NUMBER_ID` · `TEACHER_NUDGES_ENABLED` · `WHATSAPP_TOKEN`

## Never (human)
- Uploader keys land under lp-cache/v8, never the old prod cache (tests/lp-v8/uploader.test.js:33)
- Elective menu names fit the 30-code-point title (tests/lp-v8/elective-menu-names.test.js:34)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/CLAUDE.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.md`? (+17)
