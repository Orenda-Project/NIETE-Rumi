# A/B tracker store (Postgres, `ab_` tables)

**Main only (operator ruling R8, 20 Nov 2026): these tables live in the NIETE main database and nowhere else; never
apply V1.10.7 on a test site.** The Sandbox copy was rolled back on 21 Nov.

The workspace's A/B tracker keeps its numbers in this database, in five small tables of its own (migration V1.10.7).
One job a night, on its own Railway cron service, reads the app's rows on the **read replica only** and writes those tables only.
(The test sites, staging and sandbox, have no paid read copy, so there the job reads their own database;
`bot/shared/config/supabase-replica-only.js` allows that only for those two Railway environment names.)

## Tables (all `public`, RLS on with no policy: service_role only; unit ids only, never a name or phone)

| Table | One row per | Written by |
|---|---|---|
| `ab_card_lock` | test, from the moment its card is frozen: frozen card hash, `unit_kind` (school/teacher), `metric_ids`, `start_on`, `read_on`, `ended_at`; **the ledger** (V1.10.12): `description`, `status` planned → running → concluded, `default_arm`, `winner`, `switch_key`, `owner`, `feature`, `arm_a`, `arm_b`, `launch_date`, `planned_n`, `current_n`, `call`, `called_at` | the workspace's `card.py freeze` (`ab_ledger_upsert`, planned), `decide.py` (`ab_ledger_call`, once), the cron (`ab_ledger_advance`); the two pre-ledger ICT tests by `infrastructure/scripts/ab-ledger-backfill.sql` (production needs a go) |
| `ab_assignment` | unit of a test: `arm`, `block` (hash split or seeded draw, written at launch) | the launch step |
| `ab_refresh_log` | nightly run: status, counts, timings (`detail`) | the job |
| `ab_rollup_unit_period` | test × unit × measure × day/week: `n`, `s`, `ss` | the job |
| `ab_stop_state` | test × stop rule: tripped / reviewed / clear | the workspace stop check |

No foreign key, trigger or write reaches an app table. After a launch inserts assignment rows, run
`ANALYZE ab_assignment;` (once, with cold statistics, the local reads ran about 70 times slower; see the load budget).

## The job (`bot/shared/services/ab-tracker/ab-tracker-rollup.service.js`)

- **Where it runs (operator, 23 Nov 2026):** its own Railway project, like RDF: **Impact - A/B Tracker**
  (`bba06868-b76a-4ff5-8d96-b41fd522b427`), service `ab-tracker-cron`, built from this repo with config
  `railway.ab-tracker-cron.json`. Railway starts `bot/scripts/ab-tracker-cron.js` every 15 minutes (`*/15 * * * *`);
  each start runs one tick, closes Redis and exits. Exit 1 (run shows red) on refused, partial, error, or no Redis.
- **Build (bd-3kshar.6.5.3):** the config installs `bot/` (`npm ci --prefix bot --omit=dev`); the root install has no
  `pino`, so the first deploys died on MODULE_NOT_FOUND. Node 22 is the service variable `RAILPACK_NODE_VERSION=22`
  (Supabase realtime needs native WebSocket; Node 18 threw) and the variable `RAILWAY_CONFIG_FILE` names this config;
  neither can live in the config file, so a recreated service needs both set again.
- **Cadence (operator, 23 Nov 2026):** a refresh every 15 minutes in school hours, every 2 hours outside them
  (`ab-tracker-cadence.js`). School hours are the quiz scheduler's rule: Mon–Sat 08:00–16:00 Pakistan time, Friday
  until 12:00, Sunday off. A slot is `YYYY-MM-DDTHH:MM` (Pakistan), floored to 15 minutes or to the even hour; the
  rollup runs once per slot. Off-hours cron starts inside an already-run 2-hour slot end at `done_already` (one Redis
  read, no database read). Load: this is far more replica reads than the one nightly run `TEAM/load_budget.md`
  measured, including in school hours; the budget should be re-measured on the first school day it runs.
- **Env the service needs:** `NIETE_SUPABASE_REPLICA_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`
  (the project's own Redis; the bot's has no public URL). Its Railway environment is `production`, so the replica rule holds.
- The cron is the only caller. The bot worker's older hourly tick was retired (bd-3kshar.6.5.1, 23 Nov 2026).

- **Switch:** `app_settings` `ab_tracker_rollup_enabled` = `true` (or a well-formed `{"at":"HH:MM"}`, the older value,
  still read as on; its time is no longer used). No row, a malformed value or a failed read = off. Read on the replica.
- **Order:** `rpc('db_is_replica')` first, before any other read, else refused; the switch; one caller per tick (Redis
  claim, 840 s) and once per slot (marker `ab_tracker:v1:run:<slot>`, 36 h).
- **Reads (replica, sent as GET because the replica refuses POST rpc calls; 30 s each, one at a time, 0.5 s apart):** `ab_tracker_live_tests()`, then per test and database
  measure `ab_tracker_metric_rows(test, measure, from, to)`: daily measures from 4 days back (or the start) to
  **today** (today's numbers are provisional; the next slot overwrites them), weekly ones from that Monday. The
  refresh watermark stays yesterday (the last complete day). On a Pakistan Monday and on the test's read day the first
  complete run re-reads from the start instead (weekly: its Monday), in 7-day slices, so rows that landed late are
  counted; it then sets `ab_tracker:v1:full:<date>` and later slots that date use the short window. The upsert
  overwrites, never double-counts. Measures: `plan_fidelity` (day), `teachers_coming_back` (week), `send_failures` (day),
  `child_quiz_objectives_secured` (day, child level). Any other measure is skipped and counted.
- **Writes (primary, 15 s each, one at a time):** `ab_tracker_refresh_open`, `ab_tracker_upsert_rollup` (≤ 1,000 rows a
  call; the function refuses > 2,000), `ab_tracker_refresh_close`. A failed read → `partial`, no marker; the next tick
  runs the slot again (and a full re-read stays owed).
- **Ledger (V1.10.12, bd-9nb6s0.2):** after a run that ended `ran`, the cron calls `ab_ledger_advance()` once on the
  primary: it counts each test's units (`current_n`), moves `planned` → `running` at the first unit and `running` →
  `concluded` once a call is written. It never changes the exit code; a database without V1.10.12 logs
  `not_installed`. `ab_ledger_past_tests(feature, metric)` is what `find.py` reads before a new test.
- **Logs:** `ab_tracker.rollup.<ran|partial>` with counts and timings, a correlation id, never a unit id.

## Switching off

Delete the `ab_tracker_rollup_enabled` row (the next tick is off). To remove everything: the rollback file drops the
five tables and six functions and nothing else.
