# patterns — Board-pattern definitions (FDE grades 1, 2, 5) as frozen data
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/assessment/patterns kg=8a7eebba3bb2 gen=6d9d095860cc overflow=213 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `index.js` — registry and derived views used by routes and generator
- `fde-g5-2027.js` — Grade 5 pattern: sections, slots, marks, scheme rules
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `board/` | (no description yet) → `board/CLAUDE.md` |
| `early/` | Grade 1-2 FDE subject patterns plus their shared chrome → `early/CLAUDE.md` |
| `mid/` | (no description yet) → `mid/CLAUDE.md` |
| `index.js` | Board-pattern registry: which patterns exist, who may use them, and derived views for routes and generator |
| `fde*` | 6 files; most used `fde-g5-2027.js`: FDE Grade V Feb 2027 centralised exam pattern as frozen data: sections, slots, marks, scheme rules |

## Who reads this (generated)
- `index.js` ← imported by `bot/shared/routes/internal-api.routes.js:1679:03aa6a49` · `bot/shared/services/assessment/assessment-browse.service.js:307:1b1f5879` (+6)
- `fde-g5-2027.js` ← imported by `bot/shared/services/assessment/patterns/early/chrome.js:13:ef4af3ac` · `bot/shared/services/assessment/patterns/index.js:10:c2aca214` (+1)
- `fde-g1-2026.js` ← imported by `bot/shared/services/assessment/patterns/index.js:11:9ab30672`
- `fde-g2-2026.js` ← imported by `bot/shared/services/assessment/patterns/index.js:12:0bd1792f`
- `fde-g3-2026.js` ← imported by `bot/shared/services/assessment/patterns/index.js:13:4f03ba6f`
- `fde-g4-2026.js` ← imported by `bot/shared/services/assessment/patterns/index.js:14:b5f5b0c7`
- `fde-g5-islamiat.js` ← imported by `bot/shared/services/assessment/patterns/fde-g5-2027.js:32:8024ee9d`

## Never (human)
- Patterns are deep-frozen data; read, never mutate (fde-g5-2027.js:1237-1245)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/assessment/fde-v31-prompt-rules.test.js` (fde-g3-2026.js, fde-g4-2026.js, index.js)
- `tests/assessment/fde-v32-prompt-rules.test.js` (fde-g3-2026.js, fde-g4-2026.js, index.js)
- `tests/assessment/fde-v38-prompt-rules.test.js` (fde-g3-2026.js, fde-g4-2026.js, index.js)
- … 213 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/assessment/CLAUDE.md`?
