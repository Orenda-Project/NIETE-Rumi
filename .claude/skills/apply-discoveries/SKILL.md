---
name: apply-discoveries
description: 'Fold HUMAN-APPROVED E2E discoveries and intended drift back into the Gherkin specs, then flip the ledger entry to applied. Never touches proposed/pending. Use after triaging an E2E run. NOT for writing new scenarios (gherkin-test-cases), NOT for running the suite (chrome-mcp-whatsapp-e2e).'
user-invocable: true
disable-model-invocation: true
metadata:
  disclosure: manual
  owner: Haroon Yasin
  last_verified: 2026-08-23
---

# apply-discoveries — the gated E2E spec-updater

**This is the ONLY writer to `.feature`/`answer-keys.yaml` in the harness.** A run never
edits specs; this command does, and only on human-gated entries.

## Guardrails (non-negotiable)
- Act ONLY on discoveries with `status: approved` and drift rows with `verdict: intended`.
- NEVER act on `proposed` (discovery) or `pending`/`bug` (drift). Skip and report them.
- Show every diff; the change still goes through normal PR review before merge.
- After applying an entry, flip it: discovery `approved→applied`; leave a `- applied: <date> run <short>` line. For an intended drift, update the fixture and note it.

## Procedure
1. **Collect.** Read every `.claude/qa/ledgers/discoveries/**/*.md` and `.claude/qa/ledgers/drift/**/*.jsonl`.
   Bucket: approved-discoveries, intended-drift, and (report-only) proposed / pending / bug.
2. **Per approved discovery** — from its `surface` + `kind` + `suggested`, draft a real
   scenario into the matching `.feature`, following conventions: expected values go in
   `answer-keys.yaml` (never inline), tags from `config/tags.md` (structure → contract tags;
   exact strings → `@copy`), grouped POSITIVE/EDGE/NEGATIVE like the file. Apply the edit.
3. **Per intended drift** — update the referenced `answer-keys.yaml` key to the `actual` value.
4. **Flip status** in the ledger entries you applied.
5. **Summary** — print what was applied + what was skipped-and-why (for the PR body / Notion).

## What this never does
Files bugs (that's a bead + the drift `bug` verdict), edits `proposed` entries, or pushes.
