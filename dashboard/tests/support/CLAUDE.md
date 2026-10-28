# support — Shared helper for the SA Urdu fit tests, not a test file itself

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/tests/support kg=c9cac4ad4c50 gen=abcc9779955c overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `sa-ur-walk.js` — drives every SA screen in a real browser and measures Urdu ink; required by sa-ur-screens-fit.service.test.js
- Run via its consumer: cd dashboard && ./run-tests.sh tests/sa-ur-screens-fit --maxWorkers=2
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `sa-ur-walk.js` | Helper that walks every distinct Urdu screen at zoomed phone sizes (e.g. 360x640 at 130%) for the sa-ur fit tests |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- `sa-ur-walk.js` ← imported by `dashboard/scripts/sa-ur-fit-walk.js:15:1acac550`
- env read here: `SA_WALK_DEBUG`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/tests/CLAUDE.index.md`? · `dashboard/tests/CLAUDE.md`? · `dashboard/tests/support/CLAUDE.md`?
