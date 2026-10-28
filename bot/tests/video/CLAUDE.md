# video — Legacy tests for the AI video generation flow (style, language, PDF, R2)

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/video kg=47e56f05e360 gen=24a4644c3b50 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `style-selection.test.js` — video style carousel keys and prefixes
- `r2-persistence.test.js` — uploadVideoAsset path structure
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `style-selection.test.js` | Tests video style selection: STYLE_PREFIXES keys and photorealistic prefix keywords (Issue #35) |
| `issue-58-ttl-logging.test.js` | Legacy video: Redis TTL extended to 15 minutes for video topic/language state and button payload logging (Issue #58) |
| `watermark.test.js` | Tests the video watermark service addWatermark function (Issue #39) |
| `CLAUDE.md` | (unmapped) |
| `design-quality.test.js` | Legacy video: design principles (palette, professional look, creative layouts) present in slide GPT prompt (Issue #6) |
| `language-selection.test.js` | Legacy video test: language options and WhatsApp interactive list structure for video language selection (Issue #4) |
| `layout-consistency.test.js` | Legacy video test: END frames generated image-to-image from the START frame via image_input (Issue #2) |
| `parallel-workers.test.js` | Tests parallel worker identification via RAILWAY_REPLICA_ID, falling back to 'local' (Issue #43 Phase 2) |
| `pdf-delivery.test.js` | Legacy video test: slide PDF generated with PDFKit, not ImageMagick convert (Issue #3) |
| `r2-persistence.test.js` | Legacy video test: uploadVideoAsset R2 path structure for audio, PNG and JPG assets (Issue #1) |
| `video-parallelization.test.js` | Legacy video test: slides generate in parallel while image generation stays sequential (Issue #5) |

## Who reads this (generated)
- env read here: `RAILWAY_REPLICA_ID` · `SQS_VIDEO_QUEUE_URL` · `VIDEO_WATERMARK_ENABLED`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/video/CLAUDE.index.md`? · `bot/shared/services/video/CLAUDE.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? · `bot/tests/video/CLAUDE.md`?
