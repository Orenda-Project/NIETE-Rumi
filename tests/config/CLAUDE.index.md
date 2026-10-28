# config — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/config -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `branding-defaults.test.js` | bd-2381: env-driven branding defaults (botName, orgName, etc.) resolve to NIETE, never Rumi |
| `job-label-arms-nothing.test.js` | bd-jntcx: a telemetry-only job label reaches the cost record but never the vendor request or the fallback path |
| `job-label-reaches-no-vendor.test.js` | bd-3kv02: a job label must never reach a model vendor; no labelled call site builds its own raw OpenAI client |
| `job-labels-coverage.test.js` | bd-jntcx: every model call in the coaching cluster carries a job name that exists in model-registry |
| `language-canon.test.js` | language-canon normalises language codes at storage boundaries without clamping to the offered languages |
| `language-registry.test.js` | languages.js registry: exactly Urdu then English, one list, no region dependency, Meta template code mapping |
| `logger-severity.test.js` | logToFile level routing (info to console.log, error to console.error) and the logError/logWarn wrappers |
| `output-language-check.test.js` | verifyOutputLanguage: flags model output that came back in the wrong language, tolerates English technical terms |
| `raw-sdk-spend-recorded.test.js` | bd-wgso2: withSpendRecording makes raw new OpenAI() services record cost (api.cost.incurred) without changing the call |
| `ux-strings-paragraph-direction.test.js` | ux-strings catalog paragraphs keep their language's text direction even when a placeholder opens them |
| `ux-strings-whatsapp-limits.test.js` | Every picker string in the ux-strings catalog fits its WhatsApp field cap (code points) in en and ur |
| `ux-strings.test.js` | ux-strings catalog and the single clampLanguage that replaced 23 inline copies; off-market falls to English |

## Who reads this (all, generated)
- env `DEFAULT_REGION` read at `tests/config/language-registry.test.js:72:5faf6df6`
- env `REGION` read at `tests/config/language-registry.test.js:72:5faf6df6`

## Tests (all, generated)
- (none)

## Related (all, generated)
- skills: `pre-merge-checklist`?
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/coaching/fidelity/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `docs/CLAUDE.index.md`? · `docs/model-switching.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/config/CLAUDE.index.md`? · `tests/config/CLAUDE.md`?
