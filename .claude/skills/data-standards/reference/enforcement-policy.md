# Enforcement Policy — What Blocks, What's Advisory

Read this before wiring `scripts/validate_schema.py`'s output into anything that can stop a
commit, push, or PR. The rule that governs every blocking decision in this skill: **only
deterministic, high-confidence checks may block.** Model-written prose is never, by itself, the
thing that blocks a change — a blocking decision must trace to a specific mechanical check against
real DDL/migration text, not an LLM's judgment call about whether something "looks risky."

## Blocking findings (exit code 1 from the validator)

A confirmed instance of any of these blocks the operation, in every enforcement layer (Claude gate,
Git hook, CI):

| Finding | Standard | Why it's mechanical, not judgment |
|---|---|---|
| Missing mandatory primary key | D1 | A `CREATE TABLE` with no `PRIMARY KEY` clause is a grep-detectable structural fact |
| Prohibited identifier type on an applicable entity | D1 | A PK column typed `SERIAL`/`INTEGER`/bare `TEXT` instead of `UUID`, on a table not marked `NOT APPLICABLE` for D1, is directly readable from the DDL |
| Bare `TIMESTAMP` where `TIMESTAMPTZ` is mandatory | D5 | A column typed `TIMESTAMP` with no `WITH TIME ZONE` in a `created_at`/`updated_at`-named column is a type-string match |
| Missing mandatory constraint or referential integrity | D3 | A column named `*_id` with no matching `REFERENCES`/`FOREIGN KEY` clause anywhere in the same migration, on a table that isn't documented as having no parent |
| Destructive migration without safety metadata | D8/D17 | A `DROP COLUMN`/`DROP TABLE`/`TRUNCATE` statement with no accompanying rollback script or explicit `-- destructive: reviewed` marker (statements after a `-- migrate:down` / `-- rollback` section marker are undo code and are skipped) |
| Renamed column or table | D12 | `RENAME COLUMN` / `RENAME TO` breaks any code still using the old name the moment it runs. Exception: a `-- breaking: reviewed` marker in the 200 characters before it |
| New `NOT NULL` column without a `DEFAULT` | D12 | `ADD COLUMN ... NOT NULL` with no `DEFAULT` fails on a table with rows, and old code inserting without it breaks. Same `-- breaking: reviewed` exception |
| New restricted-PII field without required protection/classification metadata | D4/D6 | A newly added column matching a known PII name pattern (phone, cnic, ssn, email, dob) with no adjacent classification comment/registry entry |
| Malformed validator output | — | If the validator itself can't produce a well-formed report (see exit code 2), that is treated as a failure, not a silent pass — an enforcement layer that can't confirm compliance must never behave as if compliance was confirmed |
| New violation of a non-negotiable standard (D1-D8) not already listed above | D1-D8 | Any other NON-NEGOTIABLE-tier hit that the deterministic scanner confirms via its `detect` patterns AND a structural check (not keyword-only) |

## Checks that block by default but a repo may keep as warnings

These were warn-only from 5 Nov 2026 and **block by default since 2026-11**. They are read
from the SQL text just as mechanically as the checks above, but a repo can have a fair reason to
keep one as a warning while it catches up. Run on the 40 newest migrations of each repo, judged as
new (10 Nov 2026): **whatsapp-ai-bot** would block 35 of 40, mostly `D17-no-rollback` (34) and
`D9-no-deleted-at` (11); **NIETE-Rumi** 18 of 40, mostly `D9-no-deleted-at` (11). A repo in that
position lists the checks it is not ready for under `"warn_only"` in its `.data-standards.json`
(see "Keeping a check as a warning"). The check ids, modes and reasons live in `enforcement:` in
[standards.yaml](standards.yaml).

A check kept as a warning is shown to the developer, in the PR comment, as a CI annotation, on the
gate board as `PASS WITH WARNINGS` (counted as a pass) and in Slack, always with the reason from
its `why`.

| Check | Standard | What it flags |
|---|---|---|
| `D8-duplicate-version` | D8 | Two forward migrations with the same version number (plain date prefixes are skipped) |
| `D9-hard-delete` | D9 | `DELETE FROM` in a migration |
| `D9-no-deleted-at` | D9 | A new table with no `deleted_at` (log/event/history-named tables skipped) |
| `D14-table-name` | D14 | A new table name that isn't snake_case or plural |
| `D14-boolean-prefix` | D14 | A boolean column not starting `is_`/`has_`/`can_` |
| `D14-timestamp-suffix` | D14 | A timestamp column not ending `_at` |
| `D15-free-text-category` | D15 | A `status`/`type`/`category`/`role`/... text column with no enum, `CHECK` or lookup table |
| `D16-no-is-test` | D16 | A new users/teachers/students/accounts-style table with no `is_test` |
| `D17-no-rollback` | D17 | A new migration with no rollback/down file beside it and no `-- migrate:down` section |

### Keeping a check as a warning

```json
{ "warn_only": ["D17-no-rollback", "D9-no-deleted-at"] }
```

