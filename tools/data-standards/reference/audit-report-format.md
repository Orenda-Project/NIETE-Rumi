# Data Standards Audit — Report Format Specification

Read this before generating any full schema/migration/PR audit report. It defines the vocabulary,
structure, and acceptance bar for the report an agent hands back to a database owner — the
scanner (`scripts/audit.py`) and the scorecard renderer (`scripts/scorecard.py`) are inputs to
this report, not the report itself. A reader must be able to answer, quickly:

1. Did the schema pass or fail overall?
2. Which standards failed?
3. Which tables and columns have issues?
4. What is the risk of each issue?
5. What exact change is recommended?
6. How can the user verify the change worked?

The old "report per standard: pass / fail / not applicable, cite the line" instruction in
`SKILL.md` is superseded by this file for any **full audit report** — a quick single-standard
lookup ("what does D6 require") doesn't need this structure, but a real "does this schema/
migration/PR meet our data standards" audit does.

## 1. Fixed verdict vocabulary — this report's, not the scanner's

This report uses exactly five verdicts, and no others:

| Verdict | Meaning |
|---|---|
| `PASS` | All applicable checks passed. |
| `PARTIAL` | Some checks passed, but one or more issues remain. |
| `FAIL` | One or more material violations were confirmed. |
| `NOT ASSESSED` | The required files, metadata, or evidence were unavailable. |
| `NOT APPLICABLE` | The standard does not apply to the assessed object. |

Never use ambiguous phrasing ("mostly pass", "no signal", "pass on new ones") as a verdict. That
nuance belongs in the finding or notes field, not the verdict cell.

**This is a different vocabulary from `scorecard.py`'s verdicts JSON** (`"pass"|"fail"|"na"`),
which is a narrower machine-readable input for the D21 compliance chart, not a report format. Do
not conflate the two: when you produce a full audit report, use the five-value vocabulary above;
when you feed `scorecard.py` for a chart, map into its three-value input (`PASS`→`pass`,
`FAIL`→`fail`, `NOT APPLICABLE`→`na`; treat `PARTIAL` as `fail` for chart purposes and say so in
the report, since a chart has no partial-credit bar; `NOT ASSESSED` has no scorecard equivalent —
omit that standard for that product rather than inventing a value for it).

## 2. Severity and remediation priority — every confirmed issue gets both

| Severity | Definition |
|---|---|
| `CRITICAL` | Immediate security, privacy, destructive-integrity, or regulatory risk. |
| `HIGH` | Material production risk or a violation affecting important entities. |
| `MEDIUM` | Meaningful inconsistency, reliability risk, or maintainability problem. |
| `LOW` | Minor deviation with limited operational impact. |

| Priority | Expected action |
|---|---|
| `P0` | Block release or remediate immediately. |
| `P1` | Remediate in the current delivery cycle. |
| `P2` | Schedule in the next planned cleanup cycle. |
| `P3` | Track as improvement or accepted debt. |

Severity describes impact; priority describes when the team should act. They are not
interchangeable — a `CRITICAL` issue on a table nobody touches for another quarter can still be
`P1` rather than `P0` if there's a real dependency blocking immediate action, and that dependency
must be named in the issue's `Recommended change` field if so.

## 3. Stable issue IDs

Every finding gets an ID of the form:

```
<STANDARD>-<TABLE>-<SEQUENCE>
```

```
D4-users-001
D5-lesson-plans-001
D3-users-002
```

Normalize long table names to a readable slug. **Preserve IDs across repeated audits when the
same underlying issue remains** — this is what makes "is this the same finding as last time"
answerable without re-reading both reports side by side. If a prior audit report or issue-tracking
file is available, read it first and carry forward matching IDs; only mint a new sequence number
for a genuinely new issue on that table+standard pair.

## 4. Exact locations — never bury multiple tables in one evidence cell

Every issue must identify, as separate fields:

- schema, if applicable
- table
- column or constraint, if applicable
- source file
- line number or migration identifier, when available

**One row per actionable issue.** If the same violation affects several tables, either create
separate issue rows or one clearly labeled grouped issue with a complete affected-table list —
never a paragraph that silently mixes findings from `users`, `students`, and `lesson_plans`
together.

## 5. Separate facts from recommendations

Each issue carries these fields, kept distinct — do not merge evidence, interpretation, and
remediation into one paragraph:

