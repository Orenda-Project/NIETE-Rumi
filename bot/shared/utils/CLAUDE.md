# utils — Small shared helpers: language, logging, phone, SQS, rendering, text
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/utils kg=21d0929a4afd gen=2c1d69c080a2 overflow=572 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `resolve-response-language.js` — which language a reply uses
- `structured-logger.js` — Axiom logging
- `html-to-pdf.js` — Playwright PDF render
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__mocks__/` | → (no door; 2 test files) |
| `logger.js` | Structured JSON logger (logToFile/logError/logWarn) for Railway/Axiom with auto correlationId |
| `structured-logger.js` | Pino structured logger with Axiom HTTP ingest and console override; required at the top of entry points |
| `html-to-pdf.js` | Playwright/Chromium HTML to PDF/PNG renderer with lazy browser singleton and font loading |
| `constants.js` | Central env-derived constants: Flow IDs, VOICE_MODELS routing table, presence-gated feature IDs |
| … | 45 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `logger.js` ← imported by `bot/shared/calls/call-forwarder.js:18:9949d551` · `bot/shared/calls/call-log.service.js:19:9949d551` (+595)
- `structured-logger.js` ← imported by `bot/shared/handlers/exam-checker.handler.js:14:6565d9d3` · `bot/shared/handlers/image-message.handler.js:26:b00ce36f` (+175)
- table `users` (written by `language-cache.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+170)
- … 50 more → `CLAUDE.index.md`

## Never (human)
- Media sends use private-temp.js paths, never clock-only names (private-temp.js:2, bd-c00np)
- registration-status.js is the one registered check (registration-status.js:2)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/quiz/transcript-quiz-flow-endpoint.test.js` (logger.js, structured-logger.js, text-format.js)
- `bot/tests/quiz/web-quiz/teacher-report-library-send.test.js` (html-to-pdf.js, logger.js, structured-logger.js)
- … 477 more → `CLAUDE.index.md`

## Related (generated)
- skills: `coaching`? · `debugging`? · `logging`? · `whatsapp-flows`?
- docs: `.claude/skills/niete-mock-e2e/reference/exit-codes.md`? · `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/scripts/e2e/CLAUDE.index.md`? · `bot/shared/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? (+25)
