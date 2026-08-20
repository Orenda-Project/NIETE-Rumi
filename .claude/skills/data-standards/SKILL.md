---
name: data-standards
description: Audit a schema, migration, or PR diff against Taleemabad's 27 Data Standards (D1-D27, tiered NON-NEGOTIABLE/ESSENTIAL/ADVANCED/SPECIALIZED, across Lesson Plans, Digital Coach, Teacher Training, Exam Generator, User Mgmt, Data & Analytics). Use when reviewing a schema change, writing a migration, designing a new table, or asked "does this meet our data standards" / "is this PII-safe" / "what does D6 require" / "give me a compliance audit report". A full audit produces a structured report — fixed verdicts, severity, stable issue IDs, per-table findings, a remediation plan — per reference/audit-report-format.md. Also generates the D21 weekly compliance scorecard as a house-style chart. A PreToolUse hook warns on schema writes that look like they skip a NON-NEGOTIABLE standard.
---

# Data Standards

Taleemabad's data governance catalog — 27 standards, four tiers, six products — as something an
agent can actually check against, not just read. Source of truth: [reference/standards.yaml](reference/standards.yaml).
Edit that file to change a standard; this SKILL.md and the scripts both read it, so they can never drift apart.

## The four tiers

| Tier | Meaning | IDs |
|---|---|---|
| **NON-NEGOTIABLE** | Ship nothing without these. Enforce now. | D1-D8 |
| **ESSENTIAL** | The quality multipliers. Adopt next. | D9-D16 |
| **ADVANCED** | Compounding advantages. Earn the right. | D17-D22 |
| **SPECIALIZED** | Single-service or Phase 2. When ready. | D23-D27 |

The tiers are a dependency order, not just a priority list — e.g. D6 (sensitivity labels) is what
makes D4 (PII masking) and D20 (audit trail) enforceable; D7 (ownership) is what makes D18 (contract
enforcement) enforceable; D8 (migration framework) is D17 (reversible migrations)'s prerequisite;
D14 (naming) and D15 (values) are two sides of the same coin. Read `depends_on` / `enables` /
`requires` / `prerequisite_for` / `counterpart` in standards.yaml before treating any one standard
in isolation — a fix to D4 without D6 underneath it doesn't actually hold.

## The four verifier roles

Every standard names who checks it — these are the audit personas, not generic "QA":

| Verifier | Checks |
|---|---|
| **Data Contract Reviewer** | Schema shape, naming, ownership, classification, contracts — mostly design-time (D1, D6, D7, D14, D15, D18, D19, D22, D24, D25, D26, D27) |
| **Data Code Reviewer** | Migration code, indexing, backward-compatibility, rollback scripts (D2, D8, D11, D12, D17) |
| **Data Quality Analyzer** | Runtime data quality — orphans, freshness, duplicates, test-data leakage, partitioning (D3, D9, D10, D13, D16, D21, D23) |
| **Data Log Analyzer** | PII leakage in logs, audit trails for sensitive tables (D4, D20) |

