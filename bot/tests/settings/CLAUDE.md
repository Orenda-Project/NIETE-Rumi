# settings — Tests for the app_settings switch cache and outage behaviour

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/settings kg=308688fcf44a gen=856a812901d7 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `switch-cache.test.js` — TTL, last-good value, one read and one log per outage
- `switch-outage.test.js` — the six switch readers share that behaviour
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `switch-outage.test.js` | Pins that an app_settings outage costs each quiz-link/join/weekly-report switch one read per 30 s, not one per request |
| `CLAUDE.md` | (unmapped) |
| `switch-cache.test.js` | Pins the shared settings switch-cache: TTL keep, single read during an outage, last-good value else OFF, one log line |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/coaching/weekly-report/CLAUDE.index.md`? · `bot/shared/services/coaching/weekly-report/CLAUDE.md`? · `bot/shared/services/first-touch/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/services/settings/CLAUDE.md`? · `bot/tests/CLAUDE.index.md`? (+2)
