# roster — Tests /roster: register-photo extraction, review editing, saving, class hand-over
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/roster kg=9abff3091993 gen=71f49498b85a overflow=16 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `roster-lines.test.js` — roster to TextArea bridge the REVIEW screen edits through
- `roster-identity-not-position.test.js` — edits matched by identity, not position (bd-a05gc)
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/roster --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `roster-class-details.test.js` | bd-tf3jg: changing a saved class's grade, section or shift in class.service, with twin-class refuse-or-merge |
| `roster-edit-save-identity.test.js` | bd-a05gc: saveRosterEdits at the endpoint deletes the right child and reports unmatched lines, never corrupting rows |
| `roster-shift-endpoint.test.js` | bd-ff2e9: the roster CLASS screen offers real shifts and the chosen shift reaches importRoster and the audit manifest |
| `roster-boxes-and-rolls.test.js` | Field reports: roster edit boxes keep headroom under Meta's cap; roll-less pages print no question marks (roster-lines) |
| `roster-extraction-identity.test.js` | Pins roster-extraction admission-number and date-of-birth normalisation (plausible kept, garbage refused) |
| `roster-language.test.js` | Pins that /roster's role refusal and Flow chrome are in the leader's language (Urdu or English), via ux-strings |
| `roster-principal-class-teacher.test.js` | bd-37lyd: teachersFor offers and labels principals and nameless people as class teachers; refuses non-teaching roles |
| … | 16 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- A roll-less child keeps an identity; reconcile must not match by position (roster-identity-not-position.test.js:2)
- The class-teacher field stays required on the CLASS screen (roster-class-teacher-required.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.index.md`? · `bot/shared/services/roster/CLAUDE.index.md`? · `bot/shared/services/roster/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? (+5)
