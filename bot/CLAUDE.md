# bot — NIETE WhatsApp bot: webhook, workers, services, tests, migrations
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot kg=bcfffffbde15 gen=e86199a22cef overflow=51 rendered=2026-10-30 kg.py=1.1.0 -->

## Entry points
- `whatsapp-bot.js` — the Express webhook (GET/POST /webhook at :467/:488) and button/message routing
- `workers/sqs-worker.js` — the job poll loop; executeJob (:527) switches on jobType (:535)
- `shared/services/queue/index.js` — picks the queue driver from QUEUE_DRIVER (sqs default, bullmq)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 10 sub-dirs, each with `CLAUDE.md` | `06_MMS_Inference_Service/` · `dashboard/` · `database/` · `docs/` · `fonts/` · `scripts/` · `shared/` · `tests/` · `vendor/` · `workers/` |
| 5 sub-dirs without a door | `.github/` (1) · `assets/` (133) · `data/` (2) · `marketing/` (1) · `test-assets/` (4) |
| `whatsapp-bot.js` | Express entry point of the NIETE bot: Meta webhook (signature-checked), button/message routing to handlers, health |
| … | 21 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `reading_assessments` (written by `whatsapp-bot.js`) ← read by `dashboard/database/queries.js:748:4337985e`? · `dashboard/routes/portal.routes.js:8258:4337985e`? (+12)
- table `reading_assessments` whole row (`*`) (written by `whatsapp-bot.js`) ← read by `dashboard/database/queries.js:749:7a0c163a`? · `dashboard/routes/portal.routes.js:8334:d2b02c3e`? (+4)
- … 12 more → `CLAUDE.index.md`

## Never (human)
- Require `shared/services/queue` (the index), never a driver file — both drivers share one surface (shared/services/queue/index.js:6-9)
- POST /webhook stays behind `WebhookSignature.requireMetaSignature` (rejects 401) — `whatsapp-bot.js:488`
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/coaching/bd-uwpohl-lesson-file-goes-to-app.test.js` (whatsapp-bot.js)
- `bot/tests/first-touch/maker-fallback.webhook.test.js` (whatsapp-bot.js)
- … 36 more → `CLAUDE.index.md`

## Related (generated)
- skills: `coaching`? · `video-generation`? · `whatsapp-flows`?
- docs: `CLAUDE.md`? · `SECURITY.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/queue/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/architecture.md`? (+5)
- … 1 more → `CLAUDE.index.md`