in the repo's `.data-standards.json` turns those checks back into warnings for that repo only. A
standard id (`"D14"`) covers every check of that standard that is in the table above. Only these
nine checks can be listed. The checks in "Blocking findings" have no `why` in `standards.yaml`
and always block, whatever `warn_only` says. `"strict"` (see "Strict mode") is applied after
`warn_only`, so a check in both lists blocks. Treat a `warn_only` entry as a debt with an owner: say
in the PR that adds it why the repo is not ready and when it will be removed.

For a single change that is a fair exception (a column named to match an outside API, say), use
the bypass with a reason instead (`TALEEMABAD_DATA_STANDARDS_BYPASS`, see SKILL.md). It is
recorded on the gate board and posted to Slack.

### Rollback files and down sections are undo code

A file named as a rollback (`ROLLBACK_V1.2__x.sql`, `rollback_0003_x.sql`, Flyway undo
`U1.2__x.sql`, `0003_x.down.sql`, `0003_x_rollback.sql`) undoes its migration: dropping what it
created, deleting what it inserted, renaming back. In such a file `D8-destructive`, `D9`, `D12`,
`D14`, `D15` and `D16` are skipped; a table it recreates is the old design, judged when it was
first created. The D1, D3, D4 and D5 structure checks still apply. Code after a `-- migrate:down` /
`-- rollback` / `-- down` marker inside a forward migration is undo code the same way for
`D8-destructive`, `D9-hard-delete` and `D12`. Only the file NAME makes a rollback file: a forward
migration called `V1.2__add_rollback_reason.sql` is judged in full. Measured on NIETE-Rumi
(18 Nov 2026): before this, 20 of its 63 `ROLLBACK_` files would have been blocked; now none are.

### Files in a migrations folder

`D8-migration-tool` ("raw CREATE/ALTER TABLE with no migration-tool marker") is for DDL outside a
migration tool, such as an edited `schema.sql`. A `.sql` file inside a folder named `migrations`,
`migration`, `migrate` or `db_migrations` is run by that repo's migration tool, so the check skips
it. Before this, NIETE-Rumi's `ROLLBACK_V1.9.9__own_plans_review.sql` was blocked because the
rollback file had no tool name in its text.

## Advisory / manual-review findings (never block on their own)

These surface in the report as `NOT ASSESSED` or a low/medium-confidence advisory note, and never
stop a commit/push/merge by themselves:

- Inferred mutability (whether a table is genuinely append-only vs. mutable often can't be proven
  from DDL alone)
- An external ownership or classification registry being unavailable to check against (D7, D6)
- Possible application-layer validation that might already cover a D2 concern, invisible in DDL
- Architectural preference (e.g. "this could be a view instead of a new table") — a suggestion,
  never a gate
- Low-confidence model inference — anything the scanner or an agent flags with `Confidence: LOW`
  per [audit-report-format.md](audit-report-format.md) §8
- Anything requiring live-data checks unavailable to a static, pre-merge gate (orphan counts,
  freshness SLAs, actual index usage)

## The line between the two lists

If a finding requires a live database query, an external registry lookup, or genuine judgment
about intent ("is this table really append-only?"), it cannot block — no enforcement layer here has
live-database access, and blocking on an unconfirmable guess produces exactly the false-positive
fatigue that gets a gate disabled by an annoyed team. If a finding is fully readable from the
diff/DDL text with a structural check (not just a keyword hit), it can block.

**A model's narrative judgment about a blocking finding is never sufficient on its own.** An agent
reading a migration and concluding "this looks like it's missing a foreign key" must be backed by
the deterministic check actually confirming the absence of a `REFERENCES`/`FOREIGN KEY` clause in
that table's DDL block — the agent's prose explains and contextualizes the finding for a human
reader; the validator's structural check is what actually authorizes the block.

## Regressions vs. existing debt

A **regression** — a standard that was passing on the base commit and now fails on the proposed
change — is always treated with the same severity as a brand-new violation on a new object; "it
used to pass" is not a mitigating factor.

**Pre-existing debt** — a violation that already existed before this change and isn't made worse
by it — is reported (visibly, not hidden) but does **not** block an unrelated change.
`validate_schema.py` does this by running every check on each changed file twice, before and after
the change (base and head commits in CI, `HEAD` and the index at commit time, the file on disk and
the edit's result in the live Claude gate), and listing anything found both times under `existing`.
Editing an old, large `schema.sql` therefore only blocks on what the edit adds. Blocking every
commit in a repository until all historical debt is cleared makes the gate impossible to adopt
incrementally and gets it disabled. See [audit-report-format.md](audit-report-format.md) §11 for
how legacy vs. new-schema results are reported as separate facts even though only one blocks.

## Strict mode

An optional strict mode (opt-in, never the default) escalates specific advisory findings to
blocking for teams that have already cleared their baseline debt and want the gate to mean more.
Which specific advisory checks strict mode promotes is a per-repository configuration decision, not
a global default — document the choice in the repo's own `.data-standards.json` (see
[detection-guidance.md](detection-guidance.md) "Configuring paths") rather than baking it into this
reference file. The key is `"strict"`: a list of check ids, or standard ids (`"D15"`) to promote
every check of that standard. Since every check blocks by default (2026-11), `strict` only matters
to undo a `warn_only` entry, for example one inherited from a shared config.
