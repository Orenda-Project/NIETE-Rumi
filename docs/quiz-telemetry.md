# Post-quiz action telemetry

After a video quiz finishes, a child (or the teacher, on a solo run) is offered
one or more follow-on actions — send it to a friend, watch another video, rate
what they just did. Before this, only the *outcome* of some of those offers was
logged (`friend_invited`, `invite_result_sent`, `share_code_minted`,
`share_code_opened`) — nothing recorded that an offer was **shown**, and
nothing recorded a **decline**. The funnel could not be measured: a flat
acceptance count with no denominator.

This file documents the event set that closes that gap: a uniform two-event
funnel plus a handful of point events, all ids/enums/booleans/counts — no
phone numbers, no names, no free text.

## The funnel: `offer_shown` / `offer_answered`

Every offer the child (or teacher) is shown emits exactly one:

```js
logEvent('video_quiz.offer_shown', { kind, sessionId, quizId, source, language });
```

Every tap on one of those offers emits exactly one:

```js
logEvent('video_quiz.offer_answered', { kind, choice, ... });
```

| `kind`     | Offered when | `choice` values |
|------------|--------------|------------------|
| `quiz`     | After a video, before any session exists (`sendOffer`) | `yes` \| `no` \| `share` |
| `invite`   | A `share_link` session finishes (`offerInvite`) | `yes` \| `no` |
| `share`    | A `video_solo` session finishes (`offerShare`) | `yes` \| `no` |
| `binge`    | A child declines the friend-invite (`offerMore`) | `yes` \| `no` |
| `feedback` | The post-quiz survey **actually sends** (`sendFeedbackPrompt`, scope `video_and_quiz` only — the bare-video survey is a separate offer this event does not cover) | `useful` \| `not_useful` |

`sessionId` is `null` on the `quiz` kind — no session exists until the offer
is accepted. Every other kind carries it, and it is always spelled
`sessionId`, so one query joins the two halves of the funnel. `choice` is
always a short stable token, **never the WhatsApp button title** (button copy
is translated and can change; the token cannot).

Two kinds carry a delivery verdict rather than assuming one, because their
send can fail and an offer nobody received is not an offer shown:

* `share` adds `sent` — the offer is sent with one retry, and `sent: false`
  means both attempts failed.
* `feedback` is logged **at send time, not at schedule time**. The survey is
  queued ~30 s after the quiz ends; logging it when it was queued would count
  offers that never arrived.

