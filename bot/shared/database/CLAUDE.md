# database — Supabase helpers for users and sessions, dashboard queries, original schema
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/database kg=2423e89b3d8f gen=e19417e9da59 overflow=44 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `bot-helpers.js` — getOrCreateUser, sessions, conversations
- `queries.js` — dashboard analytics queries
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__mocks__/` | → (no door; 1 files: 0 test + 1 support) |
| `bot-helpers.js` | User and session helpers: getOrCreateUser (race-safe on 23505), sessions, conversation rows used by all handlers |
| `queries.js` | Analytics queries (users, voice notes, messages, activity) backing the legacy admin dashboard |
| `schema.sql` | Original v3.0 Rumi bot Postgres schema (Nov 2025: users, conversations, sessions); historical baseline only |

## Who reads this (generated)
- table `users` (written by `bot-helpers.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+170)
- column `users.id` (written by `schema.sql`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632` · `bot/shared/calls/call-context.repo.js:36:6776a642` (+157)
- column `users.phone_number` (written by `bot-helpers.js` (+1)) ← read by `bot/shared/calls/call-context.repo.js:37:2b4c151c` · `bot/shared/routes/homework-request-endpoint.js:51:0b64c13f` (+89)
- column `users.name` (written by `schema.sql`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/calls/call-tools.repo.js:242:774e00e5` (+62)
- table `lesson_plans` (written by `bot-helpers.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:158:611f2601`? · `bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js:158:611f2601`? (+14)
- … 36 more → `CLAUDE.index.md`

## Never (human)
- schema.sql is the Nov 2025 baseline only; live schema comes from supabase/migrations
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/first-touch/first-reply-english.text-turn.test.js` (bot-helpers.js)
- `bot/tests/first-touch/one-door-share-ref.test.js` (bot-helpers.js)
- … 8 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/CLAUDE.md`? · `docs/data-standards.md`?
