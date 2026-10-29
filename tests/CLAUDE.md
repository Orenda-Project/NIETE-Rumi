# tests — Root jest suite over bot/ and dashboard/ code, plus the no-new-failure baseline gate
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests kg=edd13e6c6ef0 gen=3103a1fc34f9 overflow=2 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `BASELINE.md` — why `npm test` (baseline-gate.js) is a delta check against baseline.snapshot.json, not all-green
- `jest.config.js` — rootDir is repo root; maps bot-only deps to __mocks__; run one folder: `node tests/run.js tests/<dir> --maxWorkers=2`
- `baseline-growth-check.js` — fails if baseline.snapshot.json grew vs origin/sandbox
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 18 sub-dirs, each with `CLAUDE.md` | `assessment/` · `attendance/` · `child-test/` · `coaching/` · `coachip/` · `dashboard/` · `features/` · `hcp/` · `lesson-plan-lifecycle/` · `lp612/` · `observe2/` · `portal/` · `quiz/` · `routes/` · `scripts/` · `setup/` · `training/` · `whatsapp/` |
| 45 sub-dirs without a door | `__mocks__/` (24 tests) · `app-funnel/` (8 tests) · `app-redirect/` (22 tests) · `broadcast/` (6 tests) · `cache/` (4 tests) · +40 more → `CLAUDE.index.md` |
| `BASELINE.md` | Explains the root-suite baseline gate: why npm test means "no new failure", filtered jest runs, known red suites |
| `jest.config.js` | Root jest config: rootDir is repo root, matches tests/**/*.test.js|ts, maps bot-only deps to tests/__mocks__ stubs |
| `baseline*` | 3 files; most used `baseline.snapshot.json`: Recorded known-failing suites, failing test names and offender lists that baseline-gate.js compares each run against |
| `run.js` | Wrapper that runs jest with tests/jest.config.js, adding the right NODE_OPTIONS localstorage flag for Node 22+/25 |
| … | 65 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Never grow baseline.snapshot.json; it may only shrink (tests/baseline-growth-check.js:3)
- Never pass args to `npm test`; it takes none, use `npm run test:raw -- <path>` (tests/BASELINE.md:25)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- skills: `qa-testing`?
- docs: `AGENTS.md`? · `CLAUDE.md`? · `README.md`? · `bot/database/migrations/CLAUDE.md`? · `bot/shared/routes/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? (+9)
