# Student mode — a child outside the quiz is tutored, a teacher is never locked out

A child reaches this bot by tapping a link their teacher forwarded to the class group. Inside the
quiz the child is handled by the quiz chain. The moment they step **outside** it — "what is a
fraction?", "i didnt understand question 4" — the free-chat path used to answer with the one
persona the bot had: a teaching assistant that offers lesson plans, classroom-observation feedback
and reading assessments, and talks to a ten-year-old as a colleague.

Student mode gives that path a second persona. It is a **persona, not a lock**: nothing is gated,
no feature is withdrawn, and no account is downgraded.

## Where it is consulted

Exactly one call site: `handleGeneralConversation` in `bot/shared/handlers/text-message.handler.js`
— the free-chat path, where the system prompt is built.

Everything else short-circuits **above** that function and is unchanged:

| Path | Reached before the gate? |
|---|---|
| Share-code join (`QUIZ-XXXXXX`), name/class replies | yes — unchanged |
| An answer to a live quiz question | yes — unchanged |
| Any `/command` (`/menu`, `/quiz`, `/video`, …) | yes — unchanged |
| Registration keywords (`register`, `sign up`, `رجسٹر`) | yes — unchanged |
| Flow replies (`nfm_reply`) | different handler — unchanged |
| Coaching, observation, attendance, lesson-plan flows | yes — unchanged |
| Free chat | **the gate runs here** |

Each row is proven by an executed test in `tests/quiz/student-mode-gate.test.js`, which drives the
real handler rather than reading its source.

## The decision

`bot/shared/services/student-mode.service.js` →
`decide({ user, teacherSignals, students, lastSessionAt, now, flag })`

| # | Condition | Mode | `reason` | Meaning |
|---|---|---|---|---|
| 1 | `STUDENT_MODE_ENABLED` is not `true` | `unknown` | `flag_off` | nothing is read, nothing is written |
| 2 | The message is a first-person teacher claim, a registration keyword, or a `/command` | `teacher` | `teacher_claim` | and the handset's quiz-joined student rows are retired |
| 3 | **Any teacher signal** (table below) | `teacher` | the signal's name | weighed before a single row about a child is read |
| 4 | An active quiz-joined `students` row for this handset **and** a `quiz_sessions` row for it within 30 days | `student` | `active_student_recent_quiz` | the tutor persona, free chat only |
| 5 | anything else | `unknown` | `no_student_row` / `no_quiz_session` / `quiz_session_stale` / … | today's behaviour, unchanged |

### The five teacher signals

Any **one** of them is decisive, and all of them are read before anything about a child is. They
are ordered cheapest-first and short-circuited: a registered or a named row costs **zero** queries;
the worst case — an adult with no name and no history — costs six head counts, on a path that is
already making an LLM call.

| Signal | `reason` | Read from | Cost |
|---|---|---|---|
| `registered` | `registered_teacher` | `users.registration_completed` or `registration_state === 'completed'` | free (the row is already in hand) |
| `hasName` | `hasName` | `users.first_name` non-empty after trim | free |
| `ownsQuizzes` | `ownsQuizzes` | any `quizzes.teacher_id = user.id` | 1 head count |
| `hasCoaching` | `hasCoaching` | any `coaching_sessions.user_id = user.id` | 1 head count |
| `usedFeatures` | `usedFeatures` | `FeatureRegistrationService.countUserFeatures(user.id) > 0` | 4 head counts |
| *(a failed lookup)* | `signal_lookup_failed` | any of the three reads erroring | — |

A failed read is **not** "no rows": collapsing the two is how a teacher becomes a child during a
database hiccup, so an error resolves towards `teacher` like everything else here.

`registered` and `hasName` are also derived from the `user` row inside the pure `decide()` when the
caller passes no signals at all, so a call site written before the signals existed still gets both.

Rules 2 and 3 are the safety valves. Anybody can say they are a teacher in one sentence and be
believed; and a handset with any adult history on it is a teacher's, whatever else is on it.

The two errors are not symmetrical, which is why the evidence bar for `student` sits where it
does: a wrong `student` costs one oddly pitched reply and is corrected by the next message; a
wrong `teacher` costs nothing at all — it is exactly what the bot does today.

### Why registration alone was not enough (bd-mg9c7.88)

