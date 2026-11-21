# A/B tracker store (Postgres, `ab_` tables)

**Main only (operator ruling R8, 20 Nov 2026): these tables live in the NIETE main database and nowhere else; never
apply V1.10.7 on a test site.** The Sandbox copy was rolled back on 21 Nov.

The workspace's A/B tracker keeps its numbers in this database, in five small tables of its own (migration V1.10.7).
One job a night on the bot's worker reads the app's rows on the **read replica only** and writes those tables only.
(The test sites, staging and sandbox, have no paid read copy, so there the job reads their own database;
`bot/shared/config/supabase-replica-only.js` allows that only for those two Railway environment names.)

## Tables (all `public`, RLS on with no policy: service_role only; unit ids only, never a name or phone)

| Table | One row per | Written by |
|---|---|---|
| `ab_card_lock` | launched test: frozen card hash, `unit_kind` (school/teacher), `metric_ids`, `start_on`, `read_on`, `ended_at` | the launch step (a reviewed SQL insert; production needs a go) |
| `ab_assignment` | unit of a test: `arm`, `block` (hash split or seeded draw, written at launch) | the launch step |
| `ab_refresh_log` | nightly run: status, counts, timings (`detail`) | the job |
| `ab_rollup_unit_period` | test × unit × measure × day/week: `n`, `s`, `ss` | the job |
| `ab_stop_state` | test × stop rule: tripped / reviewed / clear | the workspace stop check |

No foreign key, trigger or write reaches an app table. After a launch inserts assignment rows, run
`ANALYZE ab_assignment;` (once, with cold statistics, the local reads ran about 70 times slower; see the load budget).

## The job (`bot/shared/services/ab-tracker/ab-tracker-rollup.service.js`, ticked hourly by `bot/workers/ab-tracker-schedule.js`)

- **Switch:** `app_settings` `ab_tracker_rollup_enabled` = `{"at":"HH:MM"}` (Pakistan time; window 90 minutes, must end by
  midnight) or `true` (03:00). No row, a malformed value or a failed read = off. Read on the replica.
- **Order:** `rpc('db_is_replica')` first, before any other read, else refused; the switch; one worker per tick (Redis
  claim) and once per Pakistan date (marker `ab_tracker:v1:run:<date>`, 36 h).
- **Reads (replica, 30 s each, one at a time, 0.5 s apart):** `ab_tracker_live_tests()`, then per test and database
  measure `ab_tracker_metric_rows(test, measure, from, to)`: daily measures from 4 days back (or the start) to
  yesterday, weekly ones from that Monday. Measures: `plan_fidelity` (day), `teachers_coming_back` (week), `send_failures` (day),
  `child_quiz_objectives_secured` (day, child level). Any other measure is skipped and counted.
- **Writes (primary, 15 s each, one at a time):** `ab_tracker_refresh_open`, `ab_tracker_upsert_rollup` (≤ 1,000 rows a
  call; the function refuses > 2,000), `ab_tracker_refresh_close`. A failed read → `partial`, no marker; the next tick
  inside the window runs again.
- **Logs:** `ab_tracker.rollup.<ran|partial>` with counts and timings, a correlation id, never a unit id.

## Switching off

Delete the `ab_tracker_rollup_enabled` row (the next tick is off). To remove everything: the rollback file drops the
five tables and six functions and nothing else.
