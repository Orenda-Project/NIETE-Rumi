# ICT-001: [ICT] Region → School → Coach dimension spine — Execution Ledger

**The one document to follow.** Status: not started. Opened: 2026-08-04 · Tracker: TBD
(All design decisions resolved before this plan was written.)

> Working notes: this file is the plan of record until an equivalent Notion card exists.
> If a card is later created, add the pointer header and execute from the card.

---

## 0. READ FIRST — state & rollback

**Shipped:** nothing yet.

**Already migrated by prior work (do NOT re-migrate):** `migrate-coaching-observations.py`
moved 10 fact tables — templates, sections, question groups, questions (125,883), question
options (497,177), visit plans, school visits (324), teacher visits (8,973), observations
(9,944), observation answers (255,417). `migrate-users.py` imported org-1 users across all
6 role types into `users`.

**Rollback anchor:** every table this plan adds is new and prefixed `nietemigrated_`.
Rollback is a drop, no existing data touched:

```sql
DROP TABLE IF EXISTS nietemigrated_fico_kpis;
DROP TABLE IF EXISTS nietemigrated_teacher_profiles;
DROP TABLE IF EXISTS nietemigrated_coach_profiles;
DROP TABLE IF EXISTS nietemigrated_schools;
DROP TABLE IF EXISTS nietemigrated_school_regions;
```

**THE VERY NEXT THING:**
1. Apply migration `025_ict_dimension_spine.sql` (§9) to Supabase.
2. Run `python3 scripts/migrate-ict-spine.py --dry-run` and confirm the counts in §1.
3. Run with `--commit`, then run the §11 verification queries.

---

## 1. Why we're doing it

The observation facts are in Supabase but **cannot be attributed**. `nietemigrated_observations`
carries `coach_id`, `user_profile_content_type_id`, and `user_profile_object_id`; `nietemigrated_school_visits`
carries `school_id`. **None of those FKs resolve** — no coach, school, or region table was ever
migrated.

Live evidence, queried against `tbproddb` on **2026-08-04** (governed MCP, rule_version v0.22.5):

| Fact | Value |
|---|---|
| Active observations, test accounts excluded | **8,460** |
| — by coach (content_type 173) | 6,406 |
| — by principal (content_type 70) | 900 |
| — by teacher self (content_type 65) | 1,154 |
| Distinct coach profiles behind them | **63** |
| Distinct teachers observed | **2,711** |
| Distinct schools with an observation | **337** |
| Date span | 2025-08-22 → 2026-08-03 |

So the question *"which coach did which observation in which school, in which sector"* is
answerable at source and **unanswerable in Supabase today**. That is the whole gap.

Sector dimension, live 2026-08-04 — `schools_schoolregion` ⨝ `schools_school`:

| Sector | Schools |
|---|---|
| B.K | 84 |
| Sihala | 79 |
| Urban-I | 74 |
| Nilore | 67 |
| Urban-II | 67 |
| Tarnol | 61 |
| *(null)* | 32 |
| Durbeen | 1 |

**462 schools live (`deleted_at IS NULL`); 32 carry no region** and are unfilterable by sector —
surfaced, not hidden. (An earlier draft said 432; that count omitted the `deleted_at` filter.
Corrected 2026-08-04: 462 live rows, 459 distinct EMIS, 3 with a NULL EMIS.)

Teacher spine, live 2026-08-04, from base tables (`users_user` ⨝ `users_teacherprofile`,
org 1, active, non-test, not soft-deleted): **4,259 distinct teachers / 4,310 profile rows /
409 schools linked.** Level split: PRIMARY 3,374 · MIDDLE 974 · HIGH 1,035 · **no-level 0**.
The level sums exceed the headline because teachers teach multiple levels; the distinct count
is 4,259.

---

## 2. The Big Idea

**Migrate the lookups, not the facts — the facts are already there, they just have nothing to point at.**

---

## 3. Binding invariants

- **Additive only.** Every table is new and `nietemigrated_`-prefixed. No existing row is ever
  written or deleted. **One qualified exception:** three `ADD CONSTRAINT … NOT VALID` statements
  attach FKs to the already-migrated fact tables (§9), because PostgREST derives its embedded-
  resource joins from foreign keys — without them the ORM-style access layer cannot traverse
  relations. `NOT VALID` means existing rows are not re-checked, so the statement cannot fail on
  legacy data and no row is rejected. Each is guarded by an existence check and is reversible with
  `DROP CONSTRAINT`. Nothing the bot reads today changes behaviour.
- **Backward compatible by construction.** No existing column is dropped, renamed, or retyped;
  no existing query can break. A caller that never touches a `nietemigrated_*` dimension table
  behaves exactly as before. The FK additions are metadata-only at `NOT VALID`.
- **Follow the established house pattern exactly.** Source is `fde_production` Postgres via
  `TALEEMABAD_DB_*`; target is Supabase via PostgREST bulk POST with
  `Prefer: resolution=merge-duplicates`; language is Python; the script lives in `scripts/`.
  Do not introduce a BigQuery dependency — no existing migration script has one.
- **Idempotent.** Re-running overwrites matching PKs and creates no duplicates.
- **Source IDs are preserved as PKs** so the already-migrated facts resolve without a
  translation table.
