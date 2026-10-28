# video — Student video pipeline: script, images, animation, assembly, watermark, queue
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/video kg=fe3362e2e4ba gen=c563807a327c overflow=30 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `video-orchestrator.service.js` — public API and rate limiting
- `video-assembly.service.js` — FFmpeg assembly and delivery
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `video*` | 8 files; most used `video-orchestrator.service.js`: Public API for video generation: user interaction, rate limiting and coordinating the flow |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- table `video_requests` (written by `video-animation.service.js` (+4)) ← read by `bot/shared/services/context.service.js:179:31e6558b`? · `bot/shared/services/feature-registration.service.js:152:31e6558b`? (+10)
- column `video_requests.status` (written by `video-assembly.service.js` (+1)) ← read by `bot/shared/services/context.service.js:184:a69ef692` · `bot/shared/services/feature-registration.service.js:155:abb6a119` (+4)
- column `video_requests.user_id` (written by `video-orchestrator.service.js`) ← read by `bot/shared/services/context.service.js:183:219f5683` · `bot/shared/services/feature-registration.service.js:154:219f5683` (+3)
- `video-orchestrator.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:37:f0074ff4` · `bot/shared/handlers/voice-message.handler.js:17:f0074ff4` (+2)
- … 25 more → `CLAUDE.index.md`

## Never (human)
- Watermark failure must never fail delivery (`bot/shared/services/video/video-watermark.service.js:7`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/video/style-selection.test.js` (video-orchestrator.service.js, video-script.service.js)
- `bot/tests/bug-014-video-language.test.js` (video-script.service.js)
- … 5 more → `CLAUDE.index.md`

## Related (generated)
- skills: `video-generation`?
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/video/CLAUDE.index.md`? · `bot/shared/services/video/CLAUDE.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? (+2)
