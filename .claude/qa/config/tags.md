# Tag taxonomy (single source of truth)

Every `.feature` tag must come from this vocabulary. Agents filter on the **layer**
tag (`@e2e`); the rest are for slicing/reporting.

| Axis | Tags | Meaning |
|------|------|---------|
| **Layer** | `@e2e` | Full user-flow test the agent runs. |
| | `@smoke` | Minimal liveness subset (fast). |
| **Feature** | `@menu` `@training` `@ask` `@portal` `@language` `@register` | Which feature the scenario exercises. |
| **Scope** | `@menu-feature` | One of the 4 `/menu` features (the focus set). |
| | `@out-of-region` | Command exists but the feature is not part of this tenant's region (N/A). |
| | `@copy` | Asserts EXACT teacher-facing strings (headers/labels). Deliberately brittle — a fail is usually an intended copy tweak; update the one fixture line. Copy assertions may live INSIDE a structural scenario when they share its trigger and state (anti-redundancy rule, 2026-08-19) — tag the merged scenario `@copy` and, on a fail, check WHICH Then step broke before filing: the structural steps are the contract, the exact strings are not. |
| | `@flow` `@quiz` `@negative` `@edge` `@certificates` `@data` `@vendor` | Descriptive slice tags — which surface/kind a scenario exercises (native Flow · module quiz · error path · boundary · certificates · data-quality guard · non-NIETE vendor). Reporting only; do not gate the run. |
| **Content** | `@content-driven` | Answers/expected values must be resolved **LIVE** — the quiz body is non-deterministic (which questions, how many, option order, correct letter all vary). The driver reads each served question and matches the SEMANTIC answer key (`answer-keys.yaml training_quiz`) by substring, never by position. Never assert a fixed question/letter/count. |
| **Priority** | `@P1` `@P2` `@P3` | P1 = core happy path; P3 = edge/graceful-degradation. |
| **Status** | `@known-fail` | Encodes a real bug — expected to FAIL until fixed (red-before-green). |
| | `@known-issue` | Known imperfect behaviour, lower severity. |
| | `@wip` | Scenario written but not yet runnable / feature not built. **Excluded from the default run.** |
| | `@draft` | Written from the code but not yet driven live. **Excluded from the default run.** |
| | `@slow` | Reply takes minutes (LP/video/coaching generation). **Excluded from the default run**; runs nightly. |
| | `@destructive` | Mutates real state irreversibly (fails a grand quiz → hours-long cooldown; certifies a level). **Excluded from the default run** — throwaway teacher only, via `all`. |
| | `@config-gated` | Only meaningful when its env/Flow id is set/unset. **Excluded from the default run.** |
| | `@obsolete` | The spec sync believes the behaviour is gone. **A DELETION PROPOSAL, never a deletion** — `gherkin-spec-sync` may not remove a scenario, because a wrong auto-delete drops coverage with no failing test to catch it. Requires a `# OBSOLETE <date> (<bead>): <why>` comment inside the scenario; `validate_specs.py` errors (`E-OBSOLETE-NOREASON`) without one. A human deletes it, or removes the tag if the behaviour is still there. **Excluded from the default run.** |
| | `@first-use` | Depends on a fresh/unregistered account. **Excluded from the default run.** |
| **Backend** | `@chunk` | API/backend-level — not UI-drivable; skip in the WhatsApp agent (mark BLOCKED). |
| **Profile** | `@profile:<tenant>` | Feature-level only. Resolves the target via `whatsapp-targets.yaml`. |

> **Default `/niete-e2e` run = every `@e2e` scenario EXCEPT `@destructive @slow @wip @first-use @config-gated`.**
> `@content-driven` and the quiz scenarios are NOT excluded — they RUN by default and **drive real quizzes** (advancing module progress / writing attempts). Run on a throwaway teacher, or use a target whose progress you don't mind changing.

Rules:
- **No redundant flows.** Before adding a scenario ask: can this be verified naturally in an
  existing one? If it shares the same setup, trigger AND state, add the assertion there instead.
  Split only for a meaningfully different flow, state, trigger, or business rule.
- Exactly one **layer** tag per scenario.
- `@profile:<tenant>` goes on the `Feature:` line only (inherited by all scenarios).
- A `@known-fail` that PASSES means the bug is fixed — remove the tag.
