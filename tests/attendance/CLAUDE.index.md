# attendance — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/attendance -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `_shared.js` | Shared helpers for dashboard attendance route tests; mirrors hcp/_shared.js, invokeRoute aimed at attendance.routes |
| `absent-then-leave.test.js` | bd-2727: attendance Flow routes MARK to a separate LEAVE page so a student cannot be both absent and on leave |
| `attendance-no-class-creation.test.js` | Attendance never creates classes: a teacher with no class is sent to /class, or answered in chat if no school is on file |
| `attendance-repository.test.js` | dashboard attendance-repository (mock impl) and computePresence math: rounding and zero-working-days guard |
| `attendance-router.test.js` | attendance-router.service: which Flow a user gets on "attendance" (principal marks teachers, teacher picks method) |
| `attendance-routes.test.js` | /api/portal/attendance/* router: session and principal-role guards, presence payload shape, mark validation |
| `attendance-tap-routing.test.js` | Source-reads whatsapp-bot.js: att_method_/att_class_ taps are consumed in both button_reply and list_reply branches |
| `attendance-write.test.js` | attendance-write.service, the single write path: mark by exception, leave distinct from absent, shared with portal |
| `attendance-writes-no-rosters.test.js` | Static guard that attendance code mutates only register tables and never writes the class/roster tables owned by /class |
| `bd-fmf24g.7-attendance-portal.test.js` | bd-fmf24g.7: attendance-portal.service for the teacher portal: class selector, day status, marking window, write rule |
| `bigquery-export-worker.test.js` | attendance-bigquery-export.worker pure helpers: parseArgs, yesterdayInKarachi and aggregatePresence |
| `bigquery-sync.test.js` | attendance/bigquery-sync.service: BigQuery config validation (required env fails loud, defaults) and the sync behaviour |
| `class-screen-query-cost.test.js` | bd-2728: the attendance CLASS screen costs a constant number of queries however many classes a teacher has |
| `class-setup-endpoint.test.js` | attendance-setup-endpoint paste-a-roster: parseRoster turns one paste into a clean student list, numbering stripped |
| `completion-classified-from-token.test.js` | A bare flow_token Flow completion is classified from its token as attendance/class-manager and answered by its own Flow |
| `cross-script-names.test.js` | bd-43526: voice-attendance matches Urdu-script spoken names to a Latin-script roster |
| `edit-class-enrolls.test.js` | bd-dz6qb.2: "edit class" enrols each child it adds (class_enrollments), not only the legacy students.list_id |
| `empty-roster-dead-end.test.js` | bd-2713: an empty roster never dead-ends the attendance Flow; routing model has one entry screen per way in |
| `empty-roster-renders.test.js` | bd-2732: MARK never sends an empty data-source for a class with nobody in it, so the CheckboxGroup renders |
| `enrollment-roster-source.test.js` | Attendance reads class_enrollments for class-backed lists, falls back to legacy students.list_id, never makes rosters |
| `flow-preamble.test.js` | bd-2726: the class picker lives inside the Flow (CLASS, DATE, MARK) so 20+ class-sections are reachable |
| `marking-completion.test.js` | flow-type-detector spots an attendance-marking completion by its attendance_action field, even with a colon-less token |
| `monthly-register.test.js` | bd-43520: attendance-register.service builds the cumulative monthly matrix, leave kept distinct from absence |
| `overwrite-acknowledged.test.js` | bd-2730: CONFIRM names earlier tallies and warns before re-marking replaces a day; silent for a fresh day |
| `principal-owns-a-class.test.js` | bd-37lyd: a principal who is also a class teacher can mark their own class after the tap-or-voice question |
| `principal-teachers-only.test.js` | bd-43520: /attendance for a principal is staff attendance only, starting with the tap-or-voice chat question |
| `register-delivery-temp-race.test.js` | bd-c00np: two same-named register files delivered at once each reach their own school's principal; temp dir left clean |
| `register-delivery.test.js` | bd-43520: attendance-register-delivery sends the month-to-date .xlsx named for school and month, queries the whole month |
| `router-action-coverage.test.js` | Every action the attendance router emits must be handled by both consumers (message handler and generic fallthrough) |
| `schema-mirror.test.js` | Guards that 00_complete-schema.sql carries the same attendance objects as the V1.0.7 attendance migration |
| `student-flow-four-asks.test.js` | bd-43523: student attendance reuses the principal path (picker, voice, REVIEW, register); radios to five classes |
| `typed-method-reply.test.js` | bd-43520: a principal who types "voice" or "tap" (either script) instead of tapping the button is understood |
| `voice-note-wiring.test.js` | bd-43520: static checks that the voice-message handler checks attendance before comprehension and joins the router |
| `voice-roll-call.test.js` | bd-43520: voice roll call matches spoken names (full or first) to the roster in voice-attendance.service |
| `voice-session-state.contract.test.js` | bd-43520, Class O: arming the voice wait persists in the real conversation-state service and reads back as waiting |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/attendance/CLAUDE.md`? · `bot/shared/services/classes/CLAUDE.index.md`? · `bot/shared/services/classes/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/workers/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.index.md`? · `dashboard/services/CLAUDE.index.md`? · `docs/CLAUDE.index.md`? · `docs/attendance-bigquery-sync.md`? · `docs/flows/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/attendance/CLAUDE.index.md`? · `tests/attendance/CLAUDE.md`?
