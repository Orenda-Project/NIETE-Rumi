# registration — Tests for registration Flow, /register and persistence of name and role

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/registration kg=4097b251e175 gen=8ae83bb16aa4 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `bd-2480-2773-persist-per-screen.test.js` — each screen writes to the user row
- `bd-2447-register-command-sends-flow.test.js` — /register always opens the Flow
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `bd-2447-register-command-sends-flow.test.js` | Pins that /register always opens the registration Flow, never the deferred-onboarding text (bd-2447) |
| `bd-2kxxa1-register-reopens-for-registered.test.js` | Pins /register re-opens Flow for an already-registered user so a coach can fix a reassigned number's name (bd-2kxxa.1) |
| `CLAUDE.md` | (unmapped) |
| `bug-002-registration-recovery.test.js` | Tests countUserFeatures and the /register recovery path for users who skipped first-feature registration (BUG-002) |
| `bd-2404-role-persistence.test.js` | Pins the registration endpoint carries the selected role (e.g. Coach) into SUCCESS params and Flow payload (bd-2404) |
| `bd-2480-2773-persist-per-screen.test.js` | Pins registration persisting first_name, name, country, role per screen so a dropped final payload loses none (bd-2480) |
| `bd-2480-register-gate.test.js` | Pins the already-registered gate predicate against the shipped helper: flag or name alone counts (bd-2480) |
| `bd-2480-completion-no-clobber.test.js` | Pins that the registration completion write is non-destructive: empty payload never blanks name/country (bd-2480) |
| `organization-constant.test.js` | Pins that new NIETE registrations get organization 'niete', matching scripts/set-organization.py backfill |

## Who reads this (generated)
- (none)

## Never (human)
- New registrations carry organization 'niete', kept in sync with scripts/set-organization.py (organization-constant.test.js:3)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/database/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? (+1)
