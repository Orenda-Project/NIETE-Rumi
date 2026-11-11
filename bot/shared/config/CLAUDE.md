# config — Configuration, feature flags, language registry, model registry, copy catalogs
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/config kg=e0533f4f1a15 gen=6ee1ee7a0f98 overflow=956 rendered=2026-11-11 kg.py=1.1.0 -->

## Entry points
- `languages.js` — Urdu/English registry all lists derive from
- `model-registry.js` — which LLM runs each job
- `ux-strings.js` — teacher-facing copy and language clamp
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__mocks__/` | → (no door; 1 files: 0 test + 1 support) |
| `supabase.js` | Supabase client singleton and cold-boot env gate that exits 78 when URL or service key is missing |
| `ux-strings.js` | Teacher-facing fixed-copy catalog plus the language clamp deciding which language a surface may render |
| `languages.js` | Language registry: single list (Urdu, English) every other language list derives from |
| … | 40 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `supabase.js` ← imported by `bot/scripts/apply-lp612-figure-notes.js:28:bdc9e340` · `bot/scripts/assessment/backfill-paper-versions.js:101:eb082fc4` (+469)
- `ux-strings.js` ← imported by `bot/scripts/import-lp612-segments.js:36:244271c0` · `bot/shared/handlers/account-state-reply.js:34:90174631` (+226)
- … 75 more → `CLAUDE.index.md`

## Never (human)
- supabase.js exits 78 when DB env is missing; keep that boot gate (supabase.js:8)
- tts-voices.js does not route voices; VOICE_MODELS in utils/constants.js does (tts-voices.js:4)
- feature-flags.js is fail-closed (feature-flags.js:2); model-settings is fail-safe
- Never add a per-region or per-generation lesson-plan table or env flag; extend the existing one, book as separator (docs/lesson-plan-data-model-debt.md)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/menu/menu-role-layouts.test.js` (languages.js, menu-gates.js, role-features.js, ux-strings.js)
- `tests/language/urdu-gender-neutral-copy.test.js` (coaching-card.config.js, coaching-messages.js, ux-strings.js)
- … 881 more → `CLAUDE.index.md`

## Related (generated)
- skills: `digital-coach`? · `registration`? · `setup`?
- docs: `.github/CONTRIBUTING.md`? · `AGENTS.md`? · `CLAUDE.md`? · `bot/shared/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/agent-customization.md`? (+9)