An `offer_answered` also keeps every field the pre-existing event already
carried for that call site (e.g. `quiz`'s `userId`/`accepted`/`shared`) —
additive only, nothing removed or renamed.

### Backward compatibility

`offerInvite` / `offerShare` / `offerMore` now accept optional `sessionId` /
`quizId` and store them in the Redis context object each offer already
writes. A ctx written by the previous deploy (no such keys) still answers
cleanly — the fields simply come out `null` on the matching `offer_answered`.

## Point events

| Event | Fires | Fields |
|-------|-------|--------|
| `video_quiz.scorecard_sent` | `finish()`, right after the scorecard image send resolves | `sessionId`, `quizId`, `ok` (image sent), `fallback` (plain-text `vqDoneFallback` went instead), `pct`, `language` |
| `video_quiz.binge_started` | `handleMoreButton`, only when the Student Videos Flow **actually sent** (`WhatsAppService.sendFlow` returned truthy) | `sessionId`, `quizId`, `shareCodeId`, `language` |
| `video_quiz.binge_unavailable` | `handleMoreButton`, when the Flow could not be offered — `STUDENT_VIDEOS_FLOW_ID` unset, or the send failed | `reason`: `flow_not_configured` \| `flow_send_failed` |
| `video_quiz.binge_video_picked` | `student-videos-endpoint.js` `deliverVideoAsync`, the child branch — the point where a binge round's Student-Videos Flow reply (grade → subject → topic → SUCCESS) comes back, before we know whether that video has a quiz | `shareCodeId`, `studentId` |
| `video_quiz.feedback_answered` | `handleFeedbackButton`, only when the tap is linked to a quiz run (`link.quizSessionId` set — a bare-video 👍/👎 with no linked quiz session does not emit this) | `quizSessionId`, `useful`, `videoId`. Note the field is `quizSessionId` on this point event and `sessionId` on the matching `offer_answered`; the funnel queries use the latter |

## Pre-existing events this funnel sits alongside (unchanged)

`video_quiz.offered`, `video_quiz.completed`, `video_quiz.friend_invited`,
`video_quiz.invite_result_sent`, `video_quiz.share_code_minted`,
`video_quiz.share_code_opened`, `video_quiz.join_flow_completed`.

**Known gap, not fixed here**: `student_video.feedback_prompt.scheduled`
(the survey-scheduling event, distinct from `feedback_answered` above) logs a
raw `phone` field. It predates this funnel and was left alone per the
additive-only scope of this change — flagged for a separate fix.

## Reading these events in Axiom

Follow the project's Axiom conventions (see the `axiom-logging` skill): never
a `data.` prefix in a query. This service's structured logger
(`bot/shared/utils/structured-logger.js`, `AXIOM_CORE_FIELDS`) keeps only
`level`, `time`, `msg`, `pid`, `hostname`, `service`, `env`, `correlationId`,
`phone`, `userId`, `sessionId`, `err` at the top level — **every other field
is stringified into a single `data_json` column**, including `event` itself
and every field this doc lists (`kind`, `choice`, `quizId`, `videoId`, `pct`,
`ok`, `fallback`, `useful`, `reason`, `source`, `language`, `shareCodeId`).
`sessionId` is the one exception among the fields above — it IS core, so it
stays a top-level column.

Every query below starts `extend d = parse_json(data_json)` and reads fields
off `d`, never off a top-level column of the same name. `<dataset>` is this
deployment's Axiom dataset; `region == "niete"` is the service-filter
convention already in use for it elsewhere in this project — if a query
returns 0 rows, drop that filter and confirm the actual column names with
Axiom's schema view before assuming the data isn't there.

### (a) The post-quiz funnel: completed → shown → answered, by kind

```apl
['<dataset>']
| where service == "bot" and region == "niete"
| extend d = parse_json(data_json), ev = tostring(d.event)
| where ev in ('video_quiz.completed', 'video_quiz.offer_shown', 'video_quiz.offer_answered')
| extend kind = iif(ev == 'video_quiz.completed', '_all_sessions_', tostring(d.kind))
| summarize
    sessions_completed = countif(ev == 'video_quiz.completed'),
    offers_shown        = countif(ev == 'video_quiz.offer_shown'),
    offers_answered      = countif(ev == 'video_quiz.offer_answered')
  by kind
| order by kind asc
```

The `_all_sessions_` row is the total-completed denominator (that event
carries no `kind`); the `quiz` / `invite` / `share` / `binge` / `feedback`
rows are the per-offer shown/answered counts.

### (b) Decline rate per kind

```apl
['<dataset>']
| where service == "bot" and region == "niete"
| extend d = parse_json(data_json), ev = tostring(d.event)
| where ev == 'video_quiz.offer_answered'
| summarize
    accepted = countif(tostring(d.choice) in ('yes', 'useful', 'share')),
    declined = countif(tostring(d.choice) in ('no', 'not_useful'))
  by kind = tostring(d.kind)
| extend decline_rate_pct = round(100.0 * declined / (accepted + declined), 1)
| order by kind asc
```

### Scorecard delivery health

```apl
['<dataset>']
| where service == "bot" and region == "niete"
| extend d = parse_json(data_json)
| where tostring(d.event) == 'video_quiz.scorecard_sent'
| summarize sent = count(), image_ok = countif(tobool(d.ok) == true), fell_back = countif(tobool(d.fallback) == true)
```

## Transcript Quiz Flow telemetry

`/quiz` as one Flow (`bot/shared/routes/transcript-quiz-flow-endpoint.js`) — the
lesson list with in-Flow paging, a lesson's own live results, and generate
report / resend link / make the quiz, all inside one Flow session instead of
round-tripping through the chat. Six `transcript_quiz.*` events cover it.

| Event | Fires | Fields | Question it answers |
|-------|-------|--------|----------------------|
| `transcript_quiz.flow_opened` | `handleTranscriptQuizInit` — the Flow's INIT resolves a teacher from the flow token and the lesson list (page 1) is served | `userId` | How many teachers open the Flow? |
| `transcript_quiz.flow_page` | `handleTranscriptQuizDataExchange`, `step === 'page'` — the teacher pages the lesson list (older/newer) | `userId`, `page` | How deep do teachers page into the list? |
| `transcript_quiz.flow_lesson` | `stepLesson` — the teacher taps a lesson row and its LESSON screen (live results) is served | `userId`, `quizId`, `status` (the quiz's state — e.g. `sent`, `report_sent`), `started` (students who have started), `finished` (students who have completed) | Which lessons get opened, and what does their live-results state look like at open time? |
| `transcript_quiz.flow_action` | `stepAction` — the teacher's chosen action (`report` / `link` / `make:<language>`) has passed the availability check and is about to be dispatched | `userId`, `action`, `quizId` | Which action does a teacher pick, on which quiz? |
| `transcript_quiz.flow_action_done` | `runAfterResponse` — the action's async work (report generation, link resend, quiz creation) finishes, success or failure, AFTER the DONE screen has already been returned (Meta's data_exchange budget is 10s; a report render or a resend would blow it) | `action`, `quizId`, `ok`, and `error` on failure | Did the action the teacher asked for actually happen? |
| `transcript_quiz.flow_closed` | `doneScreen(kind, ...)` — fires when the DONE/TERMINAL screen is **served to the client**, not when the teacher taps Close (WhatsApp Flows do not report a Close tap; the terminal screen being sent is the closest signal, and closer than none) | `kind` (`report` \| `link` \| `make` \| `wait`) plus per-kind meta: `userId` always; `quizId` for `report`/`link`; `language` (the chosen quiz language) for `make` | How many Flow sessions reach a terminal screen, broken down by which one? |

`flow_action` and `flow_action_done` are two ends of the same async action —
join them on `action` + `quizId` (not `userId` alone: the same teacher can
fire the same action twice). A `flow_action` with no matching
`flow_action_done` within the request window means the background work never
finished (crash, or a `runAfterResponse` promise still pending at deploy).

## Latency

Nothing timed a single send, a phase, or the gap between a child's tap and
the next question landing — a prior review round could only describe the
pacing as "slow from the driver's side", with no way to say where the time
actually went. Two events close that gap.

`video-quiz-sender.service.js` `sendPhase()` — the one place every quiz send
(question, interaction, answer) passes through — emits ONE event when the
phase ends:

```js
logEvent('video_quiz.phase_sent', {
  phase, sessionId, questionId, messages, sent, failed, pickerFailed,
  ms,            // wall time for the whole phase, including inter-message gaps
  msSending,     // ms actually spent inside the WhatsApp calls (gaps + throttle excluded)
  msThrottled,   // ms spent waiting on the per-recipient send throttle
  msGaps,        // ms spent in the deliberate pacing sleeps between messages
  kinds,         // e.g. ['text', 'buttons'] — WHAT was sent, in order
});
```

`ms` decomposes: `msSending + msThrottled + msGaps` ≈ `ms`. That
decomposition is the whole point — it says whether a slow phase is WhatsApp
itself, our own proactive rate-limit throttle, or our own deliberate pacing.

`video-quiz.service.js` `handleAnswer()` — the child's tap — emits ONE event
per answer:

```js
logEvent('video_quiz.answer_latency', {
  sessionId, questionId, isCorrect,
  msToFeedback,      // tap received -> the verdict phase finished sending
  msToNextQuestion,  // tap received -> the next question (or the finish) landed
  msPause,           // the fixed pacing pause between the verdict and the next question
  media,             // 'card' | 'image' | 'none' — what the question showed
  finished,          // true when this tap ended the quiz
});
```

A tap that hits the answers-table unique-constraint race (a double tap, or a
resumed session after a process restart) delivers no verdict, so it emits no
`answer_latency` — one would misrepresent a re-tap as a normal graded answer.

**`finished: true` rows are not comparable to the rest.** On the last tap
there is no next question: `sendNextQuestion` goes to the finish instead, and
`msToNextQuestion` therefore contains the whole completion chain — the
scorecard image render and send, the early class report, the follow-on offers.
Filter them out of any "how fast is the next question" figure, which is what
query (c) does.

### (c) p50/p95 of msToNextQuestion, by media

```apl
['<dataset>']
| where service == "bot" and region == "niete"
| extend d = parse_json(data_json)
| where tostring(d.event) == 'video_quiz.answer_latency'
| where tobool(d.finished) == false      // the last tap measures the finish chain, not a next question
| summarize p50 = percentile(toreal(d.msToNextQuestion), 50),
            p95 = percentile(toreal(d.msToNextQuestion), 95),
            n = count()
  by media = tostring(d.media)
| order by media asc
```

---

## `transcript_quiz.offered`

Fires once per offer, at the end of `processOffer` (`transcript-quiz-offer.service.js`)
— after the digest has run and the yes/no buttons (with or without the intro
film) have been sent. `withVideo` and `shownCount` together answer "did the
film ride the first N offers": the film is gated by the teacher's showing
count against `TRANSCRIPT_QUIZ_INTRO_VIDEO_SHOWS` (default 2), not by whether
the teacher has ever been offered before.

| Field | Meaning |
|-------|---------|
| `coachingSessionId`, `quizId`, `userId` | The session, the `quizzes` row, the teacher |
| `subject`, `language`, `teacherLang` | The quiz's subject/language and the language the offer itself was written in |
| `withVideo` | The intro film was **actually sent** (`sendVideoWithButtons` returned truthy) — not merely configured or attempted |
| `shownCount` | The teacher's intro-video showing count **before** this offer (0 when no video was configured for this offer at all) |
| `sent` | Some offer (video or plain buttons) went out |
| `early` | The survey answer brought this offer forward rather than the delayed job firing |
