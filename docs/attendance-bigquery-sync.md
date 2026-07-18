# STEPS Attendance → BigQuery Sync

Nightly export of teacher presence rollups from Rumi Supabase to the STEPS BigQuery warehouse.
Consumer: the STEPS dashboard (Annual Confidential Report / ACR pipeline).

## Pieces

| Path | What it is |
|------|-----------|
| `bot/workers/attendance-bigquery-export.worker.js` | Cron entry point. One-shot exec. |
| `bot/shared/services/attendance/bigquery-sync.service.js` | Config, row shaping, `ensureTable`, `upsertRows`. |
| `dashboard/services/attendance-repository.service.js` | Source of truth for the `computePresence` contract. |
| `scripts/bigquery-steps-attendance-ddl.sql` | Full DDL with column descriptions (for the STEPS team to review). |

## Data flow

```
Supabase (teacher_attendance_records ⋈ users ⋈ schools)
        │
        │  fetchAttendanceForDate(client, targetDate)  ─── date filter (default: yesterday PKT)
        ▼
Raw per-day rows
        │
        │  aggregatePresence(rows, targetDate)  ─── groups by teacher_id, calls computePresence()
        ▼
Presence contract rows
   { teacher_id, mobile, school_id, sector,
     period_start, period_end,
     present_days, absent_days, leave_days, working_days, presence_pct }
        │
        │  toBigQueryRow(presence, syncedAt)  ─── drops any row missing teacher_id / phone_number
        ▼
BigQuery-shaped rows
        │
        │  upsertRows(client, rows, cfg)  ─── DELETE WHERE period_end=X, then INSERT
        ▼
BigQuery table  ${BIGQUERY_STEPS_PROJECT_ID}.${BIGQUERY_STEPS_DATASET}.${BIGQUERY_STEPS_TABLE}
                (default:  <project>.steps.attendance)
```

## Grain + idempotency

- **Grain:** one BigQuery row per `(teacher_id, period_end)`. Nightly runs => one row per teacher per day.
- **Dedup key:** `(teacher_id, period_end)`. The worker DELETEs any existing rows for the target `period_end` before inserting the fresh batch, so re-running is safe.

## Schedule

- **When:** 22:00 UTC (03:00 PKT next day), inside the partner's approved 02:00–04:00 PKT maintenance window.
- **How:** Railway Cron service running `node bot/workers/attendance-bigquery-export.worker.js`.
- **Failure mode:** worker exits with code 1 and logs a structured `attendance-bigquery-export error` event; Railway restarts on failure with backoff.

## Env vars

Add these to `.env` (see `.env.template` for the copy-pasteable block):

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `GOOGLE_SERVICE_ACCOUNT_PATH` | yes | — | Absolute path to a GCP service-account JSON key file. |
| `BIGQUERY_STEPS_PROJECT_ID` | yes | — | Target GCP project (the STEPS warehouse). |
| `BIGQUERY_STEPS_DATASET` | no | `steps` | Target dataset. |
| `BIGQUERY_STEPS_TABLE` | no | `attendance` | Target table. |
| `BIGQUERY_STEPS_AUTO_CREATE_TABLE` | no | *(enabled if unset)* | Gates the `CREATE TABLE IF NOT EXISTS` backstop in `ensureTable()`. See "Table creation modes" below. |

The GCP service account needs **BigQuery Data Editor** + **BigQuery Job User** on the target project.

## Table creation modes (`BIGQUERY_STEPS_AUTO_CREATE_TABLE`)

Two modes, one flag. The service uses `BIGQUERY_STEPS_AUTO_CREATE_TABLE` to decide whether `ensureTable()` actually issues the DDL on first run:

| Flag value | `ensureTable()` behaviour | Use in |
|-----------|---------------------------|--------|
| unset, `true`, `1`, `yes` (case-insensitive) | Runs `CREATE TABLE IF NOT EXISTS` — the harmless backstop. | dev, staging, local — convenient one-shot bootstrap on a fresh warehouse. |
| `false`, `0`, `no` (case-insensitive) | Short-circuits with a `skip, table expected to pre-exist` log line, no DDL issued. | **prod** — set this explicitly. |

**Prod convention (TASK-133 review, Hasnat):**

1. Set `BIGQUERY_STEPS_AUTO_CREATE_TABLE=false` in the prod env.
2. Run `scripts/bigquery-steps-attendance-ddl.sql` by hand against the target project after eye-balling it in the PR — the authoritative table creation is the manual step, not the app.
3. `ensureTable()` still runs from the worker but short-circuits — the DDL string stays in code as a harmless backstop for any non-prod environment that first-boots without a pre-created table.

