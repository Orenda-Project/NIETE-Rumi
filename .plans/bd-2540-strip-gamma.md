# bd-2540 — Strip teacher-triggerable Gamma paths from NIETE-Rumi

**Branch**: `bd-2540-strip-gamma-teacher-paths` (off `origin/develop@d20201b`)
**Scope decision (operator, 2026-08-11)**: Option A partial strip. Close every teacher-triggerable path to Gamma. **Keep** `grounded-lp-render.service.js` + `content.service.js::generateLessonPlan` alive because they are the render engine for the 2,485-row `curriculum_lp_ast` catalog (96% currently unrendered — killing them = catalog dies).
**Nearest-alternative nudge**: dropped from scope (operator said "kill features", not "add nearest-match UX"). Follow-up bead if desired.
**Baseline (branch tip d20201b)**: 103/137 jest suites pass, 1100/1118 tests pass. 34 pre-existing failing suites saved to `.baseline-failing-tests-bd-2540.txt`. **Rule for this branch: do not add to that failing list.**

## Node / test invocation

```
export PATH="/Users/mashhoodr/.nvm/versions/node/v21.7.3/bin:$PATH"
cd bot && npx jest --testTimeout=30000
```

## Pregen data reality (verified 2026-08-11 against NIETE Supabase ihzciabopbttygxxgrkm)

- `pre_generated_lps`: 317 rows, 317 `completed` — the flat pregen cache, all rendered ✅
- `curriculum_lp_ast`: **2,485 rows**, all `is_enabled=true`
  - Missing `pdf_r2_key_en`: 2,400 (96.6%)
  - Missing `pdf_r2_key_ur`: 2,475 (99.6%)
  - Missing EITHER: 2,485 (100%)
  - Missing BOTH: 2,390
- Implication: `grounded-lp-render.service.js` (Gamma) is the *primary* render engine, not a fallback. **Do not delete it.** Follow-up bead needed later to replace with a deterministic HTML→PDF renderer.

## What to KEEP (load-bearing for grounded AST catalog)

- `bot/shared/services/content.service.js::generateLessonPlan` (+ its `_generateGammaContent` internal helper + `downloadPDF`)
- `bot/shared/services/grounded-lp-render.service.js`
- `bot/shared/services/lesson-plan-template.service.js`
- `bot/shared/config/gamma-languages.config.js`
- `bot/workers/lesson-plan-generation.worker.js` (the type=lesson_plan branch, NOT type=presentation)
- Env vars: `GAMMA_API_KEY`, `GAMMA_MAX_ATTEMPTS`, `GAMMA_POLL_INTERVAL`

## What to DELETE — ordered by phase (each phase = one commit ideally)

### Phase 1b — Pic-to-LP (hermetically sealed, 9 file changes)

- [ ] Delete `bot/shared/services/pic-to-lp/` (15 files: caption-prefill, classifier, completion-handler, flow-options, gamma-client, image-batch-coalescer, kieai-client, kieai-handoff, kieai-prompt-builder, lp-handoff, metadata-extractor, page-collector, pic-lp-latency, pic-lp-session, pic-lp-wait-message — all `.service.js` or `.js`)
- [ ] Delete `bot/shared/routes/pic-lp-endpoint.js`
- [ ] Edit `bot/shared/routes/flow-endpoint.routes.js` — remove line 41 (`require('./pic-lp-endpoint')`), the whole POST `/pic-lp` router block starting ~line 269, and the docstring block ~line 301
- [ ] Edit `bot/shared/handlers/flow-response.handler.js` line 82 — remove the `Pic-to-LP Confirm` entry from the Flow registry array
- [ ] Edit `bot/shared/handlers/image-message.handler.js`:
  - Remove pic-lp try/catch block (approx lines 285-320 inside `handleImageMessage`)
  - Delete `tryPicLpRoute` function (approx lines 599-708)
  - Delete `handleCoalescedBatch` function (approx lines 720-827)
  - Update `module.exports` at line 829 — expose only `handleImageMessage`
  - Update the routing docstring at top of file — remove step 3 (`Pic-to-LP`)
- [ ] Edit `bot/whatsapp-bot.js` — delete the button routing block for `pic_lp_start_` / `pic_explain_` / `pic_other_` (approx lines 990-1030)
- [ ] Delete `docs/flows/pic-lp-confirm-flow.json`
- [ ] Delete `bot/tests/pic-to-lp/*.test.js` (the whole dir if it exists)
- [ ] Edit `bot/tests/observe/bd-2453-gender-neutral-urdu.test.js:47` — remove `'services/pic-to-lp/page-collector.service.js'` from the SRC list
- [ ] Env: remove `PIC_LP_FLOW_ID`, `PIC_LP_FORCE_GAMMA`, `PIC_LP_FORCE_KIEAI` from `bot/shared/utils/constants.js`, `bot/shared/config/feature-availability.js`, and `.env.example`
- [ ] DB cleanup (post-deploy): delete `app_settings.pic_lp_backend_ab` row
- [ ] Meta cleanup (post-deploy, ops task): unpublish the Pic-to-LP Confirm Flow in Meta WhatsApp Manager (endpoint returns 404 once deployed)
- [ ] Verify: `npx jest tests/handlers/ tests/services/ tests/observe/bd-2453-gender-neutral-urdu.test.js` — all suites at baseline or better

