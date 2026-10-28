# language — Pins how reply language is chosen and that Urdu copy stays gender-neutral

<!-- kg:meta repo=NIETE-Rumi dir=tests/language kg=406271d3e945 gen=a822be38ec64 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `resolve-response-language.test.js` — the rule: a stored preference beats a script-only detector
- `language-ratchet.test.js` — language-debt snapshot gate (bd-3lhh9.2)
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/language --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `urdu-gender-neutral-copy.test.js` | Walks the ux-strings and observe-strings Urdu catalogs asserting no gendered verb addresses teacher, coach or child |
| `resolver-floors.test.js` | Pins that coaching step messages and the language cache floor to the registry's offer default (Urdu), not English |
| `CLAUDE.md` | (unmapped) |
| `child-reply-language.test.js` | Pins that a child's reply language is decided in code per turn (childMessageLanguage, replyTextLanguage), not by prompt |
| `resolve-response-language.test.js` | Pins resolveResponseLanguage: a stored Urdu preference survives Roman-Urdu text, and the reason is logged |
| `language-ratchet.test.js` | bd-3lhh9.2 language-debt ratchet: no bot/shared file may carry more language debt than the language-audit snapshot |

## Who reads this (generated)
- (none)

## Never (human)
- Teacher/coach/child-facing Urdu must not use gendered verb forms (urdu-gender-neutral-copy.test.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? (+2)
