# migrations — Hand-applied SQL migrations (no runner); newer ones carry a *_rollback.sql file
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/database/migrations kg=a83604897631 gen=a6dc4621783b overflow=455 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `web_quiz_challenge_registry.sql` — shows the requires/NON-DESTRUCTIVE/rollback convention
- `roster_import_students.sql` — one-transaction RPC written after the 460-duplicate roster incident
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `016_curriculum_lp_ast.sql` | Creates curriculum_lp_ast, structured lesson-plan content imported from the Taleemabad core DB, with lookup/FTS indexes |
| `create*` | 4 files; most used `create_video_quiz_tables.sql`: Ports the main bot's video-quiz schema to NIETE: quiz_questions changes, share codes, invites, identity (bd-2482) |
| `web_quiz_challenge_registry.sql` | Creates the five Challenge registry tables: passages, items, periods, equating links and draws |
| `002_add_registration_fields.sql` | Adds teacher-onboarding columns to users (registration fields, v3.2.0) |
| … | 132 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `002_add_registration_fields.sql` (+4)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+171)
- column `coaching_sessions.id` (written by `003_classroom_coaching.sql`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/handlers/text-message.handler.js:1981:21597576` (+73)
- column `users.preferred_language` (written by `add_preferred_language_to_users.sql`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/handlers/flow-response.handler.js:761:6d7fc8d6` (+73)
- … 365 more → `CLAUDE.index.md`

## Never (human)
- Seed files are generated; edit the script, not the SQL (web_quiz_challenge_registry_seed.sql:2-3 'do not edit by hand')
- Run add-schools-emis-and-role-not-null.sql STEP 4 only after migrate-schools.py --commit (line 74)
- Roster RPC bodies stay byte-identical to roster_apply_edits.sql plus one actor line (roster_rpc_actor.sql:3-6)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/database/CLAUDE.md`? · `docs/features/video-quiz.md`? · `docs/migration/01-lesson-plans.md`? · `tests/BASELINE.md`?