**Verifying the flag is doing what you think it is.** Grep for the log line the service emits on the skip path — it prints `BIGQUERY_STEPS_AUTO_CREATE_TABLE=false — skipping CREATE TABLE IF NOT EXISTS for {project}.{dataset}.{table}` when disabled, and `running CREATE TABLE IF NOT EXISTS backstop for …` when enabled. If neither appears in the worker log, `ensureTable()` didn't run at all.

## Contract (BigQuery schema)

See `scripts/bigquery-steps-attendance-ddl.sql` for the authoritative DDL with per-column descriptions. Summary:

| Column | Type | Notes |
|--------|------|-------|
| `teacher_phone_e164` | STRING NOT NULL | E.164 digits (no `+`), e.g. `92XXXXXXXXXX` |
| `teacher_id` | STRING NOT NULL | `users.id` UUID as string |
| `school_id` | STRING | `users.school_id` UUID; nullable |
| `sector` | STRING | `schools.region`; nullable |
| `period_start` | DATE NOT NULL | inclusive |
| `period_end` | DATE NOT NULL | inclusive; dedup key with `teacher_id` |
| `present_days` | INT64 NOT NULL | distinct dates status=`present` |
| `absent_days` | INT64 NOT NULL | distinct dates status=`absent` |
| `leave_days` | INT64 NOT NULL | distinct dates status=`leave` |
| `working_days` | INT64 NOT NULL | present + absent + leave |
| `presence_pct` | FLOAT64 NOT NULL | `round(present / working * 100, 1dp)`; 0 when `working_days=0` |
| `synced_at` | TIMESTAMP NOT NULL | write-time UTC |

Partitioned by `period_end`, clustered by `sector, teacher_id`.

## Running it

### Dry-run (safe, no BigQuery write)

```
GOOGLE_SERVICE_ACCOUNT_PATH=/path/to/sa.json \
BIGQUERY_STEPS_PROJECT_ID=my-warehouse-project \
node bot/workers/attendance-bigquery-export.worker.js --dry-run
```

Expected output: pull count from Supabase, aggregation count, "DRY RUN — payload preview (first 5 rows)" with JSON, then "Would write N rows total, skipping actual BigQuery call."

**In dry-run mode the env vars are only used if the actual write step runs — you can dry-run without any BigQuery credentials at all, and the worker will only complain if you drop `--dry-run`.**

### Targeting a specific date

```
node bot/workers/attendance-bigquery-export.worker.js --dry-run --date=2026-07-16
```

Default is "yesterday in Asia/Karachi." Pass `--date=YYYY-MM-DD` to override (useful for backfills).

### Real run (WRITES to BigQuery)

```
npm run start:bigquery-export
```

or directly:

```
node bot/workers/attendance-bigquery-export.worker.js
```

## Ops runbook

**"The worker ran but no rows landed in BigQuery"**
1. Check the worker exit log — if it says `No rows to write — exiting successfully`, there were no `teacher_attendance_records` rows for the target date. Confirm with:
   ```
   SELECT COUNT(*) FROM teacher_attendance_records WHERE date = 'YYYY-MM-DD';
   ```
2. If Supabase has rows but BigQuery is empty, check the log for `attendance-bigquery-export error` events — likely an auth issue (SA missing perms) or a schema mismatch (streaming-buffer INSERT rejection).

**"Rows are landing in BigQuery but presence_pct looks wrong"**
- Compare against the source: `dashboard/services/attendance-repository.service.js :: getPresence({ teacher_id, start_date, end_date })` — both codepaths call the same `computePresence` helper, so any mismatch is either a data problem (Supabase records changed between the two reads) or a bug in `aggregatePresence` (grouping/window).

**"BigQuery DELETE fails with `UPDATE or DELETE statement over table … would affect rows in the streaming buffer`"**
- The previous run's INSERT is still in the streaming buffer (window: minutes). Wait 30 min and re-run, or switch to load-job mode (not implemented in Round 2).

**"How do I backfill a range?"**
- Loop `--date=YYYY-MM-DD` day-by-day:
  ```
  for d in 2026-07-10 2026-07-11 2026-07-12; do
    node bot/workers/attendance-bigquery-export.worker.js --date=$d
  done
  ```
- Each day is idempotent via the DELETE-then-INSERT pattern.

## Tests

- `tests/attendance/bigquery-sync.test.js` — service-level unit tests (config, row shaping, upsert).
- `tests/attendance/bigquery-export-worker.test.js` — worker-level unit tests (arg parsing, timezone math, aggregation).

Run with:
```
npm test -- --testPathPattern=attendance/bigquery
```

Both suites mock BigQuery + Supabase — no external calls.

## What Round 2 does NOT do

- No streaming updates — nightly batch only.
- No historical backfill on first run — bootstrap must be done manually via the `--date` loop above.
- No schema evolution — additive-only. If STEPS asks for new columns, add them to the DDL + `toBigQueryRow` + tests in one PR.
- No cross-region export — this worker exports the local deployment's `teacher_attendance_records` only.
