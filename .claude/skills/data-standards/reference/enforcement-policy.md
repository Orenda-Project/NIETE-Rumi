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
| Duplicate migration version | D8 | Two migration files claiming the same version number/timestamp prefix is a filename collision, not an inference |
| Destructive migration without safety metadata | D8/D17 | A `DROP COLUMN`/`DROP TABLE`/`TRUNCATE` statement with no accompanying rollback script or explicit `-- destructive: reviewed` marker |
| New restricted-PII field without required protection/classification metadata | D4/D6 | A newly added column matching a known PII name pattern (phone, cnic, ssn, email, dob) with no adjacent classification comment/registry entry |
| Malformed validator output | — | If the validator itself can't produce a well-formed report (see exit code 2), that is treated as a failure, not a silent pass — an enforcement layer that can't confirm compliance must never behave as if compliance was confirmed |
| New violation of a non-negotiable standard (D1-D8) not already listed above | D1-D8 | Any other NON-NEGOTIABLE-tier hit that the deterministic scanner confirms via its `detect` patterns AND a structural check (not keyword-only) |

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
by it — is reported (visibly, not hidden) but does **not** block an unrelated change. Blocking every
commit in a repository until all historical debt is cleared makes the gate impossible to adopt
incrementally and gets it disabled. See [audit-report-format.md](audit-report-format.md) §11 for
how legacy vs. new-schema results are reported as separate facts even though only one blocks.

## Strict mode

An optional strict mode (opt-in, never the default) escalates specific advisory findings to
blocking for teams that have already cleared their baseline debt and want the gate to mean more.
Which specific advisory checks strict mode promotes is a per-repository configuration decision, not
a global default — document the choice in the repo's own `.data-standards.json` (see
[detection-guidance.md](detection-guidance.md) "Configuring paths") rather than baking it into this
reference file.