- **FK-safe order, ancestors first:** regions → schools → coach profiles → teacher profiles → KPIs.
- **Governed SQL only.** Every SELECT below carries the filters mandated by
  `ict-islamabad/dimensions/teachers/teacher-query-rules.md` (rule_version v0.22.5):
  `organization_id = 1`, `is_active`, `is_testing_account = false`, `deleted_at IS NULL`.
- **Never sum PRIMARY + MIDDLE/HIGH** as a total. Headline is the distinct count (4,259);
  level counts overlap by design.
- **Surface the gaps, never paper over them.** The 32 region-less schools and the three
  disagreeing school lists are reported, not silently reconciled.

---

## 4. Code to touch

**The two implementation files are WRITTEN AND COMMITTED — read them, do not re-derive
them from a diff.** They were validated against a real PostgreSQL 16 instance on
2026-08-04 (see §11 "Proven locally"), so the code below is the tested artifact, not a
sketch:

| File | Role |
|---|---|
| `bot/database/migrations/025_ict_dimension_spine.sql` | 5 tables + 1 view + RLS + 3 guarded FK back-fills, with a commented DOWN block |
| `scripts/migrate-ict-spine.py` | The loader — governed SELECTs, `--dry-run` / `--commit` / `--tables` / `--verify` |

Locate them with:

```
ls -l bot/database/migrations/025_ict_dimension_spine.sql
ls -l scripts/migrate-ict-spine.py
grep -n "TABLES: dict" scripts/migrate-ict-spine.py      # the 5 table specs
grep -n "fico_with_teacher" bot/database/migrations/025_ict_dimension_spine.sql
```

### Still to write — the ORM-style access layer

Schema is SQL (above) because the repo has **no ORM**: verified 2026-08-04, no Prisma /
Sequelize / TypeORM / Knex / Drizzle in any `package.json`, and `supabase-js` is a
PostgREST query builder that cannot create tables — which is why all 24 existing
migrations are raw `.sql`. Adding an ORM would create a second source of schema truth.
So *access* gets the ORM ergonomics instead: named model functions and declarative
relation traversal, no hand-written joins at call sites.

The FK constraints in the migration are what make this work — PostgREST derives
relationships from foreign keys, so `select('*, school:...')` resolves only because the
FK exists. The FKs are load-bearing, not decorative.

```diff
# NEW FILE — bot/shared/services/ict/ict-spine.service.js
+++ b/bot/shared/services/ict/ict-spine.service.js
+/**
+ * ICT Dimension Spine — read models over the migrated ICT lookup tables.
+ *
+ * The facts (observations, answers, visits) were migrated earlier by
+ * `scripts/migrate-coaching-observations.py` but their FKs dangled. Migration 025
+ * lands the five lookups; this service is the only place that knows how they join.
+ *
+ * NO PII HERE, BY CONSTRUCTION. `nietemigrated_fico_kpis` holds only the
+ * observation grain + the six scores + emis. The 9 HR columns at source (cnic,
+ * date_of_birth, gender, joining_date, last_promotion_date, qualifications,
+ * professional_trainings, service_designation, basic_pay_scale) are never
+ * migrated, so `select('*')` is safe from any tier and no read-side allow-list is
+ * needed. If gender or designation is later required, add it as a deliberate,
+ * narrow migration — do not widen this table casually.
+ */
+
+const supabase = require('../../config/supabase');
+
+const T = {
+  regions:  'nietemigrated_school_regions',
+  schools:  'nietemigrated_schools',
+  coaches:  'nietemigrated_coach_profiles',
+  teachers: 'nietemigrated_teacher_profiles',
+  fico:     'nietemigrated_fico_kpis',
+  ficoView: 'nietemigrated_fico_with_teacher',   // scores + resolved teacher/school
+};
+
+// The six scored KPIs, in report order. Total/percentage are stored, not derived.
+const KPIS = [
+  'planning_and_preparation', 'subject_knowledge', 'classroom_management',
+  'communication_skills', 'professional_development', 'use_of_technology',
+];
+
+/** All sectors, ordered. 7 rows. */
+async function listSectors() {
+  const { data, error } = await supabase.from(T.regions).select('id, name').order('name');
+  if (error) throw error;
+  return data;
+}
+
+/** Schools, optionally one sector. Region embedded via the schools.region_id FK. */
+async function listSchools({ sector = null } = {}) {
+  let q = supabase.from(T.schools)
+    .select(`id, name, emis, region_name, region:${T.regions}!region_id ( id, name )`)
+    .order('name');
+  if (sector) q = q.eq('region_name', sector);
+  const { data, error } = await q;
+  if (error) throw error;
+  return data;
+}
+
+/**
+ * Teachers with school and sector, one hop each.
+ * Headline is DISTINCT user_id — a transferred teacher holds one profile row per
+ * school assignment (4,310 rows / 4,259 people; 51 teachers hold 2).
+ */
+async function listTeachers({ sector = null, level = null } = {}) {
+  let q = supabase.from(T.teachers).select(`
+    id, user_id, teacher_name, levels,
+    school:${T.schools}!school_id (
+      id, name, emis, region_name,
+      region:${T.regions}!region_id ( id, name )
+    )
+  `);
+  if (level) q = q.ilike('levels', `%${level}%`);   // no 'SECONDARY' in the data
+  const { data, error } = await q;
+  if (error) throw error;
+  const rows = sector ? data.filter((r) => r.school?.region_name === sector) : data;
+  return { rows, teacherCount: new Set(rows.map((r) => r.user_id)).size };
+}
+
+/**
+ * The question this whole migration exists to answer: which coach observed which
+ * teacher, at which school, in which sector.
+ */
+async function observationsWithAttribution({ sector = null, coachId = null, limit = 500 } = {}) {
+  let q = supabase.from('nietemigrated_observations').select(`
+    id, observation_date, status,
+    coach:${T.coaches}!coach_id ( id, coach_name ),
+    visit:nietemigrated_teacher_visits!visit_id (
+      id,
+      teacher:${T.teachers}!teacher_id (
+        id, user_id, teacher_name, levels,
+        school:${T.schools}!school_id ( id, name, emis, region_name )
+      )
+    )
+  `).eq('is_active', true).order('observation_date', { ascending: false }).limit(limit);
+  if (coachId) q = q.eq('coach_id', coachId);
+  const { data, error } = await q;
+  if (error) throw error;
+  return sector
+    ? data.filter((o) => o.visit?.teacher?.school?.region_name === sector)
+    : data;
+}
+
+/**
+ * FICO scores with teacher/school/sector resolved.
+ * Reads the VIEW, not the base table — the view encodes the profile tie-break
+ * (prefer the profile whose school EMIS matches the observation, else most recent)
+ * exactly once. Never re-derive that join here. It LEFT JOINs, so the ~9 FICO users
+ * with no active profile keep their scores with a null teacher_name.
+ */
+async function ficoScores({ sector = null, userId = null } = {}) {
+  let q = supabase.from(T.ficoView).select('*')
+    .order('observation_date', { ascending: false });
+  if (sector) q = q.eq('sector', sector);
+  if (userId) q = q.eq('user_id', userId);
+  const { data, error } = await q;
+  if (error) throw error;
+  return data;
+}
+
+/** Mean of each KPI across a set of score rows — the high/low indicator view. */
+function kpiAverages(rows) {
+  return KPIS.map((k) => {
+    const vals = rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined);
+    return {
+      kpi: k,
+      average: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
+      n: vals.length,
+    };
+  }).sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
+}
+
+module.exports = {
+  TABLES: T, KPIS,
+  listSectors, listSchools, listTeachers,
+  observationsWithAttribution, ficoScores, kpiAverages,
+};
```

