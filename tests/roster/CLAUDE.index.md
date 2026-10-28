# roster — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/roster -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `roster-ack-text.test.js` | Pins rosterAckText: the chat line after a /roster Flow closes says save, hand-over or unchanged as it happened |
| `roster-boxes-and-rolls.test.js` | Field reports: roster edit boxes keep headroom under Meta's cap; roll-less pages print no question marks (roster-lines) |
| `roster-class-details.test.js` | bd-tf3jg: changing a saved class's grade, section or shift in class.service, with twin-class refuse-or-merge |
| `roster-class-teacher-required.test.js` | Pins the /roster CLASS screen class-teacher Dropdown as required:true while keeping a sayable "not listed" escape |
| `roster-completion-contract.test.js` | Pins that /roster completion payload discriminators match what flow-type-detector reads, so no catch-all ack |
| `roster-edit-save-identity.test.js` | bd-a05gc: saveRosterEdits at the endpoint deletes the right child and reports unmatched lines, never corrupting rows |
| `roster-endpoint-save.test.js` | Pins that saveRoster passes the PHOTOS-minted runId through for idempotency; replays reach SAVED, in-progress is honest |
| `roster-endpoint-status.test.js` | Pins roster SCHOOL submit: status screen with done and missing grades when history exists, camera when none |
| `roster-extraction-identity.test.js` | Pins roster-extraction admission-number and date-of-birth normalisation (plausible kept, garbage refused) |
| `roster-extraction-rows.test.js` | Pins sanitizeRows: unread or backwards or duplicated roll numbers become null, never inferred |
| `roster-failure-copy.test.js` | Pins describeFailure: coach-facing register-read failure copy that never leaks billing errors, URLs or key fragments |
| `roster-hand-over-principal.test.js` | bd-37lyd: class.service handOverClass accepts a principal as class teacher (assignment plus mirror), refuses a coach |
| `roster-hand-over.test.js` | bd-dz6qb.5: a coach hands a saved class to its teacher; assignment and mirror written together in class.service |
| `roster-identity-not-position.test.js` | bd-a05gc: roster-lines reconcile() matches roll-less children by identity not position, so deletions hit the right child |
| `roster-language.test.js` | Pins that /roster's role refusal and Flow chrome are in the leader's language (Urdu or English), via ux-strings |
| `roster-lines.test.js` | Pins roster-lines, the roster-to-TextArea bridge: chunking under the 600-char cap, roll numbering, edit parsing |
| `roster-media.test.js` | Pins roster-media decryptMedia: CDN download, hash and HMAC checks, AES-CBC decrypt of a PhotoPicker upload |
| `roster-principal-class-teacher.test.js` | bd-37lyd: teachersFor offers and labels principals and nameless people as class teachers; refuses non-teaching roles |
| `roster-saved-count-is-stored.test.js` | bd-37lyd: the SAVED screen reports the stored roster count and says a skipped line was not saved |
| `roster-school-status-row-cap.test.js` | bd-p3bs1: roster school status counts enrolments without hitting PostgREST's row cap, so no class is lost |
| `roster-shift-endpoint.test.js` | bd-ff2e9: the roster CLASS screen offers real shifts and the chosen shift reaches importRoster and the audit manifest |
| `roster-shift-identity.test.js` | bd-ff2e9: a scan for an evening class lands in the teacher's one class, through the real ClassService and attendance |
| `roster-storage.test.js` | Pins roster-storage keys: register photos and manifest are kept under school/run/page keys, escape-safe |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.index.md`? · `bot/shared/services/roster/CLAUDE.index.md`? · `bot/shared/services/roster/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `docs/flows/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/roster/CLAUDE.index.md`? · `tests/roster/CLAUDE.md`?
