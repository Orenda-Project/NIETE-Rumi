# Customizing Rumi — the seam map

Rumi is built to be **re-shaped**, not just deployed. Every feature's design and pedagogical
framework lives behind a discoverable, isolated **seam** — a single place you change it, with a
conformance test that fails if a change half-applies. This page is the map: for each thing you
might want to change, it tells you **where** the seam is, **what kind** of change it is, and the
**test** that guards it.

> **For AI agents:** start here, then open the cited file. The [`customizing` skill](../.claude/skills/customizing/SKILL.md)
> explains the foothold pattern. Don't hunt — if something you want to change isn't on this map,
> that's a gap worth reporting, not a cue to edit a random service. For step-by-step recipes see
> [agent-customization.md](agent-customization.md).

## How to read this

- **Type** tells you the depth: `env` (just set a variable) · `config` (edit one data file) ·
  `module` (edit/author a small module behind a registry) · `template` (edit HTML/prompt text) ·
  `schema` (a DB migration — the deepest).
- **Conformance test** is the guard you run (`node tests/run.js`) after changing the seam.

---

## Coaching

### Which observation framework is used (OECD / HOTS / TEACH / FICO)
- **Type:** `env` (default) + `module` (to add a new one)
- **Seam:** `DEFAULT_OBSERVATION_FRAMEWORK` (and optional `REGION_FRAMEWORK_MAP`) in `.env`, resolved by
  [`bot/shared/config/region-config.js`](../bot/shared/config/region-config.js) and
  [`bot/shared/services/coaching/frameworks/framework-selector.js`](../bot/shared/services/coaching/frameworks/framework-selector.js).
  The selected framework is honoured by `analyzePedagogy` in
  [`bot/shared/services/gpt5-mini.service.js`](../bot/shared/services/gpt5-mini.service.js) — it drives the
  prompt + scoring (OECD keeps the canonical inline path; other frameworks route through their module).
- **To add a framework:** add a module under
  [`bot/shared/services/coaching/frameworks/`](../bot/shared/services/coaching/frameworks/) exporting
  `getSystemPrompt / buildAnalysisPrompt / computeScores / getScoringConstants`, then register it in
  [`framework-registry.js`](../bot/shared/services/coaching/frameworks/framework-registry.js).
- **Conformance test:** `tests/coaching/analyze-pedagogy-framework-dispatch.test.js`,
  `tests/coaching/framework-wiring.test.js`

### The coaching report design (layout / visual)
- **Type:** `module` + `template`
- **Seam:** a renderer registry —
  [`bot/shared/services/coaching/report-renderers/renderer-registry.js`](../bot/shared/services/coaching/report-renderers/renderer-registry.js).
  `getReportRenderer(framework)` picks the renderer; **all five frameworks** (OECD/HOTS/TEACH/FICO/MEWAKA)
  use the unified celebration ("hero") renderer that produces an inline PNG + caption. The legacy
  PDFKit renderer in [`bot/shared/services/pdf-report.service.js`](../bot/shared/services/pdf-report.service.js)
  is kept as the fallback for unknown frameworks and as the safety net the hero renderer falls back to
  if its pipeline throws. Add a framework's report design by registering one renderer + adding a score
  adapter — no `if (framework === …)` to edit.
- **Conformance test:** `tests/coaching/report-renderer-registry.test.js`, `tests/coaching/hero-render-fallback.test.js`

### The hero report visual (colors, layout, fonts)
- **Type:** `template`
- **Seam:** [`bot/shared/services/coaching/report-v2/hero-report.template.js`](../bot/shared/services/coaching/report-v2/hero-report.template.js)
  — the Playwright HTML template that renders to PNG. Variable-height single-page A4 design;
  language-aware fonts (Lexend for LTR, Nastaliq for Urdu, Naskh for Arabic). Fonts + Rumi mark
  are base64-embedded so the renderer is offline-safe.
- **Conformance test:** rendered via `tests/coaching/hero-render-fallback.test.js`

