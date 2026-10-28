# __goldens__ — Recorded byte-for-byte outputs of OFF-switch first-touch behaviour

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/first-touch/__goldens__ kg=5114006088b0 gen=072c499ef943 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `one-door-off.json` — one-door replies per sender with the switch OFF
- `bot-mounts.json` — expected ordered first-touch mount stack
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `teacher-home-shell-off.json` | Golden of teacher-home shell sha256 per language/switch case, pinned by named-pick and page-run tests |
| `CLAUDE.md` | (unmapped) |
| `bot-mounts.json` | Golden of the first-touch Express mount stack (paths and handlers), pinned by mounts-golden.test.js |
| `one-door-off.json` | Golden of the one door's replies with quiz_one_door OFF per sender and trigger, pinned by one-door-entry.test.js |
| `teacher-home-grade-fast-off.json` | Golden of teacher-home shell responses with the grade-fast switch OFF, pinned by the grade-fast-off golden test |
| `teacher-home-paged-off.json` | Golden of teacher-home paged-switch OFF home JSON, pinned by teacher-home.quick.test.js and teacher-home.wait.test.js |
| `teacher-home-server-timing-off-rich.json` | Golden of the teacher-home JSON headers with server-timing OFF (rich case), pinned by teacher-home.server-timing.test.js |
| `teacher-home-server-timing-off.json` | Golden of the teacher-home JSON headers with server-timing OFF, pinned by teacher-home.server-timing.test.js |
| `teacher-home-speed.json` | Golden of the teacher-home speed fixture (make-card home JSON), pinned by teacher-home.speed.test.js |
| `teacher-home-wait-off.json` | Golden of teacher-home route responses with the wait switch OFF, pinned by teacher-home.wait.test.js |
| `way-back-off.json` | Golden of dead-end page sha256 hashes per page, language and number, way-back OFF; pinned by one-door-way-back.test.js |

## Who reads this (generated)
- (none)

## Never (human)
- Record only with TEACHER_HOME_RECORD=1; a normal run compares against the file (`bot/tests/first-touch/mounts-golden.test.js:57`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/tests/first-touch/CLAUDE.index.md`? · `bot/tests/first-touch/CLAUDE.md`? · `bot/tests/first-touch/__goldens__/CLAUDE.md`?
