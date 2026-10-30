# tests — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__mocks__/` | → (no door; 24 files: 0 test + 24 support) |
| `app-funnel/` | → (no door; 9 tests) |
| `app-redirect/` | → (no door; 22 tests) |
| `assessment/` | Tests for the assessment/exam generator: WhatsApp Flow, portal editor, FDE board papers → `assessment/CLAUDE.md` |
| `attendance/` | WhatsApp attendance: router, marking Flow, voice roll call, registers and portal service → `attendance/CLAUDE.md` |
| `broadcast/` | → (no door; 6 tests) |
| `cache/` | → (no door; 4 tests) |
| `child-test/` | EGRA/EGMA child test a coach runs over WhatsApp; one folder per build lane → `child-test/CLAUDE.md` |
| `classes/` | → (no door; 20 tests) |
| `coaching/` | Root jest suite for the AI coaching pipeline: analysis, reports, reflection, LP linking → `coaching/CLAUDE.md` |
| `coachip-media/` | → (no door; 2 tests) |
| `coachip-rm/` | → (no door; 1 tests) |
| `coachip/` | COACHIP coach/RM insight routes tested over HTTP against a throwaway Postgres → `coachip/CLAUDE.md` |
| `config/` | → (no door; 12 tests) |
| `conversation-state/` | → (no door; 12 tests) |
| `dashboard/` | Dashboard portal proxy routes to the bot: assessment, classes, board pattern → `dashboard/CLAUDE.md` |
| `database/` | → (no door; 15 tests) |
| `deploy/` | → (no door; 1 tests) |
| `e2e-mock/` | → (no door; 27 tests) |
| `exam-checker/` | → (no door; 3 tests) |
| `features/` | Gherkin specs for the NIETE bot (WhatsApp) and portal (web) E2E lanes → `features/CLAUDE.md` |
| `fflp/` | → (no door; 21 files: 6 test + 15 support) |
| `fixtures/` | → (no door; 13 files: 0 test + 13 support) |
| `flow-response/` | → (no door; 2 tests) |
| `handlers/` | → (no door; 18 tests) |
| `hcp/` | HCP/Priority Dashboard portal routes under /api/portal/hcp/* → `hcp/CLAUDE.md` |
| `homework/` | → (no door; 1 tests) |
| `language/` | → (no door; 5 tests) |
| `lesson-plan-lifecycle/` | lesson_plan_requests lifecycle rows per LP path, plus the hourly health check → `lesson-plan-lifecycle/CLAUDE.md` |
| `llm/` | → (no door; 26 tests) |
| `lp-v8/` | → (no door; 33 tests) |
| `lp612/` | Grade 6-12 LP lane: author ladder, render, catalogue, Urdu overlay, religious gate → `lp612/CLAUDE.md` |
| `menu-match/` | → (no door; 4 tests) |
| `menu/` | → (no door; 6 tests) |
| `meta-bill-cut/` | → (no door; 6 tests) |
| `migrations/` | → (no door; 1 tests) |
| `observability/` | → (no door; 2 tests) |
| `observe/` | → (no door; 26 tests) |
| `observe2/` | Tests /observe2, the live field-form coaching visit: form, moments, check, brief → `observe2/CLAUDE.md` |
| `portal/` | Root jest tests pinning the portal's dashboard routes, services and Android shell → `portal/CLAUDE.md` |
| `pregen/` | → (no door; 1 tests) |
| `queue/` | → (no door; 9 tests) |
| `quiz/` | Tests for the quiz stack: authoring, validator, offers, class reports, web quiz → `quiz/CLAUDE.md` |
| `reading/` | → (no door; 4 tests) |
| `region/` | → (no door; 3 tests) |
| `registration/` | → (no door; 20 tests) |
| `remark/` | → (no door; 1 tests) |
| `reports/` | → (no door; 5 tests) |
| `roster/` | → (no door; 23 tests) |
| `routes/` | Tests the bot's internal HTTP API (portal-to-bot), FLN sends and /go links → `routes/CLAUDE.md` |
| `schema/` | → (no door; 1 tests) |
| `scripts/` | Tests scripts/smoke-test.js, plus the tiny modules it loads as fixtures → `scripts/CLAUDE.md` |
| `settings/` | → (no door; 2 tests) |
| `setup/` | Repo-wide guard tests: schema, migrations, flows, hygiene ratchets and setup scripts → `setup/CLAUDE.md` |
| `status/` | → (no door; 9 tests) |
| `student-videos/` | → (no door; 2 tests) |
| `textbook-lp-v2/` | → (no door; 5 tests) |
| `training/` | Tests teacher training: levels, quizzes, exams, certificates, I-SAPS and portal routes → `training/CLAUDE.md` |
| `tts/` | → (no door; 7 tests) |
| `unit/` | → (no door; 16 tests) |
| `users/` | → (no door; 2 tests) |
| `whatsapp/` | Tests WhatsApp senders, send pacing, inbound typing and webhook signature checks → `whatsapp/CLAUDE.md` |
| `workers/` | → (no door; 3 tests) |
| `BASELINE.md` | Explains the root-suite baseline gate: why npm test means "no new failure", filtered jest runs, known red suites |
| `baseline-gate.js` | npm test gate: runs the full suite, fails only on new failures vs baseline.snapshot.json (suite, test, offender level) |
| `baseline-growth-check.js` | Fails if baseline.snapshot.json grew versus the base branch (default origin/sandbox); --allow-growth records intent |
| `baseline.snapshot.json` | Recorded known-failing suites, failing test names and offender lists that baseline-gate.js compares each run against |
| `jest.config.js` | Root jest config: rootDir is repo root, matches tests/**/*.test.js|ts, maps bot-only deps to tests/__mocks__ stubs |
| `run.js` | Wrapper that runs jest with tests/jest.config.js, adding the right NODE_OPTIONS localstorage flag for Node 22+/25 |
| `setup-loopback-root.test.js` | Pins that the root jest tree loads the no-live-services guard so LLM, Redis and HTTP clients cannot dial real hosts |
| `setup.js` | Global jest setup: sets NODE_ENV=test and safe dummy Supabase, OpenRouter, Redis and LLM_PROVIDER env defaults |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- skills: `qa-testing`?
- docs: `AGENTS.md`? · `CLAUDE.md`? · `README.md`? · `bot/database/migrations/CLAUDE.md`? · `bot/shared/routes/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `dashboard/CLAUDE.md`? · `dashboard/routes/CLAUDE.md`? · `docs/features/role-based-menu.md`? · `infrastructure/scripts/CLAUDE.md`? · `portal/scripts/urdu-fit/CLAUDE.md`? · `tests/BASELINE.md`? · `tests/assessment/CLAUDE.md`? · `tests/training/CLAUDE.md`? · `todo.md`?