When auditing, work through the standards one verifier-lens at a time rather than all 27 at once —
it keeps the reasoning focused and makes it obvious which kind of evidence to look for (a live
query result for the Quality Analyzer's checks; a grep of log statements for the Log Analyzer's;
the DDL itself for the Contract/Code Reviewers').

## First trigger in a session: orient before auditing

The first time this skill fires in a conversation — whether via `/data-standards` or because a
message matched the trigger cases — check the transcript so far. If nothing in this conversation
has already explained what this skill is or how it works, give a short plain-language orientation
**before** doing any actual audit work; if this skill (or an equivalent explanation) already ran
earlier in this same session, skip straight to the request below instead of repeating it. There is
no flag or file tracking this — it is a judgment call from re-reading what has already been said,
same as not re-introducing yourself twice in one conversation.

**This inline orientation is a short pointer, not the full explanation** — the complete primer
(what a schema is, what the 27 standards actually cover and why they're tiered, how all four
enforcement layers fit together end-to-end, every way to trigger this skill) lives in
[reference/orientation.md](reference/orientation.md). Read that file in full before writing the
inline version below — don't paraphrase from memory, and don't let it drift out of sync with the
inline summary over time.

The inline orientation is three short parts, plain language, no jargon, roughly 4-7 sentences
total. **All three parts are required, every time** — if something else in the same reply competes
for attention (e.g. a stale-file warning, an ambiguity that needs an AskUserQuestion), the
orientation still runs in full first; don't let a situational aside crowd out or truncate part 3
just because something else felt more urgent to say. This is a courtesy framing for a human who
may not know what any of this means, not a restatement of the tables below:

1. **What a "schema" is, here.** One or two sentences: a schema is the structure of a
   database table — its columns, their types, keys, and relationships — and "auditing a schema"
   means checking a table definition or migration script against Taleemabad's own rules for how
   data should be built, before or after it ships.
2. **What this skill actually does for them.** It checks a table/migration/PR against 27 written
   data standards (things like "primary keys must be UUIDs," "personal info must be labeled,"
   "every migration needs a rollback plan") and comes back with a plain pass/fail per rule, not a
   vague opinion — plus it can block a non-compliant `git commit`/`push`/PR automatically and
   notify the Data Team in Slack when that happens.
3. **How to trigger it**, concretely and completely: typing `/data-standards`, OR asking in plain
   English — give at least two real example phrasings ("does this migration meet our data
   standards," "is this table PII-safe," "audit this schema," "what does D6 require" — pick from
   these or similar) — no special syntax needed. Also say explicitly that a schema-shaped
   `git commit`/`push`/PR gets checked automatically, with no trigger needed at all.

End the orientation with one line pointing to the full primer for anyone who wants more depth:
*"For the full picture — how the standards are tiered, how enforcement works end-to-end — see
reference/orientation.md."* Then proceed with whatever they actually asked for, using the rest of
this document.

## What to do for each kind of request

### "Does this schema/migration/PR meet our data standards?"

1. Get the actual file (schema dump, migration script, or PR diff) — never audit from memory or a
   description of the change.
2. Run the heuristic scanner for a first pass:
   ```bash
   python3 skills/data-standards/scripts/audit.py path/to/migration.sql
   python3 skills/data-standards/scripts/audit.py --tier non_negotiable path/to/migration.sql
   python3 skills/data-standards/scripts/audit.py --product lesson_plans path/to/schema.sql
   ```
   This greps for the keyword patterns each standard declares (`detect:` in standards.yaml) and
   reports which standards look **possibly relevant** — see "What this script can and cannot
   check" below before treating a hit as a pass or a miss as a clean bill.
3. For every standard the scanner flags (or that you know applies from the product's row in
   standards.yaml), read the actual **Standard Statement** and **metric** and check the real
   thing: does the column have `uuid` type, not just a column named `id`? Is there an actual
   `REFERENCES` constraint, not just an `_id` column name? Is the timestamp `TIMESTAMPTZ`, not a
   bare `TIMESTAMP`?
4. Watch for the cross-references standards.yaml encodes rather than scoring each standard in
   isolation: a D4 (PII masking) "pass" sitting on top of a failed D6 (sensitivity labels) isn't
   really a clean pass, since D6 is what makes D4 enforceable in the first place. Same logic for
   D7→D18 and D8→D17.
5. **For a quick single-standard lookup**, a bare pass/fail/not-applicable per standard with a
   cited line is enough. **For a full schema/migration/PR audit**, read
   [reference/audit-report-format.md](reference/audit-report-format.md) first and produce a report
   in that shape — see "Audit output contract" below.
6. If this is a NON-NEGOTIABLE (D1-D8) violation, say so explicitly and recommend blocking the
   merge — that tier is "ship nothing without these," not "nice to have."

#### Audit output contract — for a full report (step 5, above)

Read [reference/audit-report-format.md](reference/audit-report-format.md) in full first — it's the
authoritative spec for verdicts, severity, issue IDs, and structure. Summary of the contract:

1. Start with the audit scope and an executive summary.
2. Use only `PASS`, `PARTIAL`, `FAIL`, `NOT ASSESSED`, and `NOT APPLICABLE` as verdicts — never
   ambiguous phrasing like "mostly pass" or "no signal." (This is a different, five-value
   vocabulary from `scorecard.py`'s three-value `pass`/`fail`/`na` chart-input format — see
   reference/audit-report-format.md §1 for how the two map.)
3. Provide both a standards scorecard and a table compliance register.
4. Create one stable issue ID (`<STANDARD>-<TABLE>-<SEQUENCE>`, e.g. `D4-users-001`) and one
   detailed record for every actionable finding. Preserve IDs across repeated audits for the same
   underlying issue.
5. For each issue, include standard, severity, priority, confidence, table, column or constraint,
   source file and line, finding, evidence, risk, recommended change, verification, and suggested
   owner.
6. Separate confirmed violations (`FAIL`) from missing evidence (`NOT ASSESSED`). Never convert
   missing evidence into a confirmed failure.
7. Show counts with denominators and coverage percentages — never a bare percentage.
8. Sort findings by severity, then table, then issue ID.
9. Keep evidence concise; never combine unrelated table findings into one evidence cell.
10. Label SQL as either an illustrative example or an executable migration. Never propose a
    destructive change without a migration and rollback plan.
11. End with a prioritized remediation plan, manual checks, limitations, and an appendix of
    passed checks.

The report must support navigation both directions: **standard → affected tables → detailed
issues**, and **table → failed standards → recommended changes**.

### "What does D<N> require?" / "Which standards apply to <product>?"

Read `reference/standards.yaml` directly — don't paraphrase from this file's summary tables (they
exist for orientation; the YAML is authoritative and has the fuller statement, both metrics, the
why-it-matters rationale, and the per-product example). Quick lookup:
```bash
python3 skills/data-standards/scripts/audit.py --list                       # every standard
python3 skills/data-standards/scripts/audit.py --list --tier non_negotiable # one tier
python3 skills/data-standards/scripts/audit.py --list --product exam_generator
```

### "Generate the compliance scorecard" (D21)

D21 requires every Gold-layer dataset to publish four quality dimensions weekly
(Completeness/Validity/Uniqueness/Timeliness) and the notion-board skill's rule 18 requires numbers
presented to a human to be a chart, not a table. `scripts/scorecard.py` renders a per-product
compliance bar chart via the house `economist_chart.py` engine (see the **house-style-charts**
skill — never hand-roll a differently-styled chart):

1. Produce a verdicts JSON — `{product: {standard_id: "pass"|"fail"|"na"}}` — either from your own
   audit pass (step above, repeated per product) or from whatever tracks this over time.
2. Render:
   ```bash
   python3 skills/data-standards/scripts/scorecard.py verdicts.json --tier non_negotiable -o scorecard.png
   ```
3. `na` verdicts and omitted standards are excluded from that product's denominator — a product
   that genuinely doesn't need a standard (per standards.yaml's `applies: false`, e.g. D22 identity
   graph for Lesson Plans) is never penalised for it.
