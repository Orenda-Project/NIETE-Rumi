# patterns — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/assessment/patterns -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `board/` | (no description yet) → `board/CLAUDE.md` |
| `early/` | Grade 1-2 FDE subject patterns plus their shared chrome → `early/CLAUDE.md` |
| `mid/` | (no description yet) → `mid/CLAUDE.md` |
| `fde-g1-2026.js` | FDE Grade 1 2026-27 annual pattern; assembles the early/g1-* subject files |
| `fde-g2-2026.js` | FDE Grade 2 2026-27 annual pattern; assembles the early/g2-* subject files |
| `fde-g3-2026.js` | (unmapped) |
| `fde-g4-2026.js` | (unmapped) |
| `fde-g5-2027.js` | FDE Grade V Feb 2027 centralised exam pattern as frozen data: sections, slots, marks, scheme rules |
| `fde-g5-islamiat.js` | (unmapped) |
| `index.js` | Board-pattern registry: which patterns exist, who may use them, and derived views for routes and generator |

## Who reads this (all, generated)
- `fde-g1-2026.js` ← imported by `bot/shared/services/assessment/patterns/index.js:11:9ab30672`
- `fde-g2-2026.js` ← imported by `bot/shared/services/assessment/patterns/index.js:12:0bd1792f`
- `fde-g3-2026.js` ← imported by `bot/shared/services/assessment/patterns/index.js:13:4f03ba6f`
- `fde-g4-2026.js` ← imported by `bot/shared/services/assessment/patterns/index.js:14:b5f5b0c7`
- `fde-g5-2027.js` ← imported by `bot/shared/services/assessment/patterns/early/chrome.js:13:ef4af3ac` · `bot/shared/services/assessment/patterns/index.js:10:c2aca214` · `bot/shared/services/assessment/patterns/mid/chrome.js:12:ef4af3ac`
- `fde-g5-islamiat.js` ← imported by `bot/shared/services/assessment/patterns/fde-g5-2027.js:32:8024ee9d`
- `index.js` ← imported by `bot/shared/routes/internal-api.routes.js:1679:03aa6a49` · `bot/shared/services/assessment/assessment-browse.service.js:307:1b1f5879` · `bot/shared/services/assessment/assessment-generation.service.js:761:1b1f5879` · `bot/shared/services/assessment/assessment-orchestrator.service.js:59:1b1f5879` (+4: `python3 kg/kg.py who-reads index.js`)

## Tests (all, generated)
- `fde-g1-2026.js` ← `tests/assessment/topics/topic-oral.test.js`
- `fde-g2-2026.js` ← `tests/assessment/topics/topic-oral.test.js`
- `fde-g3-2026.js` ← `tests/assessment/fde-mid-g3-layout.test.js` · `tests/assessment/fde-mid-g3-pattern.test.js` · `tests/assessment/fde-v31-prompt-rules.test.js` · `tests/assessment/fde-v31-work-box.test.js` · `tests/assessment/fde-v32-prompt-rules.test.js` · `tests/assessment/fde-v38-prompt-rules.test.js`
- `fde-g4-2026.js` ← `tests/assessment/fde-mid-g4-layout.test.js` · `tests/assessment/fde-mid-g4-pattern.test.js` · `tests/assessment/fde-v31-key-echo.test.js` · `tests/assessment/fde-v31-prompt-rules.test.js` · `tests/assessment/fde-v31-work-box.test.js` · `tests/assessment/fde-v32-prompt-rules.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/assessment/patterns/fde-g4-2026.js`)
- `fde-g5-2027.js` ← `tests/assessment/fde-pattern-module.test.js` · `tests/assessment/fde-v29-g5-keys.test.js` · `tests/assessment/fde-v33-mid-legend.test.js` · `tests/assessment/fde-v37-english-r2.test.js` · `tests/assessment/fde-v37-english-r3.test.js`
- `fde-g5-islamiat.js` ← `tests/assessment/fde-g5-islamiat.test.js`?
- `index.js` ← `tests/assessment/assessment-paper-fde.renderer.test.js` · `tests/assessment/board-pattern-g5-only.test.js` · `tests/assessment/board-wiring/board-index.test.js` · `tests/assessment/composition-criteria.test.js` · `tests/assessment/fde-answer-repeats.test.js` · `tests/assessment/fde-blueprint-check.test.js` (+200: `python3 kg/kg.py who-reads bot/shared/services/assessment/patterns/index.js`)

## Related (all, generated)
- docs: `bot/shared/services/assessment/CLAUDE.md`?
