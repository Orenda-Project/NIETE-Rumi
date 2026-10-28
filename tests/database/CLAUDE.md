# database — DB-layer contracts: record_history audit, actor ledger, soft delete, SQL migrations
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/database kg=f7d7513ebb7c gen=a5f9861bd31d overflow=5 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `bd-a21ks-actor-ledger.test.js` — flows run as the real actor, not 'authenticator'
- `v1-6-15-fln.test.js` — pattern for SQL-text migration contract tests (no database)
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/database --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `bd*` | 6 files; most used `bd-a21ks-actor-ledger.test.js`: bd-a21ks: flows wrapped in runAsActor so record_history names the real user, not the 'authenticator' role |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `conversation-language-telemetry.test.js` | bot-helpers conversation writer records output_language (resolved default or explicit) on assistant rows |
| `get-or-create-user-last-message.test.js` | bd-1877: getOrCreateUser stamps users.last_message_at on every inbound, update or insert (24h window check) |
| … | 5 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `bd-rbtpr-ledger-gaps.test.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+171)
- column `users.name` (written by `bd-rbtpr-ledger-gaps.test.js`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/calls/call-tools.repo.js:242:774e00e5` (+62)
- table `users` whole row (`*`) (written by `bd-rbtpr-ledger-gaps.test.js`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687`? · `dashboard/test-rls-with-supabase-client.js:51:77bc023b`?
- env read here: `R2_BUCKET_NAME`

## Never (human)
- A history trigger must watch columns that exist; a missing one records nothing silently (tests/database/record-history-users-trigger.test.js:7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/roster/CLAUDE.index.md`? · `bot/shared/services/roster/CLAUDE.md`? · `bot/shared/services/schools/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `scripts/CLAUDE.index.md`? (+4)