4. Post it per **house-style-charts** conventions — lead with the takeaway sentence, chart
   supports it — and per **notion-board** if it's landing on a card (image embedded via
   `file_upload`, never a bare URL).

## What this script can and cannot check

Be honest about this with whoever reads the audit — false confidence here is worse than no audit:

- **Can**: flag likely-relevant standards by keyword match in the text you gave it; point you at
  the exact metric and statement to verify by hand; compute a compliance % once you supply verdicts.
- **Cannot**: query a live database to see if a constraint actually exists (`D3`, `D9`, `D11`);
  check CI logs for manual-SQL runs (`D8`); confirm an MCP endpoint's actual rate limit (`D25`);
  see whether a named human steward is genuinely tracked anywhere (`D7`); verify audit-log
  immutability (`D20`). Standards with no textual signature in a schema file at all — ownership,
  freshness SLAs, contract sign-off, bias-tag metadata — need a different kind of check entirely
  (query the metadata catalog, check the CI config, ask the owning team) — the scanner will report
  zero hits for these and that is expected, not a clean bill.
- A **miss is not a pass**. A **hit is not a pass** either — it just means the word appeared near a
  schema change; still read the actual DDL.
- In a full audit report, this list is exactly what turns into `NOT ASSESSED` verdicts rather than
  `FAIL` — see [reference/audit-report-format.md](reference/audit-report-format.md) §6. Missing
  evidence is never reported as a confirmed violation.

