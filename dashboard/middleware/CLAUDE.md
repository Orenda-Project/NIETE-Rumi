# middleware — Express middleware: session auth, request timeout, latency logging, RBAC

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/middleware kg=5f1e7b4029dc gen=0cdf7bf0c977 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `auth.js` — requireAuth and role helpers for observability pages
- `rbac/index.js` — RBAC exports
- `timeout.js` — per-route-type timeouts
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `rbac/` | Role, feature-access and DB-context middleware for admin routes → `rbac/CLAUDE.md` |
| `CLAUDE.md` | (unmapped) |
| `latency-logger.js` | Express middleware that times each request, logs it via telemetry and flags slow ones. |
| `timeout.js` | Per-route-type request timeout middleware so hung requests cannot block workers. |
| `auth.js` | Session auth middleware for the observability dashboard (requireAuth, role checks, user locals). |

## Who reads this (generated)
- `timeout.js` ← imported by `dashboard/index.js:20:f961953a` · `dashboard/routes/portal.routes.js:65:b7fead48` (+1)
- `auth.js` ← imported by `dashboard/index.js:19:4e45b290`
- `latency-logger.js` ← imported by `dashboard/index.js:21:93d3201a`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `dashboard/tests/web-quiz-teacher-report.service.test.js` (latency-logger.js)
- `tests/observability/portal-request-telemetry.test.js` (latency-logger.js)
- `tests/observe/iab-probe.test.js` (latency-logger.js)
- `tests/portal/capstone-submit-budget.test.js` (timeout.js)

## Related (generated)
- docs: `dashboard/CLAUDE.index.md`? · `dashboard/CLAUDE.md`? · `dashboard/middleware/CLAUDE.md`? · `dashboard/middleware/rbac/CLAUDE.md`? · `dashboard/tests/CLAUDE.index.md`? · `dashboard/tests/CLAUDE.md`? (+3)
