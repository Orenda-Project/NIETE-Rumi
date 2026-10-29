# bot — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `.github/` | → (no door; 1 files) |
| `06_MMS_Inference_Service/` | Standalone Python ASR service for Balochi, Sindhi, Pashto speech (bot calls it over HTTP) → `06_MMS_Inference_Service/CLAUDE.md` |
| `assets/` | → (no door; 133 files) |
| `dashboard/` | Legacy Express admin dashboard: login, users, conversations, stats → `dashboard/CLAUDE.md` |
| `data/` | → (no door; 2 files) |
| `database/` | Legacy v3.0 schema, guides and ad-hoc SQL migrations from the main-bot era → `database/CLAUDE.md` |
| `docs/` | Docs home for the bot; only the Flow JSON definitions live here → `docs/CLAUDE.md` |
| `fonts/` | Bundled Urdu/Arabic font files the bot's renderers load from disk → `fonts/CLAUDE.md` |
| `marketing/` | → (no door; 1 files) |
| `scripts/` | Operator scripts: LP corpus builds, backfills, template and Flow registration → `scripts/CLAUDE.md` |
| `shared/` | Code shared by the web bot and workers: handlers, routes, services glue, config → `shared/CLAUDE.md` |
| `test-assets/` | → (no door; 4 files) |
| `tests/` | Jest suite for the NIETE bot: unit, handler, worker, LP and call tests → `tests/CLAUDE.md` |
| `vendor/` | Vendored upstream code copied into the bot, edited only per SYNC.md → `vendor/CLAUDE.md` |
| `workers/` | SQS job worker, cron sweeps and per-job handlers run outside the web process → `workers/CLAUDE.md` |
| `.deploy-marker` | (unmapped) |
| `.gitignore` | (unmapped) |
| `Procfile` | Process types for the bot image: web (whatsapp-bot.js), worker (workers/sqs-worker.js), dashboard (dashboard/index.js) |
| `README.md` | Quick start and architecture sketch for the bot package (install, dev server, CLI simulator); partly historical |
| `VERSION` | (unmapped) |
| `calls-server.js` | Entry point of the separate calls service: live WhatsApp voice calls forwarded by the bot over private networking |
| `jest.config.js` | Jest config for bot unit/integration tests: node env, tests/**/*.test.js, loopback setup that blocks live services |
| `package.json` | Bot package manifest: start scripts for web, worker, stale-session and BigQuery-export workers, deps, postinstall checks |
| `whatsapp-bot.js` | Express entry point of the NIETE bot: Meta webhook (signature-checked), button/message routing to handlers, health |

## Who reads this (all, generated)
- `package.json` ← imported by `bot/whatsapp-bot.js:2763:056c465a`
- column `reading_assessments.comprehension_answers` (written by `whatsapp-bot.js`) ← read by `bot/shared/services/redis-comprehension.service.js:85:64fad2d6`
- column `reading_assessments.comprehension_score` (written by `whatsapp-bot.js`) ← read by `dashboard/routes/portal.routes.js:8257:6033d135`
- table `reading_assessments` whole row (`*`) (written by `whatsapp-bot.js`) ← read by `dashboard/database/queries.js:749:7a0c163a`? · `dashboard/routes/portal.routes.js:8332:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:517:d2b02c3e`? · `bot/shared/services/feature-registration.service.js:147:7a0c163a`? (+2: `python3 kg/kg.py who-reads reading_assessments`)
- table `broadcast_logs` (written by `whatsapp-bot.js`) ← read by `dashboard/database/queries.js:1750:d5d1db20`?
- table `broadcast_messages` (written by `whatsapp-bot.js`) ← read by `dashboard/database/queries.js:1868:5e6ab800`?
- table `reading_assessments` (written by `whatsapp-bot.js`) ← read by `dashboard/database/queries.js:748:4337985e`? · `dashboard/routes/portal.routes.js:8256:4337985e`? · `bot/shared/handlers/flow-response.handler.js:326:4337985e`? · `bot/shared/handlers/text-message.handler.js:1734:4337985e`? (+10: `python3 kg/kg.py who-reads reading_assessments`)
- env `CALLS_REPLICA_COUNT` read at `bot/calls-server.js:65:3b9b933c`
- env `INTERNAL_API_KEY` read at `bot/whatsapp-bot.js:2797:1b3e4b05`
- env `NGROK_AUTHTOKEN` read at `bot/whatsapp-bot.js:2923:7dd66fc8`
- env `NODE_ENV` read at `bot/whatsapp-bot.js:2783:3d55fed5`
- env `OPERATOR_WHATSAPP` read at `bot/calls-server.js:86:4705b673`
- env `PORT` read at `bot/calls-server.js:364:769700c7`
- env `RAILWAY_REPLICA_COUNT` read at `bot/calls-server.js:65:3b9b933c`