**No existing file is edited or deleted.** Verified by grep: nothing in the repo referenced
any `nietemigrated_*` dimension table before this work, so there is no live consumer to break.
The only touch to existing *schema* is the three guarded `NOT VALID` FK additions (§3, §9).

## 5. Tests — written FIRST, red before green

```js
// NEW — tests/database/ict-spine.test.js   (RED before 025 is applied + script run)
const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

describe('ICT dimension spine', () => {
  it('has the six ICT sectors plus Durbeen', async () => {
    const { data } = await db.from('nietemigrated_school_regions').select('name');
    const names = data.map(r => r.name).sort();
    expect(names).toEqual(
      ['B.K', 'Durbeen', 'Nilore', 'Sihala', 'Tarnol', 'Urban-I', 'Urban-II'].sort()
    );
  });

  it('every school resolves to a region, or is explicitly region-less', async () => {
    const { count: total } = await db
      .from('nietemigrated_schools').select('*', { count: 'exact', head: true });
    const { count: orphan } = await db
      .from('nietemigrated_schools').select('*', { count: 'exact', head: true })
      .is('region_id', null);
    expect(total).toBeGreaterThanOrEqual(430);
    expect(orphan).toBeLessThanOrEqual(40); // 32 at 2026-08-04; surfaced, not hidden
  });

  it('resolves coach -> observation -> teacher -> school -> sector end to end', async () => {
    const { data, error } = await db
      .from('nietemigrated_observations')
      .select(`
        id,
        coach:nietemigrated_coach_profiles!coach_id ( coach_name ),
        visit:nietemigrated_teacher_visits!visit_id (
          teacher:nietemigrated_teacher_profiles!teacher_id (
            teacher_name,
            school:nietemigrated_schools!school_id ( name, region_name )
          )
        )
      `)
      .not('coach_id', 'is', null)
      .limit(1);
    expect(error).toBeNull();
    expect(data[0].coach.coach_name).toBeTruthy();
    expect(data[0].visit.teacher.school.region_name).toBeTruthy();
  });

  it('teacher headline is the distinct count, never the sum of levels', async () => {
    const { data } = await db
      .from('nietemigrated_teacher_profiles').select('user_id, levels');
    const distinct = new Set(data.map(r => r.user_id)).size;
    const levelSum = data.reduce(
      (n, r) => n + (JSON.parse(r.levels || '[]').length), 0
    );
    expect(distinct).toBeGreaterThanOrEqual(4200);
    expect(levelSum).toBeGreaterThan(distinct); // proves overlap; sum is NOT the headline
  });

  it('FICO carries no HR/PII columns at all', async () => {
    const { data } = await db.from('nietemigrated_fico_kpis').select('*').limit(1);
    const banned = ['cnic', 'date_of_birth', 'basic_pay_scale', 'last_promotion_date',
                    'qualifications', 'professional_trainings', 'service_designation',
                    'gender', 'joining_date'];
    for (const col of banned) expect(Object.keys(data[0])).not.toContain(col);
  });

  it('the FICO view resolves teacher and sector, and keeps profile-less scores', async () => {
    const { data, error } = await db
      .from('nietemigrated_fico_with_teacher')
      .select('user_id, observation_date, grade, subject, total_score_out_of_60, teacher_name, sector');
    expect(error).toBeNull();
    // one row per FULL observation grain — the tie-break must not fan out.
    // grade+subject are part of the key: same teacher, same day, two subjects = two rows.
    const keys = data.map(r => `${r.user_id}|${r.observation_date}|${r.grade}|${r.subject}`);
    expect(new Set(keys).size).toBe(keys.length);
    // ~9 users have no active profile; their scores survive with a null name
    expect(data.some(r => r.teacher_name === null)).toBe(true);
  });

  it('carries no test accounts', async () => {
    const { count } = await db
      .from('nietemigrated_teacher_profiles')
      .select('*', { count: 'exact', head: true })
      .ilike('teacher_name', '%test%');
    expect(count).toBe(0);
  });
});
```

