# draw — Which children a coach tests: seeded per-class draw, cycles, term sets, visit keys
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test/draw kg=f8f6390ee77d gen=8eb18b4c9eac overflow=17 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `index.js` — todaysList, markOutcome, addChild, frame snapshot
- `shuffle.js` — HMAC seeded shuffle; stores only a seed digest
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `index.js` | The child draw: snapshot frame per class, seeded order, todaysList, markOutcome promoting alternates, addChild |
| `visit-key.js` | Parses and builds visit keys (cs:/day:) for child-test draws on visits with no observe2 field form |
| `cycle.js` | Maps a date to its Pakistan-time quarter cycle id (ICT-YYYY-Qn) and the Aug-Jul academic session code |
| `region.js` | (unmapped) |
| `shuffle.js` | Seeded Fisher-Yates shuffle (HMAC of cycle and class) so ranks are unpredictable yet auditable; stores only a digest |
| `class-label.js` | Names a classroom as teachers read it (Grade 3 - B, evening, short form) in English and Urdu (R1 7.1) |
| `term-set.js` | Picks the card set (A/B) for a cycle, alternating by quarter, and the CHILD_TEST_FORM_POLICY switch |

## Who reads this (generated)
- `visit-key.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:53:02a8f71f` · `bot/shared/services/child-test/conversation/machine.js:51:4db8f781` (+3)
- `region.js` ← imported by `bot/shared/handlers/jugnu-command.js:89:89bb404d` · `bot/shared/services/child-test/app/sa-api.service.js:305:f34c87d1` (+2)
- `cycle.js` ← imported by `bot/shared/services/sa-game/store-adapter.js:30:a6c5b7c9` · `scripts/child-test/seed-sandbox.js:152:9fd5cd5b` (+1)
- `class-label.js` ← imported by `bot/shared/services/child-test/check-flow/check-store.js:20:a8c1bf9b` · `bot/shared/services/child-test/draw/index.js:44:4677f11c`
- … 6 more → `CLAUDE.index.md`

## Never (human)
- Changing the shuffle changes every future order: bump ALGO_VERSION (shuffle.js:12)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/child-test/L3/cycle-shuffle.test.js` (cycle.js, index.js, shuffle.js)
- `tests/child-test/L3/draw.test.js` (index.js, shuffle.js)
- … 13 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/child-test/CLAUDE.md`?
