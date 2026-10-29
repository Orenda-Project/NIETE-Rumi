# scripts — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/scripts -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `deployment/` | → (no door; 2 files) |
| `face-lite/` | → (no door; 2 files) |
| `landing-urdu-face/` | → (no door; 2 files) |
| `backfill-processed-transcripts.js` | CLI that pre-processes coaching transcripts with GPT-4o-mini and stores results so transcript pages load instantly. |
| `check-progress.sh` | Ad-hoc shell monitor of re-transcription tracks by tailing /tmp logs for four sessions; one-off. |
| `link-railway.sh` | Helper that runs `railway link` for the dashboard project (prompts for workspace, project, environment). |
| `sa-clips-lock.js` | Rewrites dashboard/sa/clips.lock.json after a SESSION bump; refuses while a locked file changed under the same SESSION |
| `sa-ur-fit-walk.js` | Playwright walk over every self-administered battery screen reporting Urdu text that overflows or collides. |
| `verify-funnel-tables.js` | Quick check that website_visits, cta_clicks, chat_starts tables exist and count rows via the Supabase client. |

## Who reads this (all, generated)
- column `coaching_sessions.analysis_data` (written by `backfill-processed-transcripts.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:53:c286009d` · `bot/shared/routes/observe2-check-endpoint.js:297:ed6f6cd9` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:285:4fa90499` (+32: `python3 kg/kg.py who-reads coaching_sessions.analysis_data`)
- table `coaching_sessions` whole row (`*`) (written by `backfill-processed-transcripts.js`) ← read by `bot/shared/handlers/text-message.handler.js:1921:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? · `bot/shared/routes/observe-mewaka-endpoint.js:152:d2b02c3e`? · `bot/shared/services/coaching-orchestrator.service.js:225:d2b02c3e`? (+5: `python3 kg/kg.py who-reads coaching_sessions`)
- table `coaching_sessions` (written by `backfill-processed-transcripts.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+85: `python3 kg/kg.py who-reads coaching_sessions`)
- env `OPENAI_API_KEY` read at `dashboard/scripts/backfill-processed-transcripts.js:192:f1ad06eb`
- env `PWCHROME_EXE` read at `dashboard/scripts/sa-ur-fit-walk.js:27:66874803`
- env `PWCORE` read at `dashboard/scripts/sa-ur-fit-walk.js:26:4da64dcc`
- env `SUPABASE_SERVICE_ROLE_KEY` read at `dashboard/scripts/backfill-processed-transcripts.js:22:90118d4a`
- env `SUPABASE_URL` read at `dashboard/scripts/backfill-processed-transcripts.js:21:e84bc099`

## Tests (all, generated)
- `sa-clips-lock.js` ← `dashboard/tests/sa-clips-lock.service.test.js`

## Related (all, generated)
- docs: `dashboard/CLAUDE.md`?
