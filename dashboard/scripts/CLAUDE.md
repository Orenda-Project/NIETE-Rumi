# scripts — One-off ops scripts: transcript backfill, SQS setup, font builds, Urdu fit walk
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/scripts kg=790fb844bb01 gen=8d62446b08c7 overflow=2 rendered=2026-10-28 kg.py=1.0.0 -->

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
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `backfill-processed-transcripts.js` | CLI that pre-processes coaching transcripts with GPT-4o-mini and stores results so transcript pages load instantly. |
| `check-progress.sh` | Ad-hoc shell monitor of re-transcription tracks by tailing /tmp logs for four sessions; one-off. |
| `link-railway.sh` | Helper that runs `railway link` for the dashboard project (prompts for workspace, project, environment). |
| … | 2 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `backfill-processed-transcripts.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? (+87)
- column `coaching_sessions.analysis_data` (written by `backfill-processed-transcripts.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:53:c286009d` (+34)
- table `coaching_sessions` whole row (`*`) (written by `backfill-processed-transcripts.js`) ← read by `bot/shared/handlers/text-message.handler.js:1921:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? (+7)
- env read here: `OPENAI_API_KEY` · `PWCHROME_EXE` · `PWCORE` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL`

## Never (human)
- Never hand-edit generated record.json; rebuild (`face-lite/record.json:2`)
- Never change landing strings without rebuilding the font; its guard test goes red (`landing-urdu-face/build.py:6`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/CLAUDE.index.md`? · `dashboard/CLAUDE.md`? · `dashboard/scripts/CLAUDE.index.md`? · `dashboard/scripts/CLAUDE.md`?
