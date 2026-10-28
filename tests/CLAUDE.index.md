# tests — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__mocks__/` | → (no door; 24 test files) |
| `app-funnel/` | App funnel telemetry: journey ids, action logging and funnel endpoints → `app-funnel/CLAUDE.md` |
| `app-redirect/` | Bot-to-app redirect: per-feature switches and the one-tap /go login link → `app-redirect/CLAUDE.md` |
| `assessment/` | Tests for the assessment/exam generator: WhatsApp Flow, portal editor, FDE board papers → `assessment/CLAUDE.md` |
| `attendance/` | WhatsApp attendance: router, marking Flow, voice roll call, registers and portal service → `attendance/CLAUDE.md` |
| `broadcast/` | Dashboard WhatsApp broadcast sending: templates, language, wamids, quick-reply taps → `broadcast/CLAUDE.md` |
| `cache/` | Redis and language-cache behaviour: setNX, error throttling, the language writer → `cache/CLAUDE.md` |
| `child-test/` | EGRA/EGMA child test a coach runs over WhatsApp; one folder per build lane → `child-test/CLAUDE.md` |
| `classes/` | The /class manager: ClassService, roster Flow screens, labels and vocabulary → `classes/CLAUDE.md` |
| `coaching/` | Root jest suite for the AI coaching pipeline: analysis, reports, reflection, LP linking → `coaching/CLAUDE.md` |
| `coachip-media/` | COACHIP audio clip (R7) and circle (R8) streaming service and routes → `coachip-media/CLAUDE.md` |
| `coachip-rm/` | Adversarial sector-scope tests for COACHIP regional-manager routes → `coachip-rm/CLAUDE.md` |
| `coachip/` | COACHIP coach/RM insight routes tested over HTTP against a throwaway Postgres → `coachip/CLAUDE.md` |
| `config/` | Config contracts: branding defaults, language registry, string catalog, job labels → `config/CLAUDE.md` |
| `conversation-state/` | One-row-per-teacher conversation state store and the resume sweeper → `conversation-state/CLAUDE.md` |
| `dashboard/` | Dashboard portal proxy routes to the bot: assessment, classes, board pattern → `dashboard/CLAUDE.md` |
| `database/` | DB-layer contracts: record_history audit, actor ledger, soft delete, SQL migrations → `database/CLAUDE.md` |
| `deploy/` | Install-time guard that a missing native module fails the bot build → `deploy/CLAUDE.md` |
| `e2e-mock/` | Unit tests for the mock E2E lane: cassettes, mock Graph API, flow emulator, drivers → `e2e-mock/CLAUDE.md` |
| `exam-checker/` | Exam checker: grading schema contract, confirm-students Flow, missing-canvas boot → `exam-checker/CLAUDE.md` |
| `features/` | Gherkin specs for the NIETE bot (WhatsApp) and portal (web) E2E lanes → `features/CLAUDE.md` |
| `fflp/` | Free-form (typed-topic) lesson plan seam: switch, catalogue match, queue, goldens → `fflp/CLAUDE.md` |
| `fixtures/` | → (no door; 13 test files) |
| `flow-response/` | flow-response handler routing of WhatsApp Flow completions (NFM_REPLY) → `flow-response/CLAUDE.md` |
| `handlers/` | Text, voice and menu handler behaviour of the bot through real handlers → `handlers/CLAUDE.md` |
| `hcp/` | HCP/Priority Dashboard portal routes under /api/portal/hcp/* → `hcp/CLAUDE.md` |
| `homework/` | Homework request flow: lookup, request endpoint, bundle worker → `homework/CLAUDE.md` |
| `language/` | Pins how reply language is chosen and that Urdu copy stays gender-neutral → `language/CLAUDE.md` |
| `lesson-plan-lifecycle/` | lesson_plan_requests lifecycle rows per LP path, plus the hourly health check → `lesson-plan-lifecycle/CLAUDE.md` |
| `llm/` | LLM routing: per-job model override, model registry, direct Anthropic lane, cost events → `llm/CLAUDE.md` |
| `lp-v8/` | Grade 1-5 v8 LP delivery, coaching ask, LP survey, web lessons link, Meta-bill cuts → `lp-v8/CLAUDE.md` |
| `lp612/` | Grade 6-12 LP lane: author ladder, render, catalogue, Urdu overlay, religious gate → `lp612/CLAUDE.md` |
| `menu-match/` | Tests that unmatched messages and voice notes route via the teacher's live menu → `menu-match/CLAUDE.md` |
| `menu/` | Tests the /menu front door: role layouts, language, tap gating, stale waits → `menu/CLAUDE.md` |
| `meta-bill-cut/` | Tests the Oct 2026 fix rounds that cut billed WhatsApp sends and stray typing → `meta-bill-cut/CLAUDE.md` |
| `migrations/` | Tests a data migration that changes teachers' stored language → `migrations/CLAUDE.md` |
| `observability/` | Tests that portal and dashboard telemetry really reaches the Axiom sink → `observability/CLAUDE.md` |
| `observe/` | Tests the /observe coach flow: portal observations, send, edit teacher, sweeps → `observe/CLAUDE.md` |
| `observe2/` | Tests /observe2, the live field-form coaching visit: form, moments, check, brief → `observe2/CLAUDE.md` |
| `portal/` | Root jest tests pinning the portal's dashboard routes, services and Android shell → `portal/CLAUDE.md` |
| `pregen/` | Pre-generated Pakistan lesson-plan seed rows (FEAT-059 / FEAT-080) → `pregen/CLAUDE.md` |
| `queue/` | Tests the SQS/BullMQ queue drivers, worker drain and job language handling → `queue/CLAUDE.md` |
| `quiz/` | Tests for the quiz stack: authoring, validator, offers, class reports, web quiz → `quiz/CLAUDE.md` |
| `reading/` | Tests the reading-assessment seams: benchmarks, availability gate, copy, voice → `reading/CLAUDE.md` |
| `region/` | Tests region-config labels and the DB-driven region feature gating → `region/CLAUDE.md` |
| `registration/` | Tests the registration Flow v5, its endpoint and every door that invites it → `registration/CLAUDE.md` |
| `remark/` | Tests the /remark Supervisor Remark Flow's cross-artifact contract → `remark/CLAUDE.md` |
| `reports/` | Tests PDF/HTML report rendering: Playwright wrapper, MEWAKA, reading, Oxbridge LP → `reports/CLAUDE.md` |
| `roster/` | Tests /roster: register-photo extraction, review editing, saving, class hand-over → `roster/CLAUDE.md` |
| `routes/` | Tests the bot's internal HTTP API (portal-to-bot), FLN sends and /go links → `routes/CLAUDE.md` |
| `schema/` | Tests that repo migrations and the reference schema declare live DB columns → `schema/CLAUDE.md` |
| `scripts/` | Tests scripts/smoke-test.js, plus the tiny modules it loads as fixtures → `scripts/CLAUDE.md` |
| `settings/` | Tests the settings Flow endpoint and its language writer → `settings/CLAUDE.md` |
| `setup/` | Repo-wide guard tests: schema, migrations, flows, hygiene ratchets and setup scripts → `setup/CLAUDE.md` |
| `status/` | Tests /status: active-resource listing, cancel actions, completion acks and logging → `status/CLAUDE.md` |
| `student-videos/` | Tests the Student Videos Flow endpoint, feedback and voiceover gateway → `student-videos/CLAUDE.md` |
| `textbook-lp-v2/` | Textbook-grounded LP services: ToC loading, topic match, pre-gen lookup, template → `textbook-lp-v2/CLAUDE.md` |
| `training/` | Tests teacher training: levels, quizzes, exams, certificates, I-SAPS and portal routes → `training/CLAUDE.md` |
| `tts/` | Tests the text-to-speech gateway, providers (ElevenLabs, Soniox) and Ogg Opus handling → `tts/CLAUDE.md` |
| `unit/` | Misc unit tests: llm-client, WhatsApp senders, plus sprint-N OSS-prep checks → `unit/CLAUDE.md` |
| `users/` | Tests user-row invariants: one name column and one teacher-level reader → `users/CLAUDE.md` |
| `whatsapp/` | Tests WhatsApp senders, send pacing, inbound typing and webhook signature checks → `whatsapp/CLAUDE.md` |
| `workers/` | Tests worker process signals: web drain and the PDF renderer under SIGTERM → `workers/CLAUDE.md` |
| `BASELINE.md` | Explains the root-suite baseline gate: why npm test means "no new failure", filtered jest runs, known red suites |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `baseline-gate.js` | npm test gate: runs the full suite, fails only on new failures vs baseline.snapshot.json (suite, test, offender level) |
| `baseline-growth-check.js` | Fails if baseline.snapshot.json grew versus the base branch (default origin/sandbox); --allow-growth records intent |
| `baseline.snapshot.json` | Recorded known-failing suites, failing test names and offender lists that baseline-gate.js compares each run against |
| `jest.config.js` | Root jest config: rootDir is repo root, matches tests/**/*.test.js|ts, maps bot-only deps to tests/__mocks__ stubs |
| `run.js` | Wrapper that runs jest with tests/jest.config.js, adding the right NODE_OPTIONS localstorage flag for Node 22+/25 |
| `setup-loopback-root.test.js` | Pins that the root jest tree loads the no-live-services guard so LLM, Redis and HTTP clients cannot dial real hosts |
| `setup.js` | Global jest setup: sets NODE_ENV=test and safe dummy Supabase, OpenRouter, Redis and LLM_PROVIDER env defaults |

