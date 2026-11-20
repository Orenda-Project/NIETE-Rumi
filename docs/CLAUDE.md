# docs — Repo docs: architecture, E2E and QA system, migration history, ops guides
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=docs kg=688fcff7b6fd gen=2e4b0f3d37ce overflow=13 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `architecture.md` — start here for the system overview
- `qa-automation.md` — how a commit reaches spec sync and E2E
- `e2e-mock-lane.md` — the local mock lane design
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 18 sub-dirs, each with `CLAUDE.md` | `assessment/` · `assets/` · `evals/` · `features/` · `flows/` · `images/` · `lp612/` · `migration/` · `observability/` · `onboarding/` · `ops/` · `qa/` · `reports/` · `reviews/` · `roadmap/` · `samples/` · `templates/` · `testing/` |
| `customization.md` | Seam map: for each thing you might change, the file, kind of change and the conformance test guarding it |
| `agent-customization.md` | Agent-first guide mapping customization goals to exact files and change patterns, for Cursor or Claude Code users |
| `LP_PATHS.md` | Explains the three lesson-plan generation paths (text vs photo, per-region config) and how to switch each on; current |
| `e2e*` | 3 files; most used `e2e-mock-lane.md`: Design and operation of the E2E mock lane: bot from a commit behind a local Graph API, no browser or number |
| `app-funnel-telemetry.md` | Teacher-app funnel telemetry (bd-4r3rei): journey-id joined Axiom rows from WhatsApp command to app page exit |
| `lesson-plan-data-model-debt.md` | (unmapped) |
| `architecture.md` | System overview of the Rumi platform: webhook to Node bot, AI services, queues and storage components |
| `attendance-bigquery-sync.md` | Nightly export of teacher presence rollups from Supabase to the STEPS BigQuery warehouse for the ACR pipeline |
| … | 31 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Migration docs are history of decisions; do not delete (migration/README.md:5 area)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- skills: `customizing`? · `niete-mock-e2e`? · `setup`?
- docs: `.claude/CLAUDE.md`? · `.claude/commands/niete-e2e.md`? · `.claude/qa/README.md`? · `.claude/qa/SCHEDULE.md`? · `.githooks/README.md`? · `.github/CLAUDE.md`? (+79)
- … 1 more → `CLAUDE.index.md`