## The gate hook

`hooks/schema-change-gate.sh` is a `PreToolUse` hook (declared in [hooks.json](hooks.json)) that
fires only on `Bash` calls matching `git commit` / `git push` / `gh pr create` / `gh pr merge`
(word-boundary matched — "about to git commit soon" in a prose string does not trip it). On a
match, it runs `scripts/validate_schema.py --mode staged` and **blocks (exit 2)** if the validator
returns a confirmed finding, or exits 0 if the staged change is compliant or has no schema-relevant
files at all. This hook does not have its own heuristics — every check lives in the shared
validator, so the Claude gate, a local Git hook, and CI can never disagree about what's a
violation. See [reference/enforcement-policy.md](reference/enforcement-policy.md) for exactly
which findings block vs. stay advisory, and [reference/detection-guidance.md](reference/detection-guidance.md)
for what counts as a schema-relevant file in the first place.

Same as every hook in this pack: the underlying checks can be wrong in both directions (see the
caveats above), so a block is "the validator found a specific, structural problem," not "an
opinion." **Bypass requires a real, validated reason, not a boolean** (changed 2026-08-19):
`export TALEEMABAD_DATA_STANDARDS_BYPASS="INC-4821: hotfix for prod outage, D4 finding reviewed and approved by data-eng lead"`.
An empty, generic (`bypass`, `fix later`, `1`, …), or too-short reason is rejected by
[scripts/bypass_audit.py](scripts/bypass_audit.py) and the bypass does **not** take effect — the
gate falls through to its normal check. A reason that passes is recorded (actor, real commit SHA,
which standards were bypassed, the reason) to `.data-standards-bypass-log.jsonl` before the commit
is let through. The old `CLAUDE_DATA_STANDARDS_GATE_OFF=1` boolean no longer bypasses anything —
setting it now only triggers a one-time notice pointing at the new variable. Same env-var gotcha as
every other gate in this pack: inline `VAR=value` before the blocked command does not work, the
hook reads env before that assignment takes effect — use `export` in the parent shell.

**Slack notification is automatic, with zero per-repo setup** (added 2026-08-19). On a confirmed
block, and on an accepted bypass, the gate fires a `scripts/notify.py slack` call for the Data
Team's channel — `validation_failure` on a block, `bypass` on an accepted bypass. Nothing else
notifies (not `pr_update`, `pass_after_failure`, `merge`, or `standards_version_change` — those stay
manual/future work). This needs no configuration in whatever repo the gate fires in: `SLACK_BOT_TOKEN`
and `TALEEMABAD_DATA_STANDARDS_SLACK_CHANNEL` are read from **this pack's own** `.env` (`slack_send.py`
resolves `.env` relative to its own script location, walking up through the symlink Claude Code
installs skills as — not the target repo's working directory), so configuring them once here makes
every repo's gate notify automatically. The call is backgrounded and its result is never inspected:
a missing/misconfigured channel, a missing token, or a hard Slack API failure has **zero effect** on
the block/allow decision — same guarantee `notify.py` already gives its other callers, just wired in
here too. Verified end-to-end against a real Slack channel (see [CHANGELOG.md](CHANGELOG.md)) and with
a deliberately-broken channel override to confirm the exit code never moves either way.

