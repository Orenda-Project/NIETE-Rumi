# bot — NIETE WhatsApp bot: webhook, workers, services, tests, migrations
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot kg=623f51f3d0be gen=1204dfe362a6 overflow=52 rendered=2026-10-28 kg.py=1.0.0 -->

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
| `CLAUDE.index.md` | (unmapped) |
| … | 10 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `reading_assessments` (written by `whatsapp-bot.js`) ← read by `dashboard/database/queries.js:748:4337985e`? · `dashboard/routes/portal.routes.js:8256:4337985e`? (+12)
- table `reading_assessments` whole row (`*`) (written by `whatsapp-bot.js`) ← read by `dashboard/database/queries.js:749:7a0c163a`? · `dashboard/routes/portal.routes.js:8332:d2b02c3e`? (+4)
- `package.json` ← imported by `bot/whatsapp-bot.js:2763:056c465a`
- … 5 more → `CLAUDE.index.md`

## Never (human)
- Require `shared/services/queue` (the index), never a driver file — both drivers share one surface (shared/services/queue/index.js:6-9)
- POST /webhook stays behind `WebhookSignature.requireMetaSignature` (rejects 401) — `whatsapp-bot.js:488`
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/coaching/bd-uwpohl-lesson-file-goes-to-app.test.js` (whatsapp-bot.js)
- `bot/tests/first-touch/maker-fallback.webhook.test.js` (whatsapp-bot.js)
- … 36 more → `CLAUDE.index.md`

## Related (generated)
- skills: `coaching`? · `debugging`? · `digital-coach`? · `feature-tracer`? · `video-generation`? · `whatsapp-flows`?
- docs: `CLAUDE.md`? · `README.md`? · `SECURITY.md`? · `bot/06_MMS_Inference_Service/CLAUDE.md`? · `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? (+45)
- … 1 more → `CLAUDE.index.md`