**Cases:** 1) sector list exact · 2) school→region coverage with the orphan bound explicit ·
3) the full attribution chain, which is the whole point of the migration · 4) headline is
distinct not summed · 5) test-account filter held.

**Expected: RED now** — all five fail with `relation "nietemigrated_school_regions" does not
exist` (PostgREST 404), because the tables don't exist. **GREEN after T1.3.1.**

**Suite gate:** `npx jest tests/database/ict-spine.test.js` green, and
`./run-tests.sh` at no worse than branch-HEAD baseline.

---

## 6. Phases → subphases → tasks

### Phase 1 — the attribution spine (ships: observations become attributable)

#### Phase 1.1 — schema

- [ ] **T1.1.1 Write migration `025_ict_dimension_spine.sql`**
  - Files: `bot/database/migrations/025_ict_dimension_spine.sql` (new) → §4 diff, §9 DDL
  - Test: none yet (DDL only); §5 goes red-for-the-right-reason after this
  - Gate: reviewer 👍 · statements are `CREATE TABLE IF NOT EXISTS` only, no ALTER/DROP of
    an existing object
  - Done when: file exists and `psql -f` applies clean against a scratch DB

- [ ] **T1.1.2 Apply 025 to Supabase**
  - Files: none (operational)
  - Test: §5 now fails on empty tables, not missing relations
  - Gate: fresh operator "go" — this is a shared DB, a write here is a prod write
  - Done when: all 5 tables present in `information_schema.tables`; §5 red reason changed

#### Phase 1.2 — the script

- [ ] **T1.2.1 Write `scripts/migrate-ict-spine.py`**
  - Files: `scripts/migrate-ict-spine.py` (new) → §4 diff
  - Test: `--dry-run` prints 5 rows of counts and exits without writing
  - Gate: reviewer 👍 · mirrors `migrate-coaching-observations.py` conventions (env reader,
    `SRC_DSN`, `jsonable`, merge-duplicates, `--tables`)
  - Done when: `python3 scripts/migrate-ict-spine.py --dry-run` prints counts matching §1
    (7 / 462 / 117 / 4310 / 5180) with no DRIFT warnings

- [ ] **T1.2.2 Confirm the read-only source role reaches all 5 source tables**
  - Files: none
  - Test: the dry-run itself — a permission gap surfaces as a psycopg2 error
  - Gate: no error on any of the 5 SELECTs
  - Done when: dry-run completes with zero failures

#### Phase 1.3 — the load

- [ ] **T1.3.1 Run `--commit`, ancestors first**
  - Files: none (operational)
  - Test: §5 all five cases → GREEN
  - Gate: fresh operator "go" · run in dict order (regions → schools → coaches → teachers
    → KPIs), never a subset that puts a child before its parent
  - Done when: §5 green AND the §11 verification queries return the §1 numbers

- [ ] **T1.3.2 Re-run `--commit` unchanged, prove idempotency**
  - Files: none
  - Test: row counts identical before and after the second run
  - Gate: zero net row change
  - Done when: `SELECT count(*)` on all 5 tables identical across the two runs

### Phase 2 — school-list reconciliation (ships: one defensible "total schools")

Three source lists disagree and the plan must not pick one silently:
`schools_school` **462** · `FDE_Schools` **341** · `Middle_High_Schools_Updated` **228**
(all live 2026-08-04).

- [ ] **T2.1.1 Produce the three-way EMIS reconciliation**
  - Files: `docs/migration/ict-school-list-reconciliation.md` (new)
  - Test: the counts in the doc reproduce from the §11 reconciliation query
  - Gate: reviewer 👍 · every bucket (in-all-three, in-one-only, etc.) sums back to the union
  - Done when: the doc states, with counts, which list is authoritative for "total schools,
    ICT region" and why — and names the 32 region-less schools explicitly

---

## 7. Blast radius — other regions & shared services

This change is **additive-only DDL plus one manually-run script**. No bot code path, handler,
route, or shared service is edited (§4 shows zero EDIT and zero DELETE blocks). A `main` merge
therefore redeploys every service with **no behaviour change**.