### Phase 1c — Vocabulary-image (reading assessment)

- [ ] Edit `bot/shared/services/reading/comprehension.service.js:603` — always take the `createTextFallbackQuestion` fallback (line 626); remove the try that calls `VocabularyImageService.generateVocabularyGrid`
- [ ] Delete `bot/shared/services/reading/vocabulary-image.service.js`
- [ ] Verify: `npx jest tests/services/reading/`

### Phase 1d — Quiz revision-LP (bd-1270 feature killed)

- [ ] Edit `bot/shared/services/quiz/quiz-follow-up.service.js:199-208` — delete the LP-enqueue branch (`source: 'gamma_standard'`)
- [ ] Grep for any handler that expects the revision-LP option and remove it
- [ ] Verify: `npx jest` for anything mentioning quiz-follow-up

### Phase 1e — content.service.js surgery (KEEP generateLessonPlan; delete generatePresentation)

- [ ] Edit `bot/shared/services/content.service.js` — delete `generatePresentation` method (approx lines 178-197). KEEP `_generateGammaContent` (called by generateLessonPlan) and `downloadPDF`.
- [ ] Edit `bot/workers/lesson-plan-generation.worker.js:135` — remove the `if (type==='presentation')` branch that calls `ContentService.generatePresentation`
- [ ] Grep for any other caller of `generatePresentation` — should be zero after worker edit
- [ ] Verify: `npx jest tests/unit/lesson-plan-worker.test.js`

### Phase 1f — Handler cleanup

- [ ] Edit `bot/shared/handlers/text-message.handler.js` — remove any `/pres` command handler or freeform-presentation branch that no longer works
- [ ] Edit `bot/shared/handlers/voice-message.handler.js` — same treatment
- [ ] Edit `bot/shared/handlers/lesson-plan-v2.handler.js` — the `page_prompt` return branch (lines 144, 208, 233, 236, 241) currently signals "fall through to Gamma freeform". Replace with a reply to the teacher: "we don't have that chapter yet — try [available list]" (see UX-strings pattern). **Confirm exact copy with operator before shipping.**
- [ ] Verify: `npx jest tests/handlers/`

### Phase 1g — Dashboard cleanup

- [ ] Delete `dashboard/services/api-health/gamma.service.js`
- [ ] Edit `dashboard/services/api-health/api-health-aggregator.service.js` — remove all references to `getGammaHealth` / `gamma` (lines 8, 26, 48, 109)
- [ ] Edit `dashboard/routes/api-health.routes.js` — remove `gamma` from the route pattern; drop the `require.cache` entry for the gamma service
- [ ] Edit `dashboard/routes/portal.routes.js` — the `gamma_url` column reads (lines 816, 835, 1014, 1036) return `null` for new pregen rows. Change the response mapping to `pdf_url || gamma_url` so historical rows still render and new rows also render.
- [ ] Verify: dashboard smoke test if one exists

### Phase 1h — Dead-import cleanup

- [ ] Edit `bot/shared/services/coaching/report-generator.service.js:23` — delete the unused `const ContentService = require('../content.service')` line
- [ ] Edit `bot/shared/config/feature-availability.js` — remove pic-lp / vocab-image / freeform-LP toggles
- [ ] Edit `bot/scripts/setup/doctor.js` — remove any pic-lp / Gamma-non-grounded checks (keep GAMMA_API_KEY check since grounded still needs it)

### Phase 1i — Baseline diff + PR

- [ ] Run full suite: `npx jest --testTimeout=30000 --json --outputFile=/tmp/nietre-after.json >/dev/null 2>&1`
- [ ] Diff against `.baseline-failing-tests-bd-2540.txt` — verify no new failing suites
- [ ] `git add -A && git commit` per-phase commits (or squash on PR)
- [ ] `git push -u origin bd-2540-strip-gamma-teacher-paths`
- [ ] Open PR against `develop` — title: `bd-2540: strip teacher-triggerable Gamma paths (Option A)`
- [ ] PR body: link this plan doc, note that grounded-render is intentionally kept, note follow-up bead for HTML→PDF replacement

## Follow-up beads to open on completion

- **bd-2541** (planned): Replace grounded-lp-render Gamma call with deterministic HTML→PDF renderer (Puppeteer / react-pdf). Consumes `curriculum_lp_ast` structured JSON directly. Frees NIETE-Rumi from Gamma entirely.
- **bd-2542** (planned): Meta cleanup — unpublish Pic-to-LP Confirm Flow from WhatsApp Manager, delete `app_settings.pic_lp_backend_ab` row.

## Ops runbook after deploy

- Once bd-2540 is deployed: any teacher who tries to send a textbook photo will get generic vision analysis (not pic-to-LP). Any teacher who requests a chapter not in the AST catalog will get a "we don't have that yet" reply instead of a slow Gamma-freeform render.
- Watch Axiom for the `pic_lp.*` event pattern going to zero and the `page_prompt` reply pattern for a spike.
