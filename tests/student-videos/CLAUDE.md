# student-videos — Tests the Student Videos Flow endpoint, feedback and voiceover gateway

<!-- kg:meta repo=NIETE-Rumi dir=tests/student-videos kg=593106c3765b gen=b056fc9ee6ee overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `student-videos-flow.test.js` — grade, subject, video browse, delivery and feedback
- `voiceover-gateway.test.js` — narration through the TTS gateway
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/student-videos --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `student-videos-flow.test.js` | Pins the Student Videos Flow endpoint (grade, subject, video browse and delivery) and feedback capture service |
| `CLAUDE.md` | (unmapped) |
| `voiceover-gateway.test.js` | Pins video-script narration going through the TTS voice gateway (Soniox Urdu, ElevenLabs default), no raw vendor call |

## Who reads this (generated)
- (none)

## Never (human)
- Video narration must go through the TTS gateway, not a raw vendor fetch (voiceover-gateway.test.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/video/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/student-videos/CLAUDE.md`?
