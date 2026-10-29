# patterns — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/assessment/patterns -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `early/` | Grade 1-2 FDE subject patterns plus their shared chrome → `early/CLAUDE.md` |
| `fde-g1-2026.js` | FDE Grade 1 2026-27 annual pattern; assembles the early/g1-* subject files |
| `fde-g2-2026.js` | FDE Grade 2 2026-27 annual pattern; assembles the early/g2-* subject files |
| `fde-g5-2027.js` | FDE Grade V Feb 2027 centralised exam pattern as frozen data: sections, slots, marks, scheme rules |
| `index.js` | Board-pattern registry: which patterns exist, who may use them, and derived views for routes and generator |

## Who reads this (all, generated)
- `fde-g1-2026.js` ← imported by `bot/shared/services/assessment/patterns/index.js:11:9ab30672`
- `fde-g2-2026.js` ← imported by `bot/shared/services/assessment/patterns/index.js:12:0bd1792f`
- `fde-g5-2027.js` ← imported by `bot/shared/services/assessment/patterns/early/chrome.js:13:ef4af3ac` · `bot/shared/services/assessment/patterns/index.js:10:c2aca214`
- `index.js` ← imported by `bot/shared/routes/internal-api.routes.js:1511:03aa6a49` · `bot/shared/services/assessment/assessment-browse.service.js:294:1b1f5879` · `bot/shared/services/assessment/assessment-generation.service.js:749:1b1f5879` · `bot/shared/services/assessment/assessment-orchestrator.service.js:59:1b1f5879` (+3: `python3 kg/kg.py who-reads index.js`)

## Tests (all, generated)
- `fde-g1-2026.js` ← `tests/assessment/topics/topic-oral.test.js`
- `fde-g2-2026.js` ← `tests/assessment/topics/topic-oral.test.js`
- `fde-g5-2027.js` ← `tests/assessment/fde-pattern-module.test.js`
- `index.js` ← `tests/assessment/assessment-paper-fde.renderer.test.js` · `tests/assessment/composition-criteria.test.js` · `tests/assessment/fde-answer-repeats.test.js` · `tests/assessment/fde-blueprint-check.test.js` · `tests/assessment/fde-blueprint-wiring.test.js` · `tests/assessment/fde-chain.test.js` (+136: `python3 kg/kg.py who-reads bot/shared/services/assessment/patterns/index.js`)

## Related (all, generated)
- docs: `bot/shared/services/assessment/CLAUDE.md`?
