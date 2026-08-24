# Orientation — What This Skill Is, In Plain Language

Read this if you're new to `data-standards` and want the full picture, not just the short spoken
intro Claude gives on a first trigger (see SKILL.md's "First trigger in a session" section — that
blurb links here for anyone who wants more than three sentences).

## What a "schema" actually is

A **schema** is the structure of a database table — not the data inside it, but the shape that
data is forced to fit into. Concretely, a schema defines:

- **Columns** — the named fields a row can have (`email`, `created_at`, `user_id`).
- **Types** — what kind of value each column accepts (`UUID`, `TIMESTAMPTZ`, `VARCHAR(255)`).
- **Keys** — a **primary key** uniquely identifies each row in a table; a **foreign key** points
  from one table to a row in another (e.g. an `orders` row's `user_id` points to a real row in
  `users`).
- **Constraints** — rules the database itself enforces (a column that can't be empty, a value that
  must be unique, a reference that must point to something real).

A **migration** is a script that changes a schema over time — adding a column, creating a new
table, dropping something no longer needed. "Auditing a schema" or "reviewing a migration" means
reading that structure (or the script that changes it) and checking it against a set of rules
before or after it ships — not reading the data, not guessing at intent, just the shape.

## What the 27 Data Standards actually are

Taleemabad has 27 written rules (`D1` through `D27`) for how every database table across every
product should be built. They exist because a schema decision made once, cheaply, at table-creation
time — is expensive to undo later once millions of rows depend on it. Examples of what a standard
actually says, in plain terms:

- **D1**: every table's primary key must be a UUID, not an auto-incrementing integer (`SERIAL`) —
  auto-incrementing IDs leak how many rows exist, collide across merged databases, and are
  guessable.
- **D4**: any column holding personal information (email, phone, CNIC, date of birth) must be
  explicitly labeled as such in the schema — so nobody downstream treats a phone number column
  like ordinary, unrestricted data.
- **D5**: any timestamp column must store a timezone (`TIMESTAMPTZ`), not a bare `TIMESTAMP` — a
  bare timestamp is ambiguous the moment two servers in different timezones write to the same
  table.
- **D8**: every schema change goes through a tracked migration file, never a manual, unrecorded
  `ALTER TABLE` run by hand — so there's always a record of what changed, when, and by whom.

Full statements for all 27 live in [standards.yaml](standards.yaml) — the plain-English summaries
above are illustrative, not the actual wording.

### The four tiers — not just a priority list

The 27 standards are grouped into four tiers, and the grouping is a **dependency order**, not just
"nice to have vs. critical":

| Tier | Meaning | IDs |
|---|---|---|
| **NON-NEGOTIABLE** | Ship nothing without these | D1-D8 |
| **ESSENTIAL** | The quality multipliers, adopt next | D9-D16 |
| **ADVANCED** | Compounding advantages, earn the right | D17-D22 |
| **SPECIALIZED** | Single-service or Phase 2 | D23-D27 |

Some standards only work *because* another one underneath them holds — e.g. D6 (sensitivity
labels) is what makes D4 (PII masking) checkable at all; fixing D4 without D6 in place doesn't
actually hold up. See `standards.yaml`'s `depends_on`/`enables` fields for the full dependency map.

## What the skill actually does — the two halves

**Half one: on-demand audit.** Ask a plain-English question — "does this migration meet our data
standards," "is this table PII-safe," "what does D6 require," "audit this schema" — or type
`/data-standards`. Claude reads the actual file (schema dump, migration script, or PR diff),
checks it against the relevant standards, and returns a structured report: a plain pass/fail/not-
assessed per rule, with the specific evidence (which line, which column) behind each verdict — not
a vague opinion. For a full audit, the report format is fixed (see
[audit-report-format.md](audit-report-format.md)): verdicts, severity, stable issue IDs that
persist across repeat audits, and a prioritized remediation plan.

**Half two: automatic enforcement.** This is the part that runs without anyone asking for it. A
shared validator script checks every schema-shaped `git commit`, `git push`, or PR against the
NON-NEGOTIABLE tier's structural rules (things a program can actually verify from the DDL text
itself — a missing UUID primary key, a bare `TIMESTAMP`, an unlabeled PII column — never a
judgment call). Four things happen depending on what it finds:

1. **A clean change passes silently** — nothing blocks, nothing is said.
2. **A confirmed violation blocks the commit** — Claude's own gate hook stops it before it leaves
   the session; a local git hook does the same for a plain terminal `git commit` outside Claude;
   and a CI template exists so a repo's own GitHub Actions can enforce it as a required check that
   `--no-verify` can't route around.
3. **A validated bypass lets it through anyway** — but only with a real, specific reason (a ticket
   number, an incident, a named approver — not "fix later" or a bare "1"), and every bypass is
   permanently logged with who did it, the real commit, and which standards were skipped. See
   [enforcement-policy.md](enforcement-policy.md) for exactly what can and cannot block.
4. **The Data Team's Slack channel finds out automatically** — a block or an accepted bypass posts
   a notification with no extra setup, so nobody has to remember to tell them by hand.

## How to trigger it — every way, concretely

- Type **`/data-standards`** directly.
- Ask in plain English — any of these trigger it: *"does this migration meet our data standards,"
  "is this table PII-safe," "audit this schema," "what does D6 require," "give me a compliance
  audit report," "review this migration before I merge it," "generate the D21 weekly compliance
  scorecard."*
- **No action needed at all** for the automatic part: if you (or Claude, in the same session)
  attempt a schema-shaped `git commit`, `git push`, `gh pr create`, or `gh pr merge`, the gate
  checks it on its own — you only notice it if it finds something.

## Where to go next

- [standards.yaml](standards.yaml) — the 27 standards' full statements, metrics, and dependencies.
- [enforcement-policy.md](enforcement-policy.md) — exactly which findings can block a commit vs.
  which stay advisory, and why.
- [audit-report-format.md](audit-report-format.md) — the exact structure of a full audit report.
- [detection-guidance.md](detection-guidance.md) — what counts as a "schema-relevant" file change
  in the first place.