**What actually gets sent**: repo, branch, commit, actor, and result — five fields, always. `repo` is
resolved via `git rev-parse --show-toplevel`'s basename (the actual repo root's directory name, not
just the current working directory's — correct even if the hook fires from a subdirectory). `actor`
(fixed 2026-08-20) tries, in order: `TALEEMABAD_USER_EMAIL` (a manual override, if set) → `git config
user.email` (already configured in any repo where a commit is even possible, so this resolves to a
real email automatically almost everywhere) → the OS username as a last resort if neither exists.
Before this fix, a missing `TALEEMABAD_USER_EMAIL` fell straight to the OS login name (e.g. `abdul`),
which showed up in Slack and the bypass audit log instead of an actual identifiable email — `git
config user.email` was sitting right there the whole time and wasn't being read. Findings themselves
(which standard, what evidence) are **not** currently included in the Slack message — `result` is
just the literal string `FAIL`/`BYPASSED: <reason>`; the full JSON stays on the terminal's stderr
where the gate fired. `severity_counts`/`issue_ids`/`report_url` are fields `notify.py` supports but
the gate does not yet pass — a natural next step if a bare pass/fail proves too thin in practice.

### Beyond Claude Code — local Git hooks and CI

This Claude-side gate only covers commits/pushes Claude itself initiates. Two more layers use the
exact same validator, for the cases Claude can't reach:

- **`scripts/install_repo_hooks.py`** — an explicit, opt-in installer for local `pre-commit`/
  `pre-push` hooks in a target repository, so an ordinary terminal `git commit` (not through
  Claude Code at all) gets the same check. Never run automatically — a team runs it once,
  themselves, in their own repo. Idempotent, and never overwrites a hook it doesn't own.
- **`reference/ci-workflow-template.yml`** — a copy-in GitHub Actions workflow using `--mode diff`
  against the PR's true base..head. This is the **authoritative** gate — local hooks can be
  bypassed with `--no-verify` or deleted; CI, once configured as a required branch-protection
  status check, cannot.

All three layers (Claude gate, local Git hooks, CI) call the identical
`scripts/validate_schema.py` — none of them has its own copy of the rules, so they can never
disagree about what counts as a violation.

### Local state files this skill creates in a TARGET repo

`scripts/baseline_audit.py`, `scripts/bypass_audit.py`, and `scripts/notify.py`'s governance
fallback each write a small local file to whatever repo they're pointed at — never to this pack's
own repo. None of these scripts touch that target repo's `.gitignore` for you; add these entries
yourself if you adopt any of them:

```
.data-standards-cache.json
.data-standards-last-report.json
.data-standards-bypass-log.jsonl
.data-standards-governance-events.jsonl
```

All four are local machine state (a fingerprint cache, the last audit's report, a bypass audit
trail, and unsent governance events) — safe to delete at any time, and never something a team
should commit.

## Reference files

