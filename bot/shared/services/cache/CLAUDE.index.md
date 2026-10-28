# cache — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/cache -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `railway-redis.service.js` | Railway Redis client: caching, rate limiting, webhook dedup and distributed locks; singleton export |

## Who reads this (all, generated)
- `railway-redis.service.js` ← imported by `bot/scripts/ops/flush-language-cache.js:88:dc72b764` · `bot/shared/handlers/image-message.handler.js:22:52aaec2d` · `bot/shared/handlers/text-message.handler.js:14:52aaec2d` · `bot/shared/routes/assessment-gen-endpoint.js:22:c73ea32d` (+99: `python3 kg/kg.py who-reads railway-redis.service.js`)
- env `NODE_ENV` read at `bot/shared/services/cache/railway-redis.service.js:811:d8e24952`
- env `REDIS_URL` read at `bot/shared/services/cache/railway-redis.service.js:25:d6231a76`

## Tests (all, generated)
- `railway-redis.service.js` ← `bot/scripts/e2e/lp-feedback-e2e.js` · `bot/tests/first-touch/door-bound-seam.test.js` · `bot/tests/first-touch/door-cache.test.js` · `bot/tests/first-touch/door-keys.test.js` · `bot/tests/first-touch/door-known.golden.test.js` · `bot/tests/first-touch/door-off.golden.test.js` (+191: `python3 kg/kg.py who-reads bot/shared/services/cache/railway-redis.service.js`)

## Related (all, generated)
- skills: `cross-agent-safety`?
- docs: `bot/scripts/e2e/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/cache/CLAUDE.index.md`? · `bot/shared/services/cache/CLAUDE.md`? · `bot/tests/first-touch/CLAUDE.index.md`? · `bot/tests/menu/CLAUDE.md`? · `bot/tests/observe/CLAUDE.index.md`? · `bot/tests/observe/CLAUDE.md`?
