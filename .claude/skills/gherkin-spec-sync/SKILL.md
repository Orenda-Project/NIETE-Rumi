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

And alongside the features, at the top level:

| Field | What it decides |
|---|---|
| `gaps[]` | in-scope files `feature-map.yaml` claims nothing about — each with `action: map-gap` and its own bounded `diff`. **This is work, not a footnote — see §5** |
| `existing_features` | every feature that has a `.feature` today, so you can answer "does an appropriate spec already exist?" without listing a directory |
| `map_gaps` | the same paths as a flat list (kept for the hook and older callers) |

A brief can have `gaps` and **no** features at all. That is not an empty brief.

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

## 5. `gaps[]` — in-scope code the map claims nothing about

A gap is a changed file that is **real bot code, inside `scope:`, and claimed by
no rule in `feature-map.yaml`**. It arrives with `action: map-gap` and its own
bounded diff, and it is **work you must finish in this pass** — not a note to
leave for later.

**Why it is stated this hard.** A gap used to be a bare string on `map_gaps`, and
`sync_needed` counted features only. A commit whose diff was *entirely* unmapped
therefore produced no features, so the hook wrote no brief and `/sync-specs`
printed *"nothing selected — no Gherkin work for this change"*. The worked
example that forced this fix was a change to `bot/vendor/lp-v9/**` — the
lesson-plan render engine, behind the single busiest teacher-facing surface in
the deployment — which bought itself a complete exemption from the coverage step
because its files were *hard to attribute*, not because they were unimportant.
Being unclaimed by the map is not evidence a change is inert. It is the absence
of evidence, and the only honest response is to look.

### The procedure

```
gap detected
    ↓
inspect the changed behaviour  (read the diff; if truncated, read the file)
    ↓
does an appropriate .feature already exist?   ← `existing_features` in the brief
    ↓                                    ↓
   YES                                  NO
    ↓                                    ↓
add the map entry under that          CREATE the new surface:
feature in feature-map.yaml             · tests/features/whatsapp/niete/<x>.feature
    ↓                                    · .claude/qa/agents/niete-<x>-agent.md
author the scenario into that              (both — or validate_specs raises E-NOAGENT)
existing spec (§2 `update` rules)        · a `features:` block in feature-map.yaml
    ↓                                    ↓
    └──────────────→ validate (§6) ←─────┘
```

**Default hard to YES.** Nine features already cover the teacher-facing surface
of this bot. A tenth `.feature` per unclaimed vendor directory fragments the
suite, and every new key needs its own agent or the map loader raises `MapError`.
Create a new surface only when you can name the teacher-visible thing it tests
that no existing spec could hold.

**Attribution is a fan-out question, not a folder question.** Ask *which
surfaces' entry points reach this file*, not *where does it live*. `vendor/lp-v9`
is required by `lp612-*.service.js` (**lesson-plan**) **and** by
`quiz/transcript-quiz-*.js` (**training**), so it belongs under `shared:` with
both — mapping it to `lesson-plan` alone would under-select exactly the way the
graph audit exists to catch. `audit_feature_map.py --repo NIETE-Rumi` walks the
real `require()` graph and will answer this for you.

**If the diff genuinely changes nothing a teacher can see** — a lint rule, a
build script, a fixture — the right outcome is still a map entry: add it to
`ignore:` or `not_covered:` **with its reason**. Silence is the one outcome that
is not allowed, because a gap left unresolved re-fires the SAFE subset on every
future push to that path until somebody does this.

**Scope note.** `not_covered:` surfaces (reading, video, homework,
student-videos) are a deliberate, reasoned *no* — a change there is reported, not
promoted. Do not turn one into a spec without an explicit ask.

---

## 6. Validate — this is a gate, not a formality

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

## 7. The driver — a scenario that cannot run is not synced

**A scenario is not done until its mock driver exists and is executable, or it is explicitly
declared unrunnable with a reason.** Writing the Gherkin does not make it run: `feature-runner.cjs`
loads `.claude/qa/shared/features/<feature>.cjs` and collects whatever its `rec()` calls report — it
never opens the `.feature`. So prose alone satisfies every check above and executes nothing. On
2026-09-22 coaching held 33 `@e2e` scenarios against 15 implemented, and no run, row or gate said so.

For every scenario you ADDED or RENAMED:

1. **Give it an id tag** — `@COA16`, matching the ids that feature's driver already records
   (`rec('COA15', …)` → the next is `COA16`). That tag is the identity; without it nothing can tell
   the scenario from any other.
2. **Append the stub**, which is mechanical:
   ```bash
   python3 .claude/qa/shared/scaffold-driver.py <feature> --sync
   ```
   It adds one `rec(<id>, <name>, 'BLOCKED', …)` per missing scenario and never rewrites existing
   code. **A stub is not coverage** — it only makes the scenario visible instead of absent.
3. **Implement it.** You already hold what this needs: the brief carries the changed files and a
   bounded diff, so you know the strings, the button ids and the table the scenario asserts on.
   Copy the interaction patterns from `menu.cjs` or `lesson-plan.cjs`; the whole vocabulary is
   `api.sendWait` / `openList` / `pickRowAndWait` / `tapAndWait` / `upload` / `flowClick` / `fresh` /
   `db`. Replace the `BLOCKED` with `...V(<condition>, { evidence })`. Never reach for the browser
   DOM — that breaks the mock lane.
4. **Leave it BLOCKED only when you genuinely cannot implement it safely**, and say why in the
   `reason`. That is the honest fallback, not the default. If the scenario can never run on this
   lane — a rendered Flow screen, a file above WhatsApp's upload ceiling — tag it
   `@no-mock-driver` so it is declared rather than silently missing.

Check yourself before committing; this is the same gate the PR runs:

```bash
python3 .claude/qa/shared/check-scenario-coverage.py --only <feature>
```

## 8. Commit the spec AND its driver — a working-tree edit is not done

Everything downstream judges **commits**: the PR check (`.github/workflows/qa-impact.yml`)
diffs the PR range, and the Stop-hook gate compares the spec *as committed at HEAD* with its
fingerprint from arming. A `.feature` you edited and validated but left uncommitted passes
nothing and the turn stays held. One commit, only the spec (and `niete-e2e.md` if counts moved):

```bash
git add tests/features/whatsapp/niete/<feature>.feature \
        .claude/qa/shared/features/<feature>.cjs \
        .claude/commands/niete-e2e.md
git commit -m "test(gherkin): sync <feature>.feature + driver to <sha-of-the-change>"
```

The scenario and its driver are ONE deliverable — a commit carrying only the prose ships a test
that never runs. Driver files are not in `feature-map.yaml`, so adding one selects no feature: the
post-commit hook still sees a spec change, marks it `validate-only`, authors nothing, and cannot
loop.

## 9. Report, then release phase 2

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
