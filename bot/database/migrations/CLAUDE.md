# migrations — Hand-applied SQL migrations (no runner); newer ones carry a *_rollback.sql file
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/database/migrations kg=540c802e6833 gen=da2a00cee9c4 overflow=457 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `web_quiz_challenge_registry.sql` — shows the requires/NON-DESTRUCTIVE/rollback convention
- `roster_import_students.sql` — one-transaction RPC written after the 460-duplicate roster incident
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `016_curriculum_lp_ast.sql` | Creates curriculum_lp_ast, structured lesson-plan content imported from the Taleemabad core DB, with lookup/FTS indexes |
| `create*` | 4 files; most used `create_video_quiz_tables.sql`: Ports the main bot's video-quiz schema to NIETE: quiz_questions changes, share codes, invites, identity (bd-2482) |
| `web_quiz_challenge_registry.sql` | Creates the five Challenge registry tables: passages, items, periods, equating links and draws |
| … | 91 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `002_add_registration_fields.sql` (+4)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+171)
- column `coaching_sessions.id` (written by `003_classroom_coaching.sql`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/handlers/text-message.handler.js:1981:21597576` (+73)
- … 366 more → `CLAUDE.index.md`

## Never (human)
- Seed files are generated; edit the script, not the SQL (web_quiz_challenge_registry_seed.sql:2-3 'do not edit by hand')
- Run add-schools-emis-and-role-not-null.sql STEP 4 only after migrate-schools.py --commit (line 74)
- Roster RPC bodies stay byte-identical to roster_apply_edits.sql plus one actor line (roster_rpc_actor.sql:3-6)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/database/CLAUDE.index.md`? · `bot/database/CLAUDE.md`? · `bot/database/migrations/CLAUDE.index.md`? · `bot/database/migrations/CLAUDE.md`? · `docs/features/CLAUDE.index.md`? · `docs/features/CLAUDE.md`? (+7)
