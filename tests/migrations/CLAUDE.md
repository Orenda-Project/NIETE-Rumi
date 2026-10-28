# migrations — Tests a data migration that changes teachers' stored language

<!-- kg:meta repo=NIETE-Rumi dir=tests/migrations kg=346e4d1100f5 gen=c58df0bf3df9 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `language-floor-flip.test.js` — en to ur only where language_locked is false
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/migrations --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `language-floor-flip.test.js` | Pins the language-floor-flip migration: en->ur only for teachers who never chose (language_locked predicate) |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
- The flip predicate must key on language_locked: it separates a chosen from a defaulted language (language-floor-flip.test.js:6)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `scripts/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/migrations/CLAUDE.md`?
