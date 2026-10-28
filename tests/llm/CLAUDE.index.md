# llm — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/llm -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `anthropic-facade-translation.test.js` | bd-gr4fy.2: pins anthropic-native-facade request translation for lesson-plan author, quiz key-check and token limits |
| `chat-intent-label-cutoff.test.js` | bd-gr4fy.5.15: pins chat.intent on Haiku treating a cut-off reply with a complete label as the answer (openai.service) |
| `chat-respond-whatsapp-shape.test.js` | bd-gr4fy.5.10: pins chat.respond text replies stripped of markdown for WhatsApp while voice replies stay untouched |
| `cost-user-attribution.test.js` | bd-b0qwk: pins api.cost.incurred events carrying the user id (webhook, queued worker job context) |
| `cost-user-coaching-session.test.js` | bd-b0qwk.3: pins coaching jobs without a user resolving the teacher via the session row, with 2s timeout fallback |
| `direct-lane-system-note-position.test.js` | bd-gr4fy.5.11: pins mid-conversation REPLY LANGUAGE system note keeping its place through the Anthropic facade |
| `facade-dated-model-price.test.js` | bd-gr4fy.10: pins a dated Haiku snapshot id priced like the undated model in the native facade |
| `haiku-5-5-direct-lane.test.js` | bd-upejat.45: pins Haiku 5.5 pricing tiers (100k-token break), effort setting and thinking limits on the direct lane |
| `job-model-override.test.js` | bd-gr4fy.1: pins the per-job model override in llm-client/model-settings, with its kill switch and bad-id handling |
| `job-override-hardening.test.js` | bd-gr4fy.6: pins fixes from the override audits: fallback to current model for vision/assessment, always a model behind |
| `job-override-round2.test.js` | bd-gr4fy.7: pins four more override fixes (Urdu paper fallback, settings-at-site, unrelated per-language rows) |
| `models-cli.test.js` | bd-gr4fy.16: pins the `npm run models` CLI: list jobs, apply a job->model map, kill switch, from model-registry |
| `observe-debrief-split.test.js` | bd-gr4fy.15: pins observe-debrief guide/card calls labelled coaching.observeDebrief, separate from completeJson |
| `observe2-moments-job.test.js` | bd-08qvls.1: pins /observe2 moments and label check as their own job observe2.moments, movable by app_settings |
| `override-config-process.test.js` | bd-gr4fy.9: pins the override config event naming its process (Railway service/replica, else host and pid) |
| `router-ladder.test.js` | bd-gr4fy.13: pins the reflective router retry ladder under a per-job override (override tried once, then fallback) |
| `router-split.test.js` | bd-gr4fy.12: pins reflective corpus and reflective question as separate jobs in llm-router.service |
| `settings-at-site-guard.test.js` | bd-gr4fy.6: guard that every call site reading settings itself is flagged settingsAtSite in model-registry |
| `settings-fresh-read-at-site.test.js` | bd-gr4fy.5.8: pins vision and assessment call sites reading stale settings once before planning their model |
| `settings-fresh-read.test.js` | bd-gr4fy.14: pins a call finding stale model-settings reading them once (bounded) before the job is planned |
| `settings-max-age.test.js` | bd-gr4fy.11: pins a model-settings answer older than two refresh periods moving nothing (kill switch stays exact) |
| `single-source-e2e.test.js` | bd-gr4fy.8: end to end through real call sites: registry model by default, settings row moves each job, kill switch |
| `single-source-guard.test.js` | bd-gr4fy.8: guard that in-scope Anthropic-swap models live only in model-registry and every job there is routed |
| `sonnet-5-5-price.test.js` | Pins list price for claude-sonnet-5-5 in the native facade (cache read/write) so replies are not cost_unpriced |
| `spend-limit-falls-back.test.js` | bd-gk7nrj: pins an Anthropic Console spend-limit 400 as credit-class and falling back to OpenRouter |
| `vision-caller-repairs.test.js` | bd-gr4fy.5.7: pins moved vision.analyse answers accepted when the photo-analysis caller repairs them; cut-off falls back |

## Who reads this (all, generated)
- env `ASSESSMENT_GEN_MODEL` read at `tests/llm/single-source-guard.test.js:179:6a60a14f`
- env `LLM_MODEL` read at `tests/llm/single-source-guard.test.js:140:68d646a8`
- env `LP612_EDIT_INTENT_MODEL` read at `tests/llm/single-source-guard.test.js:138:b28578bf`
- env `LP_AUTHOR_MODEL` read at `tests/llm/single-source-guard.test.js:177:9ea07cad`
- env `LP_EXTRACTION_VISION_MODEL` read at `tests/llm/single-source-guard.test.js:169:9b1aa4d6`
- env `LP_FIDELITY_MODEL` read at `tests/llm/single-source-guard.test.js:167:e0d3306c`
- env `ROSTER_VISION_MODEL` read at `tests/llm/single-source-guard.test.js:170:1d162776`
- env `TRANSCRIPT_QUIZ_MODEL` read at `tests/llm/single-source-guard.test.js:171:7a4d6e5e`
- env `TRANSCRIPT_QUIZ_VERIFY_MODEL` read at `tests/llm/single-source-guard.test.js:172:179593f5`
- env `VISION_MODEL` read at `tests/llm/single-source-guard.test.js:178:ab8dd0e0`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.index.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.md`? · `bot/shared/services/observe/observe2/CLAUDE.index.md`? · `bot/shared/services/queue/CLAUDE.index.md`? · `bot/shared/services/queue/CLAUDE.md`? · `bot/shared/services/remark/CLAUDE.index.md`? · `bot/shared/services/remark/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `docs/CLAUDE.index.md`? · `docs/model-switching.md`? · `scripts/llm/CLAUDE.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/llm/CLAUDE.index.md`? · `tests/llm/CLAUDE.md`?
