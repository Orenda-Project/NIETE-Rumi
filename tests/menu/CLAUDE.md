# menu — Tests the /menu front door: role layouts, language, tap gating, stale waits

<!-- kg:meta repo=NIETE-Rumi dir=tests/menu kg=ee0bac4c2c22 gen=3a4bdf09a693 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `menu-role-layouts.test.js` — which rows each role (teacher, principal, coach) gets
- `menu-tap-gating.test.js` — role gating enforced where a scrollback tap lands
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/menu --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `menu-language-and-honesty.test.js` | Pins /menu rendering in the teacher's language and hiding rows this deployment cannot run (menu catalog keys) |
| `menu-role-layouts.test.js` | Pins the /menu row layout per role (teacher, principal, coach) built from role-features and menu-gates |
| `stale-menu-wait.test.js` | After /menu the AWAITING_MENU_CHOICE wait no longer swallows free text; digits still pick, text routes onward |
| `role-features.test.js` | Row 122: pins the role-features capability table (DC vs HITL per role, unknown role keeps DC, case-insensitive) |
| `menu-tap-gating.test.js` | Pins that role gating is enforced where a scrollback menu_coaching tap lands, so a coach cannot start DC review |
| `CLAUDE.md` | (unmapped) |
| `role-refusal-languages.test.js` | Class H guard: every role-refusal string exists in every offered language and names the row that is theirs |

## Who reads this (generated)
- (none)

## Never (human)
- Role gating must be enforced at the tap, not only where the row is drawn (menu-tap-gating.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.md`? · `bot/shared/services/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/menu/CLAUDE.md`?