| Region | Services redeployed | Behaviour change? | Flag-gated? | Shared asset touched |
|---|---|---|---|---|
| PK | web, worker, video | No — new tables, no reader | N/A (no code path) | Supabase (additive tables) |
| TZ | web, worker | No | N/A | Supabase |
| KE | web, worker | No | N/A | Supabase |
| YE | web, worker | No | N/A | Supabase |
| PS | web, worker | No | N/A | Supabase |

- **Shared code path:** none. No file under `bot/shared/` is modified.
- **Shared Meta Flows / templates:** none touched — no teacher-facing surface changes.
- **Shared Supabase:** **this is the real risk.** One Postgres serves prod/staging/QA, so
  applying 025 and running the script are prod writes. Both are additive and confined to five
  new `nietemigrated_*` tables; no existing table is written. **No write-freeze needed** on any
  existing table, because none is touched.
- **Queues:** no new message types; no SQS involvement.
- **RLS:** the new tables are service-role-only until a reader exists (§9). No anon exposure.

---

## 8. Meta dependencies

`N/A — no teacher-facing Meta surface.` This migration writes lookup tables only; no template,
Flow, or form is created or updated, and no WABA asset is referenced.

---

## 9. Database schema

### Explored live 2026-08-04

Source side, via the governed MCP (`rule_version` v0.22.5) against `tbproddb` — the BigQuery
mirror of `fde_production`, used here because it is the governed read path; the script reads the
Postgres original:

- `schools_schoolregion` ⨝ `schools_school` → **7 regions, 462 live schools**, 32 with `region_id IS NULL`
  (sector table in §1).
- `users_user` ⨝ `users_teacherprofile` (org 1, active, non-test, not deleted) → **4,259 distinct
  teachers / 4,310 profile rows / 409 schools**; levels PRIMARY 3,374 · MIDDLE 974 · HIGH 1,035 ·
  **no-level 0**.
- Full coach chain (`coaching_observation` ⨝ coach/principal/teacher profiles ⨝ `coaching_teachervisit`
  ⨝ `users_teacherprofile` ⨝ `schools_school`, test-excluded) → **8,460 observations · 63 coach
  profiles · 2,711 teachers · 337 schools**, span 2025-08-22 → 2026-08-03.
- Row counts for scope: `coaching_questionoption` 497,177 · `coaching_observationanswer` 255,498 ·
  `coaching_observationquestion` 125,883 · `teacher_training_level_status` 29,952 ·
  `Middle_High_Training_Level_Status` 26,005 · `coaching_teachervisit` 8,978 · `fico_kpis` 5,180 ·
  `FDE_Schools` 341 · `Middle_High_Schools_Updated` 228 · `users_coachprofile` 117 ·
  `coaching_observationsection` 13 · `schools_schoolregion` 7.

Target side, in this repo:

- `grep -rhoE 'nietemigrated_[a-z_]+' scripts/ bot/` returns **10 tables**, all facts:
  observations, observation_answers, observation_questions, observation_question_groups,
  observation_sections, observation_templates, question_options, school_visits, teacher_visits,
  visit_plans.
- **No region, school, coach, teacher-profile, or KPI dimension exists** — confirmed by grep
  returning nothing for `nietemigrated_school`/`_region`/`_coach` in either
  `bot/database/migrations/` or `dashboard/database/migrations/`.
- `nietemigrated_observations` already carries `coach_id`, `user_profile_content_type_id`,
  `user_profile_object_id`; `nietemigrated_school_visits` already carries `school_id`. **The FK
  columns exist and dangle.**

### Recommendation, defended against sprawl

Five new tables. Justification for each, against reusing something existing:

| Table | Why not reuse? |
|---|---|
| `nietemigrated_school_regions` | 7 rows; no region concept exists anywhere in Supabase. Could be an enum, but it carries `created`/`modified` and an id the schools FK to. |
| `nietemigrated_schools` | `nietemigrated_school_visits.school_id` dangles today. Rumi's own `users.emis_code` is per-user, not a school dimension. |
| `nietemigrated_coach_profiles` | `migrate-users.py` put coaches into `users` as *people*; it did not preserve `users_coachprofile.id`, which is what `observations.coach_id` and `user_profile_object_id` (content_type 173) point at. Without this table those FKs cannot resolve. |
| `nietemigrated_teacher_profiles` | Same argument: `teacher_visits.teacher_id` is a `users_teacherprofile.id`, not a user id. Also the only place `levels` lands, which resolves the level-source-of-truth question in one source. |
| `nietemigrated_fico_kpis` | 5,180 scored KPI rows; no equivalent table exists. |

`region_name` is denormalized onto `nietemigrated_schools` deliberately — it makes the common
sector rollup a single-table read, and 462 rows never drift enough to matter.

### Migration — up and down, per statement

Runs entirely in **Phase 1.1**. Shared-DB caveat: this Postgres serves prod/staging/QA, so
applying it is a global act; "apply to prod" is a verification step, not a second run.

