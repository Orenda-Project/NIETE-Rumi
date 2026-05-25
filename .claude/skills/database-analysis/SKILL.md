---
name: database-analysis
description: Query the bot's Postgres database with a read-only role. Use when analysing user metrics, debugging DB state, or exploring the schema. Column names: phone_number (not phone), first_name (not name) in the users table.
---

# Database Analysis Skill

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [coaching](../coaching/SKILL.md), [debugging](../debugging/SKILL.md), [registration](../registration/SKILL.md)

The bot runs on Postgres (via Supabase by default). For analysis, connect with a **read-only** role — never
the service role — so an exploratory query can't mutate production data.

## Critical rules

1. **Filter test users**: `WHERE COALESCE(is_test_user, false) = false`.
2. **Column names in `users`**: `phone_number` (NOT `phone`), `first_name` (NOT `name`).
3. **JOIN via UUID**: always join on `users.id` (UUID), never on phone number.
4. **Read-only**: a read-only role returns "permission denied" on INSERT/UPDATE/DELETE — by design.
5. **LIMIT first**: start with `LIMIT 100` before a full scan.
6. **Schema-first when proposing changes (anti-sprawl)**: this schema is large and growing. Before proposing a new table/column, query the **live** schema (`information_schema.columns`, `pg_indexes`), and prove the change is minimal — can an existing table/column hold it (`app_settings` for config, `feature_suggestions` for nudge funnels), or can the value be **computed** by a query or materialized view? A new table/column is the last resort. (See root [CLAUDE.md](../../../CLAUDE.md).)

## Connection

Use a read-only connection string from the environment — never inline credentials.

```bash
psql "$ANALYST_DATABASE_URL"      # a read-only role; falls back to $DATABASE_URL if you only have one role
```

Prefer the **transaction pooler** (Supabase port 6543) for ad-hoc analysis — the session pooler (5432)
holds a slot per connection and exhausts under multiple idle analysts. Use 5432 only when you need
session-scoped state (prepared statements, temp tables, `SET`, `LISTEN`). For GUI clients set
SSL = `require` (the pooler uses a self-signed cert; `verify-full` will fail). Close idle transactions
promptly — a leaked `BEGIN` that idles pins the vacuum horizon and bloats tables.

## Schema

The canonical schema is a single file — read it rather than trusting a copy that can drift:
[infrastructure/supabase/00_complete-schema.sql](../../../infrastructure/supabase/00_complete-schema.sql)
(overview + how to bootstrap it: [infrastructure/CLAUDE.md](../../../infrastructure/CLAUDE.md)).

Core tables you'll touch most:

```
users:              id (UUID), phone_number, first_name, last_name, school_name,
                    registration_completed, is_test_user, preferred_language, created_at
conversations:      id, user_id, session_id, role ('user'|'assistant'), content, language, created_at
chat_sessions:      id, user_id, session_type, message_count, started_at, ended_at
coaching_sessions:  id, user_id, status, audio_duration_seconds, analysis_data (JSONB), created_at
reading_assessments:id, user_id, passage_type, language, grade_level, wcpm, benchmark_status, status
lesson_plans:       id, user_id, topic, grade, type, created_at
```

## Analyst tips

- **Timestamps are UTC** (`created_at` / `completed_at`).
- **JSONB**: `->` for object, `->>` for text — e.g. `analysis_data->>'overall_score'`.
- **Country from phone**: `LEFT(phone_number, 2)`.
- **Slow query**: prefix `EXPLAIN ANALYZE`; bound by `created_at >= NOW() - INTERVAL '30 days'`; check indexes with `\di`.
- If your deployment maintains **materialized views** (`mv_*`) for dashboards, prefer them — they're pre-computed; check their refresh status before trusting the numbers.

## Reference Files

| File | Contents |
|------|----------|
| [reference/query-patterns.md](reference/query-patterns.md) | Ready-to-run SQL: user growth, DAU, feature usage, reading/coaching analysis, cohort retention, language distribution |

## Related Skills

- [coaching](../coaching/SKILL.md) · [registration](../registration/SKILL.md) — the features whose tables you'll query most.
- [debugging](../debugging/SKILL.md) — when a metric looks wrong, trace the writing code by correlation id.
