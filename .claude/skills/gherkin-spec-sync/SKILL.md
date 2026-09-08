---
name: gherkin-spec-sync
description: 'Sync the NIETE Gherkin specs to a commit — read the spec-sync brief, add/update scenarios the diff changed, tag obsolete ones (never delete), validate, then release the E2E. Use when the auto-run arms PHASE 1 or on "/sync-specs". NOT for authoring from a ticket (gherkin-test-cases) or driving the suite (niete-e2e).'
metadata:
  disclosure: auto
  owner: Haroon Yasin
  last_verified: 2026-08-28
---

# Gherkin Spec Sync — keep the suite honest about what the code now does

You are the **judgement half** of the commit-triggered sync. The deterministic
half already ran:

```
commit → select_e2e (which features)  → spec_sync (the brief)
       → YOU (author)                 → validate_specs (the gate) → /niete-e2e
```

The brief is built. You do not go hunting for the diff, and you do not decide
which features are in scope — both are settled. Your job is the part a script
cannot do: decide what the change means for coverage.

**The one sentence that matters:** a suite that passes against the scenarios
written for the *old* behaviour is worse than no suite, because it reports
confidence it has not earned. That is the failure this phase exists to end.

---

## 1. Read the brief

```bash
cat .claude/.e2e-pending/<session>.sync.json     # the hook names the exact path
python3 .claude/qa/shared/spec_sync.py --selection <that file>   # human summary
```

Per feature it carries:

| Field | What it decides |
|---|---|
| `action` | `create` · `update` · `validate-only` — see §2 |
| `changed_files[]` | with `shared: true/false` per file |
| `only_shared` | **true = probably leave this spec alone.** See §3 |
| `diff` | bounded; `diff_truncated` says when it bit |
| `scenarios[]` | what the spec covers **today**, with tags |
| `map_gaps` | in-scope files `feature-map.yaml` claims nothing about |

---

## 2. Act on `action`

**`update`** — the normal case. Read the diff, then ask, in this order:

1. **Does the diff introduce behaviour a teacher can see that no scenario
   covers?** → add one.
2. **Does the diff contradict a scenario that exists?** → update that scenario.
   Prefer editing the existing one over adding a near-duplicate: `tags.md`'s
   anti-redundancy rule is binding here.
3. **Does the diff remove behaviour a scenario asserts?** → §4. Do not delete.

### Authoring is not this skill's job — invoke `gherkin-test-cases`

Before writing a single `Scenario:`, **load
[`gherkin-test-cases`](../gherkin-test-cases/SKILL.md)** and follow it. It is the
same skill `/testcases` runs, and it is why a generated scenario is worth having:
the test model (actors · states · actions · rules · outcomes · risks), the
positive-first ordering, the de-duplication pass, and the §14 quality gate all
live there. Nothing in this file replaces any of it.

The division of labour, so neither skill is guessed at:

| | owns |
|---|---|
| **this skill** | which features are in scope, what the diff *means* for coverage, add vs update vs `@obsolete`, the validator gate |
| **`gherkin-test-cases`** | how a scenario is designed and written — risk model, priority order, step craft, output shape |

**One deliberate override.** `gherkin-test-cases` §12 says *"Do not rewrite
existing scenarios unless the user asks you to."* A spec sync **is** that ask —
the commit changed the behaviour the scenario asserts, so updating it is the
whole point. Everything else in §12 still binds, and binds harder here: reuse the
file's existing terminology, follow its conventions, and do not duplicate
coverage it already has. The brief hands you `scenarios[]` for exactly that
comparison.

**`create`** — the feature has no `.feature` file. This is a **new surface**, and
it needs more than a file: `validate_specs` errors with `E-NOAGENT` unless
`.claude/qa/agents/niete-<feature>-agent.md` exists too. Create both, or say
plainly that you are deferring and why.

**`validate-only`** — nothing to author. Either the `.feature` file *was* the
change (a human edited it; re-authoring would churn their work), or this is a
full-suite promotion. Run the validator and move on.

