# first-touch — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests/first-touch -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__goldens__/` | → (no door; 10 files: 0 test + 10 support) |
| `LOCKOUT.empty-line.md` | Table of every outcome of the empty /quiz line (lessons x quiz_maker_page), run by maker-empty golden and fallback tests |
| `_ingress-mocks.js` | Shared boundary mocks (Redis as a Map, WhatsApp send, loggers) for the student-ingress door tests |
| `_json-path-select.js` | Wraps the in-memory Supabase fake so aliased jsonb path selects return the alias like PostgREST and record the columns |
| `_mini-dom.js` | Minimal DOM that runs the maker page's real inline scripts in a vm context, since jsdom is absent |
| `adventure-look.first-pages.test.js` | Pins the adventure look on the one door's pages: token layer hash, one-button gate, byte-identical when OFF |
| `door-bound-seam.test.js` | Seam test that door-bound.js keys its counters by the real phone-binding hash and never the phone |
| `door-cache.test.js` | Pins the first_door verdict cache TTL (60s, not 10 minutes) and warm replay without a read |
| `door-fixture.js` | Fixture for first-touch door tests: synthetic unknown phone, switch maps, in-memory Supabase with user_feature_first_use |
| `door-keys.test.js` | Tests door.keys.js as the one writer of the door keys in user_feature_first_use, upsert then update order |
| `door-known.golden.test.js` | Golden that known teachers and children get today's verdict byte-identical with both door switches ON |
| `door-off.golden.test.js` | Golden that an unknown phone's quiz request is today's path with zero new reads when both door switches are OFF |
| `door-on.test.js` | Pins the door verdict with both switches ON: one indexed read, decideDoor rules, null on error or non-quiz text |
| `first-reply-english-evidence.test.js` | Unit tests of the rule allowing an English first reply only on positive English evidence (FIRST_REPLY_ENGLISH_EVIDENCE) |
| `first-reply-english.text-turn.test.js` | Runs a brand-new row's first message through the real text handler, pinning the English-evidence switch ON and OFF |
| `identity-flags.first-door.test.js` | Pins quiz_maker_page and quiz_first_door reading through the identity switches' one map with no extra reads |
| `maker-bi-drift.test.js` | Drift check: every .bi maker string is signed Urdu, blank line, signed English; bilingual buttons fit 20 points |
| `maker-empty.golden.test.js` | Golden that the empty /quiz line becomes the maker cta only when quiz_maker_page is on, else byte-identical |
| `maker-fallback.test.js` | Tests the maker cta refused-send fallback: one counted reply, 20-point buttons, each button opens today's entry |
| `maker-fallback.webhook.test.js` | Drives the maker fallback buttons through the real /webhook chain with only the edges doubled |
| `maker-fixture.js` | Fixture for quiz-maker tests: synthetic video bank, one registered teacher, seeded into the in-memory Supabase |
| `maker-golden-cases.js` | Fixed inputs for the maker page byte-identity golden, with hashes taken before the addon hook existed |
| `maker.bank.test.js` | Tests the maker chip tree (live video quizzes, grades 1-5, subject mapping) and make()'s server re-check |
| `maker.canonical.test.js` | Pins that the maker link uses the canonical web-quiz base and the canonical-host redirect never touches /m/ links |
| `maker.cards.assessment-door.test.js` | Pins that the maker Test-paper card word reaches openAssessmentFlow exactly once through the real text handler |
| `maker.cards.test.js` | Tests the maker cards: words match the real door matchers, wa.me links, forward line, inline script in a sandbox |
| `maker.cta-seam.test.js` | Tests makerCta: ledger row first (maker_reply) then one cta_url whose /m/ token verifies with six fields |
| `maker.empty-seam.test.js` | Pins that the empty line's onboard.quiz_door event carries the keyed phone reference, never the phone |
| `maker.make.test.js` | Tests POST /api/ft/make mints one quiz_share_codes row, reuses it on repeat, sends nothing on WhatsApp |
| `maker.prefill.test.js` | Tests the maker pre-fill: grade and subject normalisers, one-cell decision, and the four source reads |
| `maker.prefill.wire.test.js` | End-to-end of the pre-fill: makerCta computes pf, the page shows 'Last time' with Use it or Change, stale cells drop |
| `maker.qlang.test.js` | Tests the question-language mark: quizzes.language, else decideLanguage matching the read-aloud voice, else none |
| `maker.ready.test.js` | Tests the maker ready screen strings and the EN/اردو question-language mark on topic chips |
| `maker.routes.test.js` | Tests the maker router: OFF answers 404 off:true, ON pages, other token kinds, step route, mount wrapper |
| `maker.share.test.js` | Tests 'Send to class group': 302 to wa.me with the rebuilt message, 404 for other teachers' codes |
| `maker.token.test.js` | Tests the maker token (kind m): six fields, 24h, stale page 200 vs forged 404, bi opens the Urdu page |
| `maker.tour.test.js` | Tests the maker tour banner: shown once per person, SHOW and DISMISS writes, replay without writes |
| `mount-failed.test.js` | Tests that a failed first-touch mount is logged once at error level while an absent module stays silent |
| `mounts-golden.test.js` | Golden that the first-touch mount block of whatsapp-bot.js registers the same ordered routes (mounts golden) |
| `mounts-order.test.js` | Pins that mounts.js order never decides who answers: each router answers only its own path |
| `one-door-abuse-bound.test.js` | Tests the one door's abuse bound: 10s dedupe and per-day ceiling, with golden OFF behaviour |
| `one-door-child-word.test.js` | Pins that a known child's 'jugnu' is not a quiz request under the one door; the tutor answers |
| `one-door-entry.test.js` | Tests /quiz yields ONE reply under quiz_one_door; OFF compared byte for byte with the one-door-off golden |
| `one-door-go-routes.test.js` | Tests the landing /api/internal/go routes on a real HTTP port: OFF 404, no-read question, who/role, bind |
| `one-door-ledger-migration.test.js` | Runs the one_door ledger migration on a throwaway Postgres: trigger CHECK gains one_door_reply and maker_reply |
| `one-door-menu-row.test.js` | Tests the menu_quiz row routes through the one door when ON and direct showList when OFF |
| `one-door-role.test.js` | Tests decideRole per persona and resolveRole's single ordered read, unknown on a failed identity read |
| `one-door-share-ref.test.js` | Tests a shared card's 'quiz please <ref>' words through the real text handler, OFF vs ON |
| `one-door-text-turn.test.js` | Tests the /quiz text turn with quiz_one_door ON sends one reply, with no registration Flow second message |
| `one-door-way-back.test.js` | Tests dead-end pages carry one tap back to WhatsApp under web_quiz_closed_way_back, byte-identical when OFF |
| `one-door-webhook.test.js` | Drives the one door through the real /webhook per persona, OFF vs ON, including the own-reply counter |
| `one-door-words.test.js` | Tests which words are a quiz request under the one door and the quiz_cmd src they carry |
| `optional-modules.test.js` | Pins the file names the optional first-touch modules are looked up by, including walk-persona |
| `reg-after-plan-turn.test.js` | Tests REGISTRATION_AFTER_PLAN: registration Flow moves to the next non-plan turn, OFF keeps today's two messages |
| `role.family-roster.test.js` | Tests the role resolver's class-roster read (familyKids): filters in the query, shared-number and school rules |
| `role.service-seam.test.js` | Seam test of the role resolver with the real child-phone-bindings repo: bound, revoked and unbound phones |
| `teacher-home-counts.flag.test.js` | Tests the quiz_teacher_story_counts switch: JSON true only, 30s cache, fail closed |
| `teacher-home-waves-fixture.js` | Fixture seeding a teacher with long history and measuring the teacher home's serial read waves |
| `teacher-home.data-seam.test.js` | Seam test of the teacher home's 'children on this phone' link through the real phone-bindings repo |
| `teacher-home.grade-fast-off.golden.test.js` | Golden that grade-fast OFF leaves teacher-home shell, home and library JSON byte-identical, with read counts pinned |
| `teacher-home.grade-fast.page-run.test.js` | Runs the page's real script with grade-fast ON: pressed chip, in-memory grade cache, one-at-a-time prefetch |
| `teacher-home.model.test.js` | Pins the teacher home's top-card lesson rule: a lesson newer than the last send, with named variants |
| `teacher-home.mount.test.js` | Pins the teacher home mount line in whatsapp-bot.js: live, before app.listen, router at /api/internal/th |
| `teacher-home.named-pick.test.js` | Runs the page script for the named_item and early_pick variants; OFF shell is byte-identical to the golden |
| `teacher-home.one-lesson.test.js` | Tests the quiz home opened for ONE recorded lesson via ?session=, behind quiz_teacher_home_one_lesson |
| `teacher-home.page-run.test.js` | Runs the teacher home's own page script on a small DOM: try-it-as row, send sheet link, message box size |
| `teacher-home.page-variants.test.js` | Builds all 32 teacher-home page variants (paged, named, early, counts, grade-fast) and checks their guards |
| `teacher-home.page.test.js` | Pins that the send sheet's message box shows the whole class message including the return line, en and ur |
| `teacher-home.portal-link.test.js` | Tests quiz_teacher_home_portal_link: home JSON carries a signed portalHref for registered non-portal teachers |
| `teacher-home.portal.routes.test.js` | Tests GET /api/internal/thportal/portal-home: key, switch, role gating and signed home path |
| `teacher-home.quick.test.js` | Tests the quick-answer switch quiz_teacher_home_paged: reads start at once, same JSON, round trips pinned |
| `teacher-home.return-line.test.js` | Tests the return line on maker sends: ends with cm.return when quiz_teacher_home is ON, else today's bytes |
| `teacher-home.routes.test.js` | End-to-end tests of the /api/internal/th router over in-memory Supabase: shell, home, class card, sends, events |
| `teacher-home.sent-story-paged.test.js` | Tests sent-story handling with the quick answer ON and OFF: library dates the sent book, pick is the next |
| `teacher-home.sent-story.test.js` | Tests that story entries carry their book id from playedOwn's single quizzes read |
| `teacher-home.server-timing.test.js` | Tests the Server-Timing header on home and library JSON when quiz_teacher_server_timing is JSON true, goldens when OFF |
| `teacher-home.speed.test.js` | Tests the home JSON answers as soon as its slowest read allows; class report held 60s per teacher |
| `teacher-home.story-return.test.js` | Tests the story class message ends with the shared return line from teacher-home.copy.js |
| `teacher-home.token.test.js` | Tests the teacher home token (kind th): shape, 24h, inline-signed tokens verify, expired stale, forged null |
| `teacher-home.wait.test.js` | Tests the slow-answer wait switch quiz_teacher_home_wait: page script hash in CSP, read counts, JSON unchanged |
| `walk-persona-seam.test.js` | Seam test of the sandbox walk-through row against the real landing router and bindings repo; OFF byte-identical |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/CLAUDE.md`? · `bot/scripts/quiz/CLAUDE.md`? · `bot/shared/database/CLAUDE.md`? · `bot/shared/handlers/CLAUDE.md`? · `bot/shared/services/cache/CLAUDE.md`? · `bot/shared/services/first-touch/CLAUDE.md`? · `bot/tests/CLAUDE.md`? · `bot/tests/first-touch/LOCKOUT.empty-line.md`?
