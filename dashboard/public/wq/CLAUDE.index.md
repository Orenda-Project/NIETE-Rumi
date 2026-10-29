# wq — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/public/wq -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `art/` | Grade and subject cover pictures (webp) for the child video library tiles → `art/CLAUDE.md` |
| `fonts/` | Urdu Nastaliq and digit font subsets (woff2) plus their OFL licence texts → `fonts/CLAUDE.md` |
| `jugnu/` | Jugnu mascot animations (webp, webm) per mood: hello, correct, notyet, idle, sleep → `jugnu/CLAUDE.md` |
| `snd/` | Sound sprite for the child pages' chimes and fanfare → `snd/CLAUDE.md` |
| `voice/` | Recorded voice clips and manifests for Jugnu's shared lines and the child welcome → `voice/CLAUDE.md` |
| `class-link.js` | Standing class link /j/<code> steps (whose turn, teacher letter, name pick) ending at the child's hub /h/<token> |
| `hub-play.js` | Hub's Jugnu corner: Jugnu card, lantern 'next' line, Story Time shelf with NEW tags; loaded when hub JSON has play |
| `hub.js` | Kid hub /h/<token>: picks this phone's child, lists teacher quiz, replays, recommended videos, library, challenge |
| `join.js` | Join screen /quiz/join/<token>: grade chips, first name, saving notice, then the child's home (quiz_student_join) |
| `jugnu_celebrate.webp` | (unmapped) |
| `jugnu_correct.webp` | (unmapped) |
| `jugnu_hello.webp` | (unmapped) |
| `jugnu_idle.webp` | (unmapped) |
| `jugnu_notyet.webp` | (unmapped) |
| `jugnu_sleep.webp` | (unmapped) |
| `jugnu_thinking.webp` | (unmapped) |
| `manifest.webmanifest` | (unmapped) |
| `og-rumi.jpg` | (unmapped) |
| `og.jpg` | (unmapped) |
| `probe.html` | Browser capability probe served at /wq-probe: tests mic, media, sharing on real phones and posts the result as one event |
| `sw-off.js` | Reminder worker served at /sw.js while web_quiz_push_remind is off; unregisters itself so old phones drop the worker |
| `sw.js` | Jugnu's push-reminder service worker (/sw.js, push_remind on): daily reminder, opens quiz on tap; no fetch handler |
| `wq-adv-more.js` | WQAD, second half of the adventure look: finish-card Jugnu cheer, Home trail stops, Urdu Home label; loaded by wq-adv.js |
| `wq-adv.js` | WQA adventure-look kit: inline-SVG icons, bars, badges, motions and sound cues; active only when payload has adv:true |
| `wq-adventure.css` | Adventure look stylesheet, all rules under html.wq-adv: three lands, pill buttons with edge, Home, done screens, motion |
| `wq-bind.css` | Styles for the 'Keep your place on WhatsApp' card, confirm sheet and Saved/Undo line; linked when hub JSON has bind |
| `wq-bind.js` | 'Keep your place on WhatsApp' card (web_quiz_phone_bind): confirm sheet, wa.me hand-off, Saved/Undo on return |
| `wq-book.css` | Styles for Jugnu's Book screen and hub tile (lamps, week days, sticker grid, class lights); taps >= 48 px |
| `wq-book.js` | Jugnu's Book (web_quiz_challenge_book): hub tile and Book screen of lamps, stickers, days, from the bot's book API |
| `wq-card.js` | Jugnu challenge card on the quiz scorecard (web_quiz_challenge_card): html() and wire(); loaded by wq.js's finish |
| `wq-challenge.js` | Kid Challenge page /c/<hub token>: menu of solo exercises (bigger, live read-aloud, numbers) and their results |
| `wq-cue.js` | Child welcome's last cue (web_quiz_child_welcome): once, a hand points at the page's first control, 'Your turn', 6 s |
| `wq-digits.js` | urDigits helper: ASCII digits to Urdu digits U+06F0-06F9; shared by the edge (web-quiz.routes.js) and pages as WQDigits |
| `wq-doors.css` | Styles for the v3 home's Stories, Games, Videos door screens: speaker rows, section heads, watch screen |
| `wq-doors.js` | WQDOORS: v3 home's three door screens (Stories, Games, Videos) and the no-class video player, loaded by wq-home.js |
| `wq-finish-card.css` | Minified styles for the shareable finish card (.wqfc: heading, count, stamp, share/next tiles) |
| `wq-finish-card.js` | WQFC: shareable card after every finish (quiz, read, story, game, video) with Send to class + Next tile; card_v3 |
| `wq-g1.js` | Grade-1 'how many dots?' stop on the Challenge page: ten-frame and three numeral tiles; no score ever shown |
| `wq-home.css` | Styles for the v3 child home: header with day-dots, single Next tile, fixed bottom door bar (wq-home.js) |
| `wq-home.js` | WQHOME: v3 child home (web_quiz_home_v3): one Next tile, three doors, day-dots, grown-ups corner behind a 2 s hold |
| `wq-identity.js` | WQID: 'who is playing?' v2 screens (name first, class, collision questions); used when boot cls.identity.mode is v2 |
| `wq-juice.css` | Styles for the sound+motion kit: mute button, streak strip, confetti layer, press feedback (wq-juice.js) |
| `wq-juice.js` | WQJ sound and motion kit (web_quiz_juice): chimes, wobble, streak strips from the juice-1 sprite |
| `wq-lib.js` | WQL video library on the quiz page: subject tiles by grade, chapters in the WhatsApp Flow's order, download button |
| `wq-liveread.css` | Styles for live reading v3 (.lr: passage words with heard/read/missed colours); linked only with the bot's lr3 flag |
| `wq-liveread.js` | WQLiveRead v3: matches streamed speech-to-text to passage words (prefix read, skipped never wrong, numerals folded) |
| `wq-moment.css` | Styles for the reading-moment card: words, jar of lights, stars, own-last-read line, effort badge (wq-moment.js) |
| `wq-moment.js` | WQMoment: instant feedback after every reading effort (words, speed jar, stars, own last read); read_feedback |
| `wq-pace.css` | Styles for the live reading pace meter (track, fill, light marks); only with web_quiz_live_meter |
| `wq-pace.js` | WQPace: live reading meter; grade-based full pace (G1-2 35, G3 50, G4-5 60) and sustained-pace level from words read |
| `wq-read-live.js` | WQLive: live read-aloud word lighting; JS port of bot scoring/text-norm.js clean/same/align plus a prefix tracker |
| `wq-readalong-listen.js` | Grown-up preview of a practice story at hub #listen/<passage_id>: stored clip with word highlight, no run or mic |
| `wq-readalong.js` | WQReadAlong: Jugnu reads and one pill moves word to word from a timing object; play/pause/seek/slow |
| `wq-remind.js` | WQREMIND: Jugnu's reminder ask card on results and the /remind/:code landing page (web_quiz_push_remind) |
| `wq-stories-d.js` | Stories part 3: questions, look-back page, done screen, teacher's read-only questions; loaded by wq-stories-q.js |
| `wq-stories-q.js` | Stories part 2: Your turn, reading together, questions and done screens, plus the copy rules for story text |
| `wq-stories-w.js` | Warms the story reader (web_quiz_story_warm): prefetches reader files and a tapped book's first picture |
| `wq-stories.css` | Styles for the storybook shelf and reader (.wqs): warm paper, zoomed line, Urdu RTL spacing |
| `wq-stories.js` | WQSTORIES: storybook shelf and page reader with Jugnu read-along; shelf(), open(), route(); parts q/d/w load later |
| `wq-story-link.js` | Teacher-sent storybook link /q/<code> (web_quiz_stories_teacher): landing copy then opens the hub on the book |
| `wq-tel.js` | Web quiz page telemetry: page-session id and ordered events in batches; inert unless boot rt is true (rich_telemetry) |
| `wq-trail.js` | WQTRAIL: Challenge page v2 (web_quiz_challenge_v2): 'someone helping?' question, mic notice card, trail of stops |
| `wq-welcome.css` | Styles for the first-open welcome layer: dim scrim with spotlight hole, Skip row, Jugnu and hand pointer (wq-welcome.js) |
| `wq-welcome.js` | Child welcome 'Jugnu says hello' (web_quiz_child_welcome): 4-step layer over home with Skip, nudge, recorded voice |
| `wq.css` | Base stylesheet for every child web page: NIETE brand tokens (server overrides per brand), cards, buttons, options |
| `wq.js` | Web child quiz page /q/<code>: WQI item renderer, offline answer queue, /api/wq/* calls, results and scorecard |

## Who reads this (all, generated)
- `wq-digits.js` ← imported by `dashboard/routes/web-quiz.routes.js:42:35273fa4`

## Tests (all, generated)
- `wq-digits.js` ← `dashboard/tests/web-quiz-preview-urdu-digits.service.test.js`
- `wq.js` ← `dashboard/tests/web-quiz-items.service.test.js` · `dashboard/tests/web-quiz-look-latin-feedback.service.test.js` · `dashboard/tests/web-quiz-look-latin-polish.service.test.js` · `dashboard/tests/web-quiz-option-voices.service.test.js` · `dashboard/tests/web-quiz-page-match-pictures.service.test.js` · `dashboard/tests/web-quiz-page-pictures.service.test.js` (+4: `python3 kg/kg.py who-reads dashboard/public/wq/wq.js`)

## Related (all, generated)
- docs: `dashboard/public/CLAUDE.md`?