---

## 3. `only_shared: true` — the trap

`bot/shared/services/whatsapp.service.js` maps to `"*"`. A logging tweak there
selects **all nine features**. If you treat that as nine specs needing rewrites,
you will churn the entire suite for a change that altered no teacher-facing
surface.

**Default for `only_shared`: change nothing, and say so in the report.** Override
only when the shared diff visibly changes that surface's behaviour — and name the
lines that do.

---

## 4. Deletion: propose, never perform

**You may not delete a scenario.** A wrong auto-delete removes coverage silently
and nobody notices for months — there is no failing test to catch it, because the
test is gone.

When behaviour genuinely goes away, mark it and let a human pull the trigger:

```gherkin
  @e2e @menu @obsolete
  Scenario: the Reading Assessment row appears in /menu
    ...
    # OBSOLETE 2026-08-28 (bd-x1y2z.3): menu.service.js:265 dropped the Reading row
    # in commit a1b2c3d. Proposed for deletion — not deleted.
```

`validate_specs` **errors** (`E-OBSOLETE-NOREASON`) on an `@obsolete` with no
`# OBSOLETE` line, so an unexplained proposal cannot ship. Every `@obsolete` you
add goes in the report as an explicit ask.

---

## 5. Validate — this is a gate, not a formality

```bash
python3 .claude/qa/shared/validate_specs.py --only menu,status
```

Exit `1` means **phase 2 does not run.** Fix, or state that the E2E is skipped
and why. The errors it raises are all silent-failure classes:

| Code | Why it is an error |
|---|---|
| `E-DUPNAME` | two scenarios, one reported result — the second hides the first |
| `E-NOTHEN` | a scenario that can never fail |
| `E-TAGTYPO` | `@e2ee` reads as covered and is **never run**, forever |
| `E-LAYER` | two layer tags — nobody can say if the default run takes it |
| `E-NOAGENT` | a spec nothing will ever execute |
| `E-OBSOLETE-NOREASON` | an unreviewable deletion proposal |

Warnings (`W-NOWHEN`, `W-NOLAYER`, `W-UNKNOWNTAG`, `W-EMPTY`) are advisory — the
live suite carries 14 of them legitimately. Do not "fix" a warning by rewriting
somebody's deliberate style.

**If you changed a scenario count**, update the per-feature counts in
[`.claude/commands/niete-e2e.md`](../../commands/niete-e2e.md) in the same pass.
`check-all-mode-counts.py` is what catches that drift, and it is a separate gate:

```bash
python3 .claude/qa/shared/check-all-mode-counts.py
```

---

## 6. Report, then release phase 2

State, briefly:

- per feature: scenarios **added / updated / marked @obsolete**, or `no change`
  with the reason (`only_shared`, docs-only, behaviour already covered)
- the validator result — errors block, warnings do not
- any `map_gaps`: an in-scope file matching nothing means `feature-map.yaml` is
  behind the code. Add the mapping in the same pass; that is how the map stays
  honest (its own header says so).
- **every `@obsolete` you added, as an explicit deletion ask**

Then drive phase 2. If validation failed, say the suite is skipped and why — a
skipped run reported honestly is fine; reported as a pass it is not.

---

## What this skill will not do

- **Author a scenario without `gherkin-test-cases`.** Free-handing one skips the
  risk model and the quality gate, and produces exactly the shallow coverage
  that skill exists to prevent. §2.
- **Invent behaviour the diff does not show.** If the diff is truncated
  (`diff_truncated: true`) or ambiguous, read the file. Never guess a scenario
  into existence — root `CLAUDE.md` Rule 12 applies to specs too.
- **Delete anything.** §4.
- **Rewrite a spec because a shared file moved.** §3.
- **Touch a non-NIETE repo.** The map's `scope:` is `bot/**` plus this repo's
  `tests/features/whatsapp/niete/**`. The main bot has no `.feature` files; there
  is nothing here to sync for it.
