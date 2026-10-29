# support — Shared helper for the SA Urdu fit tests, not a test file itself

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/tests/support kg=0773b519d29e gen=085b87e05690 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `sa-ur-walk.js` — drives every SA screen in a real browser and measures Urdu ink; required by sa-ur-screens-fit.service.test.js
- Run via its consumer: cd dashboard && ./run-tests.sh tests/sa-ur-screens-fit --maxWorkers=2
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `sa-ur-walk.js` | Helper that walks every distinct Urdu screen at zoomed phone sizes (e.g. 360x640 at 130%) for the sa-ur fit tests |

## Who reads this (generated)
- `sa-ur-walk.js` ← imported by `dashboard/scripts/sa-ur-fit-walk.js:15:1acac550`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/tests/CLAUDE.md`?
