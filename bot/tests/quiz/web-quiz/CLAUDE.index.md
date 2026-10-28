# web-quiz — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests/quiz/web-quiz -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__fixtures__/` | Invented storybook fixtures shared by web-quiz Stories tests → `__fixtures__/CLAUDE.md` |
| `__golden__/` | Recorded-from-base JSON goldens that pin web-quiz switch-off output → `__golden__/CLAUDE.md` |
| `__goldens__/` | Recorded-from-base JSON goldens for the teacher class-week and report pages → `__goldens__/CLAUDE.md` |
| `fixtures/` | → (no door; 9 test files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `all-grades-shelves.test.js` | bd-5gyspy.5: no grade forbids anything on any shelf; stories, videos, games show every grade, grade only a default |
| `backfill-video-language.test.js` | Pins scripts/web-quiz/backfill-video-language: student_videos.language from lesson quiz, NULL rows only, dry-run default |
| `bind-way-back.test.js` | Pins web_quiz_bind_way_back "Keep my place": each JUGNU- binder outcome answers chat once, with a way back |
| `challenge-bank-v4.test.js` | Pins Challenge bank v4 registry: v3 bank bytes and item-bank.js exports unchanged, passage dir and registry seed SQL |
| `challenge-calibration.test.js` | Pins the monthly Challenge calibration job that only proposes: equating links, item estimates, never sets status |
| `challenge-clip-warm.test.js` | Pins web_quiz_challenge_clip_warm: daily job records released and next-7-day passage clips; switch off does nothing |
| `challenge-counted-meta.test.js` | Pins run-row meta.counted under challenge v2 (RULING #116): only a check record counts; off keeps attempt_no stamp |
| `challenge-draw.test.js` | Pins the Challenge draw pure core: bands, eligible set, weights, seeded pick, record decision, trailStateFor |
| `challenge-grade1.test.js` | Pins the grade-1 "how many dots" form behind web_quiz_challenge_g1; either switch off keeps not_eligible |
| `challenge-passage-changes.test.js` | Pins that a passage text may change only before first exposure, with a dated changes note and differing before-hash |
| `challenge-passage-gate.test.js` | Pins the pure passage check gating Challenge passage files: band numbers, readability, no numerals, tap questions |
| `challenge-passage-licence.test.js` | Pins registry licence/attribution/calibration columns migration and Set A rows labelled as a published instrument |
| `challenge-period-id.test.js` | Pins that every challenge period id is the PKT calendar month YYYY-MM in migrations, the Jugnu tab and serve |
| `challenge-period-october.test.js` | Pins the October 2026 challenge_periods migration row (PKT month bounds) so serves carry period_id 2026-10 |
| `challenge-provenance.test.js` | Pins that the counted CHALLENGE pool admits only published_calibrated or reviewer_levelled passages (RULING #105) |
| `challenge-read-quality.test.js` | Pins counted-row quality at serve: rapid_perfect and implausible (no_speech, low confidence) floors |
| `challenge-record-guards.test.js` | Pins Challenge v2 record guards: one pick per hub visit, served-and-left row keeps the record, duplicates are practice |
| `challenge-runs-read-failed.test.js` | Pins fail-closed serve when the runs read hits 42703 (missing column): refuses, no rows, logs ch_runs_read_failed |
| `challenge-serve-v2-identity.test.js` | Pins the identity pick written on a v2 served row and phone-binding renewal on a finished stop (web_quiz_phone_bind) |
| `challenge-serve-v2.test.js` | Pins Challenge serve under v2/period/pool switches: provenance on run row, draw logs, A1 warm-up; off is byte-identical |
| `challenge-stock-seed.test.js` | Pins that the committed passage-stock seed SQL equals what scripts/challenge-stock-seed.js prints from the files |
| `challenge-story-readalong.test.js` | Pins web_quiz_readalong word-by-word timing on a Story Time serve; off is byte-identical, no file read |
| `challenge-story-serve.test.js` | Pins Story Time GET /ch/:token/<read|listen> serve rules for pid, band, language; invalid pid gives 400 story_pid |
| `challenge-title-leak.test.js` | Pins the title gate: no counted listen passage title contains an accepted answer of its own questions |
| `child-identity-canon-fold.test.js` | Pins web_quiz_identity_canon: canonicalStudentIds follows students.merged_into one hop; hub folds children through it |
| `child-identity-store.test.js` | Pins child identity store: switches under parents, family-phone binding, bind codes and the academic-year clock |
| `class-round-alt-copy.json` | Alternate en/ur copy for class-round card and invite keys (jg.round.*, bot.round.invite); read by class-round-lines test |
| `class-round-amend.test.js` | Pins class round under sampling ruling: declined, pause/resume, k=10 counted flag, Not this term, window, no repeat |
| `class-round-challenge.test.js` | Pins that a class-round turn token plays the Challenge, which writes the run row with mode and via class_round |
| `class-round-draw-breaks.test.js` | Pins runTermDraw against stored term breaks (web_quiz_term_breaks): any window or class week in a break refuses draw |
| `class-round-endcard.test.js` | Pins roundPayload: round_turn flag, no sticker line, hand-back to the round page, no report token in claims |
| `class-round-golden.test.js` | Golden: with the class round off, the teacher report page and Challenge run are byte-identical to pre-round code |
| `class-round-lines.test.js` | Pins class round lines: "Not this term", close-time counted positions and aggregates, positions fixed at Start |
| `class-round-migration.test.js` | Runs web_quiz_class_round.sql on throwaway Postgres; checks constraints and schema file mirrors it byte for byte |
| `class-round-paused-card.test.js` | Pins the class tab's paused-round card line "{done} of {total} played" (jg.round.t_paused); other states unchanged |
| `class-round-paused-continue.test.js` | Pins paused-round card single Continue button posting to /resume (jg.round.t_resume) and the Urdu round-list name line |
| `class-round-retired-still.test.js` | Pins retirement of jg.round.c_still from the round page T table; screens stay byte-identical to class-round-pages.json |
| `class-round-sampler.test.js` | Pins the class round term sampler: ~40 classes stratified by sector and grade band, seeded, never twice a term |
| `class-round-strict-fake.js` | Wraps the in-memory Supabase so class_round_draws queries naming a non-migration column answer 42703 |
| `class-round-urdu-digits.test.js` | Pins that Urdu class-round teacher screens write counts in Urdu digits (U+06F0-06F9); English unchanged |
| `class-round.test.js` | Pins the once-a-term class round in locked mode on the teacher's phone: shuffled order, real routes, service, tokens |
| `copy-deck.test.js` | Pins Jugnu copy deck copy.v2.json rules: both languages per key, caps in code points, matching placeholders |
| `fake-supabase-null.test.js` | Pins that the web-quiz fake Supabase answers NULL like PostgREST: neq never returns a NULL cell |
| `fake-supabase.js` | In-memory Supabase stand-in applying eq/is/in/or/order/range filters; shared by most web-quiz and quiz tests |
| `fixture-phone.js` | Builds synthetic phone digits at runtime for tests, since the repo bans phone-shaped digit literals |
| `fixture-students-cli.test.js` | Pins scripts/web-quiz/fixture-students.js: read-only JSON of test-child ids and counts, never names or phones |
| `guest-home-binding-expiry.test.js` | Pins expireBindings (erases phone_norm, keeps phone_tomb) and the guest home for an unknown phone's /quiz |
| `load-stories-script.test.js` | Pins scripts/web-quiz/load-stories.js: dry-run counts per book, loaded.csv, draft until cleaned page has a verdict |
| `message-ledger-minutes-golden.test.js` | Golden: send-ledger rpc args, fallback writes and msg_sent payloads for callers passing no minutes stay unchanged |
| `message-ledger-minutes.test.js` | Pins teacher minutes on the send ledger: record({minutesEach}) passes p_minutes_each; msg_sent carries min only then |
| `must-write.test.js` | Pins mustWrite: a write behind a "done" screen either lands or refuses, never an ignored error behind a 200 |
| `one-attempt-first-completed.test.js` | Pins oneAttemptPerChild rule first_completed for the web quiz; default stays latest completed |
| `phone-binder.test.js` | Pins the phone binder: JUGNU- code saves a child's place, STOP erases it, door and /quiz read the binding |
| `practice-play-routes.test.js` | Pins web_quiz_practice_play: a "Try it as a student" hub token opens read-only content; off, routes refuse it |
| `presend-pdf-unchanged.test.js` | Pins that the pre-send teacher PDF stays byte-identical (hash per language) despite the web report change (W37 12b) |
| `quiz-report-renders.golden.js` | Builds the teacher report QUIZ renders (EN/UR, screen/PDF, class-tab rows) compared against the committed golden |
| `quiz-report-renders.test.js` | Pins that 60 teacher quiz-report renders, class tab and message pages stay byte-identical (sha256) to the golden |
| `quiz-teacher-label.test.js` | Pins quiz-teacher-label: drops a stored honorific so the label is "Teacher <name>" or «استاد <name>», not doubled |
| `readalong-spend-cap.test.js` | Pins the read-along build's --max-usd cap: stops with total and one web_quiz.readalong_spend_cap event |
| `readalong-timing.test.js` | Pins read-along timing arithmetic: recogniser tokens to words, printed/spoken matching, pauses, tempo, stored file |
| `registry-columns.js` | Reads Challenge tables' real column sets from SQL and guards the fake Supabase to answer 42703 on missing columns |
| `report-fold-parity.test.js` | Pins quiz_report_fold_by_child parity: web report, teacher home count and 12h WhatsApp report name the same children |
| `report-guidance-stored.test.js` | Pins storing PDF reteach guidance in quizzes.meta.report_guidance so the web report shows the same advice |
| `report-pdf-not-played.test.js` | Pins the post-completion PDF listing children who have not played (greyed names, list numbers) with remind links |
| `report-web-arm-first-finish.test.js` | Pins that a web-arm quiz report counts each child's first finish while WhatsApp quizzes keep the latest |
| `sample-ping-dry-run-script.test.js` | Pins scripts/sample-ping-dry-run.js: one JSON of counts only, calls service dryRun, never send, no ids or phones |
| `sample-ping-ledger.test.js` | Pins that the send ledger accepts trigger sample_ping only as a bot-initiated family send without phone |
| `sample-ping.test.js` | Pins the direct sample ping built OFF: four locks, quiet hours, frame, caps, send order, dry run, PII-free events |
| `schema-columns.js` | Reads a table's columns from 00_complete-schema.sql (CREATE plus ALTER ADD COLUMN) for strictColumns fake checks |
| `sent-quiz-class-resolve.test.js` | Pins that a sent hand-out resolves to the sender's own class, never the author's (switch quiz_teacher_home) |
| `stories-migration.test.js` | Runs web_quiz_stories.sql and student_videos_language.sql on throwaway Postgres and checks schema file mirror |
| `story-face.test.js` | Pins story-face check naming Urdu characters the child page face cannot draw (face_holes) in the loader plan |
| `story-load.test.js` | Pins story-load planBook and READY gates: prepared Testwala book files to rows and hashed stored files |
| `story-replay.test.js` | Pins story-replay slices of one sentence or word as time ranges of a page's own take from its timing record |
| `story-report-chrome.test.js` | Pins teacher story report wording: "Story report" brand and title, Not opened yet roster card, never "played" |
| `story-report-rows.test.js` | Pins All-my-classes rows for storybook sends ("N of M opened"), "Your stories" heading, story-report PDF name |
| `story-store.test.js` | Pins story-store content-addressed R2 keys, immutable-year uploads, /s/ addresses and r2.uploadBuffer cacheControl |
| `story-teacher-page-csp.test.js` | Pins quiz_teacher_stories_csp: hashed CSP meta and header on the teacher Stories page; off is byte-identical golden |
| `story-teacher.test.js` | Pins the teacher storybook send (web_quiz_stories_teacher): shelf, one quizzes row per book, /q/ open, story report |
| `strict-columns.js` | Fake Supabase that answers 42703 for columns absent from the schema mirror, so misspelt columns fail tests |
| `student-join-teacher-link.test.js` | Pins the later teacher link for a self-joined child: teacher-confirm queue tier self_join, merge on Same child |
| `student-quiz.service-child-lang-seam.test.js` | Pins /quiz reply language from child_language rows under web_quiz_return_lang (Urdu reply, link l "ur"); off ignores |
| `teacher-class-week.test.js` | Pins the class-week "Forward the week" card on the Jugnu tab (web_quiz_class_week); any parent off is byte-identical |
| `teacher-confirm-at-once.test.js` | Pins that the "same child?" POST answers after the write is saved, with a page time budget and opened-event timing |
| `teacher-join-queue-backward-no.test.js` | Pins that a teacher-merged child still blocks its look-alike twin in runBackwardJoin |
| `teacher-join-queue-cache-filter.test.js` | Pins join-queue cache edits after a tap: same/no removes pairs, TTL kept, undo restores rows |
| `teacher-join-queue-cache-slide.test.js` | Pins that reading the kept join queue renews its TTL up to QUEUE_MAX_AGE_S, then recomputes |
| `teacher-join-queue-cache.test.js` | Pins the per-teacher join-queue cache (Redis, local fallback): computed once, read by candidatesFor and decide |
| `teacher-join-queue-decider-filter.test.js` | Pins that a configured test teacher's decisions never feed a tier's precision (web_quiz_fixture_rule) |
| `teacher-join-queue-excluded-count.test.js` | Pins precisionByTier excluded_n: count of queue rows by configured test teachers left out of each tier |
| `teacher-join-queue-same-roundtrip.test.js` | Pins that a served same reads the enrolment and idempotency checks together before the one guarded write |
| `teacher-join-queue-watch-root.test.js` | Pins that watch-root children (web_quiz_watch_root) are never in the root teacher's queue or a blocker |
| `teacher-join-queue.test.js` | Pins join-queue rows (two tiers), what one tap writes, link-class-codes tap and backward join (web_quiz_identity_canon) |
| `teacher-jugnu-golden.test.js` | Golden: with the Jugnu tab (or its parent) off, the teacher report quiz and class tabs are byte-identical |
| `teacher-jugnu-queue-budget.test.js` | Pins the 3 s QUEUE_BUDGET_MS on the Jugnu tab: a slow confirm queue yields 200 without the queue section |
| `teacher-jugnu-queue-row.test.js` | Pins that the real join-queue row keys reach the Jugnu tab page, with queue wording from the copy deck |
| `teacher-jugnu-tab.test.js` | Pins the teacher's Jugnu tab (web_quiz_teacher_jugnu): forward line, confirm queue, copy rules on /r/<token>?tab=jugnu |
| `teacher-jugnu-unbind.test.js` | Pins the Jugnu tab "Saved on WhatsApp ✓ · Undo": no-JS POST erases a binding, door forgets phone, bind_undo counted |
| `teacher-reminder-live-preview.test.js` | Pins quiz_reminder_live_preview: reminder link /q/<CODE>?v=<played> carries a count only, never a name |
| `teacher-report-data.test.js` | Pins quizReport(teacherId, quizId) data core and report link token: another teacher's quiz is not found |
| `teacher-report-fold-by-child.test.js` | Pins quiz_report_fold_by_child: an off-list child is one row per child (not per typed name); off keeps golden |
| `teacher-report-gate.test.js` | Pins teacher-report-gate: one app_settings read for both keys, 30 s cache, fails closed, /r/<token> links |
| `teacher-report-identity.test.js` | Pins that the teacher report reads class membership from identity v2 (bound class, roster, provisional typed child) |
| `teacher-report-internal-routes.test.js` | Pins /api/internal/tr/* routes behind the portal's /r/<token>: internal-key auth and real data core rendering |
| `teacher-report-library-send.test.js` | Pins the report for a library quiz the teacher sent but did not author (quiz_teacher_home): sender's own code only |
| `teacher-report-page.test.js` | Pins the pure teacher report page renderer (data to HTML): tiles, greyed not-played chips, Remind link, Copy message |
| `teacher-report-v21-hook.test.js` | bd-v0toag.9/.10: quizReport v21 extras (tries, completion, SLO code) only with quiz_slo_retest_enabled on |
| `teacher-report-v21-page.test.js` | bd-v0toag.9/.10: report page v21 pieces (Completed tile, "N tries" tag, curriculum code) render only when supplied |
| `video-bank-order.test.js` | Pins the video bank's one order (grade, subject, chapter, title) shared by the Student Videos Flow and web library |
| `videos-title-ur-migration.test.js` | Runs web_quiz_student_videos_title_ur.sql on throwaway Postgres: two nullable Urdu name columns, schema mirror, rollback |
| `videos-v3-fixture.js` | Seed video library with languages and mixed-digit chapter numbers for web_quiz_videos_v3 OFF golden and ON tests |
| `watch-root-depth.test.js` | Pins web_quiz_watch_root by ancestry: chips, typed-name card, me() and school league exclude codes under the root |
| `watch-root-one-parser.test.js` | Pins one watch-root parser (rootOf) shared by report, join queue, quiz page, league and videos module |
| `web-quiz-adventure-look.test.js` | Pins web_quiz_adventure_look: JSON true only, rides the hub's settings read, answers say adv:true; off is byte-identical |
| `web-quiz-art-copy-one.test.js` | Pins web_quiz_share_copy_one: singular "1 kid"/«۱ بچے نے کھیلا» forms on class and school share pictures |
| `web-quiz-art-early.test.js` | Pins that the card share picture is drawn after the answer (not awaited), without an R2 ask, and smaller on the wire |
| `web-quiz-art-invite-copy.test.js` | Pins gender-neutral Urdu on invite share pictures (addressForms check) and no score to beat from a zero challenger |
| `web-quiz-art-name-fit.test.js` | Pins web_quiz_share_name_fit: long Latin name as its own LTR run sized to fit (min 34 px) on card pictures |
| `web-quiz-art-no-sharp.test.js` | Pins that the share-picture service and web-quiz internal routes load where native sharp is not installed |
| `web-quiz-art-pic-polish.test.js` | Pins web_quiz_share_pic_polish: class table own-row label, row widths and name shortening; off/on hash goldens |
| `web-quiz-art-r2-miss.test.js` | Pins that a share picture absent from R2 is a cache miss (no error log, drawn and stored); a 500 warns once |
| `web-quiz-art-served.test.js` | Pins the web_quiz.art_served event per served share picture: kind, size, ms, source (drawn/R2/memory), no ids or names |
| `web-quiz-art-ur-digits.test.js` | Pins web_quiz_share_ur_digits: Urdu share pictures draw numbers in Urdu digits for every kind and size |
| `web-quiz-art-ur-polish.test.js` | Pins web_quiz_ur_polish: larger Urdu headline/kicker/CTA pill on share pictures; English byte-identical |
| `web-quiz-art-ur-stack.test.js` | Pins web_quiz_share_ur_stack: Urdu share picture stack (headline, stars, pill saying Open, not Tap) with off golden |
| `web-quiz-art.test.js` | Pins share-picture template (card, class, school, invite): two sizes, signed ids, headless-browser render |
| `web-quiz-audio-ask-plan.test.js` | Pins web_quiz_audio_ask_plan: link mint and page open ask for the same one clip job under the live plan |
| `web-quiz-audio-cap-one.test.js` | Pins web_quiz_audio_cap_one: one-voice recordings count toward web_quiz_audio_daily_cap |
| `web-quiz-audio-claim.test.js` | Pins web_quiz_audio_claim: one recording per quiz at a time so two jobs do not pay for the same clips twice |
| `web-quiz-bank-voice.test.js` | Pins that a video-bank quiz with NULL language is voiced by its own script (Urdu gets Soniox voice, never default) |
| `web-quiz-bind-events-envelope.test.js` | Pins web_quiz_events_v2 envelope {w, ev_v, kid_v, kid} on bind_confirm/bound/refused/undo events, no phone or code |
| `web-quiz-bind-page-mint-reuse.test.js` | Pins "Keep my place" idempotency: a second Yes within the hour returns the same code, one row, one bind_confirm |
| `web-quiz-bind-page-mint-seam.test.js` | Pins "Keep my place" mint() over the real child-bind-codes repo and bindings repo on the shared fake (no repo mock) |
| `web-quiz-bind-page.test.js` | Pins web-quiz-bind-page: mint a code, read status, undo a binding, "Whose turn?" before a scored route, pick record |
| `web-quiz-bind-reply-language.test.js` | Pins that the binder's one reply follows the language the family wrote (page prefill), not the quiz's language |
| `web-quiz-bind-stop-cap.test.js` | Pins that STOP which erased a binding is always answered, counted on the ledger, without moving the reply cap |
| `web-quiz-bind-way-back-seam.test.js` | Pins the bind way-back over the real code and bindings repos: a code-only reply yields a button to the child's page |
| `web-quiz-book-hub-golden-v2.json` | Golden hub payload (chips, kids, Book line) loaded by web-quiz-book.test.js |
| `web-quiz-book-hub-golden.json` | Golden hub payload with Stories off, loaded by web-quiz-book.test.js and web-quiz-book-stories.test.js |
| `web-quiz-book-noise.test.js` | Pins that Jugnu's Book gives no sticker, lit day or class light for a noise (implausible) scored read |
| `web-quiz-book-stories.test.js` | Pins storybook stickers on Jugnu's Book (web_quiz_stories); with Stories off the JSON has no book_stickers key |
| `web-quiz-book.test.js` | Pins Jugnu's Book and its hub payload line: lamps only from child_rungs, with fake Supabase and real hub token |
| `web-quiz-brand.test.js` | Pins web quiz brand resolution: app_settings row, then ORG_NAME, then NIETE code default |
| `web-quiz-busy-page-routes.test.js` | Pins web_quiz_busy_page: hub and quiz answers carry busy_page:true only on JSON true; off changes nothing |
| `web-quiz-busy-retry.test.js` | Pins web_quiz_busy_retry: busy_retry:true on answers only with the busy page on; one more key in the hub read |
| `web-quiz-card-door-kid.test.js` | Pins that scorecard door_shown/door_tap events carry the quiz session's child key via the signed st token (events v2) |
| `web-quiz-card-fast.test.js` | Pins web_quiz_card_fast: at mint the page's facts are kept in Redis under the token hash for 14 days |
| `web-quiz-card-fold-finish-waves.test.js` | Pins that finish() card_fold and no_class reads start beside the scorecard's lookups (no extra wave) under home_v3 |
| `web-quiz-card-fold-menu-waves.test.js` | Pins that the games menu no_class read starts beside the menu's own lookups (no extra wave) under web_quiz_home_v3 |
| `web-quiz-card-fold.test.js` | Pins finish() card_fold for a class child's own run under web_quiz_home_v3, and the card Home row via POST /hubdoor |
| `web-quiz-card-image.test.js` | Pins web_quiz_card_v3 finish-card server half: sealed card token, 1200x630 picture and shared link facts over HTTP |
| `web-quiz-card-ready.test.js` | Pins web_quiz_card_ready: a minted token is marked and its picture and page facts are stored in the stories bucket |
| `web-quiz-card.test.js` | Pins the Jugnu card on the scorecard: jugnu_card for a class child's own grade 2-5 run, POST /hubdoor mints the link |
| `web-quiz-challenge-budget.test.js` | Pins the read-aloud daily cap web_quiz_challenge_daily_reads (default 500): menu falls back, 429 enough_for_today |
| `web-quiz-challenge-comp-race.test.js` | Pins that a late-landing checked score cannot overwrite a tap's meta.comp tally (two meta writers race on one run row) |
| `web-quiz-challenge-daily-calls.test.js` | Pins which jobs the Challenge dailyJob runs once per PKT day (sample windows, monthly calibration), each behind own |
| `web-quiz-challenge-daily-claim.test.js` | Pins that the daily job's once-a-day claim is a Redis key (wq:daily_job), so all-switches-off writes no table row |
| `web-quiz-challenge-daily.test.js` | Pins the daily audio purge: deletes only readings past audio_keep_until, clears rows, logs; no R2 calls for unkept rows |
| `web-quiz-challenge-early.test.js` | Pins web_quiz_challenge_early: a friend's challenge page read runs in the class-link waits, same answer with fewer waits |
| `web-quiz-challenge-fold.test.js` | Pins web_quiz_challenge_fold: a friend's challenge door answer carries the challenger's score line first when switch |
| `web-quiz-challenge-keep.test.js` | Pins web_quiz_challenge_keep_audio: off scores and deletes the reading; on uploads it to a dated kept/ prefix with |
| `web-quiz-challenge-lazy-route.test.js` | Pins that the web-quiz router still loads and answers 503 on Challenge routes when web-quiz-challenge.js is absent |
| `web-quiz-challenge-lazy.test.js` | Pins that the router boots without the child-test item bank/scorer; exercises needing them answer 503 unavailable |
| `web-quiz-challenge-line-keep.test.js` | Pins web_quiz_challenge_line_keep: page answer tells the client to keep each number with its word on one line |
| `web-quiz-challenge-line-sent.test.js` | Pins web_quiz_challenge_line_sent: page answer tells the client to draw the challenge line one span per sentence |
| `web-quiz-challenge-listen.test.js` | Pins the Challenge 'Listen and answer' tile (web_quiz_challenge_listen): story played twice, up to 3 taps, off by |
| `web-quiz-challenge-live.test.js` | Pins Read-aloud live mode: single-use temporary Soniox key per run, 30 s connect, 90 s cap, flag-gated, main key never |
| `web-quiz-challenge-notice-upload.test.js` | Pins that the mic notice is marked seen at reading upload (audio_consent notice_shown), not only when result returns |
| `web-quiz-challenge-outcome.test.js` | Pins challengeOutcome: friend-vs-challenger win/tie/lose by score fraction, shown to the friend and the challenger |
| `web-quiz-challenge-questions.test.js` | Pins questions after Read aloud (web_quiz_challenge_questions): up to 3 taps on reached text only; 503 when off |
| `web-quiz-challenge-record.test.js` | Pins the Challenge record rules behind three switches: first scored attempt is the record, server clock, early-ended |
| `web-quiz-challenge-runs-notice-migration.test.js` | Runs web_quiz_challenge_runs_notice_shown.sql on throwaway Postgres: widens audio_consent CHECK, idempotent |
| `web-quiz-challenge-runs-record-locks-migration.test.js` | Runs web_quiz_challenge_runs_record_locks.sql on throwaway Postgres: one record per child x stop x period unique indexes |
| `web-quiz-challenge-runs-sampling-migration.test.js` | Runs web_quiz_challenge_runs_sampling.sql on throwaway Postgres: three nullable sampling columns, idempotent |
| `web-quiz-challenge-runs-v2-migration.test.js` | Runs web_quiz_challenge_runs_v2.sql on throwaway Postgres: nullable provenance columns, idempotent, rows unchanged |
| `web-quiz-challenge-runs-v2.test.js` | Pins runs v2: served/abandoned rows written at serve time, readers byte-identical with new columns NULL |
| `web-quiz-challenge-story-voice.test.js` | Pins web_quiz_challenge_story_voice: Challenge listening clips use the storybook voice, same keys as one-voice plan |
| `web-quiz-challenge-sweeper-rungs.test.js` | Pins that the stuck-run sweeper calls rung job onRecordFinal once per swept run and survives a throwing rung job |
| `web-quiz-challenge-sweeper.test.js` | Pins sweepStuck: a run in 'scoring' over 10 min becomes failed with meta.fail_reason and a ch_swept event |
| `web-quiz-challenge-trail.test.js` | Pins the Challenge trail and 'Missing number' stop, effective only when web_quiz_challenge_record is also on |
| `web-quiz-challenge-voice-presign.test.js` | Pins the read-aloud upload presigned PUT URL: signs content-type and host, expires in 180 s (real presigner, no network) |
| `web-quiz-challenge-voice.test.js` | Pins that scoring or any refusal deletes every object under a run's private audio prefix, and again after URL expiry |
| `web-quiz-challenge.test.js` | Main Challenge suite: kind-c token, 'Which is bigger?' tap and 'Read aloud' mic runs with faked Supabase/R2/speech |
| `web-quiz-child-lang-bind-links.test.js` | Pins that the keep-my-place bind replies and way-back link open the child's home in the child's kept language |
| `web-quiz-child-lang-chosen.test.js` | Pins web_quiz_return_lang: a grown-up's language tap in the home corner is kept (keep=1) and wins over class quiz |
| `web-quiz-child-lang-door.test.js` | Pins web_quiz_share_link_lang: a friend joining through an Urdu share card keeps the door's language (?lang=ur) |
| `web-quiz-child-lang-every-reader.test.js` | Pins that one hub open speaks one language across page, teacher pick and library lists when web_quiz_return_lang is on |
| `web-quiz-child-lang-hub-waves.test.js` | Pins that reading the child's kept language adds no serial wave to the kid hub's data fetch |
| `web-quiz-child-lang-join.test.js` | Pins that a self-joining child's join-link language (en|ur) is stored on their own row (child_language, source join) |
| `web-quiz-child-lang-migration.test.js` | Pins the child-language table migration as additive: one CREATE TABLE IF NOT EXISTS, RLS on, columns match code usage |
| `web-quiz-child-lang-one-read.test.js` | Pins that the child-language switch rides the hub's single switch read (web-quiz-hub-flags flags()), no extra query |
| `web-quiz-child-lang-page-links.test.js` | Pins that the old class link, results-card door and next-thing link open the home in the child's language, not the |
| `web-quiz-child-lang-quiz-reply.test.js` | Pins that the /quiz WhatsApp reply and its link use the child's language ladder (choice, class quiz, joined language) |
| `web-quiz-child-lang-readers.test.js` | Source-scan guard that every child-language reader in the quiz services is a known caller of the child-lang ladder |
| `web-quiz-child-lang-seam.test.js` | Pins the childLang()/ownOf() resolver against the real child-language repo when web_quiz_return_lang is on |
| `web-quiz-child-rungs-once-migration.test.js` | Runs web_quiz_child_rungs_once.sql on throwaway Postgres: nullable stop column with CHECK, unique rung-once index |
| `web-quiz-child-welcome.test.js` | Pins web_quiz_child_welcome 'Jugnu says hello' first-open hub answer (server half); needs web_quiz_home_v3, default off |
| `web-quiz-class-doors.test.js` | Pins web_quiz_class_doors: hub boot JSON gains class_doors (class table, school league) with the child home on |
| `web-quiz-class-link-homonym-turn.test.js` | Pins that a homonym pick on the class link 'Whose turn?' stays low-confidence until promoted (IDENTITY 2b rows 1 and 6) |
| `web-quiz-class-link-memory.test.js` | Pins how long a phone remembers a class-link child: high pick lasts min(link time left, 28 days), hub token carries exp |
| `web-quiz-class-link-run.test.js` | Pins that the class-link pick reaches the run row and hub_open event; tokens without the claim stay byte-identical |
| `web-quiz-class-link-v2.test.js` | Pins the class link under web_quiz_challenge_v2 and its /h/<token>?from=class_link hand-off logging hub_open src |
| `web-quiz-class-link.test.js` | Main suite for the standing class link /j/<code>: roster minting, term, arrival gate, first-name chips and picking |
| `web-quiz-class-pic-early.test.js` | Pins web_quiz_class_pic_early: class-link picture facts start beside the page reads, same answer, fewer waits |
| `web-quiz-class-pic.test.js` | Pins the class link's own preview picture (what a forwarded /q/<CODE> shows in WhatsApp) for class quiz and class story |
| `web-quiz-class-rows-together.test.js` | Pins web_quiz_class_rows_together: class rows of the class link load together, at least one wave fewer |
| `web-quiz-clip-stable-sign.test.js` | Pins web_quiz_clip_stable_sign: presignAudio stable mode gives byte-identical clip links within an hour, valid 7 h |
| `web-quiz-closed-lang.test.js` | Pins web_quiz_closed_lang: expired-link closed pages render in the child's language (30 s cache, fails off) |
| `web-quiz-config-line.test.js` | Pins the web_quiz.config boot log line: names/hosts only, never a secret value, with documented fallbacks |
| `web-quiz-db-deadline.test.js` | Pins web_quiz_db_deadline: a web-quiz DB read that hangs gets a deadline and one retry (flag on) |
| `web-quiz-door-eligibility.test.js` | Source-scan guard: Jugnu doors call formForChild (one eligibility rule), never formFor( directly |
| `web-quiz-door-event-keys.test.js` | Pins that door_shown/door_tap events (events v2) carry the phone key dk and child key kid from device header and hub |
| `web-quiz-early-unlock-flag.test.js` | Pins web_quiz_early_unlock: hub JSON says early_unlock true only on stored JSON true (new phone's first Home) |
| `web-quiz-edge-learn-fanout.test.js` | Pins that the hub answer under web_quiz_hub_fanout (hubTogether) still carries edge_learn when web_quiz_edge_learn is on |
| `web-quiz-edge-learn.test.js` | Pins web_quiz_edge_learn: GET /api/internal/wq/edge tells a fresh portal process the page switches; needs internal key |
| `web-quiz-edge-warm.test.js` | Pins web_quiz_edge_warm: edge learner answer carries edge_warm and the hub's retry/warm touch for the portal |
| `web-quiz-end-copy-fix.test.js` | Pins web_quiz_end_copy_fix: key rides the card switches' one settings read, named in the page field only when on |
| `web-quiz-end-fit.test.js` | Pins web_quiz_end_fit: page answer says end_fit true so the end screen draws stars to fit the score |
| `web-quiz-end-once.test.js` | Pins web_quiz_end_once: page answer says end_once true so Jugnu's end line never repeats the card heading |
| `web-quiz-end-polish.test.js` | Pins web_quiz_end_polish: key rides the card switches' one settings read, named in the page field only when on |
| `web-quiz-end-short.test.js` | Pins web_quiz_end_short: page answer fits the end screen to a short phone, only beside web_quiz_end_fit |
| `web-quiz-error-event.test.js` | Pins that POST /e web_quiz.error carries a sanitised err (fixed page code), so broken pages on real phones can be named |
| `web-quiz-events-v2-off.test.js` | Golden: with web_quiz_events_v2 off every existing event name and payload on touched paths is byte-identical |
| `web-quiz-face-lite-waves.test.js` | Pins web_quiz_face_lite on the kid hub answer: rides the flags' one batched read, no extra read or serial wave |
| `web-quiz-face-lite.test.js` | Pins web_quiz_face_lite as a documented key in the hub flags' one batched read (web-quiz-hub-flags KEYS), fail closed |
| `web-quiz-fast-challenge.golden.json` | Golden payloads (menu_hub, game pages) for the fast challenge pages, loaded by web-quiz-fast-challenge.test.js |
| `web-quiz-fast-challenge.test.js` | Pins web_quiz_fast on challenge pages (/ch/:token menu and games): payloads identical on/off with fewer waits |
| `web-quiz-fast-finish.golden.json` | Golden scorecard payloads (first finish, review) for fast finish, loaded by web-quiz-fast-finish.test.js |
| `web-quiz-fast-finish.test.js` | Pins web_quiz_fast on finishSession: questions/answers read together, scorecards identical to the switch-off output |
| `web-quiz-fast-hub.test.js` | Pins web_quiz_fast on the kid hub: the chosen child's row and class list are read once, not again for history |
| `web-quiz-fast-reads.golden.json` | Golden quiz page payload for the fast-reads case, loaded by web-quiz-fast-reads.test.js |
| `web-quiz-fast-reads.test.js` | Pins web_quiz_fast on getQuiz: code-only reads run together; payload identical to switch-off with more parallelism |
| `web-quiz-fast-session.golden.json` | Golden startSession answer (chip, device ref, resume) loaded by web-quiz-fast-session.test.js |
| `web-quiz-fast-session.test.js` | Pins web_quiz_fast on startSession: earlier-finish lookup beside the insert; answers identical to switch-off |
| `web-quiz-feedback.test.js` | Pins cleanWrongFeedback: wrong-pick feedback shown/voiced on the web page is trimmed from WhatsApp-shaped video-bank |
| `web-quiz-figure-phone.test.js` | Pins that web page figures stay readable at phone size (344 px box, labels at least 11 px) |
| `web-quiz-figure.test.js` | Pins figureFor: the page gets the figure drawing as inline SVG with alt text, not the WhatsApp question card PNG |
| `web-quiz-finish-timing.test.js` | Pins that finishSession logs one web_quiz.finish_timing line per call with per-step durations, on answer or throw |
| `web-quiz-fix-who-roll.test.js` | Pins the teacher's reconcile actions on a typed child: 'Add to class' enrols with next free list number |
| `web-quiz-fixture.modules.json` | List of two source files (web-quiz-fixture.js, web-quiz-in-chunks.js) the fixture/test-child tests treat as one module |
| `web-quiz-fixture.test.js` | Pins the single test-child rule (web-quiz-fixture.js): test-name, run meta.test and other ordered checks the strip reads |
| `web-quiz-fold-retry.test.js` | Pins web_quiz_fold_retry: folded end card offers a 0-word read a retry via menu field fold_retry (strict JSON true) |
| `web-quiz-games-together.test.js` | Pins web_quiz_games_together: the games door's reads start together, payload identical, cold cache means off |
| `web-quiz-getquiz-cache.test.js` | Pins getQuiz media cache: a lesson page opened twice within 5 minutes presigns media and asks R2 only once |
| `web-quiz-grade-change.test.js` | Pins web_quiz_grade_change: a grown-up can change the child's grade for good; switch rides the hub's one settings read |
| `web-quiz-handset-session.test.js` | Pins session start after a handset bind: a bind-offered chip starts as that child on the trusted device only |
| `web-quiz-handset-token.test.js` | Pins the pure handset link token (kind x): random nonce, share code, 1-hour expiry, no phone or student id |
| `web-quiz-handset.test.js` | Pins the one-shot handset link: bot keeps a phone's children in Redis (1 h) under a nonce, appended as #x= to links |
| `web-quiz-hint.test.js` | Pins the mascot hint: one sentence from the item call, leak() check refuses hints that give the answer away |
| `web-quiz-home-inline-flag.test.js` | Pins web_quiz_home_inline: hub JSON says home_inline true only on stored JSON true, on every hub answer |
| `web-quiz-home-preload-routes.test.js` | Pins web_quiz_home_preload on hub routes: GET and POST /hub answers carry home_pre true however the builder built them |
| `web-quiz-home-remember-column.test.js` | Pins web_quiz_remember_column: the join writes a sha256 device hash on the child binding row; never the raw device |
| `web-quiz-home-remember-seam.test.js` | Pins the 'Jugnu will remember you on this phone' line with one Undo, drawn once on the first home after a self-join |
| `web-quiz-homonym.test.js` | Pins the pure homonym guard on lists of children a device can tap (shared first name, no disambiguator) |
| `web-quiz-hub-batch-ids-flag.test.js` | Pins that hub payload carries ev2 true when web_quiz_events_v2 is on (parent web_quiz_hub on), else keys unchanged |
| `web-quiz-hub-child-lang-seam.test.js` | Pins hubPayload against the real child-language repo: a child's kept language drives the home under web_quiz_return_lang |
| `web-quiz-hub-child-rows.test.js` | Pins web_quiz_hub_child_memo: child student rows, enrolments and class lists read once per hub answer, same output |
| `web-quiz-hub-cold-look.test.js` | Pins web_quiz_look_after: the first hub answer after idle keeps the look flags, same as the next one |
| `web-quiz-hub-cta.test.js` | Pins WhatsAppService.sendCtaUrl: the cta_url payload for the kid hub, button cut to 20 code points, https only |
| `web-quiz-hub-door-events.test.js` | Pins that server web_quiz.hub_door events carry the writer mark w:'s' when web_quiz_events_v2 is on |
| `web-quiz-hub-door.test.js` | Pins the results card's door to the child's hub: finish() offers hub_door and POST /hubdoor mints a phone-bound link |
| `web-quiz-hub-doors.test.js` | Pins the v3 home door screens GET /doors/h/<token>?d=stories|games, gated by web_quiz_home_v3 (404 home_off) |
| `web-quiz-hub-early-kid.test.js` | Pins web_quiz_hub_early_kid: the chosen child's reads start from the link's child before lookup (needs hub_fanout) |
| `web-quiz-hub-embed.test.js` | Pins web_quiz_hub_embed: the hub reads a row with its pointed rows in one request, output identical, falls back on |
| `web-quiz-hub-fanout-pins.test.js` | Pins two hub fanout details: the switch keeper's timer is unref'd, and touch() starts one interval |
| `web-quiz-hub-fanout-waves.test.js` | Pins web_quiz_hub_fanout: independent hub reads start together, same answer and hub_open line, far fewer waves |
| `web-quiz-hub-flags-registry.test.js` | Pins the hub switches registry: web-quiz-hub-flags SWITCHES is one source line per key, KEYS in matching order |
| `web-quiz-hub-home-fallback.test.js` | Pins web_quiz_home_fallback_v3: hub boot JSON gets home_fb 1 only when it and home_v3 are both JSON true |
| `web-quiz-hub-home-preload-flag.test.js` | Pins web_quiz_home_preload on the hub JSON: home_pre true only on stored JSON true, on every hub answer |
| `web-quiz-hub-home-seam.test.js` | Pins the home's phone rows (Someone new?, teacher switch) against the real binding store; erased/expired never minted |
| `web-quiz-hub-home-waves.test.js` | Pins that the v3 child home adds keys to the hub boot JSON without any serial DB round trip (+0 waves) |
| `web-quiz-hub-home.test.js` | Pins the v3 child home keys on the hub boot JSON; golden: web_quiz_home_v3 off gives today's payload with no home key |
| `web-quiz-hub-lang.test.js` | Pins that the hub honours ?lang=en|ur over the history guess, only under web_quiz_challenge_v2 |
| `web-quiz-hub-lantern-tile.test.js` | Pins that the hub lantern names only the story of the tile under it (newest live read story), seen/unseen via |
| `web-quiz-hub-list-states.test.js` | Pins web_quiz_list_states: hub boot JSON gets list_states 1 only when it and home_v3 are both JSON true |
| `web-quiz-hub-listen-flag.test.js` | Pins web_quiz_readalong: hub JSON says listen true only when switch on AND the phone is trusted with the hub |
| `web-quiz-hub-pick-inherit.test.js` | Pins that the hub chip's pick record inherits the quiz start's pick (recordHubPick); loose child stays low (RULING #87) |
| `web-quiz-hub-play.test.js` | Pins the hub's Jugnu corner (web-quiz-hub-play.js) via the real hub payload: next-thing resolver, passages, badges |
| `web-quiz-hub-post-fields.test.js` | Pins that GET and POST /hub/:token carry the same page fields when their switches are on |
| `web-quiz-hub-return-lang.test.js` | Pins web_quiz_return_lang: a self-joined child returning via WhatsApp /quiz gets a home in the family's language |
| `web-quiz-hub-roster-warm.test.js` | Pins web_quiz_hub_roster_warm: the fanout keeper refreshes class rosters the hub uses, stops for unused classes |
| `web-quiz-hub-server-timing.test.js` | Pins the Server-Timing header on GET /api/internal/wq/hub/:token: one name;dur per awaited step, body unchanged |
| `web-quiz-hub-stories-waves.test.js` | Pins that the v3 home's Stories field adds no serial read wave to the hub, with web_quiz_stories off or on |
| `web-quiz-hub-token.test.js` | Pins the kid hub token (kind h): names the phone's children by id for 7 days, no name or phone inside |
| `web-quiz-hub-waves2.test.js` | Pins web_quiz_hub_waves2: longest hub read chains start earlier inside the fanout branch, identical answer, fewer waves |
| `web-quiz-hub-waves3.test.js` | Pins web_quiz_hub_waves3: last serial hub reads move earlier beside waves2; identical answer, wait counts as numbers |
| `web-quiz-hub.test.js` | Main kid hub suite (web-quiz-hub.js) and the WhatsApp /quiz open() that links to it: tokens, 401/503, payload, hub_open |
| `web-quiz-identity-fixture.js` | Shared fixture for identity v2 tests: a synthetic school with two grade-4 sections, a quiz, a class code and collisions |
| `web-quiz-identity-session.test.js` | Pins identity v2 on the session endpoint (web_quiz_identity v2): typed name matched inside one class, roster answers |
| `web-quiz-identity-shared.test.js` | Pins canonicalStudentIdsShared: hub identity lookup shared within one visit (under 1.5 s), same answers as unshared |
| `web-quiz-identity.test.js` | Pins identity v2 pure core: canon/smartFirst name normalisation for Urdu/Latin, roster dedupe and matching |
| `web-quiz-in-chunks.test.js` | Pins inChunks: supabase .in() lists over ~390 UUIDs are split so the 16 KB header cap is not hit, join queue included |
| `web-quiz-internal.routes.test.js` | Pins the /api/internal/wq HTTP routes: x-api-key gate (401), service errors mapped to their status codes |
| `web-quiz-invite-ask.test.js` | Pins web_quiz_invite_ask: challenge asked as 'who can beat your score?' with three who tiles (off|on|split) |
| `web-quiz-items.test.js` | Pins the web quiz item (SCHEMA_v2 in quiz_questions.media.web): source quote location and first-party gates, LLM faked |
| `web-quiz-join-queue-gate.test.js` | Pins the teacher join queue serve gate: only roster_unique_with_loose tier, merge_log.tier recorded, Wilson bound gate |
| `web-quiz-juice.test.js` | Pins web_quiz_juice switch (sound and motion kit): default off, 30 s cache, and the juice demo-page answer to the edge |
| `web-quiz-keep-place-golden.test.js` | Goldens: with phone-bind and identity-canon switches off, hub JSON and challenge answers equal the pre-feature snapshots |
| `web-quiz-kid-emit.test.js` | Pins the web-quiz-kid emit helper: events-v2 envelope/mark kinds, switch read fail-closed, no forbidden ids |
| `web-quiz-kid-together.test.js` | Pins web_quiz_kid_together: tap routes (library, doors) read the child together; same answers, fewer waves |
| `web-quiz-kid.test.js` | Pins web-quiz-kid keyed ids: kid/dk/cls/ukey are HMAC-SHA256 under WEB_QUIZ_KID_KEY, null with one log if key missing |
| `web-quiz-library.test.js` | Pins the web video library (web-quiz-library.js): subjects for a grade then chapters from an in-memory video bank index |
| `web-quiz-link-home.test.js` | Pins web_quiz_link_home: an old finished class link opens the remembered child's own hub (needs web_quiz_hub on) |
| `web-quiz-link-known-events.test.js` | Pins events v3 for the class link 'Is it <First>?' sheet: known_ask and identity_pick events, golden when off |
| `web-quiz-link-known.test.js` | Pins web_quiz_link_known_child: a class link on a phone already holding a child offers that child first |
| `web-quiz-link-together.test.js` | Pins web_quiz_link_together: the class link's own reads start together; same page and starts, waits never longer |
| `web-quiz-live-meter.test.js` | Pins web_quiz_live_meter (sky|vine|true): the menu and hub name the live reading meter variant, only with live read v3 |
| `web-quiz-live-read-v3-off.test.js` | Golden: with web_quiz_live_read_v3 absent the menu, read payload and scored reading equal a base-recorded golden |
| `web-quiz-live-read-v3.test.js` | Pins live reading v3 (web_quiz_live_read_v3): read payload tells the page how a reading finishes itself (lr3) |
| `web-quiz-match-codes.test.js` | Pins that a WhatsApp-coded match question becomes the web page's own tap-to-match (letters, pictures, key) |
| `web-quiz-measure-events.test.js` | Pins events v2 m_result/m_lost built from stored v2 run rows (comp_ok/comp_n, never an option index) |
| `web-quiz-message-ledger-capped-migration.test.js` | Runs web_quiz_message_ledger_capped.sql on throwaway Postgres: capped column, old rows read 0, add fn untouched |
| `web-quiz-message-ledger-migration.test.js` | Runs web_quiz_message_ledger.sql on throwaway Postgres: one row per day/trigger/class/initiator key, |
| `web-quiz-message-ledger-minutes-migration.test.js` | Runs web_quiz_message_ledger_minutes.sql on throwaway Postgres: minutes column, one 8-arg message_ledger_add() |
| `web-quiz-minify.test.js` | Pins web_quiz_minify: quiz and hub payloads say min true so the edge links minified page files (30 s cache, fails |
| `web-quiz-next-offer-counts.test.js` | Pins scripts/web-quiz/counts/web_quiz_next_offer.js: read-only offer-count table, sandbox-only host guard |
| `web-quiz-next-offer-events.test.js` | Pins next-thing slot page events through the relay under web_quiz_events_v3; golden equals today when off |
| `web-quiz-next-offer-hub-waves.test.js` | Pins that the ranked next thing adds no serial round trip to the kid hub (switches off vs on) |
| `web-quiz-next-offer-hub.test.js` | Pins the ranked next thing on the hub boot (hubField via real hub payload); golden: web_quiz_next_offer off gives no |
| `web-quiz-next-offer-rank.test.js` | Pins the pure rank() of the next-offer slot: teacher quiz pin first, month stop early, daily resume, then score ordering |
| `web-quiz-next-offer-video.test.js` | Pins the ranked Next after a watched video: POST /videos/start WATCH answer carries watch.next from the slot |
| `web-quiz-next.test.js` | Pins finish() on a video quiz naming 'Next in this chapter': next unfinished video in the same grade, subject and order |
| `web-quiz-no-card.test.js` | Pins that the web page never shows the WhatsApp question card PNG; figure shown instead, card-only has no picture |
| `web-quiz-non-attempters.test.js` | Pins nonAttempters (teacher follow-up list of class children who have not played) and its two reconcile actions |
| `web-quiz-offline-guard-waves.test.js` | Pins that web_quiz_offline_guard adds no serial DB round trip to the kid hub answer (warm and stale) |
| `web-quiz-offline-guard.test.js` | Pins web_quiz_offline_guard: a tap while offline stays on the page; default off, JSON true only, 30 s cache |
| `web-quiz-og.test.js` | Pins the bot-held link preview facts cache so every portal worker answers a preview fetch without a quiz render |
| `web-quiz-one-button.test.js` | Pins web_quiz_one_button switch: default off, JSON true only, 30 s cache, rides the hub's one settings read |
| `web-quiz-one-face-join.test.js` | Pins GET /join/page/:token under web_quiz_one_face: ok or stale answer says one_face true, nothing else changes |
| `web-quiz-one-face-waves.test.js` | Pins that web_quiz_one_face adds no serial DB round trip to the kid hub answer (warm and stale) |
| `web-quiz-one-face.test.js` | Pins web_quiz_one_face switch (one Urdu face): default off, JSON true only; quiz, hub and challenge answers say one_face |
| `web-quiz-one-hop.test.js` | Pins web_quiz_one_hop: the shelf, videos door and a story open in one hop; only with fast-path switches on |
| `web-quiz-one-voice-elevenlabs.test.js` | Pins that a caller pinning an ElevenLabs voice (web quiz ONE_VOICE) gets exactly that voice/model; unpinned callers |
| `web-quiz-one-voice-long-clips.test.js` | Pins one-voice: long clips (listening story, read-along) are never recorded on the fly; a missing one is refused |
| `web-quiz-one-voice-page-reads.test.js` | Pins that web_quiz_one_voice adds no settings read to getQuiz; it rides the page's own settings read |
| `web-quiz-one-voice-per-quiz.test.js` | Pins one voice per quiz for library (video-bank) quizzes: all parts spoken in one voice instead of two |
| `web-quiz-one-voice-say-as.test.js` | Pins that Urdu words a voice would misread are spelled for the voice only (web-quiz-ur-say.js), page text unchanged |
| `web-quiz-one-voice-short-clip.test.js` | Pins that a plan's loudness_lufs levels short clips too (loudnorm gain with a peak ceiling) |
| `web-quiz-one-voice.test.js` | Pins web quiz audio: one voice per language, configurable bucket, readable keys, recording kill switch and daily cap |
| `web-quiz-pack-flag.test.js` | Pins web_quiz_pack: hub JSON says pack true only on stored JSON true, on every hub answer including locked |
| `web-quiz-pack-waves.test.js` | Pins that web_quiz_pack adds no DB round trip or settings read to the kid hub (rides one batched read, +0) |
| `web-quiz-page-boot.test.js` | Pins web_quiz_page_boot: page switches are warmed at process start so a fresh process's first page reads none |
| `web-quiz-page-keep.test.js` | Pins web_quiz_page_keep: page switches kept in one read, so the page after a quiet spell reads no switch |
| `web-quiz-page-lang.test.js` | Pins web_quiz_page_lang: the quiz page in the child's language; key rides the hub switches' one settings read |
| `web-quiz-page-warm.test.js` | Pins web_quiz_page_warm: class link page switches kept warm; first answer is the warm answer with 14+ fewer waits |
| `web-quiz-picture-check.test.js` | Pins that a question picture whose media.picture_check verdict is contradict/misleading is never shown on the web |
| `web-quiz-picture-supposed.test.js` | Pins that a question whose stem supposes a picture it lacks is not served on the web; served when picture exists |
| `web-quiz-picture-zoom-nosharp.test.js` | Pins that the picture-zoom module loads and zoomFor returns null when the sharp native module is missing |
| `web-quiz-picture-zoom.test.js` | Pins that near-identical picture options are cropped/zoomed to what differs so a child can tell them apart |
| `web-quiz-pictures.test.js` | Pins web page pictures readable at 360 px: engine nouns drawn in colour on the page, line art kept on WhatsApp |
| `web-quiz-plain-paint.test.js` | Pins web_quiz_plain_paint: wordless first paint switch, default off, JSON true only, 30 s cache, never waited for |
| `web-quiz-practice-best.test.js` | Pins that a practice round finish carries the child's best earlier score on the same code for a 'New best!' card |
| `web-quiz-provenance-seam.test.js` | Pins that web-quiz-provenance.js reads only students columns the real table has (column list parsed from the CREATE |
| `web-quiz-pulse.test.js` | Pins peer pulse ('a classmate got Q4 right'): in-memory ring (TTL, own-session exclusion, newest 3) and its routes |
| `web-quiz-qa-fixes.test.js` | Pins fixes from the first sandbox end-to-end run of the web quiz (E2 teacher naming as the forwarded WhatsApp text) |
| `web-quiz-quiz-lang.test.js` | Pins getQuiz child_lang: a grown-up's chosen language (web_quiz_return_lang) shown for a chip's child on /quiz/<code>?k= |
| `web-quiz-ra-preload.test.js` | Pins web_quiz_ra_preload: games menu says ra_pre true only when switch, read-along and passage menu all apply |
| `web-quiz-read-feedback-stories.test.js` | Pins web_quiz_read_feedback on storybooks: story_done carries a reading summary (words read across the book) |
| `web-quiz-read-feedback.test.js` | Pins web_quiz_read_feedback: every scored read result carries coarse feedback {stars, badge, words_heard} |
| `web-quiz-read-growth-level.test.js` | Pins 'Faster than last time' comparing the last scored read at the SAME text level (form), not the last read |
| `web-quiz-recorded-voices.test.js` | Pins that library quizzes keep their own recorded voices: the page gets each option's clip recorded for that option |
| `web-quiz-redis-scan-values.test.js` | Pins Redis service scanValues(match): values of matching keys via SCAN and GET, never keys; null when unavailable |
| `web-quiz-relay-consent-ping.test.js` | Pins the page relay cleanEvent (events v2): page-posted sample_ping_* events dropped, consent line rules |
| `web-quiz-rewatch-done.test.js` | Pins web_quiz_rewatch_done: hub JSON says rewatch_done true only on stored JSON true; finished lesson picture replays |
| `web-quiz-rewatch-quiz-answer.test.js` | Pins getQuiz rewatch_done: a finished lesson opened with ?again=1 says it is a replay (rides hub's batched read) |
| `web-quiz-roster.test.js` | Pins web_quiz_roster_id: who plays by roll number, server answers 'Are you <first name>?' from the teacher's class list |
| `web-quiz-rungs-off.test.js` | Golden: with web_quiz_challenge_rungs off the Challenge submit path is byte-identical to before the rung job |
| `web-quiz-rungs.test.js` | Pins the rung job (web-quiz-rungs.js): computeRung per grade band and the web_quiz.lamp_lit event, needs challenge_v2 |
| `web-quiz-sample-ping-migration.test.js` | Runs web_quiz_sample_ping.sql on throwaway Postgres: sample_ping_consents and the ping log tables, constraints |
| `web-quiz-sample-ping-seam.test.js` | Pins the direct ping frame read against the real binding store and the columns the tables really have |
| `web-quiz-sample-window.test.js` | Pins web-quiz-sample-window daily(): web_quiz.sample_window event per drawn class whose window opens that PKT day |
| `web-quiz-schools.test.js` | Pins the school leaderboard (web-quiz-schools.js): pure weekly school points stat (Monday PKT) and the board the page |
| `web-quiz-seed-picture.test.js` | Pins that a 'seed' picture on the web quiz is drawn as beans, not the WhatsApp chestnut emoji |
| `web-quiz-share-bidi.test.js` | Pins web_quiz_share_bidi: Urdu share lines keep each number with its word (U+00A0) and read right to left |
| `web-quiz-share-card-a.test.js` | Pins web_quiz_share_card_a: the share token is marked and the picture is design A from web-quiz-card-a.js |
| `web-quiz-share-card-ink.test.js` | Pins that Urdu text on share pictures is never clipped (overhanging strokes, line-height 2+ on finish card) |
| `web-quiz-share-data.test.js` | Pins web_quiz_share_data: finish score, stars, words and badge read from server rows at mint and sealed into the token |
| `web-quiz-share-joined.test.js` | Pins web_quiz_share_joined: the sharer hears 'A friend joined Jugnu from your card!' via the card's short id |
| `web-quiz-share-lang-score.test.js` | Pins three share fixes (first-score after replay, language, score) each behind its own default-off switch |
| `web-quiz-share-name-bidi.test.js` | Pins web_quiz_share_name_bidi: the challenger is named the same way on Urdu and English pages |
| `web-quiz-share-open.test.js` | Pins web_quiz_share_v4 landing: a shared card's typed item ref lands a NEW child on that item |
| `web-quiz-share-page-lang.test.js` | Pins web_quiz_share_page_lang: share follow-ups follow the page's language, not the lesson's (page answer field) |
| `web-quiz-share-short.test.js` | Pins web_quiz_share_short: card link is /s/<8 hex> short id (kept 90 days against the token), not the long /k/<token> |
| `web-quiz-share-switch-reads.test.js` | Pins that web_quiz_share_ur_stack and web_quiz_share_name_bidi add no read to a child's quiz page |
| `web-quiz-share-v4-field.test.js` | Pins the share_v4 field on quiz finish and Jugnu menu: set only when web_quiz_card_v3 and share_v4 are both JSON true |
| `web-quiz-share-v4-join-seam.test.js` | Pins share_v4 join seam: a shared card's item ref is kept for the phone and the join/hub reply home link opens it |
| `web-quiz-share-v4-story-seal.test.js` | Pins share_v4 storybook seal: card token carries the finished book, checked server-side, one settings read on/off |
| `web-quiz-share-v4.test.js` | Main share_v4 suite: one share for every finish (storybook, video) with a server-checked token, behind default-off |
| `web-quiz-share-warm.test.js` | Pins that share and invite pictures are drawn when the quiz FINISHES, not at first scorecard view; failed finish draws |
| `web-quiz-sound.test.js` | Pins that 'whose sound is this?' items carry media.stimulus_audio clips through to the web page |
| `web-quiz-steps.test.js` | Pins getQuiz and startSession timing logs: web_quiz.getquiz_timing and web_quiz.session_timing, ids and numbers only |
| `web-quiz-stories-count.test.js` | Pins scripts/web-quiz/counts/web_quiz_stories.js: pure grade x language storybook count table, sandbox-only guard |
| `web-quiz-stories-notice-record.test.js` | Pins that a story_page_read saying the mic notice was shown records the child as having seen that notice version |
| `web-quiz-stories-slow-gaps.test.js` | Pins web_quiz_stories_slow_gaps: book says slow_gaps true so 'Slower' pauses between phrases (child and teacher preview) |
| `web-quiz-stories-warm.test.js` | Pins web_quiz_story_warm: shelf answer says warm true and each book its first page so the reader files prefetch |
| `web-quiz-stories.test.js` | Main storybook suite (web-quiz-stories.js, web_quiz_stories): shelf, book and events routes; off answers 404 stories_off |
| `web-quiz-storybook-next.test.js` | Pins storybook candidates for the next-thing ranker: half-read book first, then unread ready books for grade/language |
| `web-quiz-strip-dry.golden.json` | Golden strip rows and queries recorded for the weekly strip dry run, loaded by web-quiz-strip-dry.test.js |
| `web-quiz-strip-dry.modules.json` | List of bot service files whose content is treated as the strip dry-run's module set (read by web-quiz-owned-paths test) |
| `web-quiz-strip-dry.test.js` | Pins weeklyStrip dry run: a sink receives the exact rows with nothing written; golden queries byte-identical |
| `web-quiz-strip-fixtures.test.js` | Pins that test children (meta.test, 'Testwala' name, configured seed) are excluded from the weekly health numbers |
| `web-quiz-strip-floor-kept.test.js` | Pins floor_kept_aligned weekly line: kept failed reads under the heard-words floor that matched a script, per language |
| `web-quiz-strip-identity.test.js` | Pins two identity lines on the weekly strip: reply-cap histogram from Redis counters and a second identity line |
| `web-quiz-strip-ledger-lines.golden.json` | Golden weekly-strip ledger lines (fixtures_excluded, plays, ...) loaded by web-quiz-strip-ledger-lines.test.js |
| `web-quiz-strip-ledger-lines.test.js` | Pins weekly strip lines sent/capped from message_ledger (and sibling ledger-derived lines); golden-backed |
| `web-quiz-strip-lines.test.js` | Pins weekly strip line set recognised_without_typing by days since last visit (first, le7, gt7) |
| `web-quiz-strip-link-eligible.test.js` | Pins classes_link_eligible (D5 denominator): active class with active teacher row and enrolment; agrees with the mint |
| `web-quiz-strip-period.golden.json` | Golden weekly-strip rows for the period-label case, loaded by web-quiz-strip-period.test.js |
| `web-quiz-strip-period.test.js` | Pins period labels on weekly strip: October 2026 short first period note on month-to-date lines, values unchanged |
| `web-quiz-strip-provenance.test.js` | Pins strip trust of id_confidence high only when the student row proves it; unproven highs counted separately |
| `web-quiz-strip-rapid.test.js` | Pins the strip 'rapid' line: too-fast perfect warm-up check records per band x language cell |
| `web-quiz-strip.test.js` | Main weekly strip suite (web-quiz-strip.js): PKT week bounds, lost-readings rate, lines written to web_quiz_strip_weekly |
| `web-quiz-student-join-child-lang-seam.test.js` | Pins student join() against the real child-language repo: web_quiz_return_lang on writes the join link's language |
| `web-quiz-student-join-off.test.js` | Pins visible refusal of student join when quiz_student_join is on but web_quiz_phone_bind is off (G6, 27 Oct 2026) |
| `web-quiz-student-join-seam.test.js` | Main student self-join suite (quiz_student_join): one students row, child_identity, one child_phone_bindings row |
| `web-quiz-student-join-waves.golden.json` | Golden DB/Redis call sequences for the join page's cold and warm flows, loaded by student-join-waves.test.js |
| `web-quiz-student-join-waves.test.js` | Pins quiz_join_fast: wave count of POST /api/wq/join for a fresh phone, shell answer and grade tap vs golden |
| `web-quiz-timing.test.js` | Pins web_quiz.timing logging: each /api/internal/wq route logs ms and DB round trips, by route pattern |
| `web-quiz-token.test.js` | Pins web quiz signed tokens (session, teacher preview, name chip): signing/verify, fail closed with no secret |
| `web-quiz-trail-page.test.js` | Pins the Trail page v2 switch bits on menu/exercise payloads and the mic notice; golden when v2 off |
| `web-quiz-ua-app.test.js` | Pins page_open ua_app classification (whatsapp|webview|samsung|browser) from the user agent |
| `web-quiz-ur-polish.test.js` | Pins web_quiz_ur_polish switch: child pages' Urdu look, default off, fail closed, cached; ui() null when absent |
| `web-quiz-ur-say.test.js` | Pins web-quiz-ur-say sayOf: Urdu words a voice misreads are respelled for the voice only, others unchanged |
| `web-quiz-ur-share-copy.test.js` | Pins web_quiz_ur_share_copy: corrected Urdu share words; key rides the finish card's one settings read |
| `web-quiz-urdu-name.test.js` | Pins that an Urdu quiz shows a child's name one way (class list Urdu spelling) on every screen |
| `web-quiz-urdu-title.test.js` | Pins that an Urdu quiz page opens on an Urdu title, not the English lesson catalog name |
| `web-quiz-video-clean-start-hub.test.js` | Pins web_quiz_video_clean_start on hub JSON: video_clean true only on stored JSON true (one play button at 0:00) |
| `web-quiz-video-clean-start-quiz.test.js` | Pins getQuiz video_clean: the lesson video page shows one play button at 0:00 when the switch is JSON true |
| `web-quiz-video-lengths-keep.test.js` | Pins web_quiz_video_shelf lesson-length cache: kept in Redis for life and re-read once after a bot restart |
| `web-quiz-video-lengths-warm.test.js` | Pins that opening the hub with web_quiz_video_shelf and the home on warms the child's grade lesson lengths |
| `web-quiz-video-shelf-route.test.js` | Pins GET /api/internal/wq/vt/<lesson>.webp: lesson thumbnail as cacheable WebP, 404 no-store when none |
| `web-quiz-video-shelf.test.js` | Pins web_quiz_video_shelf: the Videos door's picture shelves (hub shelf true, subject lesson lists) |
| `web-quiz-video-topic-ur.test.js` | Pins web_quiz_videos_ur_titles on the quiz page: quiz.topic_ur from student_videos.title_ur; absent when off |
| `web-quiz-videos-hub.test.js` | Pins POST /videos/start from the kid hub {hub, kid, vid}: class code is the newest teacher-sent code, minted once |
| `web-quiz-videos-lang.test.js` | Pins that a library quiz page boots in the quiz's own language, not its class code's (Urdu RTL from an English class) |
| `web-quiz-videos-ur-titles.test.js` | Pins web_quiz_videos_ur_titles: library lists carry Urdu title_ur/chapter_ur; chapter list case |
| `web-quiz-videos-v3-counts.test.js` | Pins scripts/web-quiz/counts/web_quiz_videos_v3.js: read-only per grade/subject video library count table |
| `web-quiz-videos-v3-off.test.js` | Golden: with web_quiz_videos_v3 off the video library answers byte-identically to the pre-switch code |
| `web-quiz-videos-v3.test.js` | Pins web_quiz_videos_v3 on: library lists videos in the child's language, sorts chapters by number |
| `web-quiz-videos-watch-root.test.js` | Pins the videos module's reading of web_quiz_watch_root (trimmed, lower-case id; non-id ignored) |
| `web-quiz-videos-watch.test.js` | Pins videos for a child with no class (web_quiz_home_v3): off keeps 409 no_class; on lets them WATCH via the root |
| `web-quiz-videos.test.js` | Pins 'Watch another video' (web-quiz-videos.js) and how resolveCode/startSession treat its codes differently |
| `web-quiz-voice-gap-phone.test.js` | Pins web_quiz_voice_gap_phone: quiz answer says voice_gap_phone true so the phone reads a line with no recorded clip |
| `web-quiz-wait-hops.test.js` | Pins web_quiz_wait_hops: hub answers say wait_hops true only with the designed wait (web_quiz_wait_ux) on |
| `web-quiz-wait-ux-cache-only.test.js` | Pins that web_quiz_wait_ux on() answers from the hub's warm switch cache only; cold cache is off, no read |
| `web-quiz-wait-ux-doors.test.js` | Pins the Games door under web_quiz_wait_ux: reads side by side, spoken labels waited at most SAY_WAIT_MS |
| `web-quiz-wait-ux-routes.test.js` | Pins web_quiz_wait_ux on routes: hub answers (GET and POST) say wait_ux true for the progress bar, nothing else |
| `web-quiz-watch-privacy.test.js` | Pins that a class-less child's watch-root code shows no other children as 'who are you' chips (privacy) |
| `web-quiz-who-played.test.js` | Pins the teacher's Who played? on the signed preview link: one row per child, first name and roll only |
| `web-quiz-word-blank-served.test.js` | Pins that a live word_blank not matching the question asked is left out of web serving (gates v2), logged by id |
| `web-quiz.service.test.js` | Main web child quiz service suite (E2-E10): endpoints, one-attempt, scoring, 503 web_quiz_off with no secret |

## Who reads this (all, generated)
- column `quiz_answers.session_id` (written by `web-quiz-db-deadline.test.js`) ← read by `bot/shared/services/quiz/quiz-report.service.js:331:ee5701cc` · `bot/shared/services/quiz/quiz-session.service.js:282:3bd24780` · `bot/shared/services/quiz/teacher-report.data.js:323:6427ee6f` · `bot/shared/services/quiz/video-quiz-report.service.js:1630:5e48d988` (+3: `python3 kg/kg.py who-reads quiz_answers.session_id`)
- column `quizzes.grade` (written by `web-quiz-videos-ur-titles.test.js`, `web-quiz-videos-v3.test.js`) ← read by `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/maker.prefill.js:102:94d3eeca` · `bot/shared/services/quiz/handout-class.service.js:119:c28fee2c` · `bot/shared/services/quiz/lp-quiz-cache.js:138:36826a1f` (+13: `python3 kg/kg.py who-reads quizzes.grade`)
- column `quizzes.id` (written by `web-quiz-videos-ur-titles.test.js`, `web-quiz-videos-v3.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8` · `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` (+58: `python3 kg/kg.py who-reads quizzes.id`)
- column `quizzes.meta` (written by `web-quiz-identity.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/teacher-home.data.js:129:dcd760cd` (+23: `python3 kg/kg.py who-reads quizzes.meta`)
- column `quizzes.quiz_source` (written by `web-quiz-videos-ur-titles.test.js`, `web-quiz-videos-v3.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/shared/routes/quiz-flow-endpoint.js:301:fca7d9fc` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:70:fcf12f1a` (+27: `python3 kg/kg.py who-reads quizzes.quiz_source`)
- column `quizzes.status` (written by `web-quiz-videos-ur-titles.test.js`, `web-quiz-videos-v3.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:135:8cb71b1f` · `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:70:fcf12f1a` (+26: `python3 kg/kg.py who-reads quizzes.status`)
- column `quizzes.subject` (written by `web-quiz-videos-ur-titles.test.js`, `web-quiz-videos-v3.test.js`) ← read by `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/maker.prefill.js:102:94d3eeca` · `bot/shared/services/quiz/lp-quiz-cache.js:138:36826a1f` (+14: `python3 kg/kg.py who-reads quizzes.subject`)
- column `quizzes.topic` (written by `web-quiz-videos-ur-titles.test.js`, `web-quiz-videos-v3.test.js`) ← read by `bot/shared/routes/quiz-flow-endpoint.js:225:98889254` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:274:b52fa8e6` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/first-touch/teacher-home.data.js:209:d536eafa` (+23: `python3 kg/kg.py who-reads quizzes.topic`)
- column `quizzes.video_id` (written by `web-quiz-videos-ur-titles.test.js`, `web-quiz-videos-v3.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/shared/services/first-touch/maker.bank.js:69:c09109dc` · `bot/shared/services/quiz/video-quiz.service.js:147:848303cb` · `bot/shared/services/quiz/web-quiz-bank.js:45:f64e19e2` (+6: `python3 kg/kg.py who-reads quizzes.video_id`)
- column `student_lists.class_name` (written by `web-quiz-roster.test.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:299:99d94161` · `bot/shared/routes/edit-class-endpoint.js:36:99d94161` · `bot/shared/routes/quiz-flow-endpoint.js:121:68c7e306` · `bot/shared/services/attendance-portal.service.js:244:99d94161` (+15: `python3 kg/kg.py who-reads student_lists.class_name`)
- column `student_videos.clean_chapter` (written by `web-quiz-videos-v3.test.js`) ← read by `bot/shared/routes/student-videos-endpoint.js:44:c160f508` · `bot/shared/services/quiz/web-quiz-bank.js:43:ce9a7a84` · `bot/shared/services/quiz/web-quiz-hub.js:376:833db504` · `bot/shared/services/quiz/web-quiz-videos.js:208:85ce7c02` (+1: `python3 kg/kg.py who-reads student_videos.clean_chapter`)
- column `student_videos.clean_title` (written by `web-quiz-videos-v3.test.js`) ← read by `bot/shared/routes/student-videos-endpoint.js:44:c160f508` · `bot/shared/services/quiz/video-quiz.service.js:243:88c26cb1` · `bot/shared/services/quiz/web-quiz-bank.js:43:ce9a7a84` · `bot/shared/services/quiz/web-quiz-library.js:392:3833f082` (+2: `python3 kg/kg.py who-reads student_videos.clean_title`)
- column `student_videos.grade` (written by `web-quiz-videos-v3.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:130:1b43cbb0` · `bot/shared/routes/student-videos-endpoint.js:44:c160f508` · `bot/shared/services/quiz/video-quiz.service.js:243:88c26cb1` · `bot/shared/services/quiz/web-quiz-bank.js:43:ce9a7a84` (+5: `python3 kg/kg.py who-reads student_videos.grade`)
- column `student_videos.id` (written by `web-quiz-videos-v3.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:130:1b43cbb0` · `bot/shared/routes/student-videos-endpoint.js:44:c160f508` · `bot/shared/services/first-touch/maker.bank.js:71:c7c9316d` · `bot/shared/services/quiz/video-quiz.service.js:243:88c26cb1` (+8: `python3 kg/kg.py who-reads student_videos.id`)
- column `student_videos.language` (written by `web-quiz-videos-v3.test.js`) ← read by `bot/shared/services/quiz/web-quiz-bank.js:77:615b1933` · `scripts/web-quiz/backfill-video-language.js:51:9a132fd6`
- column `student_videos.migration_status` (written by `web-quiz-videos-v3.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:131:efbc5230` · `bot/shared/routes/student-videos-endpoint.js:45:7fee7905` · `bot/shared/services/quiz/video-quiz.service.js:243:88c26cb1` · `bot/shared/services/quiz/web-quiz-bank.js:44:ff25d7b2` (+5: `python3 kg/kg.py who-reads student_videos.migration_status`)
- column `student_videos.r2_url` (written by `web-quiz-videos-v3.test.js`) ← read by `bot/shared/routes/student-videos-endpoint.js:44:c160f508` · `bot/shared/services/quiz/video-quiz.service.js:243:88c26cb1` · `bot/shared/services/quiz/web-quiz-bank.js:43:ce9a7a84` · `bot/shared/services/quiz/web-quiz-library.js:392:3833f082` (+1: `python3 kg/kg.py who-reads student_videos.r2_url`)
- column `student_videos.subject` (written by `web-quiz-videos-v3.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:130:1b43cbb0` · `bot/shared/routes/student-videos-endpoint.js:44:c160f508` · `bot/shared/services/quiz/video-quiz.service.js:243:88c26cb1` · `bot/shared/services/quiz/web-quiz-bank.js:43:ce9a7a84` (+5: `python3 kg/kg.py who-reads student_videos.subject`)
- column `student_videos.superseded_by` (written by `web-quiz-videos-v3.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:131:efbc5230` · `bot/shared/routes/student-videos-endpoint.js:46:0ec013e3` · `bot/shared/services/first-touch/maker.bank.js:71:c7c9316d` · `bot/shared/services/quiz/web-quiz-bank.js:44:ff25d7b2` (+3: `python3 kg/kg.py who-reads student_videos.superseded_by`)
- table `student_lists` whole row (`*`) (written by `web-quiz-roster.test.js`) ← read by `bot/shared/services/student-list.service.js:263:d2b02c3e`?
- table `quiz_answers` (written by `web-quiz-db-deadline.test.js`) ← read by `bot/shared/services/quiz/quiz-report.service.js:318:9367da8b`? · `bot/shared/services/quiz/quiz-session.service.js:280:9367da8b`? · `bot/shared/services/quiz/teacher-report.data.js:322:0d4b1708`? · `bot/shared/services/quiz/video-quiz-report.service.js:1628:9367da8b`? (+3: `python3 kg/kg.py who-reads quiz_answers`)
- table `quizzes` (written by `web-quiz-identity.test.js`, `web-quiz-videos-ur-titles.test.js`, `web-quiz-videos-v3.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8`? · `bot/shared/routes/quiz-flow-endpoint.js:224:2c6afb51`? · `bot/shared/routes/transcript-quiz-flow-endpoint.js:273:baba8374`? (+59: `python3 kg/kg.py who-reads quizzes`)
- table `student_lists` (written by `web-quiz-roster.test.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:298:8479d615`? · `bot/shared/routes/attendance-setup-endpoint.js:174:8479d615`? · `bot/shared/routes/edit-class-endpoint.js:33:8479d615`? · `bot/shared/routes/quiz-flow-endpoint.js:120:8479d615`? (+24: `python3 kg/kg.py who-reads student_lists`)
- table `student_videos` (written by `web-quiz-videos-ur-titles.test.js`, `web-quiz-videos-v3.test.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:130:1b43cbb0`? · `bot/shared/routes/student-videos-endpoint.js:43:774bb5a8`? · `bot/shared/services/first-touch/maker.bank.js:71:c7c9316d`? · `bot/shared/services/quiz/video-quiz.service.js:242:774bb5a8`? (+8: `python3 kg/kg.py who-reads student_videos`)
- table `web_quiz_challenge_runs` (written by `web-quiz-challenge-budget.test.js`) ← read by `bot/scripts/quiz/rescore-kept-reads.js:130:a8a3c5a3`? · `bot/shared/services/quiz/teacher-jugnu.data.js:105:3ab72ffd`? · `bot/shared/services/quiz/web-quiz-book.js:100:63055e72`? · `bot/shared/services/quiz/web-quiz-card-data.js:50:5d46b6f7`? (+9: `python3 kg/kg.py who-reads web_quiz_challenge_runs`)
- env `GOLDEN_WRITE` read at `bot/tests/quiz/web-quiz/class-round-retired-still.test.js:55:7f08b924` · `bot/tests/quiz/web-quiz/quiz-report-renders.test.js:19:49e3254a` · `bot/tests/quiz/web-quiz/teacher-class-week.test.js:148:57e58f9a` · `bot/tests/quiz/web-quiz/teacher-jugnu-golden.test.js:93:a50a1fbc` · `bot/tests/quiz/web-quiz/teacher-report-fold-by-child.test.js:173:0cb812d5` · `bot/tests/quiz/web-quiz/web-quiz-class-link-run.test.js:108:a50a1fbc` · `bot/tests/quiz/web-quiz/web-quiz-class-link.test.js:427:5f71ba79` · `bot/tests/quiz/web-quiz/web-quiz-class-pic.test.js:253:a50a1fbc`
- env `INK_DEBUG` read at `bot/tests/quiz/web-quiz/web-quiz-share-card-ink.test.js:164:9a98b940`
- env `INTERNAL_API_KEY` read at `bot/tests/quiz/web-quiz/web-quiz-db-deadline.test.js:26:e9cb80e9` · `bot/tests/quiz/web-quiz/web-quiz-end-copy-fix.test.js:119:c5e811f2` · `bot/tests/quiz/web-quiz/web-quiz-handset-token.test.js:40:3d849406` · `bot/tests/quiz/web-quiz/web-quiz-one-hop.test.js:430:b82cff0e` · `bot/tests/quiz/web-quiz/web-quiz-schools.test.js:189:c5e811f2` · `bot/tests/quiz/web-quiz/web-quiz-ua-app.test.js:23:b82cff0e`
- env `NODE_ENV` read at `bot/tests/quiz/web-quiz/web-quiz-db-deadline.test.js:238:0d316c78`
- env `OPENAI_API_KEY` read at `bot/tests/quiz/web-quiz/challenge-clip-warm.test.js:39:acce1dae` · `bot/tests/quiz/web-quiz/web-quiz-challenge-story-voice.test.js:32:acce1dae` · `bot/tests/quiz/web-quiz/web-quiz-one-voice-long-clips.test.js:40:acce1dae`
- env `OPENROUTER_API_KEY` read at `bot/tests/quiz/web-quiz/challenge-clip-warm.test.js:38:1370b6dc` · `bot/tests/quiz/web-quiz/web-quiz-challenge-story-voice.test.js:31:1370b6dc` · `bot/tests/quiz/web-quiz/web-quiz-one-voice-long-clips.test.js:39:1370b6dc`
- env `PG_BIN` read at `bot/tests/quiz/web-quiz/challenge-passage-licence.test.js:123:0f807607` · `bot/tests/quiz/web-quiz/challenge-provenance.test.js:280:0f807607` · `bot/tests/quiz/web-quiz/class-round-migration.test.js:21:0f807607` · `bot/tests/quiz/web-quiz/stories-migration.test.js:21:0f807607` · `bot/tests/quiz/web-quiz/videos-title-ur-migration.test.js:16:0f807607` · `bot/tests/quiz/web-quiz/web-quiz-challenge-runs-notice-migration.test.js:22:0f807607` · `bot/tests/quiz/web-quiz/web-quiz-challenge-runs-record-locks-migration.test.js:20:0f807607` · `bot/tests/quiz/web-quiz/web-quiz-challenge-runs-sampling-migration.test.js:19:0f807607` · `bot/tests/quiz/web-quiz/web-quiz-challenge-runs-v2-migration.test.js:19:0f807607` · `bot/tests/quiz/web-quiz/web-quiz-child-rungs-once-migration.test.js:20:0f807607` · `bot/tests/quiz/web-quiz/web-quiz-message-ledger-capped-migration.test.js:18:0f807607` · `bot/tests/quiz/web-quiz/web-quiz-message-ledger-migration.test.js:18:0f807607` · `bot/tests/quiz/web-quiz/web-quiz-message-ledger-minutes-migration.test.js:19:0f807607` · `bot/tests/quiz/web-quiz/web-quiz-sample-ping-migration.test.js:21:0f807607`
- env `PROBE_EMB` read at `bot/tests/quiz/web-quiz/web-quiz-games-together.test.js:96:ce881cef`
- env `PROBE_OUT` read at `bot/tests/quiz/web-quiz/web-quiz-games-together.test.js:174:d534f31f`
- env `PROBE_TABLE` read at `bot/tests/quiz/web-quiz/web-quiz-games-together.test.js:174:d534f31f`
- env `PROBE_W3` read at `bot/tests/quiz/web-quiz/web-quiz-games-together.test.js:96:ce881cef`
- env `PROBE_WRAP` read at `bot/tests/quiz/web-quiz/web-quiz-games-together.test.js:194:778992a0`
- env `REDIS_URL` read at `bot/tests/quiz/web-quiz/web-quiz-redis-scan-values.test.js:12:767089d6`
- env `WEB_QUIZ_KID_KEY` read at `bot/tests/quiz/web-quiz/student-join-teacher-link.test.js:105:f5291a2b`
- env `WEB_QUIZ_TOKEN_SECRET` read at `bot/tests/quiz/web-quiz/web-quiz-schools.test.js:408:9b5cdeeb` · `bot/tests/quiz/web-quiz/web-quiz-stories-count.test.js:55:03c5932a`
- env `WORKER_QUEUES` read at `bot/tests/quiz/web-quiz/challenge-clip-warm.test.js:483:6d3a6f82`
- env `WQ_TOMB_SALT` read at `bot/tests/quiz/web-quiz/web-quiz-share-open.test.js:180:bf276946`
- env `WRITE_STORIES_CSP_GOLDEN` read at `bot/tests/quiz/web-quiz/story-teacher-page-csp.test.js:171:e960253d`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/quiz/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/data/child-test/CLAUDE.index.md`? · `bot/shared/data/child-test/CLAUDE.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/classes/CLAUDE.index.md`? · `bot/shared/services/classes/CLAUDE.md`? · `bot/shared/services/first-touch/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.md`? · `bot/shared/services/quiz/pictures/CLAUDE.md`? · `bot/shared/services/settings/CLAUDE.md`? · `bot/shared/services/tts/CLAUDE.index.md`? · `bot/shared/services/tts/CLAUDE.md`? · `bot/shared/templates/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.md`? · `bot/tests/quiz/CLAUDE.index.md`? · `bot/tests/quiz/CLAUDE.md`? · `bot/tests/quiz/web-quiz/CLAUDE.index.md`? · `bot/tests/quiz/web-quiz/CLAUDE.md`? · `bot/tests/quiz/web-quiz/__fixtures__/CLAUDE.md`? · `bot/tests/quiz/web-quiz/__golden__/CLAUDE.index.md`? · `bot/tests/quiz/web-quiz/__golden__/CLAUDE.md`? · `bot/tests/quiz/web-quiz/__goldens__/CLAUDE.md`? · `bot/vendor/lp-v9/CLAUDE.index.md`? · `bot/vendor/lp-v9/SYNC.md`? · `bot/workers/CLAUDE.index.md`? · `scripts/web-quiz/CLAUDE.index.md`? · `scripts/web-quiz/CLAUDE.md`? · `scripts/web-quiz/counts/CLAUDE.md`?