| File | Contents |
|---|---|
| [reference/standards.yaml](reference/standards.yaml) | The 27 standards, machine-readable: tier, statement, both metrics, verifier, why-it-matters, per-product applicability + example, status (V1/NEW/REVISED), and cross-references (`depends_on`/`enables`/`requires`/`prerequisite_for`/`counterpart`). Edit this to change a standard. |
| [scripts/audit.py](scripts/audit.py) | Heuristic scanner — flags standards possibly relevant to a schema/migration/diff file, filterable by tier/product, `--list` for lookup, `--strict` for a CI-friendly exit code. |
| [scripts/scorecard.py](scripts/scorecard.py) | Renders the D21 per-product compliance bar chart from a verdicts JSON, via the house chart engine. |
| [reference/audit-report-format.md](reference/audit-report-format.md) | The full audit-report spec: five-value verdict vocabulary, severity/priority, stable issue IDs, required report sections, remediation-plan format, acceptance criteria. Read this before producing any full audit report. |
| [reference/detection-guidance.md](reference/detection-guidance.md) | What counts as a schema-relevant file (SQL/migrations/Supabase/ORM), what's always excluded, how to distinguish schema DDL from a data dump, and how a repo overrides the defaults via `.data-standards.json`. |
| [reference/enforcement-policy.md](reference/enforcement-policy.md) | What can block a commit/push/merge (deterministic, structural findings only) vs. what stays advisory (inference, external-registry-dependent, live-data-only) — the contract every enforcement layer follows. |
| [scripts/detect_schema_changes.py](scripts/detect_schema_changes.py) | The shared change detector — classifies a git diff/staged-change/file-list into relevant/excluded/ambiguous per detection-guidance.md, used by every enforcement layer so none of them can disagree about what's schema-relevant. |
| [scripts/validate_schema.py](scripts/validate_schema.py) | The shared validator — structural (not just keyword) checks against real `CREATE TABLE` blocks, four documented exit codes (0 pass / 1 blocking violation / 2 validator error / 3 no schema change), `--mode full\|diff\|staged\|validate-report`. This is what `hooks/schema-change-gate.sh`, the local Git hooks, and the CI template all call. |
| [scripts/install_repo_hooks.py](scripts/install_repo_hooks.py) | Explicit, opt-in installer for local `pre-commit`/`pre-push` Git hooks in a target repository — same validator as the Claude gate, so a terminal `git commit` outside Claude Code gets the same check. Idempotent, never overwrites an existing hook it doesn't own, `--uninstall` to remove. **Not run automatically by anything in this pack** — a team runs it themselves in their own repo when they want local enforcement. |
| [reference/ci-workflow-template.yml](reference/ci-workflow-template.yml) | A copy-in GitHub Actions workflow — runs the same shared validator in `--mode diff` against a PR's base..head, uploads the report as an artifact, posts/updates one PR comment, fails the job on a confirmed violation. Only becomes an actual merge gate once a repo admin marks it as a required branch-protection status check — the template says so explicitly. |
| [scripts/baseline_audit.py](scripts/baseline_audit.py) | SessionStart-shaped baseline audit — fingerprints a repo (commit SHA + schema-file hashes + standards/validator version) and only re-runs the full audit when the fingerprint changed, via a local, gitignored cache. Classifies findings as new/existing/resolved against the prior cached run. Opt-in per repo (not wired into this pack's own SessionStart hook) — see the script's own docstring for wiring instructions. |
| [scripts/bypass_audit.py](scripts/bypass_audit.py) | Controlled bypass auditing — validates a bypass reason isn't empty or a generic placeholder (`--check`), and records an auditable JSONL entry (actor, real commit SHA, bypassed standards, reason) when a bypass is used (`--record`). **Wired into `hooks/schema-change-gate.sh`'s actual bypass check** (2026-08-19) — the gate now calls this script before honoring `TALEEMABAD_DATA_STANDARDS_BYPASS`; a rejected reason leaves the gate blocking, an accepted one is recorded before the commit is let through. Verified end-to-end against real scratch git repos. |
| [scripts/notify.py](scripts/notify.py) | Slack notification (reuses `storytime`'s `slack_send.py` — one authoritative Slack client, not two) + a versioned, idempotent data-governance ingestion event with bounded retry/backoff and a local fallback file when no endpoint is configured. Sanitizes local paths and credential-shaped strings before anything is sent. **Slack delivery verified end-to-end** (2026-08-18) — a real bot posted a real message to a real channel and returned a real Slack `ts`; see the CHANGELOG entry for the exact check sequence (`auth.test` → `conversations.info` membership check → live send). **The data-governance endpoint has no destination to point at yet, by design, not by oversight** — checked whether the org's `taleemabad-data` MCP could serve as one; it's query/reporting-only with no ingestion tool, and MCP tools aren't reachable from a Git hook or CI job regardless. `TALEEMABAD_GOVERNANCE_ENDPOINT` stays unset until a real HTTPS endpoint exists somewhere; until then the local-file fallback (`.data-standards-governance-events.jsonl`) is the shipped, intended behavior, not a stub. |

## Related skills

- **house-style-charts** — the chart engine `scorecard.py` calls into; use for any other data
  presentation this skill's audits produce.
- **notion-board** — if a compliance report or scorecard lands on a card, follow its image-embedding
  and body-structure rules.
- **implementation-plans** — a plan that includes a schema change (§9) should be audited against
  D1-D8 before the migration ships; cite this skill's findings in that section rather than
  re-deriving them.
- **rumi-data-v2** — the governed MCP layer this catalog's D25 (MCP Service Contract) and D6
  (sensitivity labels driving MCP redaction) describe. If you're checking whether a real MCP
  endpoint meets D25, that's the server to inspect against the contract.
