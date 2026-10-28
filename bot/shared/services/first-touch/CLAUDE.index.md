# first-touch — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/first-touch -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `adventure-look.js` | Flags and shared CSS tokens for the 'adventure look' of the first-touch pages (default OFF) |
| `cards.page.js` | Quiz-maker page's three branch cards (lesson plans, coaching, test paper) linking back to the chat via wa.me |
| `chat-tap.js` | Builds the one tap back to WhatsApp on dead-end pages (expired/forged/failed links) |
| `closed-way-back.flags.js` | Reads app_settings web_quiz_closed_way_back, the default-OFF switch for the dead-end page way-back tap |
| `door-bound.js` | Abuse bound on the one-door reply: 10s same-text dedupe and per-phone reply ceiling |
| `door.keys.js` | Names every first-touch door key/trigger stored in user_feature_first_use, the one module that holds them |
| `door.service.js` | First-touch door verdict for an unknown handset asking for a quiz (doorVerdict called by student-ingress classify) |
| `go-nonce.js` | Redis-held nonce mapping an opaque /quiz link nonce to phone and user, so identity never appears in a URL |
| `go.mount.js` | Mounts the one door's internal router at /api/internal/go, failing soft if the module throws on load |
| `go.page.js` | Server-rendered pages of the one door (role question, pick, message) with no DB read and tiny CSP-safe assets |
| `go.routes.js` | Internal /api/internal/go router: landing, who-asks and destination routing called by the portal edge |
| `go.targets.js` | Resolves where the one door sends a person once identified (teacher home, join page, child page) |
| `go.token.js` | Signs and verifies the 24h 'go' landing token via the web-quiz token signer |
| `maker.bank.js` | Builds the quiz-maker chip tree (grade, subject, topic) from the live video-bank quizzes and makes the quiz |
| `maker.cta.js` | Builds the maker cta_url reply and public /m/ link, writing the send ledger before the send |
| `maker.empty.js` | Turns the empty /quiz list reply into the maker cta when quiz_maker_page is on |
| `maker.fallback.js` | Sends the 3-button fallback when the maker cta is refused and handles what each button does |
| `maker.fallback.send.js` | Leaf module with the maker fallback message words and its single send, avoiding a require loop with /quiz list |
| `maker.fallback.strings.js` | Verbatim signed copy for the empty /quiz maker reply and the maker refused-send fallback buttons |
| `maker.mount.js` | Mounts the quiz-maker router at /api/internal/ft, failing soft if the module throws on load |
| `maker.page.js` | Server-renders the quiz-maker page /m/<token>: chips, make button, ready screen, share and copy |
| `maker.prefill.js` | Computes the maker page's 'last time' grade and subject pre-fill from a teacher's quizzes, shares and lesson plans |
| `maker.qlang.js` | Pure rule deciding the language of a bank quiz's questions (Arabic-script ratio) for marks and share text |
| `maker.routes.js` | Internal /api/internal/ft router for the maker page and make/share actions; identity only from the maker token |
| `maker.strings.js` | Verbatim signed copy for every word of the quiz-maker page and its WhatsApp cta |
| `maker.token.js` | Signs and verifies the 24h kind-m maker page bearer token via the web-quiz token signer |
| `mount-failed.js` | Logs once at error level when a first-touch mount line fails to load, silent when the module is absent |
| `mounts.js` | Ordered list of optional first-touch mounts that whatsapp-bot.js runs, each in its own try |
| `one-door.flags.js` | Reads the quiz_one_door switch and reply ceiling app_settings in one cached, fail-closed read |
| `one-door.service.js` | The one door: every quiz request gets ONE cta_url reply into a page that decides teacher or child (quiz_one_door) |
| `one-door.strings.js` | Verbatim signed copy for the one door's reply, role question page and landing notes; cta buttons capped 20 points |
| `one-door.words.js` | Pure leaf mapping the words that asked for a quiz to the quiz_cmd event src (class_msg, card_share) |
| `optional-modules.js` | Name-keyed late loader for optional first-touch modules; absent returns null, a broken one throws loudly |
| `push-remind.mount.js` | Mounts the web-quiz reminder push router at /api/internal/wqpush (web_quiz_push_remind), failing soft |
| `role.service.js` | Server-side answer to who holds this phone (teacher, child, coach, join), re-read on every landing |
| `sa-game.mount.js` | Mounts the sa-game router at /api/internal/sagame behind the sa_game switch, failing soft |
| `teacher-home-counts.flag.js` | Reads app_settings quiz_teacher_story_counts: JSON true only, 30s cache, fail closed |
| `teacher-home.copy.js` | Single source of the class message return line used by the teacher home, maker, stories page and shared card |
| `teacher-home.data.js` | Teacher home data reads: lessons, coaching, played counts, delegating to the services that own each rule |
| `teacher-home.flags.js` | Reads the teacher home switches quiz_teacher_home, _paged and server_timing; JSON-true semantics, 30s cache |
| `teacher-home.model.js` | Pure builder of the teacher home JSON: top card (class, lesson, share) from the reads and a clock |
| `teacher-home.more-flags.js` | Reads the teacher home named_item and early_pick switches (JSON true only, 30s cache) |
| `teacher-home.mount.js` | Mounts the teacher home router at /api/internal/th, failing soft |
| `teacher-home.page.js` | Server-renders the teacher home shell /quiz/teacher/<token>; an inline script fills it after paint |
| `teacher-home.portal.mount.js` | Mounts the teacher app home-card router at /api/internal/thportal, failing soft |
| `teacher-home.portal.routes.js` | Internal /api/internal/thportal route the dashboard calls for the teacher app's home card (uid-based) |
| `teacher-home.routes.js` | Internal /api/internal/th router: teacher home shell, JSON and actions behind the signed th token |
| `teacher-home.send.js` | Builds what the teacher home sends or starts: class messages for video, share, again, and quiz start |
| `teacher-home.sent.js` | Redis marker for library share codes prepared but not yet sent, so the home's class line ignores them |
| `teacher-home.strings.js` | Verbatim signed copy for every word of the teacher home, reusing maker and report-page ids |
| `teacher-home.token.js` | Signs and verifies the 24h kind-th teacher home bearer token via the web-quiz token signer |
| `teacher-stories-stale.flag.js` | Reads app_settings quiz_teacher_stories_stale_words (JSON true only) for stale stories-page links |
| `tour.page.js` | Tour banner addon for the maker page (markup, script, css) shown once and replayable |
| `tour.routes.js` | POST /api/ft/tour route recording tour shown, dismissed or replayed events via door.keys |
| `walk-persona.js` | Sandbox-only walk-through letting one test phone act as each person the one door knows (quiz_test_personas) |

