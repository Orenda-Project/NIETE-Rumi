# goldens — Pinned WhatsApp/DB call recordings for the free-form seam, one JSON per row
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/fflp/goldens kg=db627e5a3096 gen=544cf16c1caf overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `N1-MISS-on.golden.json` — the one intended change: a free-form request row inserted when ON
- `N1-HIT-en.golden.json` — a catalogue HIT: identical with the switch off or on
- Data only, no tests here; loaded by ../seam-goldens.test.js (root jest, `node tests/run.js tests/fflp`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `N-NIETE-bare-lesson-plan.golden.json` | Golden: bare 'lesson plan' text sends the lesson-plans Flow only; loaded by seam-goldens.test.js |
| `N-NIETE-bare-lp.golden.json` | Golden: bare 'lp' text sends the lesson-plans Flow only; loaded by seam-goldens.test.js |
| `N-NIETE-intent-hit.golden.json` | Golden: lesson-plan intent on a catalogue topic logs the message and sends the Flow; seam-goldens.test.js |
| `N-NIETE-intent-miss-off.golden.json` | Golden: catalogue-miss topic with the switch off logs the message and sends the Flow; seam-goldens.test.js |
| `N-NIETE-menu-fallback.golden.json` | Golden: topic typed after the menu's Lesson Planning clears state and sends the Flow; seam-goldens.test.js |
| `N-NIETE-oxbridge-tap.golden.json` | Golden: the picker's Generate LP tap sends the lesson-plans Flow unchanged; seam-goldens.test.js |
| `N-NIETE-redirect-bare.golden.json` | Golden: bare 'lesson plan' under the portal-redirect setting sends a signed CTA-URL button; seam-goldens.test.js |
| `N-NIETE-redirect-intent-hit.golden.json` | Golden: catalogue-topic ask under portal redirect sends the CTA-URL button to the portal; seam-goldens.test.js |
| `N1*` | 7 files; most used `N1-MISS-on.golden.json`: Golden: catalogue MISS with switch ON inserts a free-form gamma_standard lesson_plan_requests row; seam-goldens.test.js |
| `CLAUDE.index.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
- Only N1-MISS-on may differ between switch off and on; a HIT is never changed (tests/fflp/seam-goldens.test.js:14)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/fflp/CLAUDE.md`? · `tests/fflp/goldens/CLAUDE.index.md`? · `tests/fflp/goldens/CLAUDE.md`?