### Adding a new framework's score adapter for the hero report
- **Type:** `module`
- **Seam:** [`bot/shared/services/coaching/report-v2/score-adapters/`](../bot/shared/services/coaching/report-v2/score-adapters/)
  + [`dispatch.js`](../bot/shared/services/coaching/report-v2/score-adapters/dispatch.js).
  Each per-framework adapter turns `analysis_data` into `{ key, name, score, max, pct }[]` rows
  for the hero template's scorecard. Add a new adapter file then register it in `dispatch.js`.
- **Conformance test:** `tests/coaching/score-adapters.test.js`

### The celebration narrative LLM prompt (per-language)
- **Type:** `template` (prompt)
- **Seam:** [`bot/shared/services/coaching/report-v2/narrative.service.js`](../bot/shared/services/coaching/report-v2/narrative.service.js)
  — the `langRules()` function (per-language gender + code-switch rules) + `buildPrompt()` (the
  celebration prompt body that feeds the hero report's narrative section). Reads from
  `analysis.reflective_corpus` (lesson throughline + significant moments) when available.
- **Conformance test:** `tests/coaching/hero-narrative-corpus.test.js`

### The reflective debrief conversation
- **Type:** `module` + `config`
- **Seam:** five files under
  [`bot/shared/services/coaching/reflective-questions/`](../bot/shared/services/coaching/reflective-questions/)
  drive the v12 reflective chain (corpus + per-turn adaptive Q1/Q2/Q3):
  [`corpus-prompt.js`](../bot/shared/services/coaching/reflective-questions/corpus-prompt.js) — the
  one-shot corpus extraction prompt;
  [`question-prompt.js`](../bot/shared/services/coaching/reflective-questions/question-prompt.js) —
  per-question system prompts with Q1/Q2/Q3 beats;
  [`guardrails.js`](../bot/shared/services/coaching/reflective-questions/guardrails.js) —
  validation + per-language safe fallbacks;
  [`language-profiles.js`](../bot/shared/services/coaching/reflective-questions/language-profiles.js) —
  per-language data (script, region, gender rules);
  [`llm-router.service.js`](../bot/shared/services/coaching/reflective-questions/llm-router.service.js) —
  DeepSeek V3.2 → GPT-5.4 failover.
  Number of questions is configurable in
  [`bot/shared/config/coaching-debrief.config.js`](../bot/shared/config/coaching-debrief.config.js).
- **Conformance test:** `tests/coaching/reflective-corpus-extraction.test.js`,
  `tests/coaching/reflective-v12-question-chain.test.js`,
  `tests/coaching/reflective-conversation-v12-wiring.test.js`

### The commitment card content (Q3 → action prompt + per-language rules)
- **Type:** `template` (prompt) + `config`
- **Seam:** [`bot/shared/services/coaching/coaching-card/commitment-card.service.js`](../bot/shared/services/coaching/coaching-card/commitment-card.service.js)
  — the `buildPrompt()` LLM prompt that turns the teacher's Q3 forward-commitment + the highest-leverage
  growth area into a single lesson-rooted action. `GENDER_RULE` and `CODESWITCH_RULE` (per-language
  Urdu/Kiswahili/Arabic/English) live in the same file as named exports; safe to edit
  in-place. Falls back to the rule-based focus tip in
  [`prioritized-action.service.js`](../bot/shared/services/coaching/coaching-card/prioritized-action.service.js)
  when Q3 is missing or the LLM fails.
- **Conformance test:** `tests/coaching/commitment-card-content.test.js`,
  `tests/coaching/commitment-card-fallback.test.js`

### The commitment card visual (band colors, RTL/LTR fonts, highlight style)
- **Type:** `template`
- **Seam:** [`bot/shared/services/coaching/coaching-card/card-template.js`](../bot/shared/services/coaching/coaching-card/card-template.js)
  — the Playwright HTML template + `LABELS` (per-language eyebrow / try-label / footer strings)
  + the colour-only RTL highlight rule. Rumi marks + fonts are base64-embedded so the renderer
  is offline-safe.
- **Conformance test:** `tests/coaching/render-commitment-card-image.test.js`

---

## Lesson plans

### The text / Gamma lesson-plan framework (sections, 5E structure, voice)
- **Type:** `module`
- **Seam:** one source — [`bot/shared/services/lesson-plan-template.service.js`](../bot/shared/services/lesson-plan-template.service.js)
  (`buildLessonPlanPrompt`). The section set + card count + reinforcement instruction all come from here;
  [`bot/shared/services/content.service.js`](../bot/shared/services/content.service.js) consumes it.
  (Visual page layout is Gamma-owned — there is no in-repo template for the Gamma LP.)
- **Conformance test:** `tests/textbook-lp-v2/lesson-plan-template.test.js`

### The pic-to-LP illustrated lesson-plan design (layout, sections, typography, branding)
- **Type:** `module` + `template`
- **Seam:** [`bot/shared/services/pic-to-lp/kieai-prompt-builder.service.js`](../bot/shared/services/pic-to-lp/kieai-prompt-builder.service.js)
  — the `SECTION_REGISTRY` (canonical section order), `structuralLabelsFor` (per-language labels), and the
  `THEME` object (palette/fonts) are the three single sources of truth. Model routing is in
  [`bot/shared/services/pic-to-lp/kieai-client.service.js`](../bot/shared/services/pic-to-lp/kieai-client.service.js).
- **Conformance test:** `tests/pic-to-lp/section-registry.test.js`, `tests/pic-to-lp/flow-options-sync.test.js`

### Which LP path a request takes
- **Type:** `config` (DB `region_features`)
- **Seam:** [`docs/LP_PATHS.md`](LP_PATHS.md) documents the real routing; gating is the
  `region_features` table + the handler intercept (not a code router).

---

## Reading assessment

### Fluency benchmark numbers (WCPM / LCPM thresholds, percentiles, L2 factor)
- **Type:** `config`
- **Seam:** [`bot/shared/config/reading-benchmarks.js`](../bot/shared/config/reading-benchmarks.js) holds the
  numbers; [`bot/shared/services/reading/benchmark.service.js`](../bot/shared/services/reading/benchmark.service.js)
  is the single source of truth for the in-app comparison. Change a threshold = edit one JS file (no SQL migration).
- **Conformance test:** `tests/reading/benchmark-service.test.js`
- **Deeper — the metric *shape* (e.g. swap WCPM for ASER levels):** still `schema` depth — it lives in the
  `reading_assessments` columns + Postgres functions (`004_*.sql`, `006_*.sql`, `010_*.sql`). Numbers are a
  config edit; a different *kind* of metric is a migration.

### Passages, comprehension questions, voice-feedback script
- **Type:** `template` (prompts)
- **Seam:** [`bot/shared/services/reading/passage-generation.service.js`](../bot/shared/services/reading/passage-generation.service.js),
  [`comprehension.service.js`](../bot/shared/services/reading/comprehension.service.js),
  [`voice-feedback.service.js`](../bot/shared/services/reading/voice-feedback.service.js).
  Report design: the HTML template [`bot/shared/templates/reading-report.template.js`](../bot/shared/templates/reading-report.template.js).

---

## Cross-cutting

### Languages, voice, branding
- **Type:** `config`
- **Seam:** conversational persona per language in
  [`bot/shared/config/language-prompts.js`](../bot/shared/config/language-prompts.js); LP localization in
  [`bot/shared/config/gamma-languages.config.js`](../bot/shared/config/gamma-languages.config.js). Bot
  identity via env (`BOT_NAME`, `ORG_NAME`, `SUPPORT_CONTACT`) or [`bot/shared/config/branding.js`](../bot/shared/config/branding.js).

### Which features are on
- **Type:** `env`
- **Seam:** presence-gating — [`bot/shared/config/feature-availability.js`](../bot/shared/config/feature-availability.js).
  Set a feature's key → it turns on; leave it blank → off cleanly. Run `npm run doctor` to see what's live.

---

## The foothold contract (for contributors + agents)

When you add a new customizable surface, make it a real foothold:
1. **One source of truth** — not the same decision hardcoded in N places.
2. **Behind a registry/config/template**, not buried inline in a long service method.
3. **A conformance test** that fails if the seam is bypassed (a change that "looks" applied but isn't).
4. **Listed here** with its file + test — a foothold nobody can find is no foothold.

This file is itself guarded: `tests/setup/customization-doc-accuracy.test.js` fails if any repo file
path cited above stops existing, so the map can't rot into pointing at dead code.
