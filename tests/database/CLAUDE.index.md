# database — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/database -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `bd-2533-school-migration.test.js` | bd-2533/2534: fde_production to NIETE school and principal migration transforms, with name canonicalisation drift cases |
| `bd-2533-school-resolver.test.js` | bd-2533: resolveUserSchool reads the school via users.school_id FK and falls back to legacy school_name text |
| `bd-60014-row-history-audit.test.js` | bd-60014: record_history trigger allowlist records status transitions but not counter churn |
| `bd-60020-roster-history.test.js` | bd-60020: record_history covers roster and config tables (schools, class_teachers) keyed by real columns |
| `bd-a21ks-actor-ledger.test.js` | bd-a21ks: flows wrapped in runAsActor so record_history names the real user, not the 'authenticator' role |
| `bd-rbtpr-ledger-gaps.test.js` | bd-rbtpr: /class and "edit class" run their writes as the flow-token user so history rows carry the actor |
| `conversation-language-telemetry.test.js` | bot-helpers conversation writer records output_language (resolved default or explicit) on assistant rows |
| `get-or-create-user-last-message.test.js` | bd-1877: getOrCreateUser stamps users.last_message_at on every inbound, update or insert (24h window check) |
| `r2-key-extraction.test.js` | storage/r2 extractKeyFromUrl handles path-style and virtual-hosted presigned URLs |
| `r2-public-media-fallback.test.js` | storage/r2 downloadMedia tries own bucket first, then the public r2.dev alias (curriculum video quiz audio) |
| `record-history-users-trigger.test.js` | The users record_history trigger names only columns that users still has (e.g. teacher_level) |
| `soft-delete.test.js` | soft-delete util: softDeletePatch stamps the three tombstone columns and requires a reason |
| `v1-6-15-fln.test.js` | SQL-text contract for migration V1.6.15: niete_lp_opens plan_kind admits fln; niete_fln_events; idempotent, rollback |
| `v1-6-16-coach-visit-opened.test.js` | SQL-text contract for V1.6.16: coach_visit_requests.opened_at column (bd-tbprit.7), re-runnable with rollback |
| `v1-7-6-assessment-request-origin.test.js` | SQL-text contract for V1.7.6: assessment_requests.origin column (bd-pw1ccr.1), re-runnable with rollback |

## Who reads this (all, generated)
- column `users.name` (written by `bd-rbtpr-ledger-gaps.test.js`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/calls/call-tools.repo.js:242:774e00e5` · `bot/shared/database/queries.js:106:fef21f32` · `bot/shared/handlers/flow-response.handler.js:543:e1438837` (+60: `python3 kg/kg.py who-reads users.name`)
- table `users` whole row (`*`) (written by `bd-rbtpr-ledger-gaps.test.js`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687`? · `dashboard/test-rls-with-supabase-client.js:51:77bc023b`?
- table `users` (written by `bd-rbtpr-ledger-gaps.test.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? · `bot/shared/calls/call-tools.repo.js:242:774e00e5`? · `bot/shared/database/bot-helpers.js:17:61dfd735`? (+169: `python3 kg/kg.py who-reads users`)
- env `R2_BUCKET_NAME` read at `tests/database/r2-key-extraction.test.js:12:7b5096b8` · `tests/database/r2-public-media-fallback.test.js:22:b112cf26`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/roster/CLAUDE.index.md`? · `bot/shared/services/roster/CLAUDE.md`? · `bot/shared/services/schools/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `scripts/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/database/CLAUDE.index.md`? · `tests/database/CLAUDE.md`?
