# cache — Railway Redis client: caching, rate limits, webhook dedup, distributed locks
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/cache kg=b218c1e37f3c gen=5d3ce5bbdefc overflow=180 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `railway-redis.service.js` — singleton used across handlers; mocked in `shared/services/__mocks__/cache/`
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `railway-redis.service.js` | Railway Redis client: caching, rate limiting, webhook dedup and distributed locks; singleton export |

## Who reads this (generated)
- `railway-redis.service.js` ← imported by `bot/scripts/ops/flush-language-cache.js:88:dc72b764` · `bot/shared/handlers/image-message.handler.js:22:52aaec2d` (+101)
- env read here: `NODE_ENV` · `REDIS_URL`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/scripts/e2e/lp-feedback-e2e.js` (railway-redis.service.js)
- `bot/tests/first-touch/door-bound-seam.test.js` (railway-redis.service.js)
- `bot/tests/first-touch/door-cache.test.js` (railway-redis.service.js)
- `bot/tests/first-touch/door-keys.test.js` (railway-redis.service.js)
- `bot/tests/first-touch/door-known.golden.test.js` (railway-redis.service.js)
- `bot/tests/first-touch/door-off.golden.test.js` (railway-redis.service.js)
- `bot/tests/first-touch/door-on.test.js` (railway-redis.service.js)
- `bot/tests/first-touch/maker.routes.test.js` (railway-redis.service.js)
- `bot/tests/first-touch/one-door-abuse-bound.test.js` (railway-redis.service.js)
- `bot/tests/first-touch/one-door-entry.test.js` (railway-redis.service.js)
- `bot/tests/first-touch/one-door-go-routes.test.js` (railway-redis.service.js)
- `bot/tests/first-touch/teacher-home.routes.test.js` (railway-redis.service.js)
- `bot/tests/first-touch/walk-persona-seam.test.js` (railway-redis.service.js)
- `bot/tests/menu/issue-56-reading-assessment.test.js` (railway-redis.service.js)
- `bot/tests/menu/issue-57-lesson-plan-state.test.js` (railway-redis.service.js)
- `bot/tests/observe/bd-2kxxa2-media-target.test.js` (railway-redis.service.js)
- `bot/tests/observe/bd-lh9c2-dedup-nonce-wired.test.js` (railway-redis.service.js)
- … 180 more → `CLAUDE.index.md`

## Related (generated)
- skills: `cross-agent-safety`?
- docs: `bot/shared/services/CLAUDE.md`?
