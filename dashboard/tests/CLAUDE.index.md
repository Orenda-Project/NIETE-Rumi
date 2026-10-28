# tests — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/tests -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__golden__/` | Byte-exact switch-OFF response goldens recorded on the base code before each switch → `__golden__/CLAUDE.md` |
| `fixtures/` | → (no door; 45 test files) |
| `insights/` | Tests for the nightly CoachIP insights job: signals, rollups, ranking, model stage, locks → `insights/CLAUDE.md` |
| `queue/` | Tests for the portal SQS queue service and worker (transcript and AMA jobs) → `queue/CLAUDE.md` |
| `support/` | Shared helper for the SA Urdu fit tests, not a test file itself → `support/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `adventure-tokens-equal.service.test.js` | Pins that the adventure look's token CSS inlined in first-touch pages equals the copy in adventure-look.js (TOKENS_CSS) |
| `ama-service.test.js` | Tests services/ama.service schema validation: column checks, blocking and retry against AMA schema hallucination |
| `attendance-detail.service.test.js` | bd-60123: tests attendance-detail.service for a principal: group-merged summary (summarizeGroups) and day-wise detail |
| `billing-service.test.js` | Tests services/billing.service API billing and usage checks for the observability portal |
| `byof-agent.test.js` | Tests services/byof-agent.service, the Claude integration behind The Forge (Build Your Own Feature) |
| `byof-service.test.js` | Tests services/byof.service: byof_role validation, session CRUD, message storage, permission checks |
| `class-round-back-edge.service.test.js` | Tests GET /c/:token/back in web-quiz.routes: asks the bot where the phone goes back to and answers a 303 |
| `class-round-edge.service.test.js` | Tests the class round edge /r/:token/round in teacher-report.routes, forwarded to the bot's tr/round API |
| `class-round-endcard-page.service.test.js` | Tests the end card of a class-round turn on the Challenge page (wq-challenge.js, wq-trail.js in a vm) |
| `class-round-page-say.service.test.js` | Tests that a class-round turn on the Challenge page shows the exercise's round_say line (wq-challenge.js in a vm) |
| `closed-way-back-switch.service.test.js` | Tests lib/closed-way-back-switch: app_settings web_quiz_closed_way_back read fails closed; only JSON true is on |
| `code-chunker.test.js` | Code Chunker Service TDD Tests for AST-based code chunking Tests function extraction, metadata, and error handling |
| `cut-link-off-harness.js` | Harness that mounts portal-static-cache and edge-mounts with the cut-link switch off, to record or replay its golden |
| `cut-link-page.service.test.js` | Tests quiz_cut_link_page: a cut-short or junk link on door, join and teacher pages gets an explaining page when on |
| `edge-mounts-golden.service.test.js` | Pins that dashboard/routes/edge-mounts builds the golden stack (same layers, same order) and makes no network call |
| `edge-mounts-order.service.test.js` | Pins that every edge router in edge-mounts has a page here and forwarding order does not change any answer |
| `edge-relay-harness.js` | Harness driving every bot-relay router with a fake bot to capture response headers; used by edge-security-headers test |
| `edge-security-headers.service.test.js` | Tests quiz_edge_security_headers: every portal relay carries the bot's security headers on; byte-identical to golden off |
| `embedder.test.js` | Tests services/code-embedder.service: OpenAI embeddings for code chunks and queries, batching, caching, errors |
| `first-touch-edge.service.test.js` | Tests first-touch.routes edge (/m/:token, /f/:token, /api/ft/*): bot 404 off:true falls through, pages never stored |
| `github-api.test.js` | Tests services/github-api.service: file fetch, directory listing, tree retrieval and error handling |
| `gpt-cache.test.js` | Tests services/gpt-cache.service: Redis caching of GPT-4o-mini responses to cut repeat API calls |
| `health-db-writable.service.test.js` | bd-sex15q.19: tests dbWritable in routes/health, behind the /health db_writable field |
| `leader-assignment.service.test.js` | bd-88krt: tests leader-assignment.service, a coach editing a visit and owning a school list via a two-table write |
| `leader-observations-identity.service.test.js` | bd-2670/bd-2668: tests leader-observations.service names the observed teacher on Debrief and Completed lists |
| `leader-observations.service.test.js` | bd-2455: tests leader-observations.service: upcoming (overdue-flagged), pending-debrief and completed /observe items |
| `leader-overview.service.test.js` | bd-2434: tests summarizePatch in leader-overview.service: My Patch headline counts, average score and focus list |
| `leader-patch-observations.service.test.js` | bd-2671/bd-2672: tests getPatchTeachers counts observations and names school and focus area per teacher |
| `leader-patch-principal.service.test.js` | bd-60117: tests getPatchTeachers resolves a principal's patch from users.school_id, not leader_schools |
| `leader-patch.service.test.js` | bd-2434: tests getPatchTeachers in leader-patch.service: patch derived from leader_schools x users.school_id |
| `leader-role.middleware.test.js` | bd-2434: tests the leader role gate in middleware/leader-role and LEADER_ROLES behind the portal's leader nav |
| `leader-schedule-write.service.test.js` | bd-2676: tests createSchedule in leader-schedule-write.service: a coach schedules an observation visit from the portal |
| `leader-teacher-detail-principal.service.test.js` | bd-60117: tests getPatchTeacherDetail lets a principal open only teachers at their own school (membership SQL) |
| `leader-teacher-detail-terminal.service.test.js` | Tests leader teacher detail counts every terminal observation (observer_review_complete), matching the teacher list |
| `leader-teacher-detail.service.test.js` | bd-2434: tests getPatchTeacherDetail: leader may view only a teacher in their patch, else 404 (security-critical) |
| `login-intl-flag.service.test.js` | Tests the portal_login_intl_numbers flag in lib/feature-flags: reads its own app_settings key, off when the read fails |
| `materialized-views-partner.service.test.js` | Tests materialized-views.service partner scope filtering (all, country, school, phone_list, combined), bd-045 |
| `materialized-views.test.js` | Tests services/materialized-views.service: Postgres materialized views for dashboard speed and refresh |
| `mv-refresh-scheduler-once.service.test.js` | Tests the materialized-view refresh scheduler starts once per deployment under a lock, not once per cluster worker |
| `name-column-sweep.service.test.js` | bd-60105: sweep test that users.name is rendered once and safely after first_name/last_name were dropped |
| `niete-brand-obs.service.test.js` | bd-2458: file-level checks that the observability/admin dashboard carries NIETE brand colours, logo and strings |
| `password-reset-language.service.test.js` | bd-2469: tests sendResetCode in password-reset.service sends the OTP in the user's language (en or ur) |
| `portal-host.service.test.js` | bd-2467: tests isPortalHost (lib/portal-host, app-target.cjs): '/' on the portal hostname reaches the portal |
| `portal-teacher-push.service.test.js` | Tests portal-teacher-push.routes: 401 without a session, no bot call, a session lacking a portal user is no session |
| `push-remind-edge.service.test.js` | Tests the /remind/:code edge (push-remind.routes): bot switch off falls through; junk code or bot down falls through |
| `quiz-go-edge.service.test.js` | Tests the one-door edge /quiz/go/:token and /api/go/* (quiz-go.routes), forwarding path for path |
| `quiz-join-adventure.service.test.js` | Tests the join screen and its expired/failed note in the adventure look (quiz-join.routes, adventure-look) |
| `quiz-join-early-tap.service.test.js` | Tests quiz_join_early_tap: a grade tap made before join.js loads is kept; off matches the golden |
| `quiz-join-edge.service.test.js` | Tests GET /quiz/join/:token (quiz-join.routes): asks the bot only if switch on and token good, then draws the page |
| `quiz-join-one-face.service.test.js` | Tests web_quiz_one_face on the join page: Urdu uses wq-nastaliq-6 when on; off matches join-off-golden.json |
| `quiz-join-page.service.test.js` | Tests public/wq/join.js in a fake browser: same-name children offered, Let's go opens only for a named child |
| `quiz-join-wait-word.service.test.js` | Tests quiz_join_wait_word: the join go button says what it is doing while in flight; off matches the golden |
| `quiz-teacher-edge.service.test.js` | Tests the teacher home edge /quiz/teacher/:token and /api/th/* (quiz-teacher.routes): off falls through byte-identically |
| `quiz-teacher-mount.service.test.js` | Pins that the teacher-home edge is mounted live in dashboard/index.js ahead of static handlers and the SPA catch-all |
| `quiz-teacher-server-timing.service.test.js` | Tests quiz-teacher.routes passes the bot's Server-Timing header through on /api/th/home and /api/th/library only |
| `redis-cache.test.js` | Tests services/redis-cache.service: GitHub API cache hits, misses, TTL, fallback and invalidation |
| `sa-check-tap-early.service.test.js` | SA child test: a picture tapped early in the audio check passes or fails cleanly (sa-core, sa-ui) |
| `sa-check-words-clips.service.test.js` | Tests the audio check's words carry clips in the battery, engine and store (sa-core, sa-engine, sa-store) |
| `sa-clip-429.service.test.js` | SA offline: opening/transition lines prepared first; a 429 clip is retried once after a pause (sa-offline, sa-page) |
| `sa-coach-lastword-corner.service.test.js` | SA coach screen: the last-word view is scrolled to the words and heading in both languages |
| `sa-core.service.test.js` | Tests the SA runner sa-core: session gates, validate, intro-to-running path against the mini G3 Urdu battery |
| `sa-dev-jump.service.test.js` | Tests sandbox-only dev jump in sa-core: no jumpTo without dev_tools; skipped tasks are marked skipped_dev |
| `sa-dev-tools-gate.service.test.js` | Tests that sa-engine.routes loads sa-dev.js only on a sandbox config; a production config keeps dev tools closed |
| `sa-engine-back-offline.service.test.js` | Tests sa-engine's back-to-map step: online probes then goes; offline stays put and goes once when back online |
| `sa-engine-battery-end.service.test.js` | Tests sa-engine battery end: events acked then battery_end posted; offline send failure still posts it |
| `sa-engine-routes-cold-start.service.test.js` | Tests sa-engine.routes cold start: switches true in the store serve v2 keys and practice on the first request |
| `sa-engine-routes.service.test.js` | Tests sa-engine.routes: switch off falls through; on serves engine files by type and never outside the folder |
| `sa-engine.service.test.js` | Tests sa-engine: events and results saved in order, reload snapshot, resume at the task the tab died in |
| `sa-game-card.service.test.js` | Tests the big-flight result card in sa-game/game.js: each stone reads as the engine ended it |
| `sa-game-doors-row.service.test.js` | Tests the sa_game row on the games door (wq-doors.js gamesBody): absent when off, one section when on |
| `sa-game-edge.service.test.js` | Tests routes/sa-game.routes: sa_game switch off or junk token/chip falls through; on serves page and files |
| `sa-game-flight-copy.service.test.js` | Tests the big-flight copy in sa-game/game.js: first effort star wording and repeated-title handling |
| `sa-game-island-shape.service.test.js` | Tests the game page's island CSS rule: the sand fits inside the island and is never cut by the box edge |
| `sa-game-sink-client.service.test.js` | Tests sink-game.js wire calls (batch, presign, register, status) with run token and device ref header |
| `sa-game-skin.service.test.js` | Tests sa/skin-game.js (?skin=game): game sink only for a kept run token, Jugnu glow only while a timed task runs |
| `sa-game-ur-lines.service.test.js` | Reads sa-game/game.css: Urdu .sg-say, .sg-stone and .sg-why must set a line-height of at least 1.8 |
| `sa-image-unavailable.service.test.js` | Tests sa-core/sa-ui when a task picture fails: ends as assets_unavailable, keeps prior answers, no celebration |
| `sa-last-word-hint-relay.service.test.js` | Tests that the portal relays /sa/session/:id/last-word-hint with taskId behind saGates |
| `sa-mic.service.test.js` | Tests sa-mic: reads both mic writers, remembers the game check and its level |
| `sa-offline-images.service.test.js` | Tests sa-offline images(): every session picture once from site root; other language and unsafe paths left out |
| `sa-offline.service.test.js` | Tests sa-offline and sw.js: worker answers its own files only; session keeps its own language's lines |
| `sa-onecell-fit.service.test.js` | Tests that Urdu one-at-a-time letters/words of the W3 forms fit their cell (layout check over served batteries) |
| `sa-onecell-ink.service.test.js` | Tests ink fit of every distinct Urdu cell in the served forms, grids included |
| `sa-onecell-timeup.service.test.js` | Tests sa-core: a timed one-at-a-time task ends as time_up at the cell reached, not via the last-word screen |
| `sa-opening-gate.service.test.js` | Tests sa-offline prepareSession onLines: opening lines are reported once available before task clips (sa-page, sa-ui) |
| `sa-page.service.test.js` | Tests sa-page: strict link read, block ordering, drain of a finished child's data after the network returns |
| `sa-prepare.service.test.js` | Tests sa-offline prepare: clips on phone vs phone speech (tts) for a missing clip; persist granted kept |
| `sa-r4-cell-pace-cap.service.test.js` | Tests sa_cell_pace 10 s cap in sa-core: continuous voice moves on at 10 s; next cell gets its own 10 s |
| `sa-r4-cell-pace.service.test.js` | Tests sa_cell_pace in sa-core/sa-engine: silent child moves at 5 s, trying child waits 3 s after last voice |
| `sa-r4-coach-last-word.service.test.js` | Tests sa-core last-word marking: lastWord keeps how/suggested on the result; old call unchanged |
| `sa-r4-coach-tap-pending.service.test.js` | Tests sa-ui coach note while the last word is still being found in the recording |
| `sa-r4-comp-all-variants.service.test.js` | Tests sa_comp_all_questions over both languages, five grades and the rotated Urdu select2024 variant |
| `sa-r4-comp-all.service.test.js` | Tests sa_comp_all_questions in sa-core: 10 or more words read asks all six comprehension questions |
| `sa-r4-section-rec.service.test.js` | Tests sa-core rec_marks per question from a section recording start, with the switch on and off |
| `sa-r5-auto-child-last-word.service.test.js` | Tests ui.auto_child_last_word reaching the battery and engine: auto mode asks the child to tap the last word |
| `sa-r5-cell-next-only.service.test.js` | Tests sa_cell_next_only: a letter or word never advances by itself, only Next; the task clock still runs |
| `sa-r6-manual-app-asks.service.test.js` | Tests ui.app_asks reaching the battery: question screen folding, mental sum stays on its replay tile |
| `sa-r7-auto-no-last-word.service.test.js` | Tests sa-core skip_last_word: time up ends as time_up with last_word_skipped; off keeps old skip behaviour |
| `sa-r7-child-name.service.test.js` | Tests sa-ui child name in the instruction (Urdu and English pages) |
| `sa-r7-maths-latin-digits.service.test.js` | Tests sa-ui maths practice feedback in Latin digits while Jugnu still says the Urdu line |
| `sa-r7-practice-like-items.service.test.js` | Tests sa-core/sa-ui practice screens that mirror the task's items (taskOf, tap practice) |
| `sa-r7a-child-screens.service.test.js` | Tests sa-core child screens (Back on cells and tap items) with sa-battery-switches and r7a content |
| `sa-r7b-coach-stops.service.test.js` | Tests sa_end_section (RDF manual) in sa-core: coach ends a section and the test continues at the next |
| `sa-r7b-cwpm-switch.service.test.js` | Tests the sa_cwpm switch read in portal-child-test.routes: true or a list naming the coach, else off |
| `sa-r7b-engine.service.test.js` | Tests sa-engine end_test (ui.end_test_restart): coach-ended test event and restart, off emits none |
| `sa-r7b-incomplete-move-on.service.test.js` | Tests sa_incomplete_move_on in sa-core: an unfinished part skips the rest of its subject, English then starts |
| `sa-r7b-rec-discard.service.test.js` | Tests sa-rec discard: no marker or chunks left, next recording of the task starts clean |
| `sa-r7b-silence-fit.service.test.js` | Tests Urdu silence-reminder text size/line height fit on small phones |
| `sa-r7b-silence-line.service.test.js` | Tests that the silence_repeat line has a clip in v1 and v2 batteries only when the switch is on (sa-battery-switches) |
| `sa-r7b-switches.service.test.js` | Tests round 7b battery switches (sa-battery-switches, engine routes): ON puts battery.ui flags; all OFF changes nothing |
| `sa-r7b-ui-silence.service.test.js` | Tests sa-ui silence reminder: shown and said in EN and UR; Try again reruns the part |
| `sa-r8-counts.service.test.js` | Tests sa_r8_counts: five familiar-word practice items when on, four when off (sa-battery-switches) |
| `sa-r8-cues.service.test.js` | Tests sa-ui round-8 cues: answer cue with mic level (r8_nudges); lit instruction word kept in sight (r8_highlight) |
| `sa-r8-endcard.service.test.js` | Tests the round 8 end card fit and language line under the layout and language switches |
| `sa-r8-flow-comp.service.test.js` | Tests r8_comp_wait_next: story and listening questions wait for Next instead of timing out after 10 s |
| `sa-r8-flow-practice.service.test.js` | Tests r8_practice_autoplay: each practice says its answer on arrival; Next moves on without repeating it |
| `sa-r8-flow-reading.service.test.js` | Tests r8_reading_no_done: entering the passage skips the Done line before the recorder opens |
| `sa-r8-lang.service.test.js` | Tests sa_r8_lang: langAltLoad hands the other-language battery to the screens; toggle only when it is on the phone |
| `sa-r8-layout-fit.service.test.js` | Tests round 8 CSS fit of story parts in boxes of different heights (sa.css, sa-ui) |
| `sa-r8-layout.service.test.js` | Tests r8_layout: .is-r8-layout on the mount and ink fit for Latin cards; off adds nothing (sa.css, sa-ui) |
| `sa-r8-maths.service.test.js` | Tests round 8 maths screens showing every number in 0-9 digits (sa-core, sa-ui) |
| `sa-r8-mn-fit.service.test.js` | Tests round 8 multiple-choice screens tightening until every choice ends above the foot (sa-ui) |
| `sa-r8-offline-hunks.service.test.js` | Tests sa-voice speak.audio() and offline voice watching in sa-engine/sa-offline |
| `sa-r8-offline-prep.service.test.js` | Tests sw.js and sa-offline prepare: fresh network read with byte counts; keeps phone copy when network fails |
| `sa-r8-offline-register.service.test.js` | Tests sa-offline checkVisit offline with the worker installed: register rejection does not break the page |
| `sa-r8-offline-switches.service.test.js` | Tests the three offline switches in portal-child-test.routes: true or list naming the coach, else off |
| `sa-r8-passage-variant.service.test.js` | Tests sa-core/sa-page recording of the rotated passage variant shown (index) versus null |
| `sa-r8-position.service.test.js` | Tests r8_reading_position: story questions follow voiced seconds (under 0.9 s skipped_no_voice) |
| `sa-r8-say-next-q.service.test.js` | Tests r7_say_next_q: with say-then-next and r8 comp-wait-next ON, question hints name Next (sa-r7a-content) |
| `sa-r8-story-snap.service.test.js` | Tests r8_story_snap in sa.css/sa-ui: story as a snap box of screenful parts, off keeps the 70% slide |
| `sa-r8-switch-hold.service.test.js` | Tests sa_r8_switch_hold: failed switch reads answer OFF without a header; ON keeps variants and v4 voice |
| `sa-r8-switches.service.test.js` | Tests round 8 battery switches in sa-battery-switches and engine routes: ON sets battery.ui flags |
| `sa-r8-timeup-continue.service.test.js` | Tests r8_timeup_continue in sa-core: time up on a cell continues to the next part of the same language |
| `sa-rdf-w3-forms.service.test.js` | Tests RDF auto/manual W3 forms on the battery route: off gives no W3 list; on gives 17 W3 tasks and coach line |
| `sa-rec-mercy.service.test.js` | Tests sa-rec silent-mic mercy at 12 s and early_stop_silence at 20 s; a voice at 8 s triggers neither |
| `sa-rec.service.test.js` | Tests sa-rec: recorder type choice, chunk collection, stop closes the file with duration |
| `sa-sink-coach.service.test.js` | Tests sink-coach.js: batch, presign, register go to the relay with cookie; signed-out coach throws so sync retries |
| `sa-store.service.test.js` | Tests sa-store: events/results/chunks pending until synced, IndexedDB failure falls back to memory |
| `sa-sw-session.service.test.js` | Tests the sw.js session cache version (sa-session-v6) and that activate deletes older caches |
| `sa-switch.service.test.js` | Tests sa-switch flapping-reader hold: both SA routers (sa-engine, sa-game) do not flap on a failed read |
| `sa-sync-events-first.service.test.js` | Tests sa-sync ordering: battery_end events acked before a second recording is presigned |
| `sa-sync-skip.service.test.js` | Tests sa-sync skip: blob deleted with not_kept; a sink error keeps audio for retry |
| `sa-sync.service.test.js` | Tests sa-sync: offline keeps everything, online sends once, refused batch retried after a doubling wait |
| `sa-tester-fixes.service.test.js` | Tests sa_practice_all_maths and tester fix switches at /sa/batteries/ (sa-battery-switches, engine routes) |
| `sa-two-recordings.service.test.js` | Tests a session with two record tasks yields two recordings closed, presigned and registered |
| `sa-ui-back-wait.service.test.js` | Tests sa-ui end screen's wait line, spoken once, in EN and UR |
| `sa-ui-copy-lines.service.test.js` | Tests sa-ui copy lines: practice right/retry/answer, bubbles title, last-word question, all-done, waiting for map |
| `sa-ui-dev-jump-row.service.test.js` | Tests the Jump row CSS/markup in sa-ui for sandbox dev jump (dots shrink, row is full width) |
| `sa-ui-dev-jump.service.test.js` | Tests sa-ui proctored devJump task list, with Urdu label and page-language titles |
| `sa-ui-handback.service.test.js` | Tests sa-ui/sa-engine hand-back: onUnlock stops navigation; otherwise navigates once after writes and sync |
| `sa-ui-lang-distinct.service.test.js` | Lint over served forms: no Urdu letter in an English task and no Latin one in an Urdu task |
| `sa-ui-mic-skip.service.test.js` | Tests sa-ui mic-skip line: shown and said once in EN, Urdu in UR |
| `sa-ui-rec-chip.service.test.js` | Tests recChip in sa/sa-ui: a task's own chip (mental sums 'Say the answer') wins, else the page's 'Read aloud' (W3-12) |
| `sa-ui-screens.service.test.js` | Tests sa-ui game mic check and keypad warm-up screens (way past the check, keys pressed) |
| `sa-ui-tester-fixes.service.test.js` | Tests sa-ui tap screens for number-sequence blanks (A10) shown as a bordered gap tile |
| `sa-ur-fit-portal-switch.service.test.js` | Tests the sa_ur_fit switch in the portal's switches object: on gives urFit true, no row gives false |
| `sa-ur-passage-pitch.service.test.js` | Tests Urdu W3 passage line pitch over every served variant; English keeps 1.6 at 390x844 |
| `sa-ur-screens-fit.service.test.js` | Tests ui.ur_fit reaching the battery and engine, and Urdu screens fitting a real browser viewport |
| `sa-ur-tile-fit.service.test.js` | Tests that Urdu word tiles in coach forms fit their boxes; English tiles keep today's look |
| `sa-ur-tile-ink.service.test.js` | Tests ink fit of Urdu tap-task tiles across every served Urdu form |
| `sa-ur-word-tile-ink.service.test.js` | Tests ink fit of Urdu last-word passages (all variants) and grids across served forms |
| `sa-voice-gate.service.test.js` | Tests sa-voice clip fetch gate: six at a time, a 429 clip retried after a pause, twice refused is missing |
| `sa-voice-tabswitch.service.test.js` | Tests sa-voice when the page is hidden and shown: pause waits, resume continues, a stuck pause ends the line in 10 s |
| `sa-voice-tashdeed.service.test.js` | Tests the sa_voice_tashdeed switch and that tashdeed takes exist on disk |
| `sa-voice-v2-copy.service.test.js` | Tests that every sa-ui copyLine text has a v2 clip with sound in both languages |
| `sa-voice-v2.service.test.js` | Tests the sa_voice_v2 switch: off serves every battery byte for byte as before; on serves practice_v2 and variants |
| `sa-voice-v4-timings.service.test.js` | Tests that every spoken v4 line has a read-along timing file with words as printed and ordered times |
| `sa-voice-v4.service.test.js` | Tests the sa_voice_v4 switch: off serves as sa_voice_v2/tashdeed does; on serves the v4 voice set |
| `sa-voice.service.test.js` | Tests sa-voice speak(): the clip is tried twice, then the phone's own voice, else silent with words on screen |
| `sa-w3-core.service.test.js` | Tests sa_one_at_a_time in sa-core: first cell shown, nextCell advances, task clock runs across cells |
| `sa-w3-manual-mute.service.test.js` | Tests RDF manual mode: spoken questions have no answer clock; child screens mute per round 7 rules (sa-core, sa-ui) |
| `sa-w3-manual-opening.service.test.js` | Tests sa.css passage box and Jump row; manual mode keeps warm-up and hand-back lines silent except the coach line |
| `sa-w3-ui.service.test.js` | Tests passageWords for W3 coach forms: printed passage words line up with items, else null |
| `school-analytics.service.test.js` | bd-60117: tests summarizeSchoolAnalytics in school-analytics.service: a principal's school-level analytics |
| `setup.js` | Jest setup for dashboard tests (jest config): configures the test environment before each suite |
| `steps-presence.service.test.js` | bd-60118: tests summarizePresence in steps-presence.service: STEPS P with teacher and student attendance kept separate |
| `steps-remarks.service.test.js` | bd-60118: tests summarizeRemarks in steps-remarks.service: STEPS S supervisor remarks, five indicators scored 1-4 |
| `teacher-class-week-edge.service.test.js` | Tests /r/:token/wfwd in teacher-report.routes: the class-week card forward reaches the bot, 302 to wa.me passes through |
| `teacher-jugnu-edge.service.test.js` | Tests teacher-report.routes ?tab=jugnu forwarding (web_quiz_teacher_jugnu): reaches the bot; behaviour off is unchanged |
| `teacher-report-timing-edge.service.test.js` | Tests GET /r/:token (teacher-report.routes) passes the bot's x-render-ms and x-queue-age as timing headers |
| `teacher-stories-bot-gate.service.test.js` | Tests quiz_teacher_stories_bot_gate on the stories edge: on forwards always and the bot's answer is the gate |
| `teacher-stories-edge.service.test.js` | Tests teacher-stories.routes: story list, share and the stories page forwarded to the bot with link preview |
| `transcript-ux-helpers.test.js` | Tests services/transcript-ux-helpers: SLO Mastery and Classroom Climate raw data into friendly status indicators |
| `vector-db.test.js` | Tests services/vector-db.service: vector upsert, semantic search, filtering and retrieval |
| `video-observability-nav.test.js` | Standalone script test (run with node) of the video observability nav entry; no jest describe blocks |
| `video-observability-routes.test.js` | Standalone script test (run with node) of the Video Gallery route handler |
| `video-observability-service.test.js` | Tests services/video-observability.service for the Video Gallery feature (run first, standalone node script) |
| `video-observability-view.test.js` | Standalone script test (run with node) of the Video Gallery EJS template |
| `web-quiz-adventure-kit-late.service.test.js` | Tests the adventure kit (public/wq/wq-adv.js) when it runs after the page is parsed and the Home is already drawn |
| `web-quiz-adventure-kit.service.test.js` | Tests the adventure kit wq-adv.js (window.WQA) in a vm with the browser faked: icons and shared screen parts |
| `web-quiz-adventure-look.service.test.js` | Tests web_quiz_adventure_look: every child page gets one html class plus the look's CSS and kit; off matches the golden |
| `web-quiz-adventure-more.service.test.js` | Tests wq-adv-more.js (window.WQAD), the look's second part that the kit requests once the look is on |
| `web-quiz-all-grades-doors.service.test.js` | bd-5gyspy.5: tests wq-doors.js door screens so no grade forbids a game or video; games show every grade |
| `web-quiz-art-edge.service.test.js` | Tests the share picture path in web-quiz.routes: the page head names the og:image it advertises |
| `web-quiz-asset-version.service.test.js` | Tests the ?v= asset version in web-quiz.routes: any file a page loads changes the hash |
| `web-quiz-bind-card.service.test.js` | Tests the Keep my place card in public/wq/wq-bind.js in a vm with a fake DOM, bot API and storage |
| `web-quiz-bind-sheet-fold.service.test.js` | Tests the Keep my place sheet (wq-bind.js) on a small phone: both answers come before the notice |
| `web-quiz-bind-sheet.service.test.js` | Tests the Keep my place confirm sheet in public/wq/wq-bind.js, run whole in a vm with a fake DOM |
| `web-quiz-bind-stop-line.service.test.js` | Tests the English STOP line in wq-bind.js names what STOP removes (this phone number), like the Urdu line |
| `web-quiz-bind-way-back.service.test.js` | Tests web_quiz_bind_way_back in wq-bind.js: every outcome of Keep my place has a way back, no dead card |
| `web-quiz-book-hub-golden.html` | Golden hub page HTML with Jugnu's Book off; compared by the Book-page and doors-v3 tests |
| `web-quiz-book-next-lamp.service.test.js` | Tests wq-book.js: Jugnu's Book dashed next lamp carries its name, in EN and UR |
| `web-quiz-book-page.service.test.js` | Tests Jugnu's Book: hub page tags unchanged with the Book off, /api/wq/book/h/:token route and wq-book.js in a vm |
| `web-quiz-book-stories.service.test.js` | Tests wq-book.js draws a storybook sticker per finished book when the Book JSON has book_stickers |
| `web-quiz-bot-call-log.service.test.js` | Tests web-quiz.routes logs one line for every portal-to-bot call that fails or is slow |
| `web-quiz-bubble-balance.service.test.js` | Tests Jugnu's bubbles under the look wrap in balanced lines so none ends on one lone word (EN, UR) |
| `web-quiz-busy-page.harness.js` | Harness for the busy-page test: one fresh portal per case with a scripted fake bot fetch (web-quiz.routes) |
| `web-quiz-busy-page.service.test.js` | Tests web_quiz_busy_page: an unreachable, slow or 5xx bot gives the portal's busy page; off matches the golden |
| `web-quiz-busy-retry.service.test.js` | Tests web_quiz_busy_retry: the busy page asks again by itself; off is today's busy page |
| `web-quiz-canonical-host.service.test.js` | Tests web-quiz.routes: a child page asked on a non-canonical host answers 301 to the same path on the canonical host |
| `web-quiz-card-batch-ids.service.test.js` | Tests Jugnu card event batches on the scorecard (wq-card.js, wq.js, wq-tel.js); off sends today's bodies |
| `web-quiz-card-batch-session.service.test.js` | Tests the quiz page's event batch with Jugnu card events on and page-session telemetry off |
| `web-quiz-card-fast.service.test.js` | Tests web_quiz_card_fast: the shared link's page is served from Redis facts in ms on any portal copy (web-quiz.routes) |
| `web-quiz-card-fold-g1.service.test.js` | Tests the Grade 1 'how many dots?' end with the child home on: one next thing, Pick a story |
| `web-quiz-card-fold-page.service.test.js` | Tests card_fold after a quiz with web_quiz_home_v3 on: the card and one next thing; off matches the golden |
| `web-quiz-card-fold-trail.service.test.js` | Tests Trail end cards with the child home on: a read, listen or numbers game ends on the card and one next thing |
| `web-quiz-card-ready.service.test.js` | Tests web_quiz_card_ready: the card picture and facts stored at mint are served by the cold public edge |
| `web-quiz-card-tap-shown.service.test.js` | Tests wq-card.js: a tap on the Jugnu card before the observer fires still sends door_shown first |
| `web-quiz-card-view-once.service.test.js` | Tests card_view counts score cards once, not once per re-render after share, class table or league screens |
| `web-quiz-challenge-digits.service.test.js` | Tests ud() in wq-challenge.js: which digits the Challenge page writes in Urdu (Western or Urdu by polish) |
| `web-quiz-challenge-edge.service.test.js` | Tests /c/:token server-rendering the Challenge shell and forwarding /api/wq/ch/* to the bot's internal API |
| `web-quiz-challenge-fold.service.test.js` | Tests web_quiz_challenge_fold: a friend's challenge door with its picture puts Play right below it |
| `web-quiz-challenge-guard.service.test.js` | Tests the read guard on the Challenge read screen: local mic check, no Done during the minute |
| `web-quiz-challenge-line-keep.service.test.js` | Tests web_quiz_challenge_line_keep: a number keeps its word on one line in the challenge line and share text |
| `web-quiz-challenge-line-sent.service.test.js` | Tests web_quiz_challenge_line_sent: the challenge line breaks between its sentences on a friend's door |
| `web-quiz-challenge-listen-adv.service.test.js` | Tests Listen and answer under the adventure look: Jugnu listening and a ring filling with the playback |
| `web-quiz-challenge-listen-options.service.test.js` | Tests wq-challenge.js: with option_clips each option gets its own play button beside it |
| `web-quiz-challenge-listen.service.test.js` | Tests Listen and answer in wq-challenge.js: mascot line, Listen button, story played twice from its clip |
| `web-quiz-challenge-live.service.test.js` | Tests live Read aloud (wq-read-live.js, wq-challenge.js): words light as read, a pace bar moves, aligner scores |
| `web-quiz-challenge-outcome.service.test.js` | Web quiz page: a friend's challenge has an outcome on both sides, and the challenge link carries no child's name. |
| `web-quiz-challenge-page.service.test.js` | Tests wq-challenge.js run whole in a vm with a fake DOM, fetch and media; only browser and network are faked |
| `web-quiz-challenge-pick.service.test.js` | Tests /c/<hub token>?kid= with no tap: the bot's 400 pick_kid becomes a note; untouched paths match the golden |
| `web-quiz-challenge-questions.service.test.js` | Tests wq-challenge.js: after a praised reading a button opens up to 3 tap questions, each asked of the server |
| `web-quiz-challenge-result-502.service.test.js` | Tests POST /api/wq/ch/result answering 502 bot_unreachable and the Challenge page's reading result then |
| `web-quiz-challenge-trail.service.test.js` | Tests the trail map and Missing number in wq-challenge.js (menu trail:true); without it the page is unchanged |
| `web-quiz-child-screen-lint.service.test.js` | Lints every child-facing Trail v2 screen in en and ur against copy.v2.json and item-bank |
| `web-quiz-child-teacher-word.service.test.js` | Lint: every child screen uses the Urdu word ٹیچر for the teacher, never the masculine-reading استاد |
| `web-quiz-child-welcome-cue.service.test.js` | Tests child welcome step 5: w=1 asks the page for wq-cue.js and wq-tel.js (web_quiz_child_welcome) |
| `web-quiz-child-welcome-layout.service.test.js` | Tests the child welcome over a scrolling Home: the Home starts from its top (design-qa WF-1, WF-2) |
| `web-quiz-child-welcome.service.test.js` | Tests wq-welcome.js, the Jugnu says hello first open on the v3 Home (web_quiz_child_welcome); off is golden |
| `web-quiz-class-doors.service.test.js` | Tests web_quiz_class_doors: class table and school league return on the folded card with the child home on |
| `web-quiz-class-link-chips.service.test.js` | Tests /j/<code> class-link teacher chips (public/wq/class-link.js): two teachers with a long shared prefix stay distinct |
| `web-quiz-class-link-edge.service.test.js` | Tests the standing class link edge in web-quiz.routes and teacher-report.routes: GET /j/:code, preview, hub fallback |
| `web-quiz-class-pic-edge-rollback.service.test.js` | Tests how long the edge keeps naming and serving a class picture after its switch goes ON then OFF |
| `web-quiz-class-pic-edge.service.test.js` | Tests what a forwarded /q/<CODE> names as og:image: the class picture when the bot has one, else unchanged |
| `web-quiz-class-table-look.service.test.js` | Tests the class table under the adventure look with class_doors: the First names only note has its own row |
| `web-quiz-closed-inline.service.test.js` | Tests web_quiz_closed_inline: an expired or closed hop after the fast first page head is drawn inline when on |
| `web-quiz-closed-lang.service.test.js` | Tests web_quiz_closed_lang: closed and not-open child pages in the child's language; off matches the golden |
| `web-quiz-code-trim.service.test.js` | Tests web_quiz_code_trim: a pasted class code with a space, full stop or language word still resolves when on |
| `web-quiz-contrast.service.test.js` | Tests that web quiz page colour tokens reach WCAG AA 4.5:1 contrast in every brand (wq.css) |
| `web-quiz-deck-v23-lift.service.test.js` | Tests deck v2.3 child-page strings are byte-equal to their keys in bot/shared/config/copy.v2.json (en, ur) |
| `web-quiz-door-class-label-ur.service.test.js` | Tests an English quiz door opened with ?lang=ur names the class in Urdu in the from-teacher line |
| `web-quiz-door-latin-title.service.test.js` | Tests the adventure look on an Urdu quiz door sets an English quiz title left to right in the Latin face |
| `web-quiz-doors-prefetch.service.test.js` | Tests web_quiz_doors_prefetch: the Videos door's lists are asked early via the boot's wait_pre |
| `web-quiz-doors-v3.service.test.js` | Tests wq-doors.js, the v3 home's three door screens, rendered from 0, 1 or many rows beside wq-home.js |
| `web-quiz-early-unlock.service.test.js` | Tests web_quiz_early_unlock: a new phone's first Home asks for itself from the page head; off matches the golden |
| `web-quiz-edge-lazy-ratelimit.service.test.js` | Tests the web-quiz edge module loads when express-rate-limit is missing, as in the root CI run |
| `web-quiz-edge-learn.service.test.js` | Tests web_quiz_edge_learn: a fresh portal process learns page switches from the bot's answers |
| `web-quiz-edge-warm.service.test.js` | Tests web_quiz_edge_warm: the portal retries a failed child page once, learned through the one learner's answer |
| `web-quiz-edge.service.test.js` | Tests web-quiz.routes: /q/:code server-side render and /api/wq/* forwarding to the bot's internal API |
| `web-quiz-end-copy-fix.service.test.js` | Tests web_quiz_end_copy_fix: the end screen's words change only when the bot sends end_copy: true |
| `web-quiz-end-fit.service.test.js` | Tests web_quiz_end_fit: the class-quiz end screen fits its score when the answer carries end_fit |
| `web-quiz-end-once.service.test.js` | Tests web_quiz_end_once: Jugnu's bubble on the quiz end screen never repeats the card's own heading |
| `web-quiz-end-polish.service.test.js` | Tests web_quiz_end_polish: the end screen polish applies only when the bot sends end_polish: true |
| `web-quiz-end-short-prac.service.test.js` | Tests web_quiz_end_short on the Urdu end screen of a replayed quiz fitting a short phone |
| `web-quiz-end-short.service.test.js` | Tests web_quiz_end_short: the class-quiz end screen fits a short phone when the answer carries end_short |
| `web-quiz-face-lite-learn.service.test.js` | Tests web_quiz_face_lite reaching an Urdu child's Home with the streamed first page and edge learning on |
| `web-quiz-face-lite-storybooks.service.test.js` | Tests the light Urdu face wq-nastaliq-7 has every glyph a storybook shows (face-lite-child-codepoints.json) |
| `web-quiz-face-lite.service.test.js` | Tests web_quiz_face_lite: polished-look Urdu pages draw with wq-nastaliq-7 when the bot says ui fl true |
| `web-quiz-fast-compress.service.test.js` | Tests the streamed /q/:code and /h/:token fast first pages are compressed to save data (web_quiz_fast) |
| `web-quiz-fast-flush.service.test.js` | Tests the fast first page at the edge flushes its head early when the bot's payload says fast: true |
| `web-quiz-figure-box.service.test.js` | Tests wq.css under html.wq-1b: a question picture keeps its box while it loads |
| `web-quiz-finish-card-edge.service.test.js` | Tests web_quiz_card_v3 at the edge: the card picture /wq/card/<t>.png is kept so a share preview finds it |
| `web-quiz-finish-card-page.service.test.js` | Tests wq-finish-card.js (window.WQFC): the finish card drawn on the child's pages |
| `web-quiz-friend-class.service.test.js` | Tests that a friend who played a challenge is not shown in the challenger's class |
| `web-quiz-g1-page.service.test.js` | Tests wq-g1.js, the Grade 1 how many dots? stop on the Challenge page; off matches web-quiz-g1-off.golden.json |
| `web-quiz-grade-change-golden.json` | Golden: grade-change prompts (plain, switch-teacher, forget-phone) en/ur; loaded by web-quiz-grade-change test |
| `web-quiz-grade-change.service.test.js` | Tests web_quiz_grade_change: a grown-up changes the child's grade for good; off matches the golden |
| `web-quiz-greeting-second-try.service.test.js` | Tests two fixes under the one-button look (html.wq-1b, web_quiz_one_button): the greeting and the second try |
| `web-quiz-handset-page.service.test.js` | Tests wq.js boot with a one-shot handset link /q/<code>#x=<token> sent from a bot button |
| `web-quiz-head-full.service.test.js` | Tests web_quiz_head_full: a head the edge guesses never says less than the page's real head |
| `web-quiz-head-guess-honest.service.test.js` | Tests web_quiz_head_guess_honest: the guessed head is honest about being a guess, read only with head_full on |
| `web-quiz-head-guess-words.service.test.js` | Tests the honest guessed head's words live in the string catalog, not in a language branch |
| `web-quiz-hint.service.test.js` | Tests wq.js question(): Jugnu helps with the question the child has in mind |
| `web-quiz-home-door-hash.service.test.js` | Tests the v3 child home opens the door named in the link hash (#stories, #games) on every way into the hub page |
| `web-quiz-home-fallback.service.test.js` | Tests web_quiz_home_fallback_v3: the v3 Home shows a fallback when its script does not arrive (hub JSON home_fb) |
| `web-quiz-home-friends.service.test.js` | Tests web_quiz_share_joined: a friend joined Jugnu from your card notice on the sharer's home |
| `web-quiz-home-inline-every-open.service.test.js` | Tests web_quiz_home_inline: the Home's first open arrives in one response for every new phone |
| `web-quiz-home-inline-new-phone.service.test.js` | Tests a new phone's first Home carries wq-home.css and wq-home.js inline on every open |
| `web-quiz-home-inline-saved-phone.service.test.js` | Tests web_quiz_home_inline_every: the inline Home on every open of a saved phone; off is today's page |
| `web-quiz-home-inline.service.test.js` | Tests web_quiz_home_inline: the child Home's first open in one response; off matches home-inline-off-golden.json |
| `web-quiz-home-install.service.test.js` | Tests web_quiz_install_prompt: the add-to-home-screen card on the child Home (hub play.install), default off |
| `web-quiz-home-next-thumb.service.test.js` | Tests Home's Next tile under html.wq-adv uses a wide 16:9 thumbnail for a video |
| `web-quiz-home-preload.service.test.js` | Tests web_quiz_home_preload: the Home starts its scripts and styles while the server answers; off matches golden |
| `web-quiz-home-remember-golden.json` | Golden: remembered-child home pages (en/ur, with door stories); loaded by home-remember and home-friends tests |
| `web-quiz-home-remember.service.test.js` | Tests the first Home after a child joins on their own (boot remember, sent by the bot once; web_quiz_home_v3) |
| `web-quiz-home-v3.service.test.js` | Tests the v3 child home: edge tags, hub.js's one mount line and wq-home.js run in a vm |
| `web-quiz-hub-again.service.test.js` | Tests wq.js boot: Play again on the kid hub opens /q/<code>?again=1&k=<chip> |
| `web-quiz-hub-batch-ids.service.test.js` | Tests the hub page's event batches (public/wq/hub.js with wq-tel.js) in a vm with a fake DOM |
| `web-quiz-hub-book-once.service.test.js` | Tests Jugnu's Book tile appears on a child's first hub open only (hub.js, hub-play.js, wq-book.js) |
| `web-quiz-hub-device-cookie.service.test.js` | Tests hub.js against the wq_dv device cookie the server may already have given the phone |
| `web-quiz-hub-door-page.service.test.js` | Tests the results card's door to the child's own hub (My quizzes, videos and challenges) |
| `web-quiz-hub-keep-after-jug.service.test.js` | Tests the hub's order when the last quiz is finished (play.first): the Jugnu card position; off matches golden |
| `web-quiz-hub-lang.service.test.js` | Tests WQT.withLang (wq-tel.js): quiz page and hub links carry lang=, and the edge forwards ?lang on /h/<token> |
| `web-quiz-hub-listen.service.test.js` | Tests the grown-up's preview on the hub page, /h/<token>#listen/<passage_id> in public/wq/hub.js |
| `web-quiz-hub-manifest-first-open.service.test.js` | Tests the hub's install manifest on a child's first open with a fresh profile and no cookies |
| `web-quiz-hub-page.service.test.js` | Tests GET /h/:token in web-quiz.routes: the kid hub page rendered server-side with the bot's hub JSON as boot JSON |
| `web-quiz-hub-play.service.test.js` | Tests the hub's Jugnu corner on the page (hub-play.js, hub.js) and on the edge; off matches hub-play-golden.json |
| `web-quiz-hub-script.service.test.js` | Tests public/wq/hub.js, the kid hub page script, run whole in a vm with a small fake DOM |
| `web-quiz-hub-story-link.service.test.js` | Tests hub.js shows a storybook link on the hub when the v3 home is off |
| `web-quiz-identity-page.service.test.js` | Tests the who is playing? v2 screen of wq.js (identity mode v2): name first |
| `web-quiz-invite-ask-page.service.test.js` | Tests web_quiz_invite_ask: the challenge is asked as Who can beat your 7/9? on the quiz page (boot invite_ask) |
| `web-quiz-invite-title.service.test.js` | The invite link's preview title (og:title): gender-neutral Urdu toward the friend, and no "beat 0/N". |
| `web-quiz-items.service.test.js` | Tests the item renderer WQI in public/wq/wq.js for every question type a child meets on the web quiz |
| `web-quiz-jugnu-card-page.service.test.js` | Tests the Jugnu card on the scorecard (wq-card.js, web_quiz_challenge_card); off matches jugnu-card-off-scorecard.json |
| `web-quiz-jugnu-versions.service.test.js` | Tests Jugnu pictures built by page scripts carry their version when the page names them |
| `web-quiz-juice-challenge.service.test.js` | Tests the sound and motion kit on the Challenge page's own answers, e.g. a Which is bigger? practice pick |
| `web-quiz-juice-edge.service.test.js` | Tests edge pages with web_quiz_juice (bot payload juice: true); off matches __golden__/juice-off-pages.json |
| `web-quiz-juice-kit.service.test.js` | Tests the sound and motion kit public/wq/wq-juice.js (window.WQJ) in a vm with the browser faked |
| `web-quiz-juice-page.service.test.js` | Tests wq.js with the juice kit: a right answer calls WQJ.correct and moves on by itself |
| `web-quiz-juice-trail.service.test.js` | Tests Trail v2 end cards with the juice kit: every end card plays its sound and motion |
| `web-quiz-keep-place.service.test.js` | Tests the hub page links wq-bind.js and wq-bind.css only when the bot's hub JSON carries bind |
| `web-quiz-kids.service.test.js` | Tests wq.js rememberKid: the names remembered on this phone |
| `web-quiz-label-budget.service.test.js` | Tests every button label fits one line at 360 px in English and Urdu (one button system) |
| `web-quiz-land-header.service.test.js` | Tests the adventure look on the quiz landing's header (boot adv, html.wq-adv, web_quiz_adventure_look) |
| `web-quiz-landing-face.service.test.js` | Tests lib/web-quiz-landing-face.js, the shared link landing's own small Urdu face |
| `web-quiz-late-clips.service.test.js` | Tests wq.js late clips: audio clips recorded while the child is already playing are picked up |
| `web-quiz-league-school-code.service.test.js` | Tests the school league under the look keeps a school name's sector code whole on one line |
| `web-quiz-lib-v3-posters.service.test.js` | Tests the video library's poster fallback under web_quiz_videos_v3 |
| `web-quiz-library-edge.service.test.js` | Tests the video library routes /api/wq/lib/* and /api/wq/videos/dl/* in web-quiz.routes and the library script |
| `web-quiz-link-home-page.service.test.js` | Tests an old finished class link reopened on the phone that finished it lands on the child's home (boot link_home) |
| `web-quiz-link-known-closed.service.test.js` | Tests a closed class link on a phone that holds a child (web_quiz_link_known_child) |
| `web-quiz-link-known-page.service.test.js` | Tests a class link opened on a phone that already holds a child (boot link_known, web_quiz_link_known_child) |
| `web-quiz-list-states.service.test.js` | Tests web_quiz_list_states: every child list has loading, empty and loaded states, never a wrong one; off matches golden |
| `web-quiz-live-meter.service.test.js` | Tests the live reading meter public/wq/wq-pace.js and the pace variant the bot names |
| `web-quiz-liveread-v3-off.service.test.js` | Tests live reading v3 off (no lr3) matches liveread-off-golden.json recorded from the base |
| `web-quiz-liveread-v3.service.test.js` | Tests live reading v3 in wq-liveread.js and the Challenge page when the read payload has lr3 |
| `web-quiz-look-latin-feedback.service.test.js` | Tests the adventure look on an Urdu child's page that plays an English feedback line in the Latin face |
| `web-quiz-look-latin-polish.service.test.js` | Tests the adventure look on Urdu screens that carry Latin text: polish keeps it in the right face |
| `web-quiz-look-polish.service.test.js` | Tests two small fixes to the one-button look (html.wq-1b, web_quiz_one_button) |
| `web-quiz-look-wait.service.test.js` | Tests the look's waits and one-next rule in CSS (wq-1b and wq-adv classes) |
| `web-quiz-mascot.service.test.js` | Tests wq.js mascot functions jug, jugImg, jugWake and jugStop for the animated Jugnu |
| `web-quiz-mic-notice.service.test.js` | Tests the microphone notice under live reading v3 in wq-liveread.js (web_quiz_live_read_v3) |
| `web-quiz-minify-loaders.service.test.js` | Tests web_quiz_minify: each script a page loads later rides on its loader's own ?v= |
| `web-quiz-minify-one-link.service.test.js` | Tests web_quiz_minify with the child home's early head (fast, home_pre, home_inline) |
| `web-quiz-minify.service.test.js` | Tests web_quiz_minify: the pages serve minified files when the bot's payload says min: true |
| `web-quiz-missing-asset.service.test.js` | Tests a missing /wq/ asset is a 404 not a 500 (express.static fallthrough in web-quiz.routes) |
| `web-quiz-next-turn.service.test.js` | Tests wq.js one phone, many children: what the page offers after a child finishes |
| `web-quiz-offline-guard.service.test.js` | Tests web_quiz_offline_guard: a tap while offline stays on the page (answers carry offline_guard) |
| `web-quiz-offline.service.test.js` | Tests wq.js results, finish and boot when a child finishes with no internet |
| `web-quiz-one-button-first-open.service.test.js` | Tests the one-button look on a home drawn from the page's own hub call (web_quiz_one_button) |
| `web-quiz-one-button.service.test.js` | Tests the one button system: web_quiz_one_button via the bot's one_button sets wq-1b on html and wq.css rules |
| `web-quiz-one-urdu-face.service.test.js` | Tests web_quiz_one_face: one Urdu face per page; off matches one-urdu-face-off-golden.json |
| `web-quiz-option-voices.service.test.js` | Tests wq.js WQI: each question option has its own recorded voice play button |
| `web-quiz-pack.service.test.js` | Tests the child home's scripts and styles served as one file each when the hub answer says pack; off matches golden |
| `web-quiz-page-badge.service.test.js` | Tests wq.js ani() and wq.css .wq-ani: the animal badge on the quiz page |
| `web-quiz-page-brand-copy.service.test.js` | Tests wq.js T table copy: the page wears the brand the deployment configures |
| `web-quiz-page-card.service.test.js` | Web quiz page: the scorecard header never shows a dangling separator ("NIETE ·"). |
| `web-quiz-page-error-source.service.test.js` | Tests wq.js error events name which handler caught them and where |
| `web-quiz-page-figure-theme.service.test.js` | Tests quiz figures follow the page brand in public/wq/wq.css |
| `web-quiz-page-home-back.service.test.js` | Tests the always-visible Home button (boot nav.home, web_quiz_home_button) and the step back on wq.js |
| `web-quiz-page-icons-digits.service.test.js` | Tests wq.js as a child sees it: icons, and every number on an Urdu screen in Urdu digits |
| `web-quiz-page-inapp.service.test.js` | Tests wq.js inside WhatsApp's in-app browser (Android WebView): no share sheet of its own |
| `web-quiz-page-lang.service.test.js` | Tests the quiz page in the child's language (web_quiz_page_lang) |
| `web-quiz-page-library-hub.service.test.js` | Tests wq-lib.js alone on /lib/<hub token>, the video library opened from the kid's hub |
| `web-quiz-page-library.service.test.js` | Tests wq-lib.js video library behind 'Watch another video': subjects with a grade strip, then chapters (vm) |
| `web-quiz-page-live.service.test.js` | Tests the landing's classmates are playing now line (live.now) and the card's other lines; card-other-lines.golden.json |
| `web-quiz-page-mascot-diet.service.test.js` | Tests wq.js mascot loops only where it matters (reduced animation) |
| `web-quiz-page-match-pictures.service.test.js` | Tests wq.js item markup: a match question's left tiles can be pictures |
| `web-quiz-page-more.service.test.js` | Tests wq.js Watch another video (M15): after a result a short video list leads into that video and its quiz |
| `web-quiz-page-picture-reason.service.test.js` | Tests wq.js feedback: a wrong pick on a picture question says why |
| `web-quiz-page-pictures.service.test.js` | Tests wq.js figures and picture options at 360 px with wq.css |
| `web-quiz-page-polish.service.test.js` | Tests wq.js after-quiz screens say what they show; the league row's stars are the score |
| `web-quiz-page-progress-copy.service.test.js` | Tests wq.js progress copy a child can misread, e.g. the resume button's Continue 2/5 |
| `web-quiz-page-proof-singular.service.test.js` | Tests the landing's N children played today line says 1 child when the count is one |
| `web-quiz-page-pulse.service.test.js` | Tests wq.js M17 peer pulse: a classmate's right answer shows as a pulse line while the child plays (page harness vm) |
| `web-quiz-page-schools.service.test.js` | Tests the school leaderboard (M16) in wq.js reached from the class table or today |
| `web-quiz-page-video-door.service.test.js` | Tests the lesson page (M5) for a child from the Videos door (?via=videos); page-video-golden.json |
| `web-quiz-page-video-golden.json` | Golden: quiz door page per language/cover/library/query combination with videos off; page-video-door test |
| `web-quiz-page-video.service.test.js` | Tests wq.js lesson video box (M5): a tap anywhere starts the video |
| `web-quiz-passage-pool-tokens.service.test.js` | Tests every passage in Jugnu's pool splits into words the live read can keep |
| `web-quiz-passage-read.service.test.js` | Tests Jugnu's story passage in Story Time (/c/<hub>?room=story&pid=<id>) |
| `web-quiz-picture-fallback.service.test.js` | Tests wq.js itemHtml when a picture cannot be drawn for one option |
| `web-quiz-plain-paint.service.test.js` | Tests web_quiz_plain_paint, a wordless first paint decided by the bot; off matches plain-paint-off-golden.json |
| `web-quiz-play-again-practice.service.test.js` | Tests wq.js results() on a round that does not count (finish counted:false): the Play again screen |
| `web-quiz-practice-best.service.test.js` | Web quiz page: a practice round that beats the child's best earlier score says "New best!". |
| `web-quiz-practice-card.service.test.js` | Tests the scorecard of a practice round in wq.js card() |
| `web-quiz-preview-urdu-digits.service.test.js` | Tests the Urdu link preview of /q/<CODE> (og:title, og:description) uses Urdu digits U+06F0-06F9 |
| `web-quiz-push-remind-slot.service.test.js` | Tests the results screen's remind me tomorrow slot (finish push_remind, web_quiz_push_remind) |
| `web-quiz-q-server-timing.service.test.js` | Tests GET /q/:code says where its wait went via Server-Timing, as the hub page does |
| `web-quiz-quiz-lang.service.test.js` | Tests the quiz page in a grown-up's chosen language (web_quiz_return_lang) |
| `web-quiz-ra-preload.service.test.js` | Tests the read-along preload (bot names ra_pre with web_quiz_ra_preload); off matches ra-preload golden HTML |
| `web-quiz-read-feedback.service.test.js` | Tests the reading moment (web_quiz_read_feedback, wq-moment.js); off matches the two read-feedback goldens |
| `web-quiz-read-result-coarse.service.test.js` | Tests screens drawn from a coarse words-attempted count equal those from the raw count (wq-challenge, wq-trail) |
| `web-quiz-read-title-weight.service.test.js` | Tests Trail v2 stop intro's passage title line weight (#wqc-ptitle); trail-intro-v2.golden.json |
| `web-quiz-readalong-story.service.test.js` | Tests word-by-word read-along in Story Time (wq-trail.js, wq-readalong.js) |
| `web-quiz-readalong.service.test.js` | Tests the read-along player public/wq/wq-readalong.js in a vm with a small fake DOM |
| `web-quiz-reader-labels.service.test.js` | Tests the storybook reader's icons say what they do under html.wq-1b (wq.css only) |
| `web-quiz-reader-playpause.service.test.js` | Tests the storybook reader's main button shows a play symbol beside Listen for pre-readers |
| `web-quiz-remembered.service.test.js` | Tests wq.js for a child remembered on this phone whom the server no longer recognises |
| `web-quiz-render-fixes.service.test.js` | Tests fixes the render matrix found in wq.js WQI and wq.css |
| `web-quiz-render-matrix.service.test.js` | Render matrix: every item type the engine emits renders (scripts/qa/render-matrix) through wq.js |
| `web-quiz-replay-icon.service.test.js` | Tests html.wq-adv draws replay and media signs on a chip as icons, never text glyphs |
| `web-quiz-rewatch-done.service.test.js` | Tests web_quiz_rewatch_done: a finished lesson's picture plays the lesson again |
| `web-quiz-rewatch-replay.service.test.js` | Tests a finished lesson opened with ?again=1, the rewatch path of web_quiz_rewatch_done |
| `web-quiz-rewatch.service.test.js` | Tests wq.js WQI: Watch the lesson again from a library question |
| `web-quiz-roll.service.test.js` | Tests wq.js who is playing? with a class list (M4, E3 startSession) |
| `web-quiz-server-timing.service.test.js` | Tests the bot's Server-Timing on its internal hub answer is passed on by the portal |
| `web-quiz-share-art-page.service.test.js` | Tests the page half of the share picture: the card link carries its picture id |
| `web-quiz-share-art-sheet.service.test.js` | Tests the class table and school league join the one share panel (web_quiz_share_v4) |
| `web-quiz-share-art.service.test.js` | Tests every shared link previews as its own picture (og:image) at the edge |
| `web-quiz-share-bidi.service.test.js` | Tests web_quiz_share_bidi: Urdu share words read right to left (bot share_bidi) |
| `web-quiz-share-copy-one.service.test.js` | Tests web_quiz_share_copy_one: the one-star share copy (bot copy_one: true) |
| `web-quiz-share-funnel-events.service.test.js` | Tests friend-invite funnel events: a share tap says which browser it was in and what the phone could share |
| `web-quiz-share-lang-score.service.test.js` | Tests the edge and page halves of two share fixes (language and score), each behind its own switch |
| `web-quiz-share-link-lang-preview.service.test.js` | Tests an Urdu child's card is shared with a link carrying lang=ur so the preview is Urdu |
| `web-quiz-share-name-bidi.service.test.js` | Tests web_quiz_share_name_bidi: the child's name in English share words is isolated (bot name_bidi) |
| `web-quiz-share-one-tap.service.test.js` | Tests the quiz card's Share to class group with the one share on (web_quiz_share_v4, finish share_v4) |
| `web-quiz-share-page-lang.service.test.js` | Tests share follow-ups on a page whose language differs from its lesson's (web_quiz_share_page_lang) |
| `web-quiz-share-preview-page.service.test.js` | Tests the page half of a fast link preview: share links fetched once with HEAD when the card opens |
| `web-quiz-share-preview.service.test.js` | Tests the shared link preview is built on the sender's phone in the WhatsApp composer |
| `web-quiz-share-sheet-preview.service.test.js` | Tests the one share panel (web_quiz_share_v4) shows what will be sent before sending |
| `web-quiz-share-short.service.test.js` | Tests web_quiz_share_short: /s/<8 hex> asks the bot for its card and answers at the public edge |
| `web-quiz-share-v4-page.service.test.js` | Tests web_quiz_share_v4, one share for every finish, on the child's pages |
| `web-quiz-share-v4-slow-tap.service.test.js` | Tests Share with the one share on and a slow card: a tap before the card is ready still shares |
| `web-quiz-share-v4-story.service.test.js` | Tests the one share on the storybook's done card (web_quiz_share_v4, book share_v4) |
| `web-quiz-share-v4-table.service.test.js` | Tests the class table and school league join the one share (web_quiz_share_v4) |
| `web-quiz-shelf-one-hop.service.test.js` | Tests web_quiz_one_hop: shelf, videos door and a story in one hop (needs web_quiz_fast); one-hop-off-golden.json |
| `web-quiz-shell-caption.service.test.js` | Tests the quiz page shell caption shown until wq.js boots on slow 4G |
| `web-quiz-sound-tiles.service.test.js` | Tests wq.js WQI phonics sound tiles: a listen-and-identify item plays the sound first |
| `web-quiz-static-br.golden.json` | Golden: brotli/static-asset response metadata for /wq assets with versioned urls; web-quiz-static-br test |
| `web-quiz-static-br.service.test.js` | Tests web_quiz_brotli: /wq/* files served brotli-compressed with versioned urls; web-quiz-static-br.golden.json |
| `web-quiz-stories-client.service.test.js` | Tests wq-stories.js, the child's Stories shelf and read-along reader over the book's pictures |
| `web-quiz-stories-edge.service.test.js` | Tests /api/wq/stories/* forwarded to the bot's internal stories API with the phone's device id |
| `web-quiz-stories-one-button.service.test.js` | Tests the storybook shelf and reader in the one-button look (html.wq-1b, wq.css) |
| `web-quiz-stories-slow-gaps.service.test.js` | Tests the storybook Slower option (web_quiz_stories_slow_gaps, book slow_gaps: true) |
| `web-quiz-story-assets.service.test.js` | Tests GET /s/<book id>/<file>: storybook pictures and voices served from our own origin, cached a year |
| `web-quiz-story-class-view.service.test.js` | Tests wq.js in the page harness: a teacher-sent story's /class link opens the story landing, never the class board |
| `web-quiz-story-object.service.test.js` | Tests r2.service getObjectBytes behind /s/: the whole object as bytes from the named bucket |
| `web-quiz-story-start.service.test.js` | Tests wq-story-link.js and wq.js seams: a teacher-sent story is named on the landing and opens the hub on the book |
| `web-quiz-story-time-look.service.test.js` | Tests Story Time under the adventure look (menu adv: true, html.wq-adv) |
| `web-quiz-story-time-page.service.test.js` | Tests Story Time on the Challenge page (wq-trail.js under v2, only with the story switch on the menu) |
| `web-quiz-story-title-clip.service.test.js` | Tests the story title keeps its Nastaliq ink and clips to one line with an ellipsis (bd-5gyspy.5.2) |
| `web-quiz-story-urls.service.test.js` | Tests every URL a teacher-sent storybook code answers (boot story, web_quiz_stories_teacher) |
| `web-quiz-table-preview-art.service.test.js` | Tests the class table's shared link previews the CLASS picture, naming nobody |
| `web-quiz-taps.service.test.js` | Reads public/wq/wq.css: touch-action manipulation so double-tap zoom never swallows a child's quick second tap |
| `web-quiz-teacher-landing.service.test.js` | Tests the teacher's own preview link opens a page styled for the teacher |
| `web-quiz-teacher-report.service.test.js` | Tests the teacher report edge: /r/:token, /r/:token/pdf and /r/:token/remind in teacher-report.routes |
| `web-quiz-tel-page.service.test.js` | Tests wq-tel.js page-session telemetry run for real in a vm with a small fake DOM |
| `web-quiz-telemetry-edge.service.test.js` | Tests web_quiz_rich_telemetry at the edge: wq-tel.js loading and event forwarding to the bot |
| `web-quiz-tie-note-ur.service.test.js` | Tests the class table's tie note on an Urdu page reads as a sentence under both Urdu copy sets |
| `web-quiz-trail-counter.service.test.js` | Tests the Trail's item counter and All done! screen (wq-challenge.js with wq-trail.js) |
| `web-quiz-trail-intro-title.service.test.js` | Tests Trail v2 stop intro title (wq-trail.js with the real Challenge page); trail-intro-v2.golden.json |
| `web-quiz-trail-noise-sticker.service.test.js` | Tests the Trail v2 read result card when the server judged the read not a reading (sticker false) |
| `web-quiz-trail-page.service.test.js` | Tests Trail page v2 (wq-trail.js with the Challenge page); off matches trail-page-v2-off.golden.json |
| `web-quiz-trail-read-settle.service.test.js` | Tests the Trail v2 result card after a live reading waits for the server result before drawing buttons |
| `web-quiz-ur-copy.service.test.js` | Tests the polished Urdu copy (web_quiz_ur_polish, edge wq-ur2 class on html) |
| `web-quiz-ur-polish-league.service.test.js` | Tests the school league on a polished Urdu page uses one digit system (wq-ur2) |
| `web-quiz-ur-polish-page.service.test.js` | Tests web_quiz_ur_polish on child pages when the bot's payload carries ui.ur2 |
| `web-quiz-ur-polish-separators.service.test.js` | Tests list separators on a polished Urdu page (wq-ur2 on html) |
| `web-quiz-ur-share-copy.service.test.js` | Tests web_quiz_ur_share_copy: the corrected Urdu share words (bot ur_share) |
| `web-quiz-urdu-bidi.service.test.js` | Tests Urdu pages isolate mixed digit-and-Latin atoms like a class label '3-B' so they read in the right order |
| `web-quiz-urdu-bubble.service.test.js` | Tests the big mascot's speech bubble on Urdu pages (landing, results, time to rest) wraps well |
| `web-quiz-urdu-font-exclam-gap.service.test.js` | Tests on Urdu pages the ! after an Urdu word sits close to it |
| `web-quiz-urdu-font-exclamation.service.test.js` | Tests both Nastaliq faces draw ! themselves (nastaliq-cmap.json) |
| `web-quiz-urdu-font.service.test.js` | Tests the Nastaliq web font is served by the portal itself as one small subset file |
| `web-quiz-urdu-latin.service.test.js` | Tests Latin text inside an Urdu page keeps normal word spacing |
| `web-quiz-urdu-loans-lint.service.test.js` | Lint: Urdu child text avoids the loan words share and tap, using the Urdu words instead |
| `web-quiz-urdu-nowrap.service.test.js` | Tests WhatsApp in Urdu stays one word on a child's page, never split across a line |
| `web-quiz-video-chapter-line.service.test.js` | Tests the Videos see-all under html.wq-adv: each card's small chapter line (wq-vch) |
| `web-quiz-video-one-play.service.test.js` | Tests html.wq-adv on the lesson video page: one play button |
| `web-quiz-video-scorecard.service.test.js` | Tests the end of a video quiz (item 18a): the scorecard says video quiz with Watch more first |
| `web-quiz-video-shelf-edge.service.test.js` | Tests the Videos door picture shelves at the edge and lesson page (web_quiz_video_shelf) |
| `web-quiz-video-shelf-off.golden.json` | Golden: Videos shelf screens (wait, subjects, chapters, watch) for classless/class modes, off; video-shelf test |
| `web-quiz-video-shelf.fixture.js` | Fixture: the Videos door screens with web_quiz_video_shelf off, rendered purely for the shelf test |
| `web-quiz-video-shelf.service.test.js` | Tests the Videos door thumbnail shelves and the way into each quiz; web-quiz-video-shelf-off.golden.json |
| `web-quiz-video-topic-ur.service.test.js` | Tests a video lesson's quiz named in Urdu letters on an Urdu screen (quiz.topic_ur, hub rows topic_ur) |
| `web-quiz-voice-feedback.service.test.js` | Tests wq.js feedback voice after an answer, and silence when the page goes away |
| `web-quiz-voice-lang-gloss.service.test.js` | Tests wq.js shared feedback lines in English play with an Urdu gloss when needed |
| `web-quiz-voice-lang.service.test.js` | Tests wq.js shared feedback lines follow the page language |
| `web-quiz-voice.service.test.js` | Tests wq.js voice (speak, stopVoice, speakTts) in the page harness |
| `web-quiz-wait-home.service.test.js` | Tests web_quiz_wait_home: Home drawn at once on a return to the hub in the same tab |
| `web-quiz-wait-hops.service.test.js` | Tests web_quiz_wait_hops: the designed wait across a page hop |
| `web-quiz-wait-ux.service.test.js` | Tests web_quiz_wait_ux: the designed wait on child pages; off matches wait-ux-off-hub-golden.json |
| `web-quiz-way-back.service.test.js` | Tests web_quiz_closed_way_back: an expired, forged or closed link is never a dead end; off matches golden |
| `web-quiz-who-played-page.service.test.js` | Tests wq.js Who played? on the teacher's own preview link (M4) |
| `web-quiz-zero-read-card.service.test.js` | Tests a counted live read on the Trail with the finish card on (card_v3) shows the right card for a zero read |
| `wq-keyframes-unique.service.test.js` | Tests no @keyframes name is defined in two child-page stylesheets, since they share one document |
| `wq-list-states-screens.js` | Helper rendering door screens (wq-doors.js with wq-home.js in a vm) for the list-states test and its golden |
| `wq-min-vm.js` | Test-only helper (web_quiz_minify): runs the vm-based page suites against the minified page files |
| `wq-page-harness.js` | Shared harness for web quiz page tests: runs public/wq/wq.js and wq.css in a vm with fakes |
| `wqc-page-harness.js` | Shared harness running public/wq/wq-challenge.js whole in a vm with a fake DOM, fetch and media |

## Who reads this (all, generated)
- env `BASE_ROUTES` read at `dashboard/tests/web-quiz-trail-page.service.test.js:17:ab9677b6`
- env `BASE_SRC` read at `dashboard/tests/web-quiz-trail-page.service.test.js:16:53ff23e2`
- env `CHILD_LINT_PAGE_SRC` read at `dashboard/tests/web-quiz-child-screen-lint.service.test.js:18:8265aae7`
- env `CHILD_LINT_SEED` read at `dashboard/tests/web-quiz-child-screen-lint.service.test.js:434:f368e361`
- env `FR_GOLDEN_WRITE` read at `dashboard/tests/web-quiz-read-feedback.service.test.js:792:ba3588cb`
- env `GITHUB_TOKEN` read at `dashboard/tests/github-api.test.js:74:91cbb81f`
- env `GOLDEN_PRINT` read at `dashboard/tests/web-quiz-rewatch-replay.service.test.js:54:b4471647`
- env `GOLDEN_WRITE` read at `dashboard/tests/web-quiz-class-link-edge.service.test.js:81:7f08b924` · `dashboard/tests/web-quiz-class-pic-edge.service.test.js:84:a50a1fbc`
- env `INTERNAL_API_KEY` read at `dashboard/tests/edge-mounts-golden.service.test.js:54:42692577`
- env `JC_GOLDEN_WRITE` read at `dashboard/tests/web-quiz-jugnu-card-page.service.test.js:205:050c66ed`
- env `KEEP_JUG_GOLDEN_WRITE` read at `dashboard/tests/web-quiz-hub-keep-after-jug.service.test.js:110:72620e1d`
- env `MAIN_BOT_URL` read at `dashboard/tests/edge-mounts-golden.service.test.js:54:42692577`
- env `NODE_ENV` read at `dashboard/tests/health-db-writable.service.test.js:85:b4659750`
- env `PRINT_OFF_PIN` read at `dashboard/tests/web-quiz-stories-client.service.test.js:3048:d2f6c1d3`
- env `PWCHROME_EXE` read at `dashboard/tests/sa-coach-lastword-corner.service.test.js:23:dcc5b4a0` · `dashboard/tests/sa-onecell-fit.service.test.js:41:dcc5b4a0` · `dashboard/tests/sa-onecell-ink.service.test.js:50:dcc5b4a0` · `dashboard/tests/sa-ui-dev-jump-row.service.test.js:34:dcc5b4a0` · `dashboard/tests/sa-ur-passage-pitch.service.test.js:36:dcc5b4a0` · `dashboard/tests/sa-ur-screens-fit.service.test.js:120:dcc5b4a0` · `dashboard/tests/sa-ur-tile-fit.service.test.js:48:dcc5b4a0` · `dashboard/tests/sa-ur-tile-ink.service.test.js:45:dcc5b4a0` · `dashboard/tests/sa-ur-word-tile-ink.service.test.js:55:dcc5b4a0`
- env `PWCORE` read at `dashboard/tests/sa-coach-lastword-corner.service.test.js:17:f9b06513` · `dashboard/tests/sa-onecell-fit.service.test.js:35:f9b06513` · `dashboard/tests/sa-onecell-ink.service.test.js:44:f9b06513` · `dashboard/tests/sa-ui-dev-jump-row.service.test.js:28:f9b06513` · `dashboard/tests/sa-ur-passage-pitch.service.test.js:30:f9b06513` · `dashboard/tests/sa-ur-screens-fit.service.test.js:113:f9b06513` · `dashboard/tests/sa-ur-tile-fit.service.test.js:42:f9b06513` · `dashboard/tests/sa-ur-tile-ink.service.test.js:39:f9b06513` · `dashboard/tests/sa-ur-word-tile-ink.service.test.js:49:f9b06513`
- env `REFERRAL_BOT_NUMBER` read at `dashboard/tests/quiz-go-edge.service.test.js:130:c715650c` · `dashboard/tests/quiz-teacher-edge.service.test.js:412:6a97d946` · `dashboard/tests/web-quiz-closed-inline.service.test.js:48:063a2991`
- env `RF_GOLDEN_WRITE` read at `dashboard/tests/web-quiz-read-feedback.service.test.js:24:a56e8649`
- env `SA_FIT_DEBUG` read at `dashboard/tests/sa-onecell-fit.service.test.js:101:8f52cfcb` · `dashboard/tests/sa-ur-tile-fit.service.test.js:122:b7406ca3` · `dashboard/tests/sa-ur-word-tile-ink.service.test.js:123:9471f5dd`
- env `SA_INK_DEBUG` read at `dashboard/tests/sa-onecell-ink.service.test.js:126:aee8089b` · `dashboard/tests/sa-ur-tile-ink.service.test.js:121:dc0d5808`
- env `TEACHER_HOME_RECORD` read at `dashboard/tests/edge-mounts-golden.service.test.js:47:4cdafe7b`
- env `TEST_BASE_URL` read at `dashboard/tests/video-observability-routes.test.js:12:9a65a078`
- env `WEB_QUIZ_BASE_URL` read at `dashboard/tests/web-quiz-canonical-host.service.test.js:105:434c7d53`
- env `WHATSAPP_BOT_NUMBER` read at `dashboard/tests/quiz-go-edge.service.test.js:130:c715650c` · `dashboard/tests/quiz-teacher-edge.service.test.js:401:ec41a4f4` · `dashboard/tests/web-quiz-closed-inline.service.test.js:48:063a2991`
- env `WQ_G1_GOLDEN_FROM` read at `dashboard/tests/web-quiz-g1-page.service.test.js:210:ce575bec`
- env `WQ_MIN_VM_LOG` read at `dashboard/tests/wq-min-vm.js:37:e1ef9afd`
- env `WQ_PRINT_OFF_GOLDEN` read at `dashboard/tests/web-quiz-share-v4-story.service.test.js:282:3f143f2d`
- env `WQ_SRC` read at `dashboard/tests/web-quiz-handset-page.service.test.js:13:e83922b7` · `dashboard/tests/web-quiz-practice-card.service.test.js:11:e83922b7` · `dashboard/tests/web-quiz-remembered.service.test.js:15:e83922b7` · `dashboard/tests/web-quiz-roll.service.test.js:14:e83922b7` · `dashboard/tests/web-quiz-who-played-page.service.test.js:14:e83922b7`
- env `WRITE_CARD_GOLDEN` read at `dashboard/tests/web-quiz-page-live.service.test.js:88:62e3d10d`
- env `WRITE_READ_LIVE_GOLDEN` read at `dashboard/tests/web-quiz-challenge-live.service.test.js:424:ba9e0037`
- env `WRITE_READ_LIVE_RESULT_GOLDEN` read at `dashboard/tests/web-quiz-challenge-live.service.test.js:554:12aef2c3`
- env `WRITE_TRAIL_INTRO_GOLDEN` read at `dashboard/tests/web-quiz-trail-intro-title.service.test.js:59:7f5a6da3`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/data/child-test/sa/CLAUDE.index.md`? · `bot/shared/data/child-test/sa/CLAUDE.md`? · `bot/shared/services/child-test/sa/CLAUDE.index.md`? · `bot/shared/services/child-test/sa/CLAUDE.md`? · `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `bot/shared/services/first-touch/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `dashboard/CLAUDE.index.md`? · `dashboard/CLAUDE.md`? · `dashboard/lib/CLAUDE.index.md`? · `dashboard/lib/CLAUDE.md`? · `dashboard/middleware/CLAUDE.md`? · `dashboard/public/wq/CLAUDE.index.md`? · `dashboard/public/wq/CLAUDE.md`? · `dashboard/routes/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.md`? · `dashboard/sa/CLAUDE.index.md`? · `dashboard/sa/CLAUDE.md`? · `dashboard/services/CLAUDE.index.md`? · `dashboard/tests/CLAUDE.index.md`? · `dashboard/tests/CLAUDE.md`? · `dashboard/tests/__golden__/CLAUDE.md`? · `dashboard/tests/insights/CLAUDE.index.md`? · `dashboard/tests/insights/CLAUDE.md`? · `dashboard/tests/queue/CLAUDE.md`? · `dashboard/tests/support/CLAUDE.md`? · `portal/src/lib/CLAUDE.index.md`? · `portal/src/lib/CLAUDE.md`?
