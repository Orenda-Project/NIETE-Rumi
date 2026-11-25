# scripts — One-off ops scripts: transcript backfill, SQS setup, font builds, Urdu fit walk
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/scripts kg=eefda04f0c71 gen=95e820a83a37 overflow=6 rendered=2026-11-25 kg.py=1.1.0 -->

## Entry points
- `face-lite/build.py` — builds the light Urdu font and record.json
- `landing-urdu-face/build.py` — builds the landing Urdu font subset
- `backfill-processed-transcripts.js` — pre-process transcripts
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `deployment/` | → (no door; 2 files) |
| `face-lite/` | → (no door; 2 files) |
| `landing-urdu-face/` | → (no door; 2 files) |
| `naskh-letters/` | → (no door; 2 files) |
| `sa*` | 3 files; most used `sa-clips-lock.js`: Rewrites dashboard/sa/clips.lock.json after a SESSION bump; refuses while a locked file changed under the same SESSION |
| `backfill-processed-transcripts.js` | CLI that pre-processes coaching transcripts with GPT-4o-mini and stores results so transcript pages load instantly. |
| … | 5 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `backfill-processed-transcripts.js`) ← read by `bot/scripts/fico17-v6-replay.js:87:0a1853f5`? · `bot/scripts/quiz/backfill-quiz-lesson-links.js:76:0b673d4d`? (+102)
- column `coaching_sessions.analysis_data` (written by `backfill-processed-transcripts.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:58:c286009d` (+37)
- table `coaching_sessions` whole row (`*`) (written by `backfill-processed-transcripts.js`) ← read by `bot/shared/handlers/text-message.handler.js:1983:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:770:d2b02c3e`? (+7)
- … 5 more → `CLAUDE.index.md`

## Never (human)
- Never hand-edit generated record.json; rebuild (`face-lite/record.json:2`)
- Never change landing strings without rebuilding the font; its guard test goes red (`landing-urdu-face/build.py:6`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `dashboard/tests/sa-r28-timings-index.service.test.js` (sa-clips-lock.js, sa-timings-index.js)
- `dashboard/tests/sa-clips-lock.service.test.js` (sa-clips-lock.js)
- … 2 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/CLAUDE.md`?