- **Finding** — what was observed
- **Evidence** — the exact schema or migration evidence (a concise DDL excerpt, not a wall of text)
- **Risk** — why the finding matters
- **Recommended change** — what the team should change
- **Verification** — how to prove the remediation worked

## 6. Confirmed violations vs. missing evidence — never convert one into the other

Do not mark a standard `FAIL` merely because a required signal wasn't found in the artifact you
were given.

- `FAIL` — the available evidence **confirms** a violation.
- `NOT ASSESSED` — the check needs information that's unavailable or can't be inferred from DDL
  alone. Say explicitly what additional evidence is needed (a data-classification registry,
  runtime configuration, application-layer validation, a live query against the actual database).

Example: the absence of sensitivity labels in DDL might be a real governance gap, but first check
whether the standard actually requires labels to live in DDL — [reference/standards.yaml](standards.yaml)'s
own text tells you. If it doesn't, report `NOT ASSESSED` ("could not be completed from schema
files alone — check the metadata catalog"), not `FAIL`. This mirrors the existing "What this
script can and cannot check" section in `SKILL.md` — that section explains *why* many standards
can't be schema-checked; this section tells you what verdict to write down when that's the case.

## 7. Coverage and denominators — always show both counts and percentages

```
94 of 100 tables use UUID primary keys (94%).
6 tables require review.
```

For every standard in the scorecard, report: objects assessed, objects passed, objects with
confirmed issues, objects not assessed, and the coverage percentage. **Never present a percentage
without its denominator** — "94% compliant" alone hides whether that's 94/100 or 15/16.

## 8. Confidence — per issue, distinct from severity

| Confidence | Meaning |
|---|---|
| `HIGH` | Directly confirmed by explicit DDL, constraints, or migrations. |
| `MEDIUM` | Strongly indicated, but one source or runtime detail is missing. |
| `LOW` | Possible issue requiring manual validation. |

**Low-confidence findings must never be presented as confirmed failures.** A `LOW`-confidence
issue can still be `FAIL` if you're confident about the *violation itself* but not about some
peripheral detail (e.g. certain the column is unmasked, unsure whether it's actually read by any
live code path) — confidence qualifies your certainty in the finding, not whether it's real.

## 9. SQL recommendations — no speculative destructive SQL, and get the sequencing right

Recommend SQL only when the required schema context is actually known — read the real DDL, don't
guess at column types or existing constraints.

- State explicitly whether a SQL block is an **illustrative example** or an **executable
  migration** — never let the reader assume one when you mean the other.
- Preserve existing data and dependencies.
- Identify index, foreign-key, RLS, trigger, and application impacts the change would have.
- **Never recommend a destructive change** (`DROP COLUMN`, `DROP TABLE`, a rename that breaks a
  live reader) without a migration *and* a rollback plan attached to the same recommendation.

### Backfill sequencing — get this order wrong and the backfill silently does nothing

A migration that adds a `NOT NULL` column needs a backfill step, but **the order of operations
determines whether the backfill actually runs against real data**. The common mistake: adding the
column with `DEFAULT NOW() NOT NULL` in the *same* statement that adds it. Every existing row
then receives the default value **at column-add time**, before any backfill `UPDATE` executes —
so a follow-up `WHERE updated_at IS NULL` backfill finds zero rows to update, because none are
null anymore. The intended historical backfill silently never happens, and the mistake is easy to
miss because the migration runs without error and the column is genuinely non-null afterward —
it's just populated with the wrong value for every pre-existing row.

**Correct sequence — add nullable, backfill, then constrain:**
```sql
-- Illustrative only. Confirm the source timezone and table mutability first.
ALTER TABLE lesson_plan_requests
  ADD COLUMN updated_at TIMESTAMPTZ;                    -- 1. add nullable, no default yet

UPDATE lesson_plan_requests
SET updated_at = COALESCE(created_at AT TIME ZONE 'UTC', NOW())
WHERE updated_at IS NULL;                                -- 2. backfill while the column is still
                                                          --    nullable, so every existing row is
                                                          --    genuinely NULL and gets touched

ALTER TABLE lesson_plan_requests
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;                  -- 3. only now add the default + NOT NULL,
                                                          --    so it applies to *future* rows only
```
Then add and test the approved update-tracking mechanism (trigger or application-layer write)
**separately** — this migration only gets the column and its historical data correct; it does not
by itself make `updated_at` update on every future write.

