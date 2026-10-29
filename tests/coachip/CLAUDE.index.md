# coachip — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/coachip -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__golden__/` | → (no door; 1 files: 0 test + 1 support) |
| `fixtures/` | → (no door; 2 files: 0 test + 2 support) |
| `helpers/` | Shared helpers for COACHIP tests: temp Postgres, app mount, fictional seed rows → `helpers/CLAUDE.md` |
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
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `dashboard/routes/CLAUDE.md`? · `tests/CLAUDE.md`?
