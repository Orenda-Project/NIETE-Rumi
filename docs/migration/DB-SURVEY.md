# Taleemabad Prod DB Survey — first-look assessment (2026-07-11)

**Status**: 🟢 Access confirmed. Data assessed. Ready for detailed migration planning.
**Related**: [04-data-migration.md](./04-data-migration.md) for the ETL execution plan.

Access credentials are in `NIETE-Rumi/.env` (gitignored) as `TALEEMABAD_DB_*` env vars. To connect:

```bash
psql "postgresql://$TALEEMABAD_DB_USER@$TALEEMABAD_DB_HOST:$TALEEMABAD_DB_PORT/$TALEEMABAD_DB_NAME?sslmode=require&connect_timeout=15"
```

Password is `TALEEMABAD_DB_PASSWORD`. **This is read-only for our user (`taleem_dev_user`)** — do not attempt writes.

---

## Server + schema layout

- **Host**: `165.99.50.136:2344` (QCloud managed Postgres; internal IP `172.16.17.5`)
- **Database**: `taleemabad_core`
- **User**: `taleem_dev_user` (read-only)
- **Django-tenants** setup — one shared `public` schema (config, tenant registry) and **one tenant schema `fde_production`** for the Federal Directorate of Education (which oversees NIETE and other federal schools). This is our data source.
- 304 tables in `fde_production`, 298 in `public`.

```sql
-- Every query below must set the tenant schema first
SET search_path TO fde_production;
```

## Table row counts (2026-07-11 snapshot)

Sorted by migration-relevance for the NIETE fork.

### Users, teachers, schools (Track 01a foundation)

| Table | Rows | Purpose |
|---|---|---|
| `users_user` | 96,981 | All users (teachers + parents + admins + coaches + officers) |
| `users_teacherprofile` | 10,882 | **The teacher accounts we're importing** |
| `users_coachprofile` | (query) | Coaches for Track 03 human-in-the-loop |
| `users_administratorprofile` | (query) | Admin roles |
| `users_areaeducationofficerprofile` | (query) | Regional oversight roles |
| `schools_school` | 465 | **Federal schools** (NIETE + peers) |
| `schools_schoolclass` | 9,390 | Classes within schools |
| `schools_schoolclasssubject` | 50,068 | **Teacher-class-subject assignments** — feeds `user_classes` |
| `schools_session` | 2 | Academic years (2024-25, 2025-26) |

### Curriculum + lesson plans (Track 01)

| Table | Rows | Purpose |
|---|---|---|
| `slo_grade` | 12 | PG, N, P, G1–G10 (kindergarten through matric) |
| `slo_subject` | 17 | Math, Urdu, Eng, Sci, ISL (Islamiat), MM, WA, etc. |
| `slo_gradesubject` | 101 | Grade × Subject combinations |
| `book_library_book` | 63 | Textbooks |
| `book_library_bookchapter` | 15,503 | Chapters across all books |
| `book_library_bookchapterlessonplan` | 95,247 | LP-chapter linkage (avg **6.1 LPs per chapter**) |
| `lesson_plan_corelessonplan` (`ready`) | **119,099** | **The primary LP catalog — HTML content, not PDFs** |
| `lesson_plan_externallessonplan` (Oxbridge only) | 70 | Partner-authored LPs |
| `slo_lessonplan` (active) | 10,402 | Legacy structured LP table (mostly `RETOOL` + `GEN_AI` sourced) |

**Content shape**: `lesson_plan_corelessonplan.content` is **HTML** with structured `<h2>` sections (SLO, Opening, Explain, Practice, Conclusion) and bilingual (Urdu + English + emoji). 99.8% success rate (only 237 in `error` status).

### Teacher training (Track 02)

