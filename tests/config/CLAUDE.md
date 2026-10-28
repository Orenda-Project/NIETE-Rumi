# config — Config contracts: branding defaults, language registry, string catalog, job labels
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/config kg=67563da8cdbe gen=51807e5b01a8 overflow=1 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `ux-strings-whatsapp-limits.test.js` — every catalog string fits its WhatsApp field cap
- `language-registry.test.js` — one list, Urdu and English only
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/config --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `job*` | 3 files; most used `job-labels-coverage.test.js`: bd-jntcx: every model call in the coaching cluster carries a job name that exists in model-registry |
| `branding-defaults.test.js` | bd-2381: env-driven branding defaults (botName, orgName, etc.) resolve to NIETE, never Rumi |
| `ux*` | 3 files; most used `ux-strings-whatsapp-limits.test.js`: Every picker string in the ux-strings catalog fits its WhatsApp field cap (code points) in en and ur |
| `language-canon.test.js` | language-canon normalises language codes at storage boundaries without clamping to the offered languages |
| `output-language-check.test.js` | verifyOutputLanguage: flags model output that came back in the wrong language, tolerates English technical terms |
| `language-registry.test.js` | languages.js registry: exactly Urdu then English, one list, no region dependency, Meta template code mapping |
| `raw-sdk-spend-recorded.test.js` | bd-wgso2: withSpendRecording makes raw new OpenAI() services record cost (api.cost.incurred) without changing the call |
| … | 1 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `DEFAULT_REGION` · `REGION`

## Never (human)
- Field caps are counted in code points, not .length (tests/config/ux-strings-whatsapp-limits.test.js:20)
- A job label never reaches a model vendor (bd-3kv02, tests/config/job-label-reaches-no-vendor.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- skills: `pre-merge-checklist`?
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/coaching/fidelity/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `docs/CLAUDE.index.md`? · `docs/model-switching.md`? (+4)