**Verification for this class of migration:**
- Existing rows retain an appropriate historical value (spot-check against `created_at` or another
  known-good signal) — not the migration's execution timestamp.
- New rows receive the default.
- Updating a row changes `updated_at` (once the separate trigger/application mechanism is in
  place and tested).
- No application or reporting dependency that reads this column breaks.

## 10. Reconciliation discipline — compute totals from the register, never write them independently

Every numeric or categorical claim in the executive summary and the standards scorecard must be
**derived from the detailed issue register after it's finished**, not typed in parallel while
writing the register. Writing both from memory at the same time is exactly how a summary and its
own detail register end up disagreeing — this has happened in production runs of this skill and is
the single most common defect class in this report format. Concretely:

- **Finish the detailed issue register first.** Only then tally: count the issue blocks for
  "Confirmed issues," count blocks by `Severity` field for the Critical/High/Medium/Low row. Do
  not write the executive-summary numbers from your running mental tally as you go — recount from
  the finished register.
- **A standard's severity/verdict is single-sourced.** Whatever the standard's highest-severity
  confirmed issue says in its detailed record is what the scorecard row says too — never
  independently re-judge a standard's severity when filling in the scorecard. If the scorecard and
  the detailed register would ever disagree, that's a bug in the report, not a stylistic choice —
  fix the scorecard to match the record, or fix the record if it was wrong, but never leave both
  standing.
- **A count claim must equal the length of its own accompanying list.** If a finding says
  "affects 9 tables," the table list directly below it must contain exactly 9 distinct table
  names — not 14, not "9 plus a few more on request." If the real list is longer than the claimed
  count, fix the count; never truncate or hand-wave the list to match a stale number.
- **Every issue ID that appears anywhere (scorecard, table register, remediation plan) must have a
  matching detailed record.** An ID referenced in the scorecard with no `#### \`ID\`` section in
  the detailed issue register ("Required report structure" §6) is a dangling reference — either
  write the record or remove the reference. This applies to
  `NOT ASSESSED` issue IDs too (e.g. `D6-schema-001`, `D7-schema-001`) — they get full detailed
  records like any other issue, just with `Verdict: NOT ASSESSED` and no `Severity` (see the
  variant record shape below).
- **Denominators are applicable objects, not all objects.** Before computing a standard's
  coverage percentage, classify every object that doesn't obviously pass: is it a genuine
  violation (`FAIL`/`PARTIAL`), a documented exception, or truly out of scope for this standard
  (`NOT APPLICABLE` — a reference/benchmark/test table, for instance)? Only then compute
  `passed / applicable`. Counting a `NOT APPLICABLE` object in the denominator as if it needed to
  pass (or silently dropping it without saying so) both produce a number nobody can reproduce from
  the underlying list.
- **"Fully compliant" requires every applicable standard to have passed — no exceptions stated
  informally in prose.** Never describe an artifact (a migration, a table, a service) as "fully
  compliant" or "passes all applicable standards" if even one applicable standard on it is
  `FAIL`/`PARTIAL`. If a migration is otherwise clean but has one confirmed issue, say exactly
  that: "passes D1, D3, D5; fails D4 because …" — not "is fully compliant" followed by a
  contradicting finding elsewhere in the same report.
- **A standard that has both a structural (schema-visible) half and a runtime (live-data) half
  gets both verdicts stated, not one verdict standing in for both.** If a standard's own text
  requires only the structural check, a clean structural result can stand alone as that standard's
  verdict — but say explicitly that the runtime half wasn't assessed as a **separate supplemental
  line**, so a reader never assumes live data integrity was verified when it wasn't:
  ```
  D3 — Hard Referential Integrity
  Static structural check (DDL foreign keys): PASS, 100/100
  Runtime orphan check (live data): NOT ASSESSED — see D3-runtime-001
  ```
  Do not give a standard an unconditional `PASS` when only its structural half was checked.
- **State dependency framing once, consistently, and split remediation by what's actually
  blocked.** If a fix has an immediate-containment step that doesn't depend on anything, and a
  durable-fix step that depends on a separate decision (e.g. a classification ruling), say so as
  two ordered phases everywhere the fix is mentioned — never let the executive summary imply "no
  blocker" while the detailed issue and remediation plan say "blocked on X." Recommended split:
  1. **Immediate containment** — what can start today, no dependency.
  2. **Blocking decision** — the specific decision or artifact that must land before the durable
     fix can proceed (name it explicitly).
  3. **Durable fix** — the actual remediation, once the blocking decision resolves.
  4. **Cutover / cleanup** — removing the old path once the durable fix is live everywhere.

