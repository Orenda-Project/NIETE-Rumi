# config — Configuration, feature flags, language registry, model registry, copy catalogs
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/config kg=4a411eaa10d4 gen=e5cd41927c1f overflow=920 rendered=2026-10-29 kg.py=1.1.0 -->

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
| … | 39 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `supabase.js` ← imported by `bot/scripts/apply-lp612-figure-notes.js:28:bdc9e340` · `bot/scripts/assessment/backfill-paper-versions.js:101:eb082fc4` (+439)
- `ux-strings.js` ← imported by `bot/scripts/import-lp612-segments.js:31:244271c0` · `bot/shared/handlers/account-state-reply.js:34:90174631` (+214)
- `languages.js` ← imported by `bot/shared/handlers/flow-response.handler.js:56:28620c16` · `bot/shared/routes/internal-api.routes.js:2458:15fe99b4` (+40)
- … 72 more → `CLAUDE.index.md`

## Never (human)
- supabase.js exits 78 when DB env is missing; keep that boot gate (supabase.js:8)
- tts-voices.js does not route voices; VOICE_MODELS in utils/constants.js does (tts-voices.js:4)
- feature-flags.js is fail-closed (feature-flags.js:2); model-settings is fail-safe
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/menu/menu-role-layouts.test.js` (languages.js, menu-gates.js, role-features.js, ux-strings.js)
- `tests/language/urdu-gender-neutral-copy.test.js` (coaching-card.config.js, coaching-messages.js, ux-strings.js)
- … 848 more → `CLAUDE.index.md`

## Related (generated)
- skills: `digital-coach`? · `registration`? · `setup`?
- docs: `.github/CONTRIBUTING.md`? · `AGENTS.md`? · `CLAUDE.md`? · `bot/shared/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/agent-customization.md`? (+8)