Lane Z turned the feature on in staging and the very first real account it saw came back
`student`. It was a teacher's: `registration_completed = false`, `registration_state =
'unregistered'` — so rule 3's `registered` signal never fired — but a name on the row, six
`quizzes` owned as `teacher_id`, dozens of `coaching_sessions`, five active quiz-joined `students`
rows from joining her own class links before the self-test path existed, and a `quiz_sessions` row
finished that morning. Every clause of rule 4 was satisfied. Her next free-text message would have
been answered by a tutor pitched at a ten-year-old.

Teachers of that shape are ordinary, not exotic. The recovery-registration branch in
`text-message.handler.js` (~L2262-2290) exists precisely because people use the bot's features for
months without ever finishing registration — and it decides "established user" with the same
`countUserFeatures` call the `usedFeatures` signal uses, so student mode and registration recovery
cannot disagree about who counts.

The flag was turned off on staging the moment this was seen, and back on after the fix.

### The escape hatch is anchored, not a substring

"teacher" is the most common word in a child's message about school — "my teacher said", "ask my
teacher", "میرے استاد نے کہا". Matching it as a bare substring would retire that child's identity
row, costing them their remembered name and dropping them off their teacher's enrolled roster
(`student-identity.service.js` filters `is_active` in both `findByPhone` and `findByTeacher`). So
a claim is a **first-person** claim ("I am a teacher", "میں استاد ہوں"), the bare word as the
**whole** message, a registration keyword, or a leading `/`.

Retirement is scoped to `students` rows with `list_id IS NULL` — the quiz-join shape. A child on
an **attendance roster** has `list_id` set and their row is never touched by anything typed in
chat.

### The mode expires by itself

`student` requires a quiz session within 30 days. A handset that stops taking quizzes reverts to
`unknown` — today's behaviour — with nothing to clean up. Turning the flag off does the same
instantly, for everyone.

## The persona

`OpenAIService._getFormatAwareSystemPrompt(format, language, firstName, { persona, studentClass })`
builds a one-to-one tutor instead of the teaching assistant when `persona === 'student'`: warm,
short, pitched at the child's class, gender-neutral, no teacher features offered, no personal data
requested, and anything that is not schoolwork redirected to a grown-up. The religious-reverence
block rides it exactly as it rides every other conversational prompt.

Two things are deliberately withheld from a child's turn:

- **The teacher feature context.** The context injector describes a teacher's past lesson plans and
  coaching sessions; a child has none, and the block would hand one person's material to another.
- **The name.** The child's name is not sent to the model. The tutor is warm without it.

The reply language is the language of the child's **last quiz**, not the `users` row created by
their first inbound message — they answered fifteen questions in that language.

## The teacher's own test run

A teacher who opens her own class link is recorded as herself: the session is written with
`quiz_sessions.user_id` set to her `users.id`, no `students` row is created for her, and she is
never asked her name and class. Every count that describes *her class* excludes that session — the
class report's roster and average, the hardest-question tally, the `/quiz` started/finished counts
and the low-uptake nudge.

No schema change was needed. `quiz_sessions.user_id` is nullable, FK to `users`, indexed, and
already means "the registered user who took this session"; every share-link session is otherwise
written with `user_id: null`, so within a share code `user_id = quiz_share_codes.teacher_user_id`
identifies a self-test and nothing else.

**And the residue is cleaned up.** A teacher who tested her own links *before* this path shipped is
still carrying quiz-joined `students` rows from those runs — that is half of what made the live
account above look like a child. So when `resolveSelfTest()` recognises her phone on her own share
code it retires that handset's quiz-joined rows (`list_id IS NULL`, `is_active = false`) and logs
`video_quiz.self_test_rows_retired`. Attendance-roster rows (`list_id` set) are never touched, and a
retire that fails never stops the quiz from starting.

## Telemetry

One event per decision, no names and no phone numbers:

| Event | Fields |
|---|---|
| `student_mode.decided` | `mode`, `reason`, `signal`, `userId`, `students`, `sessionAgeDays` |
| `student_mode.escaped` | `reason`, `retired`, `userId` |
| `video_quiz.teacher_self_test` | `shareCodeId`, `quizId`, `userId` |
| `video_quiz.self_test_rows_retired` | `userId`, `retired` |
| `video_quiz.self_test_excluded` | `shareCodeId`, `n` |

`signal` on a `teacher` verdict is the signal that decided it — `registered_teacher`, `hasName`,
`ownsQuizzes`, `hasCoaching`, `usedFeatures` or `signal_lookup_failed`. It is `null` on every other
verdict.

## Kill switch

Unset `STUDENT_MODE_ENABLED`, or set it to anything other than `true`. With it off the module
reads nothing, writes nothing and logs nothing, and free chat behaves exactly as it did before
this feature existed.
