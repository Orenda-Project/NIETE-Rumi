# tests — Root jest suite over bot/ and dashboard/ code, plus the no-new-failure baseline gate
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests kg=62a630221902 gen=23fd7903f914 overflow=9 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `BASELINE.md` — why `npm test` (baseline-gate.js) is a delta check against baseline.snapshot.json, not all-green
- `jest.config.js` — rootDir is repo root; maps bot-only deps to __mocks__; run one folder: `node tests/run.js tests/<dir> --maxWorkers=2`
- `baseline-growth-check.js` — fails if baseline.snapshot.json grew vs origin/sandbox
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 61 sub-dirs, each with `CLAUDE.md` | `app-funnel/` · `app-redirect/` · `assessment/` · `attendance/` · `broadcast/` · `cache/` · `child-test/` · `classes/` · `coaching/` · `coachip-media/` · `coachip-rm/` · `coachip/` · `config/` · `conversation-state/` · `dashboard/` · `database/` · `deploy/` · `e2e-mock/` · `exam-checker/` · `features/` · `fflp/` · `flow-response/` · `handlers/` · `hcp/` · `homework/` · `language/` · `lesson-plan-lifecycle/` · `llm/` · `lp-v8/` · `lp612/` · `menu-match/` · `menu/` · `meta-bill-cut/` · `migrations/` · `observability/` · `observe/` · `observe2/` · `portal/` · `pregen/` · `queue/` · `quiz/` · `reading/` · `region/` · `registration/` · `remark/` · `reports/` · `roster/` · `routes/` · `schema/` · `scripts/` · `settings/` · `setup/` · `status/` · `student-videos/` · `textbook-lp-v2/` · `training/` · `tts/` · `unit/` · `users/` · `whatsapp/` · `workers/` |
| … | 9 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `ANTHROPIC_BASE_URL` · `BASELINE_BASE_REF` · `LLM_PROVIDER` · `NODE_OPTIONS` · `OPENAI_BASE_URL` · `OPENROUTER_API_KEY` · `PORT` · `REDIS_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL`

## Never (human)
- Never grow baseline.snapshot.json; it may only shrink (tests/baseline-growth-check.js:3)
- Never pass args to `npm test`; it takes none, use `npm run test:raw -- <path>` (tests/BASELINE.md:25)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- skills: `qa-testing`?
- docs: `AGENTS.md`? · `CLAUDE.md`? · `README.md`? · `bot/CLAUDE.index.md`? · `bot/database/migrations/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? (+106)
