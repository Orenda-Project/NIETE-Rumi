# render — Prototype LP renderers and Gamma-grounded LP smoke tests

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/render kg=f477bf3e335a gen=2e9167590f6a overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `render-v7-lp.js` — v7-style 6-slide PDF
- `smoke-gamma-grounded-async.js` — async path end to end
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `render-one-lp.js` | Renders one curriculum_lp_ast lesson plan to a simple PDF with Nano Banana Pro illustrations (Path A prototype) |
| `render-v7-lp.js` | Renders one lesson plan as a v7-style 6-slide PDF using LLM enrichment and parallel Nano Banana Pro slides |
| `smoke-gamma-grounded-async.js` | E2E smoke of the async Gamma-grounded LP path: handler queues a job, worker renders, uploads to R2, sends the PDF |
| `smoke-gamma-grounded.js` | E2E smoke of the Gamma-grounded LP handler path with sendDocument stubbed, against real Supabase, Gamma and R2 |

## Who reads this (generated)
- table `users` (written by `smoke-gamma-grounded-async.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+172)
- column `users.phone_number` (written by `smoke-gamma-grounded-async.js`) ← read by `bot/shared/calls/call-context.repo.js:37:2b4c151c` · `bot/shared/database/queries.js:106:fef21f32` (+89)
- column `users.name` (written by `smoke-gamma-grounded-async.js`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/calls/call-tools.repo.js:242:774e00e5` (+62)
- table `users` whole row (`*`) (written by `smoke-gamma-grounded-async.js`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687` · `dashboard/test-rls-with-supabase-client.js:51:77bc023b`?
- env read here: `KIE_API_KEY` · `NIETE_ENV_PATH` · `OPENROUTER_API_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.md`?