## Who reads this (all, generated)
- env `ANTHROPIC_BASE_URL` read at `tests/setup-loopback-root.test.js:23:8ad1ca0c`
- env `BASELINE_BASE_REF` read at `tests/baseline-growth-check.js:35:0132b1d4`
- env `LLM_PROVIDER` read at `tests/setup.js:17:6259bb1a`
- env `NODE_OPTIONS` read at `tests/run.js:28:1f6b0e36`
- env `OPENAI_BASE_URL` read at `tests/setup-loopback-root.test.js:22:ae900f78`
- env `OPENROUTER_API_KEY` read at `tests/setup.js:14:572b8465`
- env `PORT` read at `tests/setup.js:16:eb1a89ba`
- env `REDIS_URL` read at `tests/setup.js:15:1168aff6`
- env `SUPABASE_SERVICE_ROLE_KEY` read at `tests/setup.js:13:e0edb9fb`
- env `SUPABASE_URL` read at `tests/setup.js:12:88405bdc`

## Tests (all, generated)
- (none)

## Related (all, generated)
- skills: `qa-testing`?
- docs: `AGENTS.md`? · `CLAUDE.md`? · `README.md`? · `bot/CLAUDE.index.md`? · `bot/database/migrations/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/vendor/lp-v9/CLAUDE.index.md`? · `bot/vendor/lp-v9/SYNC.md`? · `dashboard/CLAUDE.index.md`? · `dashboard/CLAUDE.md`? · `dashboard/routes/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.md`? · `docs/features/CLAUDE.index.md`? · `docs/features/role-based-menu.md`? · `infrastructure/scripts/CLAUDE.md`? · `infrastructure/supabase/CLAUDE.index.md`? · `portal/scripts/urdu-fit/CLAUDE.md`? · `tests/BASELINE.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/app-funnel/CLAUDE.md`? · `tests/app-redirect/CLAUDE.index.md`? · `tests/app-redirect/CLAUDE.md`? · `tests/assessment/CLAUDE.index.md`? · `tests/assessment/CLAUDE.md`? · `tests/attendance/CLAUDE.index.md`? · `tests/attendance/CLAUDE.md`? · `tests/broadcast/CLAUDE.md`? · `tests/cache/CLAUDE.md`? · `tests/child-test/CLAUDE.md`? · `tests/classes/CLAUDE.index.md`? · `tests/classes/CLAUDE.md`? · `tests/coaching/CLAUDE.index.md`? · `tests/coaching/CLAUDE.md`? · `tests/coaching/fidelity/CLAUDE.index.md`? · `tests/coaching/fidelity/CLAUDE.md`? · `tests/coachip-media/CLAUDE.md`? · `tests/coachip-rm/CLAUDE.md`? · `tests/coachip/CLAUDE.index.md`? · `tests/coachip/CLAUDE.md`? · `tests/config/CLAUDE.index.md`? · `tests/config/CLAUDE.md`? · `tests/conversation-state/CLAUDE.index.md`? · `tests/conversation-state/CLAUDE.md`? · `tests/dashboard/CLAUDE.md`? · `tests/database/CLAUDE.index.md`? · `tests/database/CLAUDE.md`? · `tests/deploy/CLAUDE.md`? · `tests/e2e-mock/CLAUDE.index.md`? · `tests/e2e-mock/CLAUDE.md`? · `tests/exam-checker/CLAUDE.md`? · `tests/features/CLAUDE.md`? · `tests/fflp/CLAUDE.md`? · `tests/flow-response/CLAUDE.md`? · `tests/handlers/CLAUDE.index.md`? · `tests/handlers/CLAUDE.md`? · `tests/hcp/CLAUDE.index.md`? · `tests/hcp/CLAUDE.md`? · `tests/homework/CLAUDE.md`? · `tests/language/CLAUDE.md`? · `tests/lesson-plan-lifecycle/CLAUDE.index.md`? · `tests/lesson-plan-lifecycle/CLAUDE.md`? · `tests/llm/CLAUDE.index.md`? · `tests/llm/CLAUDE.md`? · `tests/lp-v8/CLAUDE.index.md`? · `tests/lp-v8/CLAUDE.md`? · `tests/lp612/CLAUDE.index.md`? · `tests/lp612/CLAUDE.md`? · `tests/menu-match/CLAUDE.md`? · `tests/menu/CLAUDE.md`? · `tests/meta-bill-cut/CLAUDE.md`? · `tests/migrations/CLAUDE.md`? · `tests/observability/CLAUDE.md`? · `tests/observe/CLAUDE.index.md`? · `tests/observe/CLAUDE.md`? · `tests/observe2/CLAUDE.index.md`? · `tests/observe2/CLAUDE.md`? · `tests/portal/CLAUDE.index.md`? · `tests/portal/CLAUDE.md`? · `tests/pregen/CLAUDE.md`? · `tests/queue/CLAUDE.index.md`? · `tests/queue/CLAUDE.md`? · `tests/quiz/CLAUDE.index.md`? · `tests/quiz/CLAUDE.md`? · `tests/reading/CLAUDE.md`? · `tests/region/CLAUDE.md`? · `tests/registration/CLAUDE.index.md`? · `tests/registration/CLAUDE.md`? · `tests/remark/CLAUDE.md`? · `tests/reports/CLAUDE.md`? · `tests/roster/CLAUDE.index.md`? · `tests/roster/CLAUDE.md`? · `tests/routes/CLAUDE.index.md`? · `tests/routes/CLAUDE.md`? · `tests/schema/CLAUDE.md`? · `tests/scripts/CLAUDE.md`? · `tests/settings/CLAUDE.md`? · `tests/setup/CLAUDE.index.md`? · `tests/setup/CLAUDE.md`? · `tests/status/CLAUDE.index.md`? · `tests/status/CLAUDE.md`? · `tests/student-videos/CLAUDE.md`? · `tests/textbook-lp-v2/CLAUDE.md`? · `tests/training/CLAUDE.index.md`? · `tests/training/CLAUDE.md`? · `tests/tts/CLAUDE.md`? · `tests/unit/CLAUDE.md`? · `tests/users/CLAUDE.md`? · `tests/whatsapp/CLAUDE.index.md`? · `tests/whatsapp/CLAUDE.md`? · `tests/workers/CLAUDE.md`? · `todo.md`?
