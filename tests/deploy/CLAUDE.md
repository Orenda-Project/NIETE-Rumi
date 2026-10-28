# deploy — Install-time guard that a missing native module fails the bot build

<!-- kg:meta repo=NIETE-Rumi dir=tests/deploy kg=814e019c3ea5 gen=b96d8388fb79 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `assert-native-modules.test.js` — bot/scripts/assert-native-modules.js exits 1 when canvas is absent
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/deploy --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `assert-native-modules.test.js` | bd-vq0mfv: bot/scripts/assert-native-modules.js fails the install when canvas is missing or unloadable |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
- A missing canvas fails the install so Railway keeps the old deploy (bd-vq0mfv, tests/deploy/assert-native-modules.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/deploy/CLAUDE.md`?
