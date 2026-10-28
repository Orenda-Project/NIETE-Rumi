# settings — Tests the settings Flow endpoint and its language writer

<!-- kg:meta repo=NIETE-Rumi dir=tests/settings kg=9e91ad92a73f gen=915b0fa0e6ab overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `settings-language-writer.test.js` — language changes via the one locked writer
- `settings-flow.test.js` — region-config defaults and the settings endpoint
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/settings --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `settings-flow.test.js` | Pins region-config framework defaults, the settings language dropdown from the registry, and settings-endpoint handlers |
| `settings-language-writer.test.js` | Pins that the settings endpoint changes language only via the one locked writer, never a direct preferred_language write |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
- Language change goes through the ONE writer, never a direct preferred_language write (settings-language-writer.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/settings/CLAUDE.md`?
