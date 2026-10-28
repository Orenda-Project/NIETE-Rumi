# ops — One-shot operational fixes run by hand against live caches

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/ops kg=92e8040a565f gen=5eb3ef264318 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `flush-language-cache.js` — clears cached language preferences
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `flush-language-cache.js` | One-shot flush of cached language preferences in Redis after the writer hardening (language unification step 1.8) |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- env read here: `REDIS_URL`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/cache/flush-language-cache.test.js` (flush-language-cache.js)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/CLAUDE.md`? · `bot/scripts/ops/CLAUDE.md`?
