# sprint-1 — Early open-source prep tests: branding, CLI simulator, LLM factory, feature gating

<!-- kg:meta repo=NIETE-Rumi dir=tests/unit/sprint-1 kg=7b5243acbe29 gen=22cad47b3c3b overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `feature-availability.test.js` — presence-based gating; CHANGEME counts as unset
- `taleemabad-strip.test.js` — no Taleemabad content left in bot source (bd-233)
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/unit/sprint-1 --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `feature-availability.test.js` | Pins presence-based feature-availability: required vars, CHANGEME counts as unset, missingRequired |
| `CLAUDE.md` | (unmapped) |
| `branding.test.js` | bd-228: contract for config/branding.js exports (bot name, org name, languages, support contact) with env overrides |
| `cli-simulator.test.js` | bd-235: contract for the CLI simulator (createSimulator, simulateMessage) for local testing without WhatsApp |
| `openrouter-llm.test.js` | bd-273: contract for the LLM client factory routing through OpenRouter by default with an OpenAI fallback |
| `taleemabad-strip.test.js` | bd-233: guards that no Taleemabad-specific content remains in bot source outside allowed LICENSE, docs and config |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `tests/unit/CLAUDE.md`? · `tests/unit/sprint-1/CLAUDE.md`?