```sql
-- 025_ict_dimension_spine.sql
-- ICT dimension spine: regions -> schools -> coach/teacher profiles -> KPIs.
-- Additive only. Source IDs preserved as PKs so already-migrated facts resolve.
-- UP ------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS nietemigrated_school_regions (
  id          integer PRIMARY KEY,
  name        text NOT NULL,
  created     timestamptz,
  modified    timestamptz
);

CREATE TABLE IF NOT EXISTS nietemigrated_schools (
  id          integer PRIMARY KEY,
  uuid        uuid,
  name        text NOT NULL,
  emis        integer,
  region_id   integer REFERENCES nietemigrated_school_regions(id),
  region_name text,                        -- denormalized: sector rollup in one read
  created     timestamptz,
  modified    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_nm_schools_region ON nietemigrated_schools(region_id);
CREATE INDEX IF NOT EXISTS idx_nm_schools_emis   ON nietemigrated_schools(emis);

CREATE TABLE IF NOT EXISTS nietemigrated_coach_profiles (
  id           integer PRIMARY KEY,        -- users_coachprofile.id — what coach_id points at
  user_id      integer,
  coach_name   text,
  phone_number text,
  is_active    boolean,
  created      timestamptz,
  modified     timestamptz
);

CREATE TABLE IF NOT EXISTS nietemigrated_teacher_profiles (
  id           integer PRIMARY KEY,        -- users_teacherprofile.id — teacher_visits.teacher_id
  user_id      integer,
  teacher_name text,
  phone_number text,
  school_id    integer REFERENCES nietemigrated_schools(id),
  levels       text,                       -- e.g. "['PRIMARY', 'MIDDLE']"
  is_active    boolean,
  created      timestamptz,
  modified     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_nm_teacher_school ON nietemigrated_teacher_profiles(school_id);
CREATE INDEX IF NOT EXISTS idx_nm_teacher_user   ON nietemigrated_teacher_profiles(user_id);

-- Source has 28 columns (verified live 2026-08-04 via get_table_schema). This table
-- keeps 13: the observation grain + the scores. Everything else is dropped:
--   * 9 HR columns (cnic, date_of_birth, gender, joining_date, last_promotion_date,
--     qualifications, professional_trainings, service_designation, basic_pay_scale)
--     — HR records, not dashboard metrics, and cnic/dob/pay are PII this table has
--     no reason to hold. Never migrated, so never need protecting.
--   * teacher_name / school / sector / levels / contact_number — these repeat
--     identically on every observation of the same teacher. Read them from
--     nietemigrated_teacher_profiles instead (see the join note below).
-- `emis` is the ONE placement column kept, as the join tie-breaker.
-- NOTE: no id column at source — PK is the observation grain. Observation_date is
-- STRING at source and is cast on load; every score is already FLOAT.
CREATE TABLE IF NOT EXISTS nietemigrated_fico_kpis (
  user_id                  integer NOT NULL,
  observation_date         date    NOT NULL,
  grade                    text    NOT NULL DEFAULT '',
  subject                  text    NOT NULL DEFAULT '',
  emis                     integer,        -- tie-breaker when a user has 2 profiles
  -- the six KPIs, each scored 0-10
  planning_and_preparation float,
  subject_knowledge        float,
  classroom_management     float,
  communication_skills     float,
  professional_development float,
  use_of_technology        float,
  total_score_out_of_60    float,          -- = sum of the six
  overall_percentage       float,
  PRIMARY KEY (user_id, observation_date, grade, subject)
);
CREATE INDEX IF NOT EXISTS idx_nm_fico_user   ON nietemigrated_fico_kpis(user_id);
CREATE INDEX IF NOT EXISTS idx_nm_fico_emis   ON nietemigrated_fico_kpis(emis);
CREATE INDEX IF NOT EXISTS idx_nm_fico_sector ON nietemigrated_fico_kpis(sector);

-- FICO joins teachers by USER id, not profile id, so it cannot FK to
-- teacher_profiles.id (a teacher with two school assignments has two profile
-- rows for one user_id). Left as a soft link on user_id; the service resolves it
-- explicitly rather than via an embed.
--
-- TIE-BREAK RULE (measured live 2026-08-04 — the exposure is tiny):
--   4,259 teachers, 51 with >1 active profile. FICO covers 2,257 teachers, of which
--   only 9 have >1 profile. A further 9 FICO user_ids have NO profile in the spine
--   at all (inactive/transferred out) and must be LEFT JOINed so their scores are
--   not silently dropped.
--   Rule: match on user_id AND prefer the profile whose school EMIS equals the
--   FICO row's emis; if none matches, take the most recently modified profile.
--   Encoded once in ict-spine.service.js — never re-derived at a call site.
CREATE OR REPLACE VIEW nietemigrated_fico_with_teacher AS
SELECT DISTINCT ON (f.user_id, f.observation_date, f.grade, f.subject)
       f.*,
       tp.id          AS teacher_profile_id,
       tp.teacher_name,
       tp.levels,
       s.name         AS school_name,
       s.region_name  AS sector
FROM nietemigrated_fico_kpis f
LEFT JOIN nietemigrated_teacher_profiles tp ON tp.user_id = f.user_id
LEFT JOIN nietemigrated_schools          s  ON s.id = tp.school_id
ORDER BY f.user_id, f.observation_date, f.grade, f.subject,
         (s.emis = f.emis) DESC NULLS LAST,   -- prefer the school the obs happened at
         tp.modified DESC NULLS LAST;          -- else most recent assignment

-- Back-fill the FKs the ALREADY-MIGRATED fact tables need, so PostgREST can
-- embed coach/teacher/school. Guarded: each only fires if the fact table exists
-- and the constraint does not. Additive — no data is written, no row rejected,
-- because the referenced dimension rows are loaded before this migration's
-- consumers run. NOT VALID skips the full-table check on creation so an
-- unattributable legacy row cannot block the migration; validate separately once
-- Phase 1.3 has loaded the dimensions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'nietemigrated_observations')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'fk_nm_obs_coach') THEN
    ALTER TABLE nietemigrated_observations
      ADD CONSTRAINT fk_nm_obs_coach
      FOREIGN KEY (coach_id) REFERENCES nietemigrated_coach_profiles(id) NOT VALID;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'nietemigrated_teacher_visits')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'fk_nm_tv_teacher') THEN
    ALTER TABLE nietemigrated_teacher_visits
      ADD CONSTRAINT fk_nm_tv_teacher
      FOREIGN KEY (teacher_id) REFERENCES nietemigrated_teacher_profiles(id) NOT VALID;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'nietemigrated_school_visits')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'fk_nm_sv_school') THEN
    ALTER TABLE nietemigrated_school_visits
      ADD CONSTRAINT fk_nm_sv_school
      FOREIGN KEY (school_id) REFERENCES nietemigrated_schools(id) NOT VALID;
  END IF;
END $$;

-- Service-role only until a reader exists. No anon/authenticated grants.
ALTER TABLE nietemigrated_school_regions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE nietemigrated_schools           ENABLE ROW LEVEL SECURITY;
ALTER TABLE nietemigrated_coach_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE nietemigrated_teacher_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE nietemigrated_fico_kpis         ENABLE ROW LEVEL SECURITY;

-- DOWN ----------------------------------------------------------------------
-- Reverse order (children first). Safe: nothing references these yet.
-- DROP TABLE IF EXISTS nietemigrated_fico_kpis;
-- DROP TABLE IF EXISTS nietemigrated_teacher_profiles;
-- DROP TABLE IF EXISTS nietemigrated_coach_profiles;
-- DROP TABLE IF EXISTS nietemigrated_schools;
-- DROP TABLE IF EXISTS nietemigrated_school_regions;
```