## Who reads this (all, generated)
- `adventure-look.js` ← imported by `bot/shared/services/quiz/web-quiz-student-join.js:53:2186ccb5` · `dashboard/routes/quiz-join.routes.js:25:e3e71566` · `bot/shared/services/first-touch/go.page.js:33:02844da5` · `bot/shared/services/first-touch/one-door.flags.js:39:519d00c6`
- `cards.page.js` ← imported by `bot/shared/services/first-touch/chat-tap.js:24:c82cd0f2` · `bot/shared/services/first-touch/go.page.js:203:e8ae1863` · `bot/shared/services/first-touch/maker.routes.js:40:aec06f7d`
- `chat-tap.js` ← imported by `dashboard/routes/quiz-go.routes.js:30:86f3c60a` · `dashboard/routes/web-quiz.routes.js:46:86f3c60a` · `bot/shared/services/first-touch/go.page.js:264:9382ac74` · `bot/shared/services/first-touch/go.routes.js:189:00766a6c` (+2: `python3 kg/kg.py who-reads chat-tap.js`)
- `closed-way-back.flags.js` ← imported by `bot/shared/services/first-touch/go.routes.js:188:84103fe7` · `bot/shared/services/first-touch/maker.routes.js:102:3ea65ce6` · `bot/shared/services/first-touch/teacher-home.routes.js:139:3ea65ce6`
- `door-bound.js` ← imported by `bot/shared/services/first-touch/one-door.service.js:160:4e9df975`
- `door.keys.js` ← imported by `bot/shared/services/quiz/web-quiz-student-join.js:474:01a8a7e2` · `bot/shared/services/first-touch/door.service.js:25:47bc7dce` · `bot/shared/services/first-touch/maker.routes.js:36:47bc7dce` · `bot/shared/services/first-touch/role.service.js:148:47bc7dce` (+2: `python3 kg/kg.py who-reads door.keys.js`)
- `door.service.js` ← imported by `bot/shared/services/student-ingress.js:135:5cd2beb6` · `bot/shared/services/first-touch/role.service.js:149:4b1f9669`
- `go-nonce.js` ← imported by `bot/shared/services/quiz/web-quiz-student-join.js:50:e18c14c3` · `bot/shared/services/first-touch/go.routes.js:40:69f38a5d` · `bot/shared/services/first-touch/one-door.service.js:59:69f38a5d`
- `go.page.js` ← imported by `dashboard/routes/quiz-go.routes.js:29:0d5d6e00` · `bot/shared/services/first-touch/go.routes.js:43:536022a3`
- `go.routes.js` ← imported by `bot/shared/services/first-touch/go.mount.js:8:4fea0691` · `bot/shared/services/first-touch/walk-persona.js:335:8282259c`
- `go.targets.js` ← imported by `bot/shared/services/first-touch/go.routes.js:42:2d68640f`
- `go.token.js` ← imported by `bot/shared/services/first-touch/go.routes.js:39:befa94af` · `bot/shared/services/first-touch/one-door.service.js:58:befa94af` · `bot/shared/services/first-touch/walk-persona.js:309:2a1add6c`
- `maker.bank.js` ← imported by `bot/shared/services/first-touch/maker.cta.js:60:b47ecb2f` · `bot/shared/services/first-touch/maker.routes.js:32:b47ecb2f` · `bot/shared/services/first-touch/teacher-home.data.js:39:134b7e55` · `bot/shared/services/first-touch/teacher-home.send.js:23:2b0d054b`
- `maker.cta.js` ← imported by `bot/shared/services/first-touch/go.routes.js:263:ef0e87ce` · `bot/shared/services/first-touch/maker.empty.js:54:03877c9b` · `bot/shared/services/first-touch/teacher-home.data.js:40:fba58b2a`
- `maker.empty.js` ← imported by `bot/shared/services/quiz/transcript-quiz-list.service.js:332:1f83ed62`
- `maker.fallback.js` ← imported by `bot/whatsapp-bot.js:777:84f97bb3`
- `maker.fallback.send.js` ← imported by `bot/shared/services/first-touch/maker.cta.js:87:0a77cdbe` · `bot/shared/services/first-touch/maker.fallback.js:25:eb8b4d73`
- `maker.fallback.strings.js` ← imported by `bot/shared/services/first-touch/maker.cta.js:49:5719ffde` · `bot/shared/services/first-touch/maker.fallback.send.js:9:aeaff2f4`
- `maker.page.js` ← imported by `dashboard/routes/first-touch.routes.js:25:265f6dca` · `dashboard/routes/quiz-teacher.routes.js:32:265f6dca` · `dashboard/routes/teacher-stories.routes.js:26:265f6dca` · `bot/shared/services/first-touch/maker.routes.js:33:4dabea1e` (+1: `python3 kg/kg.py who-reads maker.page.js`)
- `maker.prefill.js` ← imported by `bot/shared/services/first-touch/maker.cta.js:25:d3ea5a3a`
- `maker.qlang.js` ← imported by `bot/scripts/quiz/backfill-quiz-language.js:41:e62bc798` · `bot/shared/services/first-touch/maker.bank.js:27:968b24ec`
- `maker.routes.js` ← imported by `bot/shared/services/first-touch/maker.mount.js:8:fde608df`
- `maker.strings.js` ← imported by `bot/shared/services/first-touch/cards.page.js:28:331ebb9d` · `bot/shared/services/first-touch/maker.bank.js:26:e024dfc0` · `bot/shared/services/first-touch/maker.cta.js:24:e024dfc0` · `bot/shared/services/first-touch/maker.page.js:23:634aa236` (+3: `python3 kg/kg.py who-reads maker.strings.js`)
- `maker.token.js` ← imported by `bot/shared/services/first-touch/maker.cta.js:22:b634d213` · `bot/shared/services/first-touch/maker.routes.js:31:b634d213`
- `mount-failed.js` ← imported by `bot/whatsapp-bot.js:94:a62e272c`
- `mounts.js` ← imported by `bot/whatsapp-bot.js:93:561ab336`
- `one-door.flags.js` ← imported by `bot/shared/handlers/text-message.handler.js:590:adfbeb1d` · `bot/shared/services/menu.service.js:318:43268a5a` · `bot/shared/services/quiz/message-ledger.js:187:36017577` · `bot/shared/services/quiz/quiz-menu-entry.service.js:94:75793fe7` (+5: `python3 kg/kg.py who-reads one-door.flags.js`)
- `one-door.service.js` ← imported by `bot/shared/services/menu.service.js:319:c464b76b` · `bot/shared/services/quiz/quiz-menu-entry.service.js:95:57f06e89` · `bot/shared/services/quiz/teacher-quiz-home.service.js:68:cc5b9eba` · `bot/shared/services/quiz/web-quiz-home-remember.js:174:6b7b3e9b` (+1: `python3 kg/kg.py who-reads one-door.service.js`)
- `one-door.strings.js` ← imported by `bot/shared/services/quiz/student-quiz.service.js:239:a79e4f60` · `bot/shared/services/first-touch/chat-tap.js:17:5c0e9ff6` · `bot/shared/services/first-touch/go.page.js:32:5c0e9ff6` · `bot/shared/services/first-touch/one-door.service.js:28:71376448`
- `one-door.words.js` ← imported by `bot/shared/services/first-touch/one-door.service.js:29:56f5aaff`
- `optional-modules.js` ← imported by `bot/shared/services/first-touch/go.routes.js:171:0c552849` · `bot/shared/services/first-touch/go.targets.js:24:d88dbe73` · `bot/shared/services/first-touch/role.service.js:161:78d0cbd9` · `bot/shared/services/first-touch/teacher-home.portal.routes.js:37:ca12a008`
- `role.service.js` ← imported by `bot/shared/services/first-touch/go.routes.js:41:18ad0273` · `bot/shared/services/first-touch/one-door.service.js:27:18ad0273` · `bot/shared/services/first-touch/walk-persona.js:223:7980fe93`
- `teacher-home-counts.flag.js` ← imported by `bot/shared/services/first-touch/teacher-home.data.js:46:c139dde4`
- `teacher-home.copy.js` ← imported by `bot/shared/services/quiz/story-teacher.service.js:218:68adcaac` · `bot/shared/services/first-touch/maker.routes.js:74:893c93b9` · `bot/shared/services/first-touch/teacher-home.page.js:431:3febc90c` · `bot/shared/services/first-touch/teacher-home.routes.js:86:0ac40489` (+1: `python3 kg/kg.py who-reads teacher-home.copy.js`)
- `teacher-home.data.js` ← imported by `bot/shared/services/first-touch/teacher-home.portal.routes.js:26:37b2162e` · `bot/shared/services/first-touch/teacher-home.routes.js:59:37b2162e`
- `teacher-home.flags.js` ← imported by `bot/shared/services/quiz/teacher-report.data.js:182:cff85bf4` · `bot/shared/services/quiz/web-quiz-class-pic.js:133:92514440` · `bot/shared/services/quiz/web-quiz-identity.js:345:943bfd5c` · `bot/shared/services/quiz/web-quiz-page-warm.js:119:ba3c63a3` (+4: `python3 kg/kg.py who-reads teacher-home.flags.js`)
- `teacher-home.model.js` ← imported by `bot/shared/services/first-touch/teacher-home.portal.routes.js:27:c927145a` · `bot/shared/services/first-touch/teacher-home.routes.js:60:c927145a`
- `teacher-home.more-flags.js` ← imported by `bot/shared/services/first-touch/teacher-home.routes.js:56:40d5b2b8`
- `teacher-home.page.js` ← imported by `bot/shared/templates/teacher-stories.page.js:160:193fcba6` · `bot/shared/services/first-touch/teacher-home.routes.js:58:a854bbcc`
- `teacher-home.portal.routes.js` ← imported by `bot/shared/services/first-touch/teacher-home.portal.mount.js:9:6db79799`
- `teacher-home.routes.js` ← imported by `bot/shared/services/first-touch/teacher-home.mount.js:8:c6ad9da6`
- `teacher-home.send.js` ← imported by `bot/shared/services/first-touch/teacher-home.data.js:206:5a17d338` · `bot/shared/services/first-touch/teacher-home.routes.js:61:5a17d338`
- `teacher-home.sent.js` ← imported by `bot/shared/services/quiz/teacher-report.data.js:250:dd4044fa` · `bot/shared/services/first-touch/maker.routes.js:80:563942fd` · `bot/shared/services/first-touch/teacher-home.data.js:157:70e83d32` · `bot/shared/services/first-touch/teacher-home.routes.js:631:62fdeefc` (+1: `python3 kg/kg.py who-reads teacher-home.sent.js`)
- `teacher-home.strings.js` ← imported by `dashboard/routes/quiz-teacher.routes.js:33:decd09ca` · `dashboard/routes/teacher-stories.routes.js:27:decd09ca` · `bot/shared/services/first-touch/teacher-home.copy.js:11:3424bbdb` · `bot/shared/services/first-touch/teacher-home.page.js:37:1eb45283` (+1: `python3 kg/kg.py who-reads teacher-home.strings.js`)
- `teacher-home.token.js` ← imported by `bot/shared/services/nudges/window-closed-template.js:38:d64c7f63` · `bot/shared/services/quiz/story-teacher.service.js:83:1d0023d3` · `bot/shared/services/first-touch/teacher-home.portal.routes.js:25:6bfe9970` · `bot/shared/services/first-touch/teacher-home.routes.js:57:6bfe9970`
- `teacher-stories-stale.flag.js` ← imported by `bot/shared/services/first-touch/teacher-home.routes.js:62:68b718eb`
- `tour.page.js` ← imported by `bot/shared/services/first-touch/maker.routes.js:37:bddd8f44`
- `tour.routes.js` ← imported by `bot/shared/services/first-touch/maker.routes.js:224:3f058b2d`
- `walk-persona.js` ← imported by `bot/shared/services/quiz/web-quiz-bind.service.js:53:41ac4e1f` · `bot/shared/services/quiz/web-quiz-student-join.js:254:542c59c7`
- column `quiz_share_codes.active` (written by `teacher-home.send.js`) ← read by `bot/shared/services/quiz/story-teacher.service.js:193:2c3900c5` · `bot/shared/services/quiz/web-quiz-bank.js:148:49548c18` · `bot/shared/services/quiz/web-quiz-class-pic.js:93:a598c478` · `bot/shared/services/quiz/web-quiz-class-twin.js:34:1055e171` (+7: `python3 kg/kg.py who-reads quiz_share_codes.active`)
- table `quiz_share_codes` (written by `teacher-home.send.js`) ← read by `bot/shared/services/quiz/child-identity-reuse.js:31:2111be10`? · `bot/shared/services/quiz/handout-class.service.js:193:5b028a07`? · `bot/shared/services/quiz/report-delivery.js:80:4299222a`? · `bot/shared/services/quiz/story-teacher.service.js:193:2c3900c5`? (+26: `python3 kg/kg.py who-reads quiz_share_codes`)

