# 04 — Data Migration (Taleemabad → Rumi Fork)

**Status**: 🟢 Unblocked — direct Postgres access landed (2026-07 or earlier). `TALEEMABAD_DB_*` env vars in the `.env` connect to `fde_production` on the production Postgres directly. Bastion / BigQuery routes below are no longer required; the BQ blockers (Q-3) and bastion blockers (Q-4) are historical. See `scripts/migrate-teacher-training.py` and `scripts/migrate-lesson-plans.py` for working migrations.
**Feeds**: [01](./01-lesson-plans.md), [02](./02-teacher-training.md), [03](./03-digital-coach.md)

---

## Scope

One-way ETL from Taleemabad's production data stores into the fork's Supabase + S3/R2. This is a **one-time bulk migration** followed by an optional ongoing sync (TBD — probably not needed).

## Source systems

Taleemabad has two data stores in play:

| Store | Role | Access pattern |
|---|---|---|
| **PostgreSQL** (AWS RDS, multi-tenant via `django-tenants` schemas) | System of record | Via SSH bastion (`tb-ssh-tunnel-keypair-niete.pem` in the repo) |
| **BigQuery** (GCP) | Analytics mirror, one-way synced from Postgres by `data_engineering/migration_prod_to_BQ/main.py` | Direct BQ read with service account |

**Preferred source: PostgreSQL** (system of record — no sync lag, has soft-deleted rows, has all vendor-specific tables). BigQuery is fallback if bastion access is refused.

## Access requirements

From `taleemabad-core/data_engineering/migration_prod_to_BQ/README.md`, a full sync run needs:

| Env var | For | Blocker # |
|---|---|---|
| `bq_service_accout_key` | BQ service account JSON path | Q-3 |
| `bq_project_id` | GCP project ID hosting BQ dataset | Q-3 |
| `ec2_ip` | Postgres bastion host IP | Q-4 |
| `ec2_username` | Bastion SSH user | Q-4 |
| `ssh_key_path` | Path to bastion PEM | Q-4 (may already be in repo) |
| `pass` | Postgres password | Q-4 |
| `l_port` | Local port for SSH tunnel | — |
| `server` | Postgres host (behind bastion) | Q-4 |
| `port` | Postgres port | Q-4 |

Owner: Taleemabad DevOps / data team. **Ask in one message rather than piecemeal.**

## Target destinations

| Target | Purpose |
|---|---|
| Fork's Supabase Postgres | All catalog tables (`lesson_plan_catalog`, `training_courses`, `training_modules`, etc.) |
| Rumi's R2 / new S3 bucket | LP PDFs, training media (voice/video), certificate templates |
| Existing Rumi tables (`coaching_sessions` etc.) | Only if we're migrating historic coaching sessions (probably no) |

## Table mappings (target ⟵ source)

### Lesson Plans → `lesson_plan_catalog`

| Target column | Source table.column (Taleemabad) | Notes |
|---|---|---|
| `region` | (constant, per-migration-run) | We pick the region tag |
| `grade` | `book_library_bookchapter.book.grade` (via FK chain) | Depends on Taleemabad schema — verify |
| `subject` | `book_library_book.subject` | Verify |
| `chapter_index` | `book_library_bookchapter.index` | Verify |
| `chapter_title` | `book_library_bookchapter.title` | Verify |
| `language` | Inferred from `book.language` or `book.school_type` | Verify |
| `source_vendor` | `lesson_plan_externallessonplan.source` | Enum: `TCF`, `OXBRIDGE`, `TEAL` |
| `s3_url` | `lesson_plan_externallessonplan.pdf_url` (or similar) | **Verify field name during first schema pull** |
| `title` | `lesson_plan_externallessonplan.title` | — |

**Also merge**: `lesson_plan_corelessonplan` (internal-generated LPs) if the region wants them. Requires the LP PDF to already exist as a URL — otherwise it's just a description without a document.

### Teacher Training → `training_*` tables

| Target table | Source table (Taleemabad) | Notes |
|---|---|---|
| `training_courses` | `teacher_training_course` | `Course` model — keep `vendor` via join to `Level.vendor` |
| `training_modules` | `teacher_training_training` | `Training` model — `Level` becomes `phase` column |
| `training_quizzes` | `teacher_training_grandquiz` + course-quiz metadata | GrandQuiz per Level → per-module quiz |
| `training_quiz_questions` | `teacher_training_question` | Filter to non-soft-deleted |
| `training_progress` | `teacher_training_teachertrainingstatus` | Only if migrating historic user progress |
| `training_quiz_submissions` | `teacher_training_submission` | Only if migrating historic submissions |
| `training_certificates` | `teacher_training_certificate` | Only if migrating historic certs (needs the cert PDF URL) |

**Vendor filter** — during migration, choose which vendors to include per region:

```sql
-- Own content
WHERE level.vendor IN ('taleemabad', NULL)

-- Secondary schools (external content)
WHERE level.vendor IN ('beaconhouse', 'oxbridge', 'i-saps')
```

### Media assets

Taleemabad's `media_asset` FK → asset table (verify name). Each asset has an S3 URL. Two strategies:

**Strategy A — mirror to Rumi's R2**
- Copy every referenced S3 object into Rumi's storage bucket
- Rewrite URLs to Rumi's R2 domain
- Pros: full ownership, no cross-account IAM
- Cons: bandwidth + storage cost, one-off effort

**Strategy B — cross-account read from Taleemabad's S3**
- Rumi bot fetches directly from Taleemabad's bucket
- Pros: cheap, fast to set up
- Cons: dependency on Taleemabad's infra, potential auth complexity, no guarantee URLs stay stable

**Recommendation**: Strategy A for the fork's independence guarantee. Strategy B as short-term fallback if the mirror job takes too long.

## ETL script structure

New folder: `rumi-platform/scripts/migration/` (matches the existing `scripts/` convention).

```
scripts/migration/
├── 00-connect.js          # Sanity check: can we reach both DBs?
├── 01-lp-catalog.js       # Populate lesson_plan_catalog
├── 02-training.js         # Populate training_* tables
├── 03-media-mirror.js     # Copy S3 assets to R2 (Strategy A)
├── 04-verify.js           # Post-migration counts + spot checks
└── README.md              # How to run, what to check
```

Each script:
- Idempotent (safe to re-run)
- Logs progress with row counts + timings
- Writes a manifest file with source-row-IDs → target-row-IDs for audit
- Uses `pg` (npm) for both source and target Postgres

## Historic coaching data — probably skip

Rumi's coaching pipeline is materially different from Taleemabad's `coaching` app (which is human-visit CoT observation, not audio-based AI reports). Historic Taleemabad coaching records don't fit Rumi's `coaching_sessions` shape without lossy transformation. **Recommendation: start fresh in the new region.** Revisit if the client explicitly wants continuity.

## Open items

- **Q-3, Q-4** (blockers): DB access
- **Q-5** (blocker): S3 mirror vs. cross-account
- **Q-6** (blocker): region → determines which vendors + languages to filter for
- Do we migrate soft-deleted rows too, or only active? (Recommendation: skip soft-deleted, they're rarely needed.)
- Rollback strategy — this is a fresh region, so worst case we truncate and re-run. But do we snapshot the source data as a JSON dump for archival?