### Variant detailed-record shape for `NOT ASSESSED` issues

A `NOT ASSESSED` finding still gets a full record in the detailed issue register ("Required report
structure" §6), in this shape (severity/priority read differently than a confirmed issue —
priority reflects how urgently the missing evidence should be obtained, not remediation urgency
for a violation that hasn't been confirmed):

```markdown
#### `<ISSUE-ID>` — `<what evidence is missing>`

| Field | Value |
|---|---|
| Standard | <standard> |
| Verdict | `NOT ASSESSED` |
| Severity | Not assigned — no violation has been confirmed |
| Priority | `<P-level, reflecting urgency of obtaining the missing evidence>` |
| Confidence | `HIGH` that the required evidence is unavailable in the assessed files (this
  confidence describes certainty about the *gap*, not about a hidden violation) |
| Scope | <what was actually inspected> |
| Required evidence | <the specific artifact/registry/config that would resolve this> |

**Finding**
<what's missing and why it couldn't be inferred from the assessed artifact>

**Required manual check**
<the concrete action a human takes to close this gap>

**Verification**
- <checkable steps confirming the manual check actually closed the gap>
```

`NOT ASSESSED` issues are never counted in "Confirmed issues" in the executive summary — track
them separately as "Manual-review items" (see the executive-summary template in "Required report
structure" §2).

## 11. Legacy vs. new-schema results — report both, separately

If recent migrations comply but legacy tables don't, say so as two separate facts. The **overall
verdict reflects the unresolved production state**, not just the quality of new work:

```
Overall verdict: FAIL
New migrations: PASS
Legacy schema: 3 confirmed violations remain
```

Do not let a clean set of new migrations paper over unresolved legacy violations in the headline
verdict — that's exactly the kind of false confidence this report format exists to prevent.

---

## Required report structure

Produce these sections, in this order.

### 1. Audit header

- audit date
- repository or project
- branch and **exact commit SHA** when available — "main" alone isn't reproducible; if there's no
  commit (a local diff, an ungit'd file), say so explicitly rather than omitting the field
- schema files inspected — as **repo-relative paths**, never a local absolute path
  (`c:\Users\...`, `/home/...`) — this header is written to be shared, and a local machine path
  both leaks information about the auditor's machine and is meaningless to anyone else who opens
  the report
- migrations inspected
- standards version (the `status` field / effective date from [standards.yaml](standards.yaml))
- working tree state — clean, or modified with the relevant uncommitted files named (a report
  audited against uncommitted changes is not reproducible from the commit SHA alone; say so)
- exclusions and limitations

### 2. Executive summary

| Metric | Result |
|---|---|
| Overall verdict | `FAIL` |
| Tables inspected | 100 |
| Applicable table-standard checks | 91 |
| Standards assessed | 6 |
| Confirmed issues | 15 |
| Critical / High | 2 / 6 |
| Medium / Low | 5 / 2 |
| Manual-review items | 3 |
| Standards not assessed | D6, D7 |

All totals in this table must reconcile exactly with the detailed issue and manual-review
registers (§10) — recompute from the finished registers, never carry forward a running count.

Plus the three most important next actions, in plain language.

### 3. Standards scorecard

Compact — no evidence lives here, only pointers to issue IDs.

| Standard | Verdict | Coverage | Affected tables | Highest severity | Issue IDs |
|---|---|---:|---:|---|---|
| D1 Unique Entity IDs | `PARTIAL` | 100/100 | 6 | `MEDIUM` | D1-training-levels-001, … |
| D2 Shift-Left Validation | `PARTIAL` | 100/100 | 8 | `HIGH` | D2-users-001, … |
| D3 Referential Integrity | `FAIL` | 100/100 | 1 | `HIGH` | D3-users-001 |
| D4 PII Isolation and Masking | `FAIL` | 100/100 | 8 | `CRITICAL` | D4-users-001, … |
| D5 Timestamps and UTC | `FAIL` | 100/100 | 9 | `HIGH` | D5-users-001, … |
| D6 Classification and Labels | `NOT ASSESSED` | DDL only | — | — | D6-schema-001 |

### 4. Table compliance register

The main navigation view. Every table with an issue; clean tables may go in the appendix
("Required report structure" §9) instead of repeating here. **This register contains database
tables only** — a migration-tooling gap, a CI/deployment finding, or any other non-table object
belongs in the separate "Infrastructure and process findings" register ("Required report
structure" §5, immediately below), never mixed into this one.

| Table | Status | Standards affected | Issue IDs | Highest severity | Recommended action |
|---|---|---|---|---|---|
| `users` | `FAIL` | D2, D3, D4, D5 | D2-users-001, D3-users-001, D4-users-001, D5-users-001 | `CRITICAL` | Fix phone protection, verify FK, and migrate timestamps. |
| `students` | `FAIL` | D4 | D4-students-001 | `CRITICAL` | Protect or tokenize raw phone data. |
| `lesson_plans` | `FAIL` | D5 | D5-lesson_plans-001 | `HIGH` | Add UTC-aware update timestamps if mutable. |

**One row per table, always — never a grouped or summarized row.** "66 additional mutable
tables" or "see full list on request" are not acceptable rows: a table owner scanning this
register for their own table's name must find it directly, every time. If 40 tables share the
exact same finding (e.g. all missing a `deleted_at` column), that is 40 rows in this register —
tedious to write, but the alternative silently hides which specific tables are affected and makes
the register useless as the thing a table owner actually checks. List every affected table by
name somewhere reachable from this register (this table itself, or a labeled full-list appendix
this table links to by name — never "available on request").

Sort by highest severity, then table name. The `Issue IDs` column is how a reader jumps from this
register straight to the detailed record in §6 — every ID listed here must resolve to a real
`#### \`ID\`` subsection (see §10's reconciliation rule on dangling references).

### 5. Infrastructure and process findings

A finding that isn't about a specific database table — a migration-tooling gap, a CI/deployment
process issue, a missing rollback-drill schedule — never belongs in the table compliance register
above. Give it its own register instead:

| Object | Status | Standard | Issue ID | Severity | Recommended action |
|---|---|---|---|---|---|
| Migration deployment path | `PARTIAL` | D8 | D8-infra-001 | `MEDIUM` | Wire the migration runner into the supported deployment command and CI/staging process. |

Same rules as the table register: one row per finding, `Issue ID` resolves to a real detailed
record, sorted by severity.

### 6. Detailed issue register

One subsection per issue, this exact shape:

```markdown
#### `<ISSUE-ID>` — `<short issue title>`

| Field | Value |
|---|---|
| Standard | D4 — PII Isolation and Masking |
| Verdict | `FAIL` |
| Severity | `CRITICAL` |
| Priority | `P0` |
| Confidence | `HIGH` |
| Schema | `public` |
| Table | `users` |
| Column / constraint | `phone_number`, `idx_users_phone` |
| Source | `infrastructure/supabase/00_complete-schema.sql:73` |

**Finding**
<what was observed, one or two sentences>

**Evidence**
<concise DDL excerpt or exact structural observation — keep quoted source short>

**Risk**
<why the finding matters>

**Recommended change**
<what the team should change — SQL labeled example/executable per §9 if included>

**Verification**
- <bulleted, checkable steps — including "re-run this standard and confirm the issue ID clears">

**Suggested owner**
<team>
```

### 7. Recommended remediation plan

Group by priority and dependency; link to issue IDs rather than repeating their descriptions. For
a finding with an immediate-containment / blocking-decision / durable-fix split (see §10), show
that split as separate ordered rows rather than collapsing it into one "Dependency" cell that
hides the containment step is unblocked:

| Order | Action | Issue IDs | Owner | Dependency | Verification |
|---:|---|---|---|---|---|
| 1 | Immediate containment — restrict access, prevent new raw-PII columns | D4-* | Platform + Security | None — starts now | Access review complete; no new raw-PII columns merge |
| 2 | Classification decision | D4-*, D6-schema-001 | Data governance | — | D6 classification approved |
| 3 | Durable protected-data migration (tokenize / hash) | D4-* | Platform | Step 2 approved | D4 passes and app lookup tests pass |
| 4 | Verify or add missing foreign keys | D3-* | Database | Orphan-data check | FK metadata and orphan query pass |
| 5 | Migrate mutable timestamps to `TIMESTAMPTZ` | D5-* | Database | Backfill plan (§9 sequencing) | Type and UTC tests pass |

### 8. Manual checks and limitations

Anything the audit couldn't prove automatically:

- standards requiring runtime behavior
- sensitivity classifications stored outside the schema
- application validation not represented in DDL
- dynamic SQL or generated migrations
- missing, conflicting, or stale canonical schema files

For each, state what evidence a human must supply.

### 9. Clean tables and passed checks

A compact appendix of compliant tables / passed controls — keeps the report honest about what
*did* pass, not just what failed.

---

## Navigation both directions

A reader must be able to go either way through the report:

- **Standard → affected tables → detailed issues** (via the scorecard's Issue IDs column)
- **Table → failed standards → recommended changes** (via the compliance register)

## Acceptance criteria

This report is done when every item below is true. Check every one before calling the report
final — most of these were written after a real report shipped violating them, so treat the list
as load-bearing, not aspirational:

- [ ] A reader can identify every affected table from the first two sections alone.
- [ ] Every `FAIL`/`PARTIAL` standard links to one or more issue IDs.
- [ ] Every issue names an exact table and, when applicable, a column or constraint.
- [ ] Confirmed issues and manual-review (`NOT ASSESSED`) items are visibly distinguishable, and
      `NOT ASSESSED` items are excluded from the "Confirmed issues" count.
- [ ] Every confirmed issue has an actionable recommendation and a verification method.
- [ ] **The confirmed-issue count in the executive summary equals the number of confirmed-issue
      records in the detailed register** — recount from the finished register, don't carry
      forward a running tally (§10).
- [ ] **Severity totals (Critical/High/Medium/Low) in the executive summary equal the actual
      severity breakdown of the detailed register** — recount, don't estimate.
- [ ] **Every standard's severity in the scorecard matches its highest-severity confirmed issue in
      the detailed register** — never independently re-judged in the scorecard (§10).
- [ ] **Every count claim (e.g. "affects 9 tables") equals the length of its own accompanying
      table list** — if they disagree, fix the count or the list, never leave both standing (§10).
- [ ] **Every coverage denominator counts only applicable objects** — `NOT APPLICABLE` and
      documented-exception objects are classified and excluded before the percentage is computed,
      not silently included or silently dropped (§10).
- [ ] **No artifact is called "fully compliant" while any applicable standard on it is
      `FAIL`/`PARTIAL` elsewhere in the same report** (§10).
- [ ] **A standard split into a structural half and a runtime half states both verdicts** — never
      one unconditional verdict standing in for a half that wasn't actually checked (§10).
- [ ] **Dependency framing is consistent everywhere the same fix is mentioned** — the executive
      summary, the detailed issue, and the remediation plan never disagree about what's blocked on
      what (§10).
- [ ] An unresolved finding from a prior audit keeps its issue ID on this one.
- [ ] Clean tables and passed checks are represented, not just failures.
- [ ] No evidence cell contains findings for more than one table.
- [ ] **The table compliance register has one row per table — no grouped/summarized rows**
      ("Required report structure" §4), and every affected table is named somewhere reachable from
      it, never "available on request."
- [ ] **Non-table findings (migration tooling, CI/deployment, process gaps) live in the
      infrastructure findings register, not mixed into the table register** ("Required report
      structure" §5).
- [ ] **Any SQL backfill example adds the column nullable, backfills, then sets the default/
      NOT NULL** — never in the order that makes the backfill a no-op (§9).
- [ ] **The audit header names an exact commit SHA (or explicitly says there isn't one) and
      contains no local machine path** ("Required report structure" §1).

## Optional machine-readable companion

If the report will feed a dashboard or an automated check, emit a JSON sidecar alongside the
Markdown report — never replace the human-readable report with JSON.

```json
{
  "issue_id": "D4-users-001",
  "standard_id": "D4",
  "verdict": "FAIL",
  "severity": "CRITICAL",
  "priority": "P0",
  "confidence": "HIGH",
  "schema": "public",
  "table": "users",
  "object": "phone_number",
  "object_type": "column",
  "source": {
    "file": "infrastructure/supabase/00_complete-schema.sql",
    "line": 73
  },
  "finding": "Raw phone data is stored and indexed.",
  "risk": "Sensitive identifiers may be exposed through unrestricted data paths.",
  "recommended_change": "Use an approved protected representation and remove the raw-value index after migration.",
  "verification": [
    "No prohibited raw-value index remains",
    "Authorized lookup tests pass",
    "RLS matches the classification policy"
  ]
}
```
