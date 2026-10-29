# video — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/video -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `video-animation.service.js` | Animates start/end video frames via Kling 2.1 Pro on Kie.ai with checkpoint/resume |
| `video-assembly.service.js` | Assembles the final student video with FFmpeg, makes the PDF and delivers it to the user |
| `video-image.service.js` | Generates video slide images via Nano Banana Pro on Kie.ai with slide-level checkpoint/resume |
| `video-job-queue.service.js` | Queues video generation jobs to SQS for async processing, following lesson-plan-queue.service |
| `video-orchestrator.service.js` | Public API for video generation: user interaction, rate limiting and coordinating the flow |
| `video-script.service.js` | Generates video slide scripts with GPT and speaks narration through the voice gateway, with style prefixes |
| `video-session.service.js` | Rate limiting and multilingual progress updates for video generation |
| `video-watermark.service.js` | Non-blocking branding watermark on generated videos; falls back to the original if watermarking fails |

## Who reads this (all, generated)
- `video-animation.service.js` ← imported by `bot/workers/video-generation.worker.js:20:262b8348`
- `video-assembly.service.js` ← imported by `bot/workers/video-generation.worker.js:21:4d7ea422`
- `video-image.service.js` ← imported by `bot/workers/video-generation.worker.js:19:180cc7e7`
- `video-job-queue.service.js` ← imported by `bot/shared/services/video/video-orchestrator.service.js:11:d8787dd6`
- `video-orchestrator.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:37:f0074ff4` · `bot/shared/handlers/voice-message.handler.js:17:f0074ff4` · `bot/shared/services/menu.service.js:595:36b15dd1` · `bot/whatsapp-bot.js:1270:fcc016b3`
- `video-script.service.js` ← imported by `bot/workers/video-generation.worker.js:18:6c0be82d`
- `video-session.service.js` ← imported by `bot/workers/video-generation.worker.js:17:fab5e61f` · `bot/shared/services/video/video-assembly.service.js:58:9a8bf4ba` · `bot/shared/services/video/video-orchestrator.service.js:10:9a8bf4ba`
- `video-watermark.service.js` ← imported by `bot/shared/services/video/video-assembly.service.js:112:a14408b1`
- column `video_requests.created_at` (written by `video-orchestrator.service.js`) ← read by `bot/shared/services/context.service.js:185:e8356999` · `dashboard/database/queries.js:743:06c5e28d` · `dashboard/routes/portal.routes.js:8671:0b0b6afb`
- column `video_requests.current_step` (written by `video-session.service.js`) ← read by `bot/workers/video-generation.worker.js:73:790c0376`
- column `video_requests.customization` (written by `video-orchestrator.service.js`) ← read by `bot/workers/sqs-worker.js:1448:0df645b0`
- column `video_requests.language` (written by `video-orchestrator.service.js`) ← read by `bot/workers/sqs-worker.js:1448:0df645b0` · `dashboard/routes/portal.routes.js:8671:0b0b6afb`
- column `video_requests.session_id` (written by `video-orchestrator.service.js`) ← read by `bot/workers/sqs-worker.js:1448:0df645b0`
- column `video_requests.slide_urls` (written by `video-image.service.js`) ← read by `bot/workers/video-generation.worker.js:73:790c0376` · `dashboard/routes/portal.routes.js:8671:0b0b6afb`
- column `video_requests.status` (written by `video-assembly.service.js`, `video-orchestrator.service.js`) ← read by `bot/shared/services/context.service.js:184:a69ef692` · `bot/shared/services/feature-registration.service.js:155:abb6a119` · `bot/workers/sqs-worker.js:1449:184894e4` · `bot/workers/video-generation.worker.js:53:1099729a` (+2: `python3 kg/kg.py who-reads video_requests.status`)
- column `video_requests.style` (written by `video-orchestrator.service.js`) ← read by `bot/workers/sqs-worker.js:1448:0df645b0`
- column `video_requests.topic` (written by `video-orchestrator.service.js`) ← read by `bot/shared/services/context.service.js:323:8460890c` · `bot/workers/sqs-worker.js:1448:0df645b0` · `dashboard/routes/portal.routes.js:8671:0b0b6afb`
- column `video_requests.user_id` (written by `video-orchestrator.service.js`) ← read by `bot/shared/services/context.service.js:183:219f5683` · `bot/shared/services/feature-registration.service.js:154:219f5683` · `bot/workers/sqs-worker.js:1448:0df645b0` · `dashboard/database/queries.js:818:31232ece` (+1: `python3 kg/kg.py who-reads video_requests.user_id`)
- column `video_requests.video_segment_urls` (written by `video-animation.service.js`) ← read by `bot/workers/video-generation.worker.js:73:790c0376`
- column `video_requests.video_url` (written by `video-assembly.service.js`) ← read by `dashboard/routes/portal.routes.js:8671:0b0b6afb`
- column `video_tasks.filename` (written by `video-animation.service.js`, `video-image.service.js`) ← read by `bot/shared/services/video/video-animation.service.js:166:1b2a53e5` · `bot/shared/services/video/video-image.service.js:211:1b2a53e5`
- column `video_tasks.result_url` (written by `video-animation.service.js`, `video-image.service.js`) ← read by `bot/shared/services/video/video-animation.service.js:164:1ddbf68a` · `bot/shared/services/video/video-image.service.js:209:aef2f5cb`
- column `video_tasks.status` (written by `video-animation.service.js`, `video-image.service.js`) ← read by `bot/shared/services/video/video-animation.service.js:164:1ddbf68a` · `bot/shared/services/video/video-image.service.js:209:aef2f5cb`
- column `video_tasks.task_id` (written by `video-animation.service.js`, `video-image.service.js`) ← read by `bot/shared/services/video/video-animation.service.js:164:1ddbf68a` · `bot/shared/services/video/video-image.service.js:209:aef2f5cb`
- column `video_tasks.video_request_id` (written by `video-animation.service.js`, `video-image.service.js`) ← read by `bot/shared/services/video/video-animation.service.js:165:07edcdd8` · `bot/shared/services/video/video-image.service.js:210:07edcdd8`
- table `video_requests` whole row (`*`) (written by `video-animation.service.js`, `video-assembly.service.js`, `video-image.service.js`, `video-orchestrator.service.js`, `video-session.service.js`) ← read by `bot/shared/services/feature-registration.service.js:153:7a0c163a`? · `dashboard/database/queries.js:741:7a0c163a`? · `dashboard/routes/portal.routes.js:8730:d2b02c3e`? · `bot/shared/services/video/video-session.service.js:145:3a0a473e`?
- table `video_requests` (written by `video-animation.service.js`, `video-assembly.service.js`, `video-image.service.js`, `video-orchestrator.service.js`, `video-session.service.js`) ← read by `bot/shared/services/context.service.js:179:31e6558b`? · `bot/shared/services/feature-registration.service.js:152:31e6558b`? · `bot/workers/sqs-worker.js:1447:31e6558b`? · `bot/workers/video-generation.worker.js:52:31e6558b`? (+8: `python3 kg/kg.py who-reads video_requests`)
- table `video_tasks` (written by `video-animation.service.js`, `video-image.service.js`) ← read by `bot/shared/services/video/video-animation.service.js:163:88091ce0`? · `bot/shared/services/video/video-image.service.js:208:88091ce0`?
- env `KIE_API_KEY` read at `bot/shared/services/video/video-animation.service.js:17:afc63570` · `bot/shared/services/video/video-image.service.js:22:afc63570`
- env `RATE_LIMIT_BYPASS_NUMBERS` read at `bot/shared/services/video/video-session.service.js:63:62b925c4`
- env `SQS_VIDEO_QUEUE_URL` read at `bot/shared/services/video/video-job-queue.service.js:36:e02ca9ed`
- env `VIDEO_DAILY_LIMIT` read at `bot/shared/services/video/video-session.service.js:60:851cd404`
- env `VIDEO_GENERATION_ENABLED` read at `bot/shared/services/video/video-orchestrator.service.js:65:be419648`
- env `VIDEO_WATERMARK_ENABLED` read at `bot/shared/services/video/video-watermark.service.js:41:00715e02`
- env `VIDEO_WATERMARK_TEXT` read at `bot/shared/services/video/video-watermark.service.js:22:494912ed`

## Tests (all, generated)
- `video-orchestrator.service.js` ← `bot/tests/lp-v8/lp-shelf-flush-points.test.js` · `bot/tests/video/issue-58-ttl-logging.test.js` · `bot/tests/video/style-selection.test.js` · `tests/conversation-state/flows-on-the-store.test.js`
- `video-script.service.js` ← `bot/tests/bug-014-video-language.test.js` · `bot/tests/video/style-selection.test.js` · `tests/student-videos/voiceover-gateway.test.js`
- `video-watermark.service.js` ← `bot/tests/video/watermark.test.js`

## Related (all, generated)
- skills: `video-generation`?
- docs: `bot/shared/services/CLAUDE.md`?
