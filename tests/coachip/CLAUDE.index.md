# coachip — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/coachip -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__golden__/` | → (no door; 1 test files) |
| `fixtures/` | → (no door; 2 test files) |
| `helpers/` | Shared helpers for COACHIP tests: temp Postgres, app mount, fictional seed rows → `helpers/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `coachip-assert-clean.test.js` | bd-sex15q.19: assertClean wrapper in the COACHIP router 500s any body holding forbidden keys or URL patterns |
| `coachip-coach-read.test.js` | bd-sex15q.13: coach read routes (R2 home, R4 schools, etc.) over HTTP via real router, scope and codec on temp Postgres |
| `coachip-codes.service.test.js` | bd-sex15q.13: anonymisation codec: teacherKey HMAC, per-coach ordinal codes assigned once, audit, needs a real secret |
| `coachip-contract.test.js` | bd-sex15q.13: every COACHIP route in routes.json (R1-R21) honours 401/404/flag-off behaviour regardless of handler |
| `coachip-flags.test.js` | bd-sex15q.13: the three fail-closed COACHIP switches (portal_coachip, _rm, _decode) and how rmSectorFor reads them |
| `coachip-golden.test.js` | bd-sex15q.13: B7 golden route shapes of existing portal routes with no COACHIP setting; UPDATE_GOLDEN=1 regenerates |
| `coachip-job-runs-env-ref.test.js` | bd-sex15q.38: coachip_job_runs.env_ref accepts every tier the nightly may write to and refuses non-tier values |
| `coachip-library-words.test.js` | No snake_case schema words reach a coach or RM screen from the intervention library, via interventionShape and raw file |
| `coachip-listen-read.test.js` | bd-sex15q.13: coach Listen, player, Stats (R14) and Results (R15) reads, including 5-point change rule and null-under-5 |
| `coachip-mount.test.js` | bd-sex15q.13: executes the COACHIP block cut from dashboard/index.js: router mount, limiters, media wiring, rethrow |
| `coachip-rm-read.test.js` | bd-sex15q.13: the three RM reads (R17 sector home, R18 coach, R20) with sector scoping and empty-state behaviour |
| `coachip-scope.service.test.js` | bd-sex15q.13: coachScope picks a coach's real schools and live non-test teachers; never exposes a teacher's users.id |
| `coachip-write.test.js` | bd-sex15q.13: COACHIP write routes (R10 POST steps and siblings) with check_by rules, 409s and audit on temp Postgres |

## Who reads this (all, generated)
- table `app_settings` (written by `coachip-contract.test.js`) ← read by `bot/shared/config/feature-flags.js:92:8d5282ae`? · `bot/shared/config/model-settings.js:162:19a9a79a`? · `bot/shared/config/web-quiz-brand.js:127:110366bd`? · `bot/shared/services/app-redirect.service.js:280:8d5282ae`? (+122: `python3 kg/kg.py who-reads app_settings`)
- table `coaching_sessions` (written by `coachip-scope.service.test.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+86: `python3 kg/kg.py who-reads coaching_sessions`)
- table `coachip_circle_items` (written by `coachip-rm-read.test.js`) ← read by `dashboard/services/coachip-scope.service.js:114:6901ce57`?
- table `coachip_moments` (written by `coachip-rm-read.test.js`) ← read by `dashboard/routes/portal-coachip-media.routes.js:56:3ad11438`?
- table `observation_schedules` (written by `coachip-write.test.js`) ← read by `bot/shared/calls/call-tools.repo.js:225:061f012c`? · `bot/shared/routes/internal-api.routes.js:2492:061f012c`? · `bot/shared/services/coaching/media-attach.service.js:127:a08bdd15`? · `bot/shared/services/observe/observe-calendar.service.js:102:061f012c`? (+5: `python3 kg/kg.py who-reads observation_schedules`)
- table `users` (written by `coachip-scope.service.test.js`, `coachip-write.test.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? · `bot/shared/calls/call-tools.repo.js:242:774e00e5`? · `bot/shared/database/bot-helpers.js:17:61dfd735`? (+169: `python3 kg/kg.py who-reads users`)
- env `COACHIP_MOUNT_INDEX` read at `tests/coachip/coachip-mount.test.js:18:fa9789e2`
- env `COACHIP_TEACHER_KEY_SECRET` read at `tests/coachip/coachip-mount.test.js:64:7e8198fe`
- env `UPDATE_GOLDEN` read at `tests/coachip/coachip-golden.test.js:205:83162b2e`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `dashboard/lib/CLAUDE.index.md`? · `dashboard/lib/insights/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.md`? · `dashboard/services/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/coachip/CLAUDE.index.md`? · `tests/coachip/CLAUDE.md`? · `tests/coachip/helpers/CLAUDE.md`?
