# lp-v8 — Tests for lesson-plan delivery: v8/v9 corpus, Flow, uploader, LP chat context
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/lp-v8 kg=daf98cd4aca0 gen=118ed608ea1f overflow=22 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `delivery.test.js` — deliverV8Lesson, presigned URL and sent rows
- `endpoint-dispatch.test.js` — LP Flow endpoint routing, grades 1-5 vs 6-12
- `lp-context-builder.test.js` — what chat is told about a delivered lesson
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `flow-response-telemetry.test.js` | Pins lp612.flow.response telemetry: each data_exchange, INIT, BACK logs outcome, items, bytes, duration (bd-oak77.26) |
| `bd*` | 12 files; most used `bd-oak77-route-all.test.js`: Pins LP_612_ROUTE_ALL/ROUTE_K5 flags: default off, only narrow, old 6-12 picker unreachable from free text (bd-oak77.4) |
| `lp*` | 7 files; most used `lp-shelf-plumbing.test.js`: Pins lp-shelf wiring: deliverV8Lesson pushes an exact-version entry; failures never break delivery (bd-njn7u 1) |
| `ab-ch310.test.js` | Pins the ICT G1-5 ch3-10 lesson-plan A/B: group A gets the v8 PDF, B the v9 render, by school (bd-5o0ay.10.1) |
| `tick-app-opens.test.js` | Pins that the lesson tick counts lessons opened in the teacher app for both the Flow list and the app list |
| `upload-writes-slide-script.test.js` | Pins that the uploader writes the slide script with the same asset row and hash in one run (PLAN R8 2.2 lane S) |
| `delivery.test.js` | Tests deliverV8Lesson: presigned R2 URL, sent/failed rows, filename; Supabase, R2, WhatsApp mocked (bd-2054, bd-2407) |
| `endpoint-dispatch.test.js` | Tests Pakistan LP endpoint dispatch: INIT grade picker, v8 grades 1-5 path, Oxbridge 6-10 unchanged (FEAT-059, bd-fg3p4) |
| … | 44 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Uploader keys land under lp-cache/v8, never the old prod cache (tests/lp-v8/uploader.test.js:33)
- Elective menu names fit the 30-code-point title (tests/lp-v8/elective-menu-names.test.js:34)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.md`? · `bot/shared/routes/CLAUDE.md`? · `bot/shared/services/CLAUDE.md`? · `bot/tests/CLAUDE.md`? · `docs/flows/CLAUDE.md`?