## Tests (all, generated)
- `jest.config.js` ← `tests/jest.config.js`?
- `whatsapp-bot.js` ← `bot/tests/coaching/bd-uwpohl-lesson-file-goes-to-app.test.js` · `bot/tests/first-touch/maker-fallback.webhook.test.js` · `bot/tests/first-touch/one-door-webhook.test.js` · `bot/tests/observe/bd-n9832-cancelled-stays-cancelled-taps.test.js` · `bot/tests/quiz/child-quiz-home.test.js` · `bot/tests/quiz/report-delivery-webhook.test.js` (+31: `python3 kg/kg.py who-reads bot/whatsapp-bot.js`)

## Related (all, generated)
- skills: `coaching`? · `video-generation`? · `whatsapp-flows`?
- docs: `CLAUDE.md`? · `SECURITY.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/queue/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/architecture.md`? · `docs/data-standards.md`? · `docs/migration/06-from-main-rumi-bot.md`? · `docs/reports/bug131-phase3-grand-quiz.md`? · `tests/BASELINE.md`? · `todo.md`?
- service: `railway.json` · `web`

## Previous notes (human, unverified — moved here from the old CLAUDE.md)
**Parent:** [../CLAUDE.md](../CLAUDE.md) · Node/Express WhatsApp bot. Entry point: `whatsapp-bot.js`
(webhook + button/message routing).

## Layout

| Path | What's there |
|------|--------------|
| `whatsapp-bot.js` | Express webhook, interactive-button router, message dispatch |
| `shared/handlers/` | Message handlers (text, voice, image, flow-response, …) — 10 files |
| `shared/services/` | Domain services (49) — AI, coaching, reading, quiz, pic-to-LP, whatsapp, R2, … |
| `shared/services/queue/` | **Pluggable queue** — `index.js` selects driver by `QUEUE_DRIVER` (sqs\|bullmq) |
| `shared/routes/` | WhatsApp Flow endpoints (registration, attendance, settings, status, …) |
| `shared/config/` | `feature-availability.js` (presence gating), `branding.js`, `region-config.js` |
| `shared/utils/` | logger, structured-logger (correlation IDs), constants, phone-validation |
| `workers/` | Background job workers (10) — `sqs-worker.js` is the poll loop; one handler per job type |
| `scripts/` | CLI simulator, validators, setup `doctor.js` |

## Things to know before editing

- **Queue:** never import a specific driver. Require `shared/services/queue` (the index); both drivers
  expose the same surface (`queueJob`/`receiveJobs`/`completeJob`/`extendJobTimeout`/`cancelByGroupId`/…).
  Adding a job type = add a `case` in `workers/sqs-worker.js`'s `executeJob` switch + a handler.
- **Feature gating:** check `feature-availability.js`, not env vars directly; a feature is on iff its keys exist.
- **Shared-service edits are high-blast-radius** — grep consumers, verify imports, run the suite. See the
  `cross-agent-safety` skill.
- **LLM:** all model calls go through `shared/services/llm-client.js`; which model each job runs is one table,
  `shared/config/model-registry.js` (switch or revert without a deploy: [../docs/model-switching.md](../docs/model-switching.md)).
- **Flows:** a new Flow = `shared/routes/<x>-endpoint.js` + mount in `flow-endpoint.routes.js` + `<X>_FLOW_ID`
  in `shared/utils/constants.js` + `.env.template` + a `/command` trigger in `shared/handlers/text-message.handler.js`
  + sanitized JSON in `docs/flows/`. See the `whatsapp-flows` skill.

## Deep-dive skills

`.claude/skills/` — `coaching`, `reading-assessment`, `registration`, `whatsapp-flows`, `feature-tracer`
(trace a feature end-to-end), `debugging`, `cross-agent-safety`, `qa-testing`, `video-generation`,
`pre-merge-checklist`, `database-analysis`, `digital-coach` (full technical KB).