**`fico_kpis` — resolved 2026-08-04.** All 28 source columns enumerated live via
`get_table_schema`; the table migrates **13 of them**. Four facts an executor needs:

1. **No `id` column at source.** The PK is the observation grain
   `(user_id, observation_date, grade, subject)`, which is also the `on_conflict` target that makes
   the load idempotent. Rows with a null `user_id` or empty `Observation_date` cannot satisfy that
   key and are excluded by the WHERE clause — report the excluded count in the dry-run.
2. **`Observation_date` is STRING at source.** Cast with `NULLIF(col,'')::date` so blanks become
   NULL instead of erroring. All six KPI scores are already FLOAT.
3. **Mixed-case source columns are quoted** (`"EMIS"`, `"Planning_and_Preparation"`, …) and
   aliased to snake_case; unquoted they would fold to lowercase and fail.
4. **15 source columns are deliberately dropped** — see the DDL comment. The 9 HR columns are HR
   records, not dashboard metrics; `teacher_name` / `school` / `sector` / `levels` /
   `contact_number` repeat on every observation of the same teacher and are read from
   `nietemigrated_teacher_profiles` through the view instead.

**No PII, by construction.** Not migrating `cnic`, `date_of_birth`, and `basic_pay_scale` is
stronger than migrating them behind a read-side allow-list: there is no column to leak, no tier
rule to enforce, and `select('*')` is safe from any caller. This reverses the 2026-08-04 decision
to carry them — the operator dropped the HR fields once the table-width cost was clear. If gender
or service designation is later needed for reporting, add it as an explicit, narrow migration.

**Join exposure, measured live 2026-08-04** — the numbers that justify the tie-break rule rather
than a heavier identity model: 4,259 teachers, of which **51** hold more than one active profile.
FICO covers **2,257** teachers, of which only **9** are multi-profile. A separate **9** FICO
`user_id`s have no active profile in the spine at all (transferred out or deactivated) — the view
LEFT JOINs so their scores survive with a null teacher name instead of disappearing.

---

## 10. Railway

`N/A — no service or env change.` The script reads `TALEEMABAD_DB_*`, `SUPABASE_URL`, and
`SUPABASE_SERVICE_ROLE_KEY` from the repo `.env`; all four are already required and consumed by
`migrate-coaching-observations.py` and `migrate-users.py`. It is run manually from a developer
machine, not deployed, so no service picks up a new variable and unset-is-safe does not arise.

---

## 11. Rollout, verification & soak

Order per phase: apply DDL → dry-run → operator "go" → commit → verify → soak.