| Table | Rows | Purpose |
|---|---|---|
| `teacher_training_course` (active) | **57 courses** | Top-level programs |
| `teacher_training_level` | 9 | Course tiers (with `vendor` column for external content) |
| `teacher_training_training` (active) | **758 modules** | Individual training units (video/audio/doc) |
| `teacher_training_question` (active) | **5,652 quiz questions** | MCQ + open-ended per training/level/course |
| `teacher_training_submission` | **7,407,632** | Historic teacher submissions (7.4M!) |
| `teacher_training_certificate` | 0 | **No certificates issued yet** — courseware in soft-launch |

### Coaching (Track 03)

| Table | Rows | Purpose |
|---|---|---|
| `coaching_observation` | 9,944 | Coach visit records |
| `coaching_observationanswer` | **255,417** | Per-question answers within observations |

### Others / auditing

- Every entity has a `historical*` twin (django-simple-history) for audit trail. Skip on migration.
- `book_ocr_lp_gen_pipeline_*` — Taleemabad's OCR → LP generation pipeline artifacts. Interesting for research but not a migration target.

## Critical findings that reshape the migration plan

### 1. LP delivery: no PDFs stored at source

Both `lesson_plan_corelessonplan` (119K rows) and `lesson_plan_externallessonplan` (70 rows) have `content` fields (HTML) but **no PDF URL field at all**. The `slo_lessonplan.lp_pdf_link` field has only 1 populated row out of 10,402 — likely legacy.

**Consequence for Track 01**: earlier assumption "copy PDF URLs from Taleemabad S3 to Rumi R2" is invalid. Options:
- **(A)** Render HTML → PDF in migration pipeline (~2–8 hours, one-time)
- **(B)** Store content HTML, render on-demand at send time
- **(C)** Deliver LP content as formatted WhatsApp text

See [01-lesson-plans.md](./01-lesson-plans.md) for the trade-off analysis.

### 2. Django multi-tenant schema — always `SET search_path`

Every query MUST set `search_path` to `fde_production` first, or default `public` returns config tables (tenant registry, feature flags) — not the actual data. Failing this returns "table doesn't exist" errors on obviously-present tables.

### 3. External LPs are minimal (70 Oxbridge only)

The Taleemabad code has references to TCF and TEAL as `ExternalLPSource` enum values, but **only Oxbridge has actual data** (70 LPs). TCF and TEAL are historical / unused. For NIETE we don't need to design for multi-vendor complexity.

### 4. Teacher training is heavily used

7.4M training submissions across 758 modules = ~10K submissions per module. Yet **zero certificates issued** — either the certificate-issue flow was never wired, or the app doesn't formally track completion. Worth clarifying with Taleemabad if we intend to reproduce the training feature.

### 5. Coaches are separate from teachers

`users_coachprofile` is distinct from `users_teacherprofile`. Track 03's HITL layer needs coach identity from this table. The `users_coachprofile_schools` bridge shows which schools a coach is assigned to.

## Sample queries used in this survey

```sql
-- Schema discovery
SELECT schema_name FROM information_schema.schemata
WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema';

-- Table row counts (must SET search_path first)
SET search_path TO fde_production;
SELECT count(*) FROM lesson_plan_corelessonplan WHERE is_active AND status = 'ready';

-- Sample LP content
SELECT id, LEFT(content, 400) FROM lesson_plan_corelessonplan
WHERE is_active AND status = 'ready' LIMIT 3;

-- LP-chapter linkage
SELECT count(DISTINCT book_chapter_id) chapters, count(*) total_links,
  ROUND(count(*)::numeric / count(DISTINCT book_chapter_id), 1) avg_lps_per_chapter
FROM book_library_bookchapterlessonplan WHERE is_active;
```

## Next steps

1. Sample the full LP structure — grade × subject × chapter distribution (feeds LP catalog design in Track 01)
2. Sample a teacher's assignments (feeds `user_classes` schema in Track 01a)
3. Sample the training question types (MCQ / MSQ / open-ended distribution — feeds Track 02 schema)
4. Sample coaching observation structure (feeds Track 03 HITL history-import decision)

Access lives in `.env`. Any subsequent Claude Code session can pick these up by sourcing env and running psql commands from this doc.