## Tests (all, generated)
- `adventure-look.js` ← `bot/tests/first-touch/adventure-look.first-pages.test.js` · `dashboard/tests/adventure-tokens-equal.service.test.js` · `dashboard/tests/quiz-join-adventure.service.test.js`
- `cards.page.js` ← `bot/tests/first-touch/maker.cards.assessment-door.test.js` · `bot/tests/first-touch/maker.cards.test.js`
- `chat-tap.js` ← `dashboard/tests/web-quiz-closed-inline.service.test.js`
- `closed-way-back.flags.js` ← `bot/tests/first-touch/one-door-way-back.test.js`
- `door-bound.js` ← `bot/tests/first-touch/door-bound-seam.test.js` · `bot/tests/first-touch/one-door-abuse-bound.test.js`
- `door.keys.js` ← `bot/tests/first-touch/door-cache.test.js` · `bot/tests/first-touch/door-keys.test.js` · `bot/tests/first-touch/maker.tour.test.js`
- `door.service.js` ← `bot/tests/first-touch/door-cache.test.js` · `bot/tests/first-touch/door-on.test.js`
- `go-nonce.js` ← `bot/tests/quiz/web-quiz/web-quiz-child-lang-join.test.js` · `bot/tests/quiz/web-quiz/web-quiz-home-remember-column.test.js` · `bot/tests/quiz/web-quiz/web-quiz-home-remember-seam.test.js` · `bot/tests/quiz/web-quiz/web-quiz-share-joined.test.js` · `bot/tests/quiz/web-quiz/web-quiz-share-v4-join-seam.test.js` · `bot/tests/quiz/web-quiz/web-quiz-student-join-child-lang-seam.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/services/first-touch/go-nonce.js`)
- `go.mount.js` ← `bot/tests/first-touch/one-door-go-routes.test.js` · `bot/tests/first-touch/one-door-way-back.test.js` · `bot/tests/first-touch/walk-persona-seam.test.js`
- `go.page.js` ← `bot/tests/first-touch/adventure-look.first-pages.test.js` · `bot/tests/first-touch/one-door-go-routes.test.js` · `bot/tests/first-touch/one-door-way-back.test.js` · `bot/tests/first-touch/walk-persona-seam.test.js` · `dashboard/tests/edge-security-headers.service.test.js`
- `go.routes.js` ← `bot/tests/first-touch/one-door-go-routes.test.js` · `bot/tests/quiz/web-quiz/web-quiz-hub-return-lang.test.js`
- `go.targets.js` ← `bot/tests/quiz/web-quiz/web-quiz-hub-return-lang.test.js` · `bot/tests/quiz/web-quiz/web-quiz-share-v4-join-seam.test.js`
- `go.token.js` ← `bot/tests/first-touch/one-door-entry.test.js` · `bot/tests/first-touch/one-door-go-routes.test.js` · `bot/tests/first-touch/walk-persona-seam.test.js` · `bot/tests/quiz/web-quiz/web-quiz-share-v4-join-seam.test.js`
- `maker.bank.js` ← `bot/tests/first-touch/maker.bank.test.js` · `bot/tests/first-touch/maker.cards.test.js` · `bot/tests/first-touch/maker.make.test.js` · `bot/tests/first-touch/maker.prefill.wire.test.js` · `bot/tests/first-touch/maker.qlang.test.js` · `bot/tests/first-touch/maker.ready.test.js` (+13: `python3 kg/kg.py who-reads bot/shared/services/first-touch/maker.bank.js`)
- `maker.cta.js` ← `bot/tests/first-touch/maker-fallback.test.js` · `bot/tests/first-touch/maker.canonical.test.js` · `bot/tests/first-touch/maker.cta-seam.test.js` · `bot/tests/first-touch/maker.prefill.wire.test.js` · `bot/tests/first-touch/teacher-home.speed.test.js`
- `maker.empty.js` ← `bot/tests/first-touch/maker.empty-seam.test.js`
- `maker.fallback.js` ← `bot/tests/first-touch/maker-fallback.test.js`
- `maker.fallback.strings.js` ← `bot/tests/first-touch/maker-bi-drift.test.js` · `bot/tests/first-touch/maker-empty.golden.test.js`
- `maker.mount.js` ← `bot/tests/first-touch/maker.routes.test.js`
- `maker.page.js` ← `bot/tests/first-touch/maker.ready.test.js` · `bot/tests/first-touch/maker.tour.test.js` · `bot/tests/first-touch/one-door-way-back.test.js` · `bot/tests/first-touch/teacher-home.routes.test.js` · `dashboard/tests/edge-security-headers.service.test.js`
- `maker.prefill.js` ← `bot/tests/first-touch/maker.prefill.test.js`
- `maker.qlang.js` ← `bot/tests/first-touch/maker.qlang.test.js`
- `maker.routes.js` ← `bot/tests/first-touch/maker.cards.test.js` · `bot/tests/first-touch/maker.make.test.js` · `bot/tests/first-touch/maker.prefill.wire.test.js` · `bot/tests/first-touch/maker.qlang.test.js` · `bot/tests/first-touch/maker.ready.test.js` · `bot/tests/first-touch/maker.routes.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/first-touch/maker.routes.js`)
- `maker.strings.js` ← `bot/tests/first-touch/maker-bi-drift.test.js` · `bot/tests/first-touch/maker.cards.assessment-door.test.js` · `bot/tests/first-touch/maker.cards.test.js` · `bot/tests/first-touch/maker.cta-seam.test.js` · `bot/tests/first-touch/maker.make.test.js` · `bot/tests/first-touch/maker.qlang.test.js` (+6: `python3 kg/kg.py who-reads bot/shared/services/first-touch/maker.strings.js`)
- `maker.token.js` ← `bot/tests/first-touch/maker-empty.golden.test.js` · `bot/tests/first-touch/maker.cards.test.js` · `bot/tests/first-touch/maker.cta-seam.test.js` · `bot/tests/first-touch/maker.make.test.js` · `bot/tests/first-touch/maker.prefill.wire.test.js` · `bot/tests/first-touch/maker.qlang.test.js` (+7: `python3 kg/kg.py who-reads bot/shared/services/first-touch/maker.token.js`)
- `mount-failed.js` ← `bot/tests/first-touch/mount-failed.test.js`
- `mounts.js` ← `bot/tests/first-touch/mounts-order.test.js` · `bot/tests/first-touch/teacher-home.mount.test.js` · `bot/tests/push/web-quiz-push.routes.test.js`
- `one-door.flags.js` ← `bot/tests/first-touch/one-door-abuse-bound.test.js` · `bot/tests/first-touch/one-door-entry.test.js` · `bot/tests/first-touch/one-door-go-routes.test.js` · `bot/tests/first-touch/one-door-menu-row.test.js` · `bot/tests/first-touch/one-door-way-back.test.js` · `bot/tests/first-touch/walk-persona-seam.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/services/first-touch/one-door.flags.js`)
- `one-door.service.js` ← `bot/tests/first-touch/one-door-go-routes.test.js` · `bot/tests/first-touch/one-door-words.test.js` · `bot/tests/first-touch/walk-persona-seam.test.js` · `bot/tests/quiz/web-quiz/web-quiz-share-joined.test.js` · `bot/tests/quiz/web-quiz/web-quiz-share-v4-join-seam.test.js`
- `one-door.strings.js` ← `bot/tests/first-touch/one-door-words.test.js` · `bot/tests/quiz/web-quiz/web-quiz-hub-return-lang.test.js`
- `one-door.words.js` ← `bot/tests/first-touch/one-door-words.test.js`
- `optional-modules.js` ← `bot/tests/first-touch/one-door-go-routes.test.js` · `bot/tests/first-touch/optional-modules.test.js`
- `push-remind.mount.js` ← `bot/tests/push/web-quiz-push.routes.test.js`
- `role.service.js` ← `bot/tests/first-touch/one-door-go-routes.test.js` · `bot/tests/first-touch/one-door-role.test.js` · `bot/tests/first-touch/role.family-roster.test.js` · `bot/tests/first-touch/role.service-seam.test.js` · `bot/tests/first-touch/walk-persona-seam.test.js` · `bot/tests/quiz/web-quiz/web-quiz-hub-return-lang.test.js`
- `teacher-home-counts.flag.js` ← `bot/tests/first-touch/teacher-home-counts.flag.test.js` · `bot/tests/first-touch/teacher-home.routes.test.js`
- `teacher-home.copy.js` ← `bot/tests/first-touch/teacher-home.routes.test.js` · `bot/tests/first-touch/teacher-home.story-return.test.js`
- `teacher-home.data.js` ← `bot/tests/first-touch/teacher-home.data-seam.test.js` · `bot/tests/first-touch/teacher-home.sent-story-paged.test.js` · `bot/tests/first-touch/teacher-home.sent-story.test.js` · `bot/tests/first-touch/teacher-home.speed.test.js`
- `teacher-home.flags.js` ← `bot/tests/first-touch/maker-fixture.js` · `bot/tests/first-touch/maker.routes.test.js` · `bot/tests/first-touch/one-door-way-back.test.js` · `bot/tests/first-touch/teacher-home.grade-fast-off.golden.test.js` · `bot/tests/first-touch/teacher-home.mount.test.js` · `bot/tests/first-touch/teacher-home.one-lesson.test.js` (+13: `python3 kg/kg.py who-reads bot/shared/services/first-touch/teacher-home.flags.js`)
- `teacher-home.model.js` ← `bot/tests/first-touch/teacher-home.model.test.js` · `bot/tests/first-touch/teacher-home.routes.test.js`
- `teacher-home.more-flags.js` ← `bot/tests/first-touch/teacher-home.routes.test.js`
- `teacher-home.mount.js` ← `bot/tests/first-touch/teacher-home.mount.test.js`
- `teacher-home.page.js` ← `bot/tests/first-touch/teacher-home.grade-fast-off.golden.test.js` · `bot/tests/first-touch/teacher-home.grade-fast.page-run.test.js` · `bot/tests/first-touch/teacher-home.named-pick.test.js` · `bot/tests/first-touch/teacher-home.page-run.test.js` · `bot/tests/first-touch/teacher-home.page-variants.test.js` · `bot/tests/first-touch/teacher-home.page.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/first-touch/teacher-home.page.js`)
- `teacher-home.portal.routes.js` ← `bot/tests/first-touch/teacher-home.portal.routes.test.js`
- `teacher-home.routes.js` ← `bot/tests/first-touch/one-door-way-back.test.js` · `bot/tests/first-touch/teacher-home.grade-fast-off.golden.test.js` · `bot/tests/first-touch/teacher-home.one-lesson.test.js` · `bot/tests/first-touch/teacher-home.portal-link.test.js` · `bot/tests/first-touch/teacher-home.quick.test.js` · `bot/tests/first-touch/teacher-home.routes.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/services/first-touch/teacher-home.routes.js`)
- `teacher-home.send.js` ← `bot/tests/first-touch/teacher-home.speed.test.js`
- `teacher-home.sent.js` ← `bot/tests/first-touch/teacher-home.routes.test.js` · `bot/tests/quiz/web-quiz/teacher-report-library-send.test.js`
- `teacher-home.strings.js` ← `bot/tests/first-touch/teacher-home.one-lesson.test.js` · `bot/tests/first-touch/teacher-home.page-run.test.js` · `bot/tests/first-touch/teacher-home.page.test.js` · `bot/tests/first-touch/teacher-home.portal-link.test.js` · `bot/tests/first-touch/teacher-home.return-line.test.js` · `bot/tests/first-touch/teacher-home.routes.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/first-touch/teacher-home.strings.js`)
- `teacher-home.token.js` ← `bot/tests/first-touch/one-door-way-back.test.js` · `bot/tests/first-touch/teacher-home.grade-fast-off.golden.test.js` · `bot/tests/first-touch/teacher-home.one-lesson.test.js` · `bot/tests/first-touch/teacher-home.portal-link.test.js` · `bot/tests/first-touch/teacher-home.portal.routes.test.js` · `bot/tests/first-touch/teacher-home.quick.test.js` (+7: `python3 kg/kg.py who-reads bot/shared/services/first-touch/teacher-home.token.js`)
- `teacher-stories-stale.flag.js` ← `bot/tests/first-touch/teacher-home.routes.test.js`
- `walk-persona.js` ← `bot/tests/first-touch/walk-persona-seam.test.js` · `bot/tests/settings/switch-outage.test.js`

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/first-touch/CLAUDE.index.md`? · `bot/shared/services/first-touch/CLAUDE.md`? · `bot/tests/first-touch/CLAUDE.index.md`? · `bot/tests/push/CLAUDE.md`? · `bot/tests/quiz/web-quiz/CLAUDE.index.md`? · `bot/tests/settings/CLAUDE.md`?
