# __golden__ — Byte-exact switch-OFF response goldens recorded on the base code before each switch

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/tests/__golden__ kg=427c89aa51a2 gen=3500c2703e34 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `way-back-closed-off.json` — smallest golden; checked by web-quiz-way-back.service.test.js, read the test for how it records
- Run: cd dashboard && ./run-tests.sh tests/web-quiz-class-link-edge --maxWorkers=2 (tests here are loaded by name, not run themselves)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `quiz-join-page-off.json` | Golden of join-screen cases with early-tap and wait-word switches off; the two quiz-join tests |
| `juice-off-inputs.js` | Fixed inputs for the web_quiz_juice golden: pages the edge draws with the switch off (juice-edge test) |
| `class-link-edge-off.json` | Golden of switch-OFF /j and /q class-link edge responses, loaded by web-quiz-class-link-edge.service.test.js |
| `class-pic-edge-off.json` | Golden of switch-OFF quiz and story page heads for the class-picture edge; web-quiz-class-pic-edge test |
| `juice-off-pages.json` | Golden of quiz, Urdu quiz and challenge pages with web_quiz_juice off; web-quiz-juice-edge test |
| `way-back-closed-off.json` | Golden of way-back markup per closed/hub, en/ur, plain/ur2 with the switch off; web-quiz-way-back test |

## Who reads this (generated)
- (none)

## Never (human)
- Do not hand-edit or re-record these from the changed code: the OFF response must stay byte-identical (dashboard/tests/web-quiz-way-back.service.test.js:13)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/tests/CLAUDE.md`?
