# /sync-specs — sync the Gherkin specs to what the code now does

Phase 1 of the commit-triggered E2E auto-run. Brings
`tests/features/whatsapp/niete/*.feature` back in line with a change, then
validates them so phase 2 (`/niete-e2e`) drives specs that describe the CURRENT
behaviour instead of the behaviour they were written for.

Full procedure: [`gherkin-spec-sync`](../skills/gherkin-spec-sync/SKILL.md).
**Follow it — do not free-hand the sync.**

## Use

```
/sync-specs                              # sync whatever the HEAD commit touched
/sync-specs --brief <path/to/sync.json>  # the hook passes the brief it already built
/sync-specs menu status                  # just these features
```

`$ARGUMENTS` is either `--brief <file>`, a list of feature names, or empty.

## What to do

1. **Get the brief.** With `--brief`, read that file — it is already built and is
   the same selection that armed the run, so do not recompute it. Otherwise:
   ```bash
   python3 .claude/qa/shared/spec_sync.py --repo <repo> --committed --json
   ```
2. **Invoke the `gherkin-spec-sync` skill and follow it exactly.** Per feature:
   `create` · `update` · `validate-only`, from the brief's `action`.
3. **Author through [`gherkin-test-cases`](../skills/gherkin-test-cases/SKILL.md)** —
   the same skill `/testcases` runs. `gherkin-spec-sync` decides *what* the diff
   changes about coverage; `gherkin-test-cases` decides *how* the scenario is
   written (risk model, positive-first order, quality gate). Do not free-hand a
   scenario.
4. **Never delete a scenario** — tag it `@obsolete` with a
   `# OBSOLETE <date> (<bead>): <why>` line and raise it as an explicit ask.
5. **`only_shared: true` usually means change nothing** — that feature was pulled
   in by a fan-out file, not by a change to its own surface.
6. **Work every entry in `gaps[]`** — in-scope code no rule in `feature-map.yaml`
   claims. A brief can be *nothing but* gaps, and that is still a real sync. Per
   gap: inspect the diff, then either add the map entry under the feature that
   owns it and author into that spec, or — only for a genuinely new surface —
   create `<x>.feature` **plus** `.claude/qa/agents/niete-<x>-agent.md`. A gap
   that changes nothing teacher-visible still earns an `ignore:`/`not_covered:`
   entry with its reason. Full procedure: `gherkin-spec-sync` §5.
7. **Gate on the validator:**
   ```bash
   python3 .claude/qa/shared/validate_specs.py --only <features>
   ```
   Exit 1 → do NOT run the suite. Fix, or say phase 2 is skipped and why.
8. If a scenario count changed, update the counts in
   [`niete-e2e.md`](niete-e2e.md) and re-run `check-all-mode-counts.py`.
9. **Give every new scenario an id tag and a driver — they are one deliverable.**
   `@COA16` on the scenario, then `python3 .claude/qa/shared/scaffold-driver.py <feature> --sync`
   to append the stub, then IMPLEMENT the interaction (the brief's diff tells you the strings and
   ids; copy patterns from `menu.cjs`). A stub left BLOCKED is the fallback for when you cannot
   implement it safely — say why in the `reason` — not the normal outcome. Verify with
   `python3 .claude/qa/shared/check-scenario-coverage.py --only <feature>`. See
   [`gherkin-spec-sync`](../skills/gherkin-spec-sync/SKILL.md) §7.

10. **Commit the spec AND the driver, in its own commit.** The PR check (`qa-impact.yml`) and the
   Stop-hook gate both judge COMMITS — a `.feature` edited in the working tree does
   not count, and the gate keeps holding until it is committed:
   ```bash
   git add tests/features/whatsapp/niete/<feature>.feature .claude/commands/niete-e2e.md
   git commit -m "test(gherkin): sync <feature>.feature to <sha-of-the-change>"
   ```
   A spec-only commit re-arms nothing to author (`validate-only`), so this never loops.

Report what changed per feature, the validator result, the commit, and every
`@obsolete` you added. Then run phase 2.

## Portal features — brief entries with `lane: "web"`

The portal goes through the SAME two phases: a portal commit arms this sync first, the Stop hook holds the turn
until the spec changed (or `none-needed` is declared), and the PR check blocks a stale portal spec. Steps 1–7 and 10
apply as written; what differs for a `lane: "web"` entry:

| | WhatsApp entry | Portal (`lane: "web"`) entry |
|---|---|---|
| Spec | `tests/features/whatsapp/niete/<f>.feature` | `tests/features/web/<f>.feature` |
| Scenario id | `@COA16` style | two letters + number, the feature's own prefix (`@PL12`, `@TL03`, `@CP05`) on its own line |
| Driver | `.claude/qa/shared/features/<f>.cjs` via `scaffold-driver.py` | `.claude/qa/web/features/<f>.cjs` |
| Adding the code | stub, then implement | **a page area** (teacher-*, coach-portal, leader-portal, portal-account, portal-smoke): add a row to the table in `.claude/qa/web/gen_page_features.py` and re-run `python3 .claude/qa/web/gen_page_features.py .` — it rewrites the driver AND the spec together. **A flow** (portal-login, anything with steps): write the scenario in the driver with `.claude/qa/web/lib.cjs` (`asRole`, `visit`, `landsOn`, `setFlags`, `sendUntilLink` for WhatsApp → portal) |
| Gate | `validate_specs.py --only <f>` | the same command — it also fails `E-WEB-NOCODE` (a scenario with no code) and `E-WEB-NOSPEC` (code with no scenario) |
| Run it | `/niete-e2e <f>` or the mock lane | `npm run e2e:web -- <f>` (headless; `--headed` to watch) |
| Commit | `git add tests/features/whatsapp/niete/<f>.feature …` | `git add tests/features/web/<f>.feature .claude/qa/web/` |

Step 8 (`niete-e2e.md` counts) does not apply to portal features. `portal-smoke` is the web lane's fan-out
(`only_shared: true`): leave it alone unless the change added or removed a main page.
