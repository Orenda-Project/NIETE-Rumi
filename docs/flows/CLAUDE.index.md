# flows — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=docs/flows -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `remark-mockups/` | → (no door; 3 files) |
| `rollback/` | Frozen snapshots of live Flows taken before a cutover, for rollback → `rollback/CLAUDE.md` |
| `assessment-gen-flow.README.md` | Notes on assessment-gen-flow.json: server-served screen order CLASS to CONFIRM and how review screens are reached |
| `assessment-gen-flow.json` | Flow JSON v7.3: assessment generator form (class, coverage, pages, question types, counts, confirm), endpoint-driven |
| `assessment-review-flow.json` | Flow JSON v7.0: review and edit a generated assessment (list, add type, edit options/columns/passage/comprehension) |
| `attendance-marking-flow.json` | Flow JSON v6.3: mark attendance by exception for teachers (students) and principals (staff); date, mark, leave, confirm |
| `attendance-setup-flow.json` | Flow JSON v6.3: set up a class for attendance (class, roster, review, success) |
| `child-test-check.json` | Flow JSON v7.3: coach's child test scoring screens for Urdu, English and Maths, then done |
| `child-test-review.json` | Flow JSON v7.3: single REVIEW screen for the coach to check a child's test result |
| `class-manager-flow.json` | Flow JSON v6.3: manage classes (list, add, subjects, roster, saved) |
| `edit-class-flow.json` | Flow JSON v6.3: fix a class roster after creation (add, remove, rename students) |
| `exam-checker-confirm-students-flow.json` | Flow JSON v6.2: Exam Checker screen to confirm detected students before grading |
| `homework-request-flow.json` | Flow JSON v6.3: Homework request, pick grade and subject then multi-select chapters |
| `observe-visit-v2.json` | Flow JSON v7.0, 32 screens: coach /observe visit (menu, debriefs, work form, schedule, school and teacher pick) |
| `observe2-evidence-check.json` | Flow JSON v7.3: observation evidence check (heard ask/wrong/work/explain, fidelity, added, priority) |
| `observe2-field-form.json` | Flow JSON v7.3: observation field form parts one and two, lesson-plan evidence and photo capture screens |
| `pakistan-lp-flow-v1.json` | Historical Flow JSON v6.3: first Pakistan lesson-plan picker (spec, grade, subject, topic) |
| `pakistan-lp-flow-v2.json` | Historical Flow JSON v6.3: Pakistan lesson-plan picker with a chapter step (grade, subject, chapter, topic) |
| `pakistan-lp-flow-v3.json` | Flow JSON v7.0: Pakistan lesson-plan picker with chapter and lesson paging and language choice |
| `quiz-flow.json` | Flow JSON v6.3: Quiz Manager (list active quizzes, send new quiz to a class or lesson, cancel) |
| `quiz-multi-select-flow.json` | Static Flow JSON v6.3: select-all-that-apply answer screen for transcript-quiz questions |
| `reading-assessment-flow-v2.json` | Flow JSON v6.2: Reading Assessment basic info and options screens |
| `registration-flow-v3.json` | Superseded Flow JSON v6.3: registration (personal, region, professional, organisation details) |
| `registration-flow-v5.1.json` | Flow JSON v7.0: NIETE registration v5.1 (bd-x7aprz.9, 2026-10-19), same screens as v5 with copy changes |
| `registration-flow-v5.json` | Flow JSON v7.0: NIETE registration v5 (bd-x7aprz.2): personal, role and school, school pick, teaching, success |
| `remark-flow.json` | Flow JSON v7.0: /remark rubric for a coach (pick teacher, rubric, summary, success) |
| `roster-flow-v1.json` | Flow JSON v7.0, 14 screens: /roster for coaches and principals to view and edit a school's roster and class teachers |
| `settings-flow.json` | Flow JSON v6.3: user settings endpoint Flow (settings main, success) |
| `status-flow.json` | Flow JSON v6.3: /status snapshot of what is running for the teacher, with cancel confirmation |
| `student-join-flow-v2.json` | Flow JSON v7.0: one-screen WHO screen where a child picks who is playing (v2) |
| `student-join-flow.json` | Flow JSON v7.0: one-screen WHO screen where a child picks who is playing (v1) |
| `student-quiz-flow.json` | Flow JSON v7.0: the child's /quiz Flow (quiz list, quiz, done), separate from the teacher transcript-quiz (bd-2yyry.13) |
| `student-videos-flow.json` | Flow JSON v6.3: student video picker (grade, subject, topic, success) |
| `teacher-training-flow-v1.json` | Flow JSON v5.1: teacher training (vendor and band pickers, training home, level detail, my certificates) |
| `training-msq-flow.json` | Flow JSON v6.2: select-all-that-apply answer screen for training quiz questions |
| `transcript-quiz-flow.json` | Flow JSON v7.0: teacher transcript quiz (lessons, lesson, done) |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- `assessment-gen-flow.json` ← `tests/assessment/assessment-answer-key-always.test.js`
- `attendance-marking-flow.json` ← `tests/attendance/absent-then-leave.test.js` · `tests/attendance/empty-roster-dead-end.test.js` · `tests/attendance/empty-roster-renders.test.js` · `tests/attendance/flow-preamble.test.js` · `tests/attendance/principal-teachers-only.test.js` · `tests/attendance/student-flow-four-asks.test.js`
- `attendance-setup-flow.json` ← `tests/attendance/class-setup-endpoint.test.js`
- `child-test-review.json` ← `tests/child-test/L39/review-v3-flow-contract.test.js`
- `class-manager-flow.json` ← `tests/classes/class-manager-endpoint.test.js` · `tests/classes/one-edit-screen.test.js` · `tests/classes/roster-add-failure-named.test.js` · `tests/classes/roster-empty-class.test.js`
- `observe-visit-v2.json` ← `bot/tests/observe/bd-88krt-school-admin.test.js` · `bot/tests/observe/bd-88krt-visit-actions.test.js` · `bot/tests/observe/bd-gndeg-remove-search.test.js` · `bot/tests/observe/bd-jrxo3-no-bare-capture.test.js` · `bot/tests/observe/bd-qy7dm-remove-school.test.js` · `bot/tests/observe/bd-rkofm-lang-toggle-dedup.test.js` (+3: `python3 kg/kg.py who-reads docs/flows/observe-visit-v2.json`)
- `pakistan-lp-flow-v3.json` ← `bot/tests/lp-v8/flow-response-telemetry.test.js`
- `quiz-multi-select-flow.json` ← `tests/quiz/transcript-quiz-multi.test.js`
- `roster-flow-v1.json` ← `tests/roster/roster-shift-endpoint.test.js`
- `teacher-training-flow-v1.json` ← `tests/training/training-init-entry-screen.test.js`
- `transcript-quiz-flow.json` ← `bot/tests/quiz/transcript-quiz-flow-endpoint.test.js`

## Related (all, generated)
- skills: `registration`?
- docs: `docs/CLAUDE.md`? · `docs/features/attendance.md`? · `docs/features/registration.md`? · `infrastructure/flows/README.md`?
