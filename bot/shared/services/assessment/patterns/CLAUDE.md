# patterns — Board-pattern definitions (FDE grades 1, 2, 5) as frozen data
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/assessment/patterns kg=bbc20fdd7e48 gen=c35fc3bf6cc7 overflow=131 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `index.js` — registry and derived views used by routes and generator
- `fde-g5-2027.js` — Grade 5 pattern: sections, slots, marks, scheme rules
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `early/` | Grade 1-2 FDE subject patterns plus their shared chrome → `early/CLAUDE.md` |
| `index.js` | Board-pattern registry: which patterns exist, who may use them, and derived views for routes and generator |
| `fde*` | 3 files; most used `fde-g5-2027.js`: FDE Grade V Feb 2027 centralised exam pattern as frozen data: sections, slots, marks, scheme rules |

## Who reads this (generated)
- `index.js` ← imported by `bot/shared/routes/internal-api.routes.js:1503:03aa6a49` · `bot/shared/services/assessment/assessment-browse.service.js:294:1b1f5879` (+5)
- `fde-g5-2027.js` ← imported by `bot/shared/services/assessment/patterns/early/chrome.js:13:ef4af3ac` · `bot/shared/services/assessment/patterns/index.js:10:c2aca214`
- `fde-g1-2026.js` ← imported by `bot/shared/services/assessment/patterns/index.js:11:9ab30672`
- `fde-g2-2026.js` ← imported by `bot/shared/services/assessment/patterns/index.js:12:0bd1792f`

## Never (human)
- Patterns are deep-frozen data; read, never mutate (fde-g5-2027.js:1237-1245)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/assessment/fde-pattern-module.test.js` (fde-g5-2027.js, index.js)
- `tests/assessment/topics/topic-oral.test.js` (fde-g1-2026.js, fde-g2-2026.js)
- `tests/assessment/assessment-paper-fde.renderer.test.js` (index.js)
- `tests/assessment/composition-criteria.test.js` (index.js)
- `tests/assessment/fde-answer-repeats.test.js` (index.js)
- `tests/assessment/fde-blueprint-check.test.js` (index.js)
- `tests/assessment/fde-blueprint-wiring.test.js` (index.js)
- `tests/assessment/fde-chain.test.js` (index.js)
- `tests/assessment/fde-create.test.js` (index.js)
- `tests/assessment/fde-early-answers.test.js` (index.js)
- `tests/assessment/fde-early-asked.test.js` (index.js)
- `tests/assessment/fde-early-pictures-pattern.test.js` (index.js)
- … 131 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/assessment/CLAUDE.md`?
