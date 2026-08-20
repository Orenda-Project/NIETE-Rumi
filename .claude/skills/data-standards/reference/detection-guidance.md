# Schema-Change Detection — What Counts, What's Excluded

Read this before running `scripts/detect_schema_changes.py`, or before deciding by hand whether a
diff is "schema-relevant." It's the single definition every caller shares — the Claude
`PreToolUse` gate, a local Git hook, and CI all detect relevance the same way, because a change
that looks relevant to one and not another is exactly how a violation slips through one gate and
gets caught (confusingly, late) by another.

## What's schema-relevant

A changed path is schema-relevant if it matches any of:

| Category | Default glob patterns |
|---|---|
| Raw SQL | `**/*.sql` |
| Migration frameworks | `**/migrations/**`, `**/*migration*.py`, `**/*_migration.rb`, `**/db/migrate/**` |
| Supabase | `**/supabase/**/*.sql`, `**/supabase/migrations/**` |
| ORM schema files | `**/schema.prisma`, `**/models.py` (Django-style), `**/*.entity.ts`, `**/knexfile.*` |
| Infra-as-code touching DB objects | `**/*.tf` containing `resource "*_table"` / `"*_database"` / `"*_index"`, Terraform state diffs mentioning a DB resource type |

These are **defaults**, not a hardcoded list — see "Configuring paths" below for how a caller
overrides them for a specific repository's actual layout (a repo may keep its schema in
`db/schema/` rather than `migrations/`, for instance).

A changed path is schema-relevant if it's an **addition, modification, deletion, or rename**
matching the patterns above. A rename is schema-relevant even if the file's content didn't change
— renaming a migration file after it's shipped is its own D8/D12 concern (breaks the ordering a
migration tool relies on), not something safe to skip just because the diff shows no line changes.

## What's always excluded

Regardless of the include patterns above, never treat these as schema-relevant, and never read
their content for detection or reporting:

```
.git/
.env
.env.*
node_modules/, vendor/, .venv/, venv/
dist/, build/, target/, __pycache__/, *.pyc
*.lock, package-lock.json, yarn.lock, poetry.lock
*.pem, *.key, *_rsa, id_rsa*
credentials.json, service-account*.json
*.dump, *.sql.gz (row-data dumps — content is data, not schema, even with a .sql-adjacent name)
```

If a path matches both an include pattern and an exclude pattern (a `.sql` file sitting inside
`node_modules/` from a vendored dependency, for instance), the exclude wins. Excludes are absolute.

**Row-data dumps deserve a specific callout**: a file named `backup_2026_08.sql` or
`prod_export.sql.gz` matches the raw-SQL include pattern by extension, but its content is captured
production rows, not schema. Detection heuristics that distinguish structure from data (see
"Distinguishing schema from data dumps" below) exist specifically so this class of file is treated
as excluded even though its extension says otherwise.

### Distinguishing schema from data dumps

A `.sql` file is treated as a data dump (excluded) rather than a schema file (included) if, after
stripping `CREATE`/`ALTER`/`DROP` DDL statements, more than half its remaining non-blank lines
match an `INSERT INTO` / `COPY ... FROM` pattern with more than a handful of value rows. A file
that's 40 lines of `CREATE TABLE` and one `INSERT INTO` seed row is schema; a file that's 3 lines
of DDL and 40,000 `INSERT` rows is a dump. When genuinely ambiguous, `detect_schema_changes.py`
reports it as `NOT ASSESSED — ambiguous schema/dump content` rather than silently including or
excluding it.

## Configuring paths

A caller (the Claude gate, a Git hook, CI) can override the defaults with a repo-local config file,
`.data-standards.json` at the repository root:

```json
{
  "include": ["db/schema/**/*.sql", "prisma/schema.prisma"],
  "exclude": ["db/schema/seed_data/**"]
}
```

If no config file exists, the built-in defaults above apply. `include`/`exclude` entries are glob
patterns relative to the repository root. This file carries no secrets and no environment-specific
values — it's safe to commit and share across a team.

## What this detector does NOT do

- It does not read row data, ever — detection operates on paths and, for the schema-vs-dump
  distinction above, a structural line-shape check, never a full parse of table contents.
- It does not evaluate compliance — that's the validator's job (`scripts/validate_schema.py`),
  which consumes this detector's output.
- It does not require Git — `detect_schema_changes.py` accepts a plain file list for callers that
  aren't working from a Git diff (e.g. a one-off scan of a directory).
