# cache — Redis and language-cache behaviour: setNX, error throttling, the language writer

<!-- kg:meta repo=NIETE-Rumi dir=tests/cache kg=55480a1dc622 gen=7f71222ad08b overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `language-writer.test.js` — only the offered languages may be stored
- `bd-ecpo5-setnx.test.js` — RailwayRedisService.setNX must exist (photo capture depended on it)
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/cache --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `flush-language-cache.test.js` | ops flush-language-cache script deletes only the two user:language key patterns and nothing else |
| `language-writer.test.js` | Language writer (language-cache): only the offered languages are stored; off-market languages rejected, nothing written |
| `bd-ecpo5-setnx.test.js` | bd-ecpo5: RailwayRedisService.setNX exists: atomic set-if-absent with TTL (classroom photo capture needed it) |
| `redis-error-throttle.test.js` | Railway Redis 'error' handler logs at most once per 10 s even when 50 reconnect errors fire in under a second |

## Who reads this (generated)
- (none)

## Never (human)
- flush-language-cache deletes only user:language keys (tests/cache/flush-language-cache.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/ops/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/cache/CLAUDE.md`?
