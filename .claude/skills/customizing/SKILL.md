# Customizing Rumi (the foothold map)

Use this when the user wants to **change how a feature works** — swap a coaching framework, restyle a
report, change the LP structure, re-rubric reading assessment, rebrand, add a language, etc.

## The one rule

**Do not hunt through services guessing.** Open [`docs/customization.md`](../../../docs/customization.md) —
it is the seam map. For every customizable thing it gives you: the exact file (the *seam*), the change
*type* (`env` / `config` / `module` / `template` / `schema`), and the *conformance test* that guards it.
For step-by-step recipes, [`docs/agent-customization.md`](../../../docs/agent-customization.md).

## Why footholds (not "just edit the code")

Rumi's customizable surfaces are deliberately built as **footholds**: a single source of truth, behind a
registry / config / template, with a test that fails if a change only half-applies. This exists because the
opposite — a decision hardcoded in several places, or an abstraction that *looks* live but is dead code —
is how customization silently breaks. So:

- **Change the seam, not a copy.** If you find yourself editing the "same" thing in two files, stop — you're
  off the seam. Re-check the map.
- **Run the conformance test** the map names after your change (`node tests/run.js`). If it fails, your change
  half-applied.
- **Preserve behaviour you weren't asked to change.** Most seams are built so the default path is untouched
  (e.g. OECD coaching keeps its canonical prompt; only a *non-default* framework routes differently).

## The seams at a glance

| Want to change… | Type | Seam |
|---|---|---|
| Coaching framework (OECD/HOTS/TEACH/FICO, or add one) | env + module | `framework-registry.js` + `framework-selector.js`; `DEFAULT_OBSERVATION_FRAMEWORK` |
| Coaching report design | module + template | `report-renderers/renderer-registry.js` |
| Reflective debrief + coaching card | config | `coaching-debrief.config.js`, `coaching-card.config.js` |
| Text/Gamma LP framework | module | `lesson-plan-template.service.js` |
| Pic-to-LP illustrated layout | module + template | `pic-to-lp/kieai-prompt-builder.service.js` (`SECTION_REGISTRY`, `THEME`) |
| Reading benchmark numbers | config | `config/reading-benchmarks.js` |
| Languages / branding | config | `language-prompts.js`, `branding.js` |
| Turn a feature on/off | env | set its key — `feature-availability.js`, `npm run doctor` |

Full detail, file paths, and the test for each: **[`docs/customization.md`](../../../docs/customization.md)**.

## When you add a NEW customizable surface

Make it a real foothold (the same contract this repo holds itself to):
1. One source of truth. 2. Behind a registry/config/template, not inline in a long method.
3. A conformance test that fails if the seam is bypassed. 4. Add a row to `docs/customization.md`
(its `customization-doc-accuracy` guard checks every path you cite actually exists).
