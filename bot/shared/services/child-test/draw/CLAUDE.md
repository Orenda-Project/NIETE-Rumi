# draw — Which children a coach tests: seeded per-class draw, cycles, term sets, visit keys
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test/draw kg=a4c81d995911 gen=c49a0d539ad7 overflow=15 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `index.js` — todaysList, markOutcome, addChild, frame snapshot
- `shuffle.js` — HMAC seeded shuffle; stores only a seed digest
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `index.js` | The child draw: snapshot frame per class, seeded order, todaysList, markOutcome promoting alternates, addChild |
| `visit-key.js` | Parses and builds visit keys (cs:/day:) for child-test draws on visits with no observe2 field form |
| `CLAUDE.index.md` | (unmapped) |
| `cycle.js` | Maps a date to its Pakistan-time quarter cycle id (ICT-YYYY-Qn) and the Aug-Jul academic session code |
| `CLAUDE.md` | (unmapped) |
| `shuffle.js` | Seeded Fisher-Yates shuffle (HMAC of cycle and class) so ranks are unpredictable yet auditable; stores only a digest |
| … | 2 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `visit-key.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:51:02a8f71f` · `bot/shared/services/child-test/conversation/machine.js:51:4db8f781` (+3)
- `cycle.js` ← imported by `bot/shared/services/sa-game/store-adapter.js:30:a6c5b7c9` · `scripts/child-test/seed-sandbox.js:152:9fd5cd5b` (+1)
- `class-label.js` ← imported by `bot/shared/services/child-test/check-flow/check-store.js:20:a8c1bf9b` · `bot/shared/services/child-test/draw/index.js:44:4677f11c`
- `index.js` ← imported by `bot/shared/services/child-test/app/app-api.service.js:109:7ce125b7` · `scripts/child-test/smoke-sandbox.js:28:ea229281`
- … 3 more → `CLAUDE.index.md`

## Never (human)
- Changing the shuffle changes every future order: bump ALGO_VERSION (shuffle.js:12)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/child-test/L3/cycle-shuffle.test.js` (cycle.js, index.js, shuffle.js)
- `tests/child-test/L3/draw.test.js` (index.js, shuffle.js)
- … 10 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.md`? · `bot/shared/services/child-test/draw/CLAUDE.index.md`? · `bot/shared/services/child-test/draw/CLAUDE.md`? · `bot/tests/sa-game/CLAUDE.md`? · `tests/child-test/L20/CLAUDE.md`? (+5)