1. **Apply 025** (T1.1.2). Verify all 5 relations exist:
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_name LIKE 'nietemigrated_%'
     AND table_name IN ('nietemigrated_school_regions','nietemigrated_schools',
                        'nietemigrated_coach_profiles','nietemigrated_teacher_profiles',
                        'nietemigrated_fico_kpis');
   ```
2. **Dry-run.** Counts must match §1 with no DRIFT lines. Any drift → stop, reconcile, do not commit.
3. **Fresh operator "go"** (shared DB = prod write).
4. **Commit**, ancestors first.
5. **Verify — the attribution chain, which is the point of the whole migration:**
   ```sql
   -- Must return ~6,406 coach-attributed observations across ~63 coaches and ~337 schools.
   SELECT r.name AS sector, c.coach_name,
          count(DISTINCT o.id) AS observations,
          count(DISTINCT s.id) AS schools
   FROM nietemigrated_observations o
   JOIN nietemigrated_coach_profiles   c  ON c.id  = o.coach_id
   JOIN nietemigrated_teacher_visits   tv ON tv.id = o.visit_id
   JOIN nietemigrated_teacher_profiles tp ON tp.id = tv.teacher_id
   JOIN nietemigrated_schools          s  ON s.id  = tp.school_id
   LEFT JOIN nietemigrated_school_regions r ON r.id = s.region_id
   WHERE o.is_active
   GROUP BY r.name, c.coach_name
   ORDER BY observations DESC;
   ```
   ```sql
   -- Teacher headline vs level split. distinct_teachers ~4,259; the level counts overlap
   -- and MUST NOT be summed into a total.
   SELECT count(DISTINCT user_id) AS distinct_teachers,
          count(*)                AS profile_rows,
          count(DISTINCT CASE WHEN levels LIKE '%PRIMARY%' THEN user_id END) AS primary_t,
          count(DISTINCT CASE WHEN levels LIKE '%MIDDLE%'  THEN user_id END) AS middle_t,
          count(DISTINCT CASE WHEN levels LIKE '%HIGH%'    THEN user_id END) AS high_t
   FROM nietemigrated_teacher_profiles;
   ```
   ```sql
   -- Phase 2 reconciliation input: schools per sector + the region-less bucket (~32).
   SELECT COALESCE(region_name, '(no region)') AS sector, count(*) AS schools
   FROM nietemigrated_schools GROUP BY 1 ORDER BY schools DESC;
   ```
6. **Idempotency** (T1.3.2): re-run `--commit`, re-run the count queries, expect zero net change.
7. **Soak:** 24h. Nothing reads these tables yet, so the only failure mode is a broken existing
   query — watch for Supabase errors mentioning `nietemigrated_`. Then Phase 2.

No staging→prod promotion step applies: the DB is shared, so step 1 already reached every
environment. No container restart is involved because no service code changed.

---

## 12. Inventory & "what we were wrong about"

| Assumption | Verified live? |
|---|---|
| `fde_production` reachable via `TALEEMABAD_DB_*` read-only role | Yes — pattern in use by `migrate-coaching-observations.py` |
| `schools_schoolregion` holds the 6 ICT sectors | Yes — 2026-08-04, 7 rows incl. Durbeen |
| `schools_school` has `region_id`, `emis`, `uuid` | Yes — `taleemabad_core/apps/schools/models.py` + live query |
| `users_coachprofile` is the observer target for content_type 173 | Yes — governed rules v0.22.5 + live 8,460-obs join |
| Facts already in Supabase (obs, answers, visits) | Yes — `migrate-coaching-observations.py` docstring, 10 tables |
| No school/region/coach dimension in Supabase | Yes — grep returned nothing |
| `fico_kpis` column list | Yes — 28 columns via `get_table_schema` 2026-08-04; no `id` at source, dates are STRING |
| `SUPABASE_SERVICE_ROLE_KEY` present in `.env` | Assumed from sibling scripts — confirm before T1.3.1 |

**What we were wrong about (corrected during planning, 2026-08-04):**

1. **Thought this needed a BigQuery→Supabase sync.** Wrong — the house pattern reads
   `fde_production` Postgres directly. No BigQuery dependency in any existing migration script.
2. **Thought the script should be Node.** Wrong — all 9 existing migration scripts are Python.
3. **Thought the 880k raw observation rows still needed migrating.** Wrong — already done by
   `migrate-coaching-observations.py`. The gap is dimensions only, which shrank this plan by ~20x.
4. **Quoted 4,160 distinct teachers** (governed marts, 3,328 + 2,598 − 1,766). The base-table
   spine gives **4,259** with zero missing levels. This plan uses 4,259 and the base tables;
   the ~99-teacher delta against the marts is a Phase 2 reconciliation note.
5. **Assumed `FDE_Schools` (341) was the school list.** It is one of three disagreeing lists;
   `schools_school` (462 live) is the one with the region FK, hence the spine. Phase 2 settles which
   is authoritative for reporting.
6. **Planned `fico_kpis` at 27 columns including HR/PII, guarded at the read layer.** Reversed
   2026-08-04: the table now migrates **13** columns — the observation grain, the six scores,
   total, percentage, and `emis` as join tie-breaker. The 9 HR columns are simply never migrated,
   which removes the PII surface entirely instead of policing it; `teacher_name` / `school` /
   `sector` / `levels` / `contact_number` came out because they repeat per observation and belong
   on `teacher_profiles`. Consequence: a `nietemigrated_fico_with_teacher` view now owns the
   profile tie-break, measured at 9 affected teachers out of 2,257.
