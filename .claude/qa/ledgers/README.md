# Ledgers — Discovery Loop Frozen Schemas

**Frozen 2026-08-04.** A change to any schema below is a dashboard-breaking change. Requires
coordination across all agents that emit ledger rows.

---

## §5.1 — Runs ledger (`ledgers/runs.jsonl`)

**Append-only JSONL.** One row per (run × feature). The dashboard's spine: pass-rate trend,
last-green, duration, coverage. Never rewritten.

```json
{
  "run_id": "2026-08-04T14:22:10Z-niete-menu-14f2",
  "ts": "2026-08-04T14:22:10Z",
  "surface": "whatsapp",
  "tenant": "niete",
  "env": "prod",
  "method": "chrome",
  "feature": "menu",
  "summary": { "total": 12, "passed": 10, "failed": 1, "blocked": 1 },
  "duration_ms": 84210,
  "status": "DEGRADED",
  "coverage": { "scenarios": 12, "surface_observed": 14, "uncovered": 2 },
  "drift_count": 1,
  "discovery_count": 1,
  "evidence_dir": "results/whatsapp/niete/14f2/"
}
```

**Field reference:**
- `status`: `HEALTHY` (all pass) · `DEGRADED` (1–2 fail) · `CRITICAL` (3+ fail or any blocked).
  **Caveat — `status` is a blunt convenience field, not the health source of truth.** Because
  `@wip` / `@config-gated` / `@destructive` scenarios are *routinely* BLOCKED (unbuilt features,
  unset Flow IDs, throwaway-account gates), a healthy run will often log `CRITICAL`. The raw
  `summary.{passed,failed,blocked}` counts are always stored, so **the dashboard should derive
  its health verdict from those counts** (e.g. excluding expected-blocked tags) rather than from
  `status`. Refining the rule so only *unexpected* blocks trip `CRITICAL` is a deliberate
  follow-up, best decided alongside the dashboard build (see the plan's parked finding #2).
- `coverage.uncovered` = interactive elements observed this run that no scenario references
- `run_id` format: `<ts>-<tenant>-<feature>-<short>` — globally unique, sortable, human-readable
- `commit` (optional string, **additive, 2026-09-09**): short sha of the checkout the ledger
  lives in, stamped by `ledger.append_run` when the caller does not set it. Lets a proof row
  be tied to the build it drove (`scripts/qa/impact.py`). Readers must ignore unknown keys.

---

## §5.2 — Drift ledger (`ledgers/drift/<surface>/<tenant>/<feature>.jsonl`)

**Append-only JSONL.** One row per failing scenario. Turns a red test into a one-glance triage
decision (intended change vs bug).

```json
{
  "run_id": "2026-08-04T14:22:10Z-niete-menu-14f2",
  "ts": "2026-08-04T14:22:10Z",
  "scenario": "/menu shows exactly the 4 ICT feature rows",
  "step": "Then the feature list shows exactly these rows",
  "expected": ["Teacher Training","Lesson Plans","Classroom Coaching","Ask Anything"],
  "actual":   ["Teacher Training","Lesson Plans","Classroom Coaching","Ask Anything","Report a Problem"],
  "assertion_kind": "contract",
  "verdict": "pending",
  "evidence": "results/whatsapp/niete/14f2/menu-rows.png"
}
```

**Field reference:**
- `assertion_kind`: `contract` (structure/ids — a fail is a real behavior change) vs `copy` (exact
  string — a fail is usually an intended copy tweak). Drives triage priority.
- `verdict`: `pending` → a human sets `intended` (update fixture/spec, or feed `/apply-discoveries`)
  or `bug` (leave spec, file a bead). The dashboard reads the latest verdict per `(scenario)` key.

---

## §5.3 — Discoveries ledger (`ledgers/discoveries/<surface>/<tenant>/<feature>.md`)

**Human-legible markdown.** Coverage / comprehension-debt record: what the live bot shows that no
scenario covers. One entry per uncovered element, deduped by a stable slug.

```markdown
### D-niete-menu-003 · "Report a Problem" list row
- status: proposed          # proposed | approved | applied | rejected
- slug: list-row-report-a-problem
- surface: whatsapp/niete/menu.feature
- kind: list-row            # list-row | button | flow-screen | command
- observed: 2026-08-04 · run 14f2 · a 5th /menu row not in answer-keys.menu.expected_rows
- evidence: results/whatsapp/niete/14f2/menu-5th-row.png
- suggested: Scenario "/menu offers a Report a Problem row" → assert row present + its action
```

**Field reference:**
- Status lifecycle: agent writes `proposed`; human flips `approved`/`rejected`; `/apply-discoveries`
  flips `approved`→`applied` after editing the spec.
- `slug`: the dedup key — stable per element, diffed run-over-run so the same uncovered element
  never gets re-proposed as a duplicate entry.

---

## Rules (frozen — a change here is a dashboard-breaking change)

- runs.jsonl: append-only, NEVER rewritten. One row per (run × feature).
- drift/**.jsonl: append-only; ONLY a human `verdict` edit mutates a row in place.
- discoveries/**.md: human-legible; status lifecycle proposed→approved/rejected→applied.
- These files are git-tracked. Heavy evidence (screenshots) stays in the gitignored results/.
- Ledger rows reference evidence by relative path, never embed it.
