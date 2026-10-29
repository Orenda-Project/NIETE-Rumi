# attendance — WhatsApp attendance: router, marking Flow, voice roll call, registers and portal service
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/attendance kg=3519176c2233 gen=145b32cd55d3 overflow=19 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `attendance-router.test.js` — who gets which Flow on "attendance"
- `attendance-write.test.js` — the single write path shared by WhatsApp and the portal
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/attendance --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `completion-classified-from-token.test.js` | A bare flow_token Flow completion is classified from its token as attendance/class-manager and answered by its own Flow |
| `student-flow-four-asks.test.js` | bd-43523: student attendance reuses the principal path (picker, voice, REVIEW, register); radios to five classes |
| `empty-roster-dead-end.test.js` | bd-2713: an empty roster never dead-ends the attendance Flow; routing model has one entry screen per way in |
| `empty-roster-renders.test.js` | bd-2732: MARK never sends an empty data-source for a class with nobody in it, so the CheckboxGroup renders |
| `register-delivery-temp-race.test.js` | bd-c00np: two same-named register files delivered at once each reach their own school's principal; temp dir left clean |
| `absent-then-leave.test.js` | bd-2727: attendance Flow routes MARK to a separate LEAVE page so a student cannot be both absent and on leave |
| `class-setup-endpoint.test.js` | attendance-setup-endpoint paste-a-roster: parseRoster turns one paste into a clean student list, numbering stripped |
| `principal-teachers-only.test.js` | bd-43520: /attendance for a principal is staff attendance only, starting with the tap-or-voice chat question |
| … | 27 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Attendance never writes roster tables; /class owns them (tests/attendance/attendance-writes-no-rosters.test.js:2)
- An empty roster must never dead-end the Flow (bd-2713, tests/attendance/empty-roster-dead-end.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/attendance/CLAUDE.md`? · `bot/shared/services/classes/CLAUDE.md`? · `docs/attendance-bigquery-sync.md`? · `tests/CLAUDE.md`?
