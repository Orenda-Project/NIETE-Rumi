# routes — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/routes -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `api-health.routes.js` | API-health JSON endpoints at /observability/api/api-health aggregating per-vendor status for the admin page. |
| `app-funnel.routes.js` | Teacher-app funnel events under /api/portal (page views and key actions) plus the actionLogger; bd-4r3rei. |
| `app-login.routes.js` | One-tap app login GET /go/:token: validates link, creates a portal session, redirects to its landing; bd-fmf24g.35. |
| `attendance.routes.js` | Teacher Attendance API at /api/portal/attendance: principal marks school/history, teacher /me, STEPS /presence rollup. |
| `billing.routes.js` | Observability billing page and /api/{status,anthropic,whatsapp,openai} JSON for API credit and usage checks. |
| `byof.routes.js` | Build-Your-Own-Feature routes under /observability/byof: sessions, chat messages, plans, approvals. |
| `coach-card.routes.js` | Coach card GET /cv/:token and POST /cv/:token/visited from a disputed-report WhatsApp ping; bd-v0toag.38.9. |
| `coach-disagreements.routes.js` | Coach API /coach/disagreements (list, card, visited/undone, plan, suggestion, clip) behind a flag; bd-tbprit.1. |
| `coach-school-card.routes.js` | Coach School Card API: /coach/school/:emis/card, feature rows, /coach/teacher/:ext/card, items, reports, session. |
| `coaching-report.routes.js` | Token page GET /cr/:token (+/detail, /useful, /coach) showing a teacher their coaching report card; bd-v0toag.18. |
| `cut-link-page.js` | Switch-gated handling of cut-short or junk quiz links on door/join/teacher paths: answers the expired page with 410. |
| `edge-mounts.js` | Ordered table of edge routers index.js mounts as one block (first-touch, push-remind...), each falling through when off. |
| `edge-security-headers.js` | Switch-gated passthrough of the bot's CSP/X-Frame/nosniff/Referrer headers on pages the portal relays. |
| `first-touch.routes.js` | Public first-touch edge: /m/:token maker page, /f/:token family door, /api/ft/* relayed to the bot's internal ft API. |
| `funnel-tracking.routes.js` | Public /api/track endpoints (visit, cta-click, health) recording website-to-WhatsApp funnel events. |
| `hcp.routes.js` | Human Coach Platform API at /api/portal/hcp: patch teachers, DC/training views, coaching plan, schedules. |
| `iab-probe.routes.js` | Phone test page /iab/:token and upload/result endpoints probing what WhatsApp's in-app browser allows; files discarded. |
| `portal-child-test.routes.js` | Coach-app child test at /api/portal/leader/child-test (visits, list, outcome, media) relayed to the bot; bd-s1oo0.7. |
| `portal-coachip-media.routes.js` | COACHIP media streams: /coachip/m/:momentId/clip and /coachip/session/:sessionId/audio with audit rows; bd-sex15q.16. |
| `portal-coachip.routes.js` | All /api/portal/coachip/* routes for the COACHIP coach and RM portal; dark by default; bd-sex15q.13. |
| `portal-fln-links.routes.js` | FLN leader routes /api/portal/fln/links (lesson-link builder rows) and /fln/title/:id; mounts the send router. |
| `portal-fln-send.routes.js` | FLN Send-to-teacher: GET /fln/teachers (leader's patch) and POST /fln/send queueing lesson links; share-gated. |
| `portal-fln.routes.js` | Reading Hour + Numeracy teacher-app API at /api/portal/fln: me, catalogue, plan, events, plus link-preview handler. |
| `portal-link.routes.js` | Template-button deep link GET /t/:token that mints an area-scoped portal session, plus portalLinkScope API gate. |
| `portal-share.routes.js` | POST /api/portal/share/whatsapp: teacher-app Send-on-WhatsApp (lesson/paper/dc/observation) via the bot; bd-fmf24g.30. |
| `portal-teacher-attendance.routes.js` | Teacher-app class attendance at /api/portal/teacher/attendance (classes, roster, mark, day, month); bd-fmf24g.7. |
| `portal-teacher-coaching.routes.js` | Teacher-app coaching reads: /teacher/visits, coaching journey and history with KPIs and trend; bd-fmf24g.4. |
| `portal-teacher-home.routes.js` | Teacher Home card API: GET /me/home (card, scores, tile order) and POST /me/home/tap funnel log; flag-gated. |
| `portal-teacher-lessons.routes.js` | Teacher-app /me/grade-subjects picker combos and /lesson-plans/history (counts, trend, rows); bd-fmf24g.3. |
| `portal-teacher-notices.routes.js` | Server-kept notices: GET /me/notices and seen/opened marks for papers and 6-12 lesson plans; bd-fmf24g.15. |
| `portal-teacher-push.routes.js` | Teacher evening-reminder web push at /api/portal/push (state, subscribe, unsubscribe, test) proxied to the bot. |
| `portal-teacher-thing-to-try.routes.js` | v10 coaching test: GET/POST /teacher/thing-to-try for groups C/D on a lesson plan; bd-v0toag.8. |
| `portal.routes.js` | Main teacher/coach portal API at /api/portal: auth, setup, reset, dashboard, lessons, coaching, training; 9k lines. |
| `push-remind.routes.js` | Child web-push reminder edge: /sw.js, /remind/:code page and /api/wqpush/* relayed to the bot; flag-gated. |
| `quiz-go.routes.js` | The one-door edge: GET /quiz/go/:token and /api/go/{who,role,bind,persona} forwarded to the bot; flag quiz_one_door. |
| `quiz-join.routes.js` | Child self-join screen GET /quiz/join/:token drawn at the edge from bot page facts; flag quiz_student_join. |
| `quiz-teacher.routes.js` | Teacher quiz home edge: /quiz/teacher/:token (+send, stories) and /api/th/* forwarded to the bot's internal th API. |
| `sa-battery-switches.js` | Applies app_settings content switches (practice, passage rotation, RDF W3 forms) to a battery file as served. |
| `sa-engine.routes.js` | Serves the self-administered battery engine at /sa/* and /sa/batteries/:name behind the sa_engine switch. |
| `sa-game.routes.js` | Child battery-as-game edge: /sa-game/:token page, assets, and /api/sa-game/s/* sink forwarded to the bot; flag sa_game. |
| `sa-r7a-content.js` | Round 7b/8 child-screen words added to a served battery per switch (say-then-next, Next on questions, scroll, tick) |
| `sa-switch.js` | Steady reader for sa_engine/sa_game switches: waits for first read, holds ON 60s so a failed read cannot flap. |
| `settings.js` | Observability settings routes: super-admin user list, invite, role update, deactivate, and self change-password. |
| `teacher-report.routes.js` | Public teacher web-quiz report edge at /r/:token (page, pdf, remind, class link, fixes) relayed to the bot's tr API. |
| `teacher-stories.routes.js` | Teacher storybook-to-class edge: stories shelf, preview, share, send and Stories page forwarded to the bot; flag-gated. |
| `training-library.routes.js` | Coach-only read-only Training Library at /api/portal/training/library (tree, module, readings, questions); bd-s42dye.1. |
| `video-reco.routes.js` | Recommended training clip player: /v/:token page, /v/thumb, beacons /v/:token/e and skip/stop choice /c; bd-gzfdu9. |
| `web-quiz-brotli-flag.js` | Cached (30s) strict-boolean reader of app_settings web_quiz_brotli, the house switch other edge flags reuse. |
| `web-quiz-canonical.js` | 301-redirects child quiz pages asked on a non-canonical host to WEB_QUIZ_BASE_URL so one child keeps one origin. |
| `web-quiz-class-link.js` | Standing class link edge: GET /j/:code landing and /api/wq/cl/* steps forwarded to the bot; flag web_quiz_class_link. |
| `web-quiz-early-unlock.js` | Head script letting a new phone's first hub open ask for itself early (web_quiz_early_unlock), saving a round trip. |
| `web-quiz-fast-hop.js` | Preloads the child home's scripts and first reads from the fast page head/tail (web_quiz_one_hop). |
| `web-quiz-home-inline.js` | Inlines the child home's CSS/JS into the first-open response (web_quiz_home_inline) to avoid ~10 post-head round trips. |
| `web-quiz-home-preload.js` | Head preload lines for the child home's files at exact later addresses during the bot wait; web_quiz_home_preload. |
| `web-quiz-pack.js` | Serves the child home's scripts and styles as one pack file each (flag web_quiz_pack), cutting round trips. |
| `web-quiz-preview.js` | Fast link-preview answers: detects HEAD/WhatsApp fetchers and serves og tags without a 2-3 s full quiz render. |
| `web-quiz-ra-preload.js` | Read-along player preload line for the Jugnu page head, keyed by the player file hash (flag web_quiz_ra_preload). |
| `web-quiz-static.js` | Serves /wq/* child page assets brotli-compressed once per content when web_quiz_brotli is on; else falls through. |
| `web-quiz-story-assets.js` | GET /s/:bookId/:file storybook pictures/audio with immutable cache, memory cache and Range; flag web_quiz_stories. |
| `web-quiz-stream.js` | Streaming compression (br/gzip, flushed per write) for the fast first page that is sent in two parts. |
| `web-quiz-wait-ux.js` | Inline top progress bar for waits over 400 ms on the child hub page (web_quiz_wait_ux, learned from hub answer). |
| `web-quiz.routes.js` | Child web-quiz public edge: /q/:code pages, share art, /api/wq/* forwarded to the bot, hub /h, landing /k; 2.1k lines. |
| `wordcloud.js` | Observability word-cloud API (/words etc.) over conversation text via wordcloud.service. |

## Who reads this (all, generated)
- `api-health.routes.js` ← imported by `dashboard/index.js:121:868035bb`
- `app-funnel.routes.js` ← imported by `dashboard/index.js:136:4cb3bcbf` · `dashboard/routes/portal.routes.js:7698:35a5a6e7`
- `app-login.routes.js` ← imported by `dashboard/index.js:135:fcb52582` · `dashboard/routes/portal.routes.js:112:5b0fb546`
- `attendance.routes.js` ← imported by `dashboard/index.js:138:32048bc4`
- `byof.routes.js` ← imported by `dashboard/index.js:144:7986ca93`
- `coach-card.routes.js` ← imported by `dashboard/index.js:194:d5e7c191`
- `coach-disagreements.routes.js` ← imported by `dashboard/routes/portal.routes.js:2301:0eff617f`
- `coach-school-card.routes.js` ← imported by `dashboard/routes/portal.routes.js:2291:71362c49`
- `coaching-report.routes.js` ← imported by `dashboard/index.js:191:602cc986` · `dashboard/routes/coach-card.routes.js:47:08e56c4a` · `dashboard/routes/portal.routes.js:2302:08e56c4a`
- `cut-link-page.js` ← imported by `dashboard/routes/quiz-go.routes.js:32:4ffa8049` · `dashboard/routes/quiz-join.routes.js:26:4ffa8049` · `dashboard/routes/quiz-teacher.routes.js:30:4ffa8049`
- `edge-mounts.js` ← imported by `dashboard/index.js:174:e9b7f5c8`
- `edge-security-headers.js` ← imported by `dashboard/routes/first-touch.routes.js:24:8ae9ac5b` · `dashboard/routes/quiz-go.routes.js:28:8ae9ac5b` · `dashboard/routes/quiz-teacher.routes.js:31:8ae9ac5b` · `dashboard/routes/teacher-report.routes.js:29:8ae9ac5b` (+2: `python3 kg/kg.py who-reads edge-security-headers.js`)
- `funnel-tracking.routes.js` ← imported by `dashboard/index.js:124:734cb817`
- `hcp.routes.js` ← imported by `dashboard/index.js:137:22f20eb1`
- `iab-probe.routes.js` ← imported by `dashboard/index.js:187:953b8062`
- `portal-child-test.routes.js` ← imported by `dashboard/index.js:139:523715e1`
- `portal-coachip-media.routes.js` ← imported by `dashboard/index.js:2875:eb6016a2`
- `portal-coachip.routes.js` ← imported by `dashboard/index.js:2879:c9248d25`
- `portal-fln-links.routes.js` ← imported by `dashboard/routes/portal-fln.routes.js:259:de9842cd`
- `portal-fln-send.routes.js` ← imported by `dashboard/routes/portal-fln-links.routes.js:219:87729c1f`
- `portal-fln.routes.js` ← imported by `dashboard/index.js:2868:17cb8820`
- `portal-link.routes.js` ← imported by `dashboard/index.js:134:8af5a0c0`
- `portal-share.routes.js` ← imported by `dashboard/index.js:2862:97aa192e`
- `portal-teacher-attendance.routes.js` ← imported by `dashboard/index.js:2856:03e234ac`
- `portal-teacher-coaching.routes.js` ← imported by `dashboard/index.js:2855:a6f43c90`
- `portal-teacher-home.routes.js` ← imported by `dashboard/index.js:2864:ae9ce940`
- `portal-teacher-lessons.routes.js` ← imported by `dashboard/index.js:141:327d08bd`
- `portal-teacher-notices.routes.js` ← imported by `dashboard/index.js:2860:532d069e`
- `portal-teacher-push.routes.js` ← imported by `dashboard/index.js:2865:4f38ac71`
- `portal-teacher-thing-to-try.routes.js` ← imported by `dashboard/index.js:2858:fac53138`
- `portal.routes.js` ← imported by `dashboard/index.js:133:11af011f`
- `sa-battery-switches.js` ← imported by `dashboard/routes/sa-engine.routes.js:34:37620dd3`
- `sa-engine.routes.js` ← imported by `dashboard/index.js:205:e7a5a475`
- `sa-r7a-content.js` ← imported by `dashboard/routes/sa-battery-switches.js:98:6e065f1e`
- `sa-switch.js` ← imported by `dashboard/routes/sa-engine.routes.js:33:db4ada6e` · `dashboard/routes/sa-game.routes.js:30:db4ada6e`
- `settings.js` ← imported by `dashboard/index.js:127:a35f0675`
- `teacher-report.routes.js` ← imported by `dashboard/index.js:177:d2a002ab`
- `teacher-stories.routes.js` ← imported by `dashboard/index.js:182:9cc20f47`
- `training-library.routes.js` ← imported by `dashboard/index.js:2867:a9dd5b37`
- `video-reco.routes.js` ← imported by `dashboard/index.js:197:b634ea14`
- `web-quiz-brotli-flag.js` ← imported by `dashboard/routes/edge-security-headers.js:17:4544d862` · `dashboard/routes/push-remind.routes.js:27:4544d862` · `dashboard/routes/sa-engine.routes.js:32:4544d862` · `dashboard/routes/sa-game.routes.js:29:4544d862` (+2: `python3 kg/kg.py who-reads web-quiz-brotli-flag.js`)
- `web-quiz-canonical.js` ← imported by `dashboard/routes/web-quiz.routes.js:38:57e8f4c0`
- `web-quiz-class-link.js` ← imported by `dashboard/routes/web-quiz.routes.js:1531:ed1ba1c8`
- `web-quiz-early-unlock.js` ← imported by `dashboard/routes/web-quiz.routes.js:53:0b1c644f`
- `web-quiz-fast-hop.js` ← imported by `dashboard/routes/web-quiz.routes.js:51:43b995fd`
- `web-quiz-home-inline.js` ← imported by `dashboard/routes/web-quiz.routes.js:52:815a4c1f`
- `web-quiz-home-preload.js` ← imported by `dashboard/routes/web-quiz.routes.js:40:01ea6fb0`
- `web-quiz-pack.js` ← imported by `dashboard/routes/web-quiz.routes.js:41:e3e9d22f`
- `web-quiz-preview.js` ← imported by `dashboard/routes/web-quiz-static.js:25:3dd6bf13` · `dashboard/routes/web-quiz.routes.js:39:b70fa4f6`
- `web-quiz-ra-preload.js` ← imported by `dashboard/routes/web-quiz.routes.js:1815:dd99feb9`
- `web-quiz-static.js` ← imported by `dashboard/routes/web-quiz.routes.js:1459:eb94528d`
- `web-quiz-story-assets.js` ← imported by `dashboard/routes/web-quiz.routes.js:43:9af7cb0d`
- `web-quiz-stream.js` ← imported by `dashboard/routes/web-quiz.routes.js:44:7c8b0eaf`
- `web-quiz-wait-ux.js` ← imported by `dashboard/routes/web-quiz.routes.js:50:fc5736da`
- `web-quiz.routes.js` ← imported by `dashboard/index.js:171:a0c5436b` · `dashboard/routes/first-touch.routes.js:23:618f2a96` · `dashboard/routes/portal-teacher-push.routes.js:16:618f2a96` · `dashboard/routes/push-remind.routes.js:26:f0ee1062` (+6: `python3 kg/kg.py who-reads web-quiz.routes.js`)
- `wordcloud.js` ← imported by `dashboard/index.js:130:5176fec6`
- column `teacher_training_progress.completed_at` (written by `portal.routes.js`) ← read by `bot/shared/calls/call-context.repo.js:108:0df11b25` · `bot/shared/services/coaching/video-reco/store.js:66:4266016d` · `dashboard/services/teacher-home-order.service.js:233:1aa1b0b5`
- column `teacher_training_progress.module_id` (written by `portal.routes.js`) ← read by `bot/shared/calls/call-context.repo.js:108:0df11b25` · `bot/shared/routes/teacher-training-endpoint.js:846:9402d340` · `bot/shared/services/coaching/video-reco/store.js:65:35b4acbd` · `bot/shared/services/training/capstone-delivery.service.js:116:8384324d` (+2: `python3 kg/kg.py who-reads teacher_training_progress.module_id`)
- column `teacher_training_progress.user_id` (written by `portal.routes.js`) ← read by `bot/shared/calls/call-context.repo.js:109:219f5683` · `bot/shared/routes/teacher-training-endpoint.js:846:9402d340` · `bot/shared/services/coaching/video-reco/store.js:66:4266016d` · `bot/shared/services/training/capstone-delivery.service.js:117:219f5683` (+3: `python3 kg/kg.py who-reads teacher_training_progress.user_id`)
- column `training_assessment_answers.attempt_id` (written by `portal.routes.js`) ← read by `bot/shared/services/training/capstone-delivery.service.js:641:3cb81bb1` · `bot/shared/services/training/isaps-held-release.service.js:131:20ebd565` · `bot/shared/services/training/isaps-level-grade.service.js:99:ac4ec5f5` · `bot/shared/services/training/quiz-delivery.service.js:372:dbe412f0`
- column `training_assessment_answers.chosen_option` (written by `portal.routes.js`) ← read by `bot/shared/services/training/quiz-delivery.service.js:371:128b562c`
- column `training_assessment_answers.is_correct` (written by `portal.routes.js`) ← read by `bot/shared/services/training/isaps-held-release.service.js:131:20ebd565` · `bot/shared/services/training/isaps-level-grade.service.js:99:ac4ec5f5` · `bot/shared/services/training/quiz-delivery.service.js:2041:331dd634`
- column `training_assessment_answers.question_id` (written by `portal.routes.js`) ← read by `bot/shared/services/training/isaps-held-release.service.js:131:20ebd565` · `bot/shared/services/training/isaps-level-grade.service.js:99:ac4ec5f5` · `bot/shared/services/training/quiz-delivery.service.js:2620:8e6bf883`
- column `training_assessment_answers.question_index` (written by `portal.routes.js`) ← read by `bot/shared/services/training/capstone-delivery.service.js:640:7c1a4b38` · `bot/shared/services/training/isaps-held-release.service.js:131:20ebd565` · `bot/shared/services/training/quiz-delivery.service.js:373:26ff9341`
- column `training_assessment_attempts.completed_at` (written by `portal.routes.js`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1222:7cb7cc00` · `bot/shared/services/teacher-state.service.js:415:23befb6d` · `bot/shared/services/training/quiz-delivery.service.js:2900:06ec7689`
- column `training_assessment_attempts.current_question_index` (written by `portal.routes.js`) ← read by `bot/shared/services/teacher-state.service.js:412:96ba372d` · `bot/shared/services/training/capstone-delivery.service.js:521:f7f7e335` · `bot/shared/services/training/quiz-delivery.service.js:481:0e898c87`
- column `training_assessment_attempts.grand_quiz_id` (written by `portal.routes.js`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1222:7cb7cc00` · `bot/shared/services/training/capstone-delivery.service.js:521:f7f7e335` · `bot/shared/services/training/certificate.service.js:267:bb5213ea` · `bot/shared/services/training/content-delivery.service.js:462:728dbf3f` (+3: `python3 kg/kg.py who-reads training_assessment_attempts.grand_quiz_id`)
- column `training_assessment_attempts.id` (written by `portal.routes.js`) ← read by `bot/shared/services/teacher-state.service.js:412:96ba372d` · `bot/shared/services/training/capstone-delivery.service.js:164:c4cc30e2` · `bot/shared/services/training/content-delivery.service.js:460:621a3455` · `bot/shared/services/training/isaps-held-release.service.js:77:7f06ac8a` (+2: `python3 kg/kg.py who-reads training_assessment_attempts.id`)
- column `training_assessment_attempts.is_passed` (written by `portal.routes.js`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1222:7cb7cc00` · `bot/shared/services/training/capstone-delivery.service.js:168:0cd4269d` · `bot/shared/services/training/certificate.service.js:267:bb5213ea` · `bot/shared/services/training/content-delivery.service.js:461:b558b5e2` (+2: `python3 kg/kg.py who-reads training_assessment_attempts.is_passed`)
- column `training_assessment_attempts.last_activity_at` (written by `portal.routes.js`) ← read by `bot/shared/services/teacher-state.service.js:416:b108c870` · `bot/shared/services/training/capstone-delivery.service.js:525:28e567bb` · `bot/shared/services/training/quiz-delivery.service.js:1852:28e567bb`
- column `training_assessment_attempts.level_id` (written by `portal.routes.js`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1222:7cb7cc00` · `bot/shared/services/training/capstone-delivery.service.js:166:987e696d` · `bot/shared/services/training/isaps-held-release.service.js:77:7f06ac8a` · `bot/shared/services/training/quiz-delivery.service.js:993:cf167fa6`
- column `training_assessment_attempts.program_id` (written by `portal.routes.js`) ← read by `bot/shared/services/training/capstone-delivery.service.js:521:f7f7e335` · `bot/shared/services/training/isaps-held-release.service.js:77:7f06ac8a` · `bot/shared/services/training/quiz-delivery.service.js:1848:b5f4a340`
- column `training_assessment_attempts.quiz_kind` (written by `portal.routes.js`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1222:7cb7cc00` · `bot/shared/services/training/capstone-delivery.service.js:167:a0cf05e1` · `bot/shared/services/training/certificate.service.js:269:0e1e0880` · `bot/shared/services/training/isaps-held-release.service.js:77:7f06ac8a` (+2: `python3 kg/kg.py who-reads training_assessment_attempts.quiz_kind`)
- column `training_assessment_attempts.score` (written by `portal.routes.js`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1543:afcea207` · `bot/shared/services/training/certificate.service.js:333:73adf11e` · `bot/shared/services/training/quiz-delivery.service.js:2865:8490fdf8`
- column `training_assessment_attempts.started_at` (written by `portal.routes.js`) ← read by `bot/shared/services/training/quiz-delivery.service.js:483:2b9bf037`
- column `training_assessment_attempts.status` (written by `portal.routes.js`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1222:7cb7cc00` · `bot/shared/services/teacher-state.service.js:414:80e24dee` · `bot/shared/services/training/capstone-delivery.service.js:521:f7f7e335` · `bot/shared/services/training/content-delivery.service.js:466:842d0cf0` (+2: `python3 kg/kg.py who-reads training_assessment_attempts.status`)
- column `training_assessment_attempts.total_questions` (written by `portal.routes.js`) ← read by `bot/shared/services/teacher-state.service.js:412:96ba372d` · `bot/shared/services/training/capstone-delivery.service.js:521:f7f7e335` · `bot/shared/services/training/certificate.service.js:333:73adf11e` · `bot/shared/services/training/isaps-held-release.service.js:77:7f06ac8a` (+2: `python3 kg/kg.py who-reads training_assessment_attempts.total_questions`)
- column `training_assessment_attempts.total_score` (written by `portal.routes.js`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1543:afcea207` · `bot/shared/services/training/capstone-delivery.service.js:521:f7f7e335` · `bot/shared/services/training/isaps-level-grade.service.js:92:b8f1ba77` · `bot/shared/services/training/quiz-delivery.service.js:1848:b5f4a340`
- column `training_assessment_attempts.training_module_id` (written by `portal.routes.js`) ← read by `bot/shared/services/training/certificate.service.js:333:73adf11e` · `bot/shared/services/training/isaps-level-grade.service.js:74:2f1d2500` · `bot/shared/services/training/quiz-delivery.service.js:821:c5c578b4`
- column `training_assessment_attempts.user_id` (written by `portal.routes.js`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1222:7cb7cc00` · `bot/shared/services/teacher-state.service.js:413:219f5683` · `bot/shared/services/training/capstone-delivery.service.js:165:219f5683` · `bot/shared/services/training/certificate.service.js:268:219f5683` (+4: `python3 kg/kg.py who-reads training_assessment_attempts.user_id`)
- column `users.password_reset_code` (written by `portal.routes.js`) ← read by `dashboard/services/password-reset.service.js:207:b1bad50a`
- column `users.password_reset_expires_at` (written by `portal.routes.js`) ← read by `dashboard/services/password-reset.service.js:207:b1bad50a`
- column `users.portal_activated` (written by `portal.routes.js`) ← read by `bot/shared/services/portal-invite.service.js:203:d17654ef` · `bot/shared/services/quiz/web-quiz-student-join.js:264:4a7f1445` · `bot/scripts/deployment/get-portal-test-tokens.js:46:0cecdbb4`
- column `users.portal_invite_expires_at` (written by `portal.routes.js`) ← read by `bot/shared/services/portal-invite.service.js:203:d17654ef`
- column `users.portal_invite_token` (written by `portal.routes.js`) ← read by `bot/shared/services/portal-invite.service.js:204:53285ac9`
- table `users` whole row (`*`) (written by `portal.routes.js`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687`? · `bot/shared/database/queries.js:14:77bc023b`? · `dashboard/database/queries.js:687:7a0c163a`? · `dashboard/test-rls-with-supabase-client.js:51:77bc023b`?
- table `cta_clicks` (written by `funnel-tracking.routes.js`) ← read by `dashboard/database/queries.js:963:523a1987`?
- table `hcp_visit_schedules` (written by `hcp.routes.js`) ← read by `bot/shared/calls/call-context.repo.js:91:2f8e7c71`?
- table `teacher_training_progress` (written by `portal.routes.js`) ← read by `bot/shared/calls/call-context.repo.js:107:94ec1a3a`? · `bot/shared/routes/teacher-training-endpoint.js:846:9402d340`? · `bot/shared/services/coaching/video-reco/store.js:64:6733ba3c`? · `bot/shared/services/training/capstone-delivery.service.js:115:94ec1a3a`? (+4: `python3 kg/kg.py who-reads teacher_training_progress`)
- table `training_assessment_answers` (written by `portal.routes.js`) ← read by `bot/shared/services/training/capstone-delivery.service.js:639:63b6a734`? · `bot/shared/services/training/isaps-held-release.service.js:130:63b6a734`? · `bot/shared/services/training/isaps-level-grade.service.js:98:f4be22b1`? · `bot/shared/services/training/quiz-delivery.service.js:370:63b6a734`?
- table `training_assessment_attempts` (written by `portal.routes.js`) ← read by `bot/shared/routes/teacher-training-endpoint.js:1222:7cb7cc00`? · `bot/shared/services/teacher-state.service.js:411:2a4bc949`? · `bot/shared/services/training/capstone-delivery.service.js:163:2a4bc949`? · `bot/shared/services/training/certificate.service.js:266:2a4bc949`? (+4: `python3 kg/kg.py who-reads training_assessment_attempts`)
- table `users` (written by `portal.routes.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? · `bot/shared/calls/call-tools.repo.js:242:774e00e5`? · `bot/shared/database/bot-helpers.js:17:61dfd735`? (+168: `python3 kg/kg.py who-reads users`)
- table `website_visits` (written by `funnel-tracking.routes.js`) ← read by `dashboard/database/queries.js:962:340a8e70`?
- env `ATTENDANCE_REPO` read at `dashboard/routes/attendance.routes.js:47:71b56e3d`
- env `BOT_NAME` read at `dashboard/routes/web-quiz.routes.js:1000:2e83b1e8`
- env `COACHIP_TEACHER_KEY_SECRET` read at `dashboard/routes/portal-coachip.routes.js:381:c11b2729`
- env `COACH_SUGGESTION_MODEL` read at `dashboard/routes/portal.routes.js:2309:242c1e69`
- env `HCP_FEEDBACK_MODEL` read at `dashboard/routes/hcp.routes.js:896:d2f68351`
- env `INTERNAL_API_KEY` read at `dashboard/routes/first-touch.routes.js:92:de0d94d0` · `dashboard/routes/portal-fln-send.routes.js:152:66795115` · `dashboard/routes/portal-share.routes.js:37:66795115` · `dashboard/routes/portal-teacher-home.routes.js:104:66795115` · `dashboard/routes/portal-teacher-push.routes.js:34:de0d94d0` · `dashboard/routes/portal.routes.js:3850:9cd0cfe5` · `dashboard/routes/push-remind.routes.js:96:de0d94d0` · `dashboard/routes/quiz-go.routes.js:89:de0d94d0` · `dashboard/routes/quiz-join.routes.js:240:de0d94d0` · `dashboard/routes/quiz-teacher.routes.js:111:de0d94d0` · `dashboard/routes/sa-game.routes.js:110:de0d94d0` · `dashboard/routes/teacher-report.routes.js:87:de0d94d0` · `dashboard/routes/teacher-stories.routes.js:127:de0d94d0` · `dashboard/routes/web-quiz.routes.js:1244:de0d94d0`
- env `JEST_WORKER_ID` read at `dashboard/routes/web-quiz.routes.js:1344:f9851af2`
- env `MAIN_BOT_URL` read at `dashboard/routes/first-touch.routes.js:91:bd3501c5` · `dashboard/routes/portal-fln-send.routes.js:68:1510f110` · `dashboard/routes/portal-share.routes.js:36:0b216bc4` · `dashboard/routes/portal-teacher-home.routes.js:103:0b216bc4` · `dashboard/routes/portal-teacher-push.routes.js:33:bd3501c5` · `dashboard/routes/portal.routes.js:3849:b0d6fe6e` · `dashboard/routes/push-remind.routes.js:95:bd3501c5` · `dashboard/routes/quiz-go.routes.js:88:bd3501c5` · `dashboard/routes/quiz-join.routes.js:239:bd3501c5` · `dashboard/routes/quiz-teacher.routes.js:110:bd3501c5` · `dashboard/routes/sa-game.routes.js:109:bd3501c5` · `dashboard/routes/teacher-report.routes.js:86:bd3501c5` · `dashboard/routes/teacher-stories.routes.js:126:bd3501c5` · `dashboard/routes/web-quiz.routes.js:1243:bd3501c5`
- env `NODE_ENV` read at `dashboard/routes/billing.routes.js:31:a008d457` · `dashboard/routes/byof.routes.js:122:a008d457` · `dashboard/routes/portal.routes.js:301:85c61416`
- env `ORG_NAME` read at `dashboard/routes/web-quiz.routes.js:1000:2e83b1e8`
- env `R2_ACCESS_KEY_ID` read at `dashboard/routes/portal.routes.js:177:d6f2a7a2`
- env `R2_BUCKET_NAME` read at `dashboard/routes/portal.routes.js:2451:452b57b8` · `dashboard/routes/video-reco.routes.js:39:405e21a0`
- env `R2_ENDPOINT` read at `dashboard/routes/portal.routes.js:175:2684789e`
- env `R2_SECRET_ACCESS_KEY` read at `dashboard/routes/portal.routes.js:178:5687c9ca`
- env `RAILWAY_ENVIRONMENT_NAME` read at `dashboard/routes/portal-child-test.routes.js:161:3350bca8`
- env `REFERRAL_BOT_NUMBER` read at `dashboard/routes/app-login.routes.js:48:74270e6d` · `dashboard/routes/quiz-go.routes.js:64:f8a4af8f` · `dashboard/routes/quiz-join.routes.js:252:bfae4aed` · `dashboard/routes/quiz-teacher.routes.js:120:f4d044fe` · `dashboard/routes/teacher-stories.routes.js:111:74270e6d` · `dashboard/routes/web-quiz.routes.js:1376:3411e16e`
- env `WEB_QUIZ_BASE_URL` read at `dashboard/routes/web-quiz.routes.js:1411:96869db4`
- env `WHATSAPP_BOT_NUMBER` read at `dashboard/routes/app-login.routes.js:48:74270e6d` · `dashboard/routes/quiz-go.routes.js:64:f8a4af8f` · `dashboard/routes/quiz-join.routes.js:252:bfae4aed` · `dashboard/routes/quiz-teacher.routes.js:120:f4d044fe` · `dashboard/routes/teacher-stories.routes.js:111:74270e6d` · `dashboard/routes/web-quiz.routes.js:1376:3411e16e`

## Tests (all, generated)
- `app-funnel.routes.js` ← `tests/app-funnel/action-logger.test.js` · `tests/app-funnel/dc-upload-failed-route.test.js` · `tests/app-funnel/funnel-events-route.test.js` · `tests/portal/fln-routes.test.js`
- `app-login.routes.js` ← `tests/app-funnel/app-login-journey.test.js` · `tests/app-redirect/app-link-coach-training.test.js` · `tests/app-redirect/app-link-leader-lesson-plan.test.js` · `tests/app-redirect/app-link-leader-lessons-doors.test.js` · `tests/app-redirect/app-link-leader-lessons-rescue.test.js` · `tests/app-redirect/app-link-leader-lessons-voice-topic.test.js` (+6: `python3 kg/kg.py who-reads dashboard/routes/app-login.routes.js`)
- `attendance.routes.js` ← `tests/attendance/_shared.js`
- `coach-card.routes.js` ← `tests/portal/bd-tbprit.4-cv-opens-portal-card.test.js` · `tests/portal/bd-v0toag.38.9-coach-card.test.js`
- `coach-disagreements.routes.js` ← `tests/coaching/bd-tbprit.9-coach-clip-window.test.js` · `tests/portal/bd-tbprit.1-coach-disagreements-routes.test.js` · `tests/portal/bd-tbprit.11-coach-plan-routes.test.js` · `tests/portal/bd-tbprit.12-coach-undone-route.test.js` · `tests/portal/bd-tbprit.2-coach-disagreement-clip-route.test.js`
- `coaching-report.routes.js` ← `tests/coaching/video-reco/r7r-cr-card.test.js` · `tests/portal/bd-v0toag.18-report-page.test.js` · `tests/portal/bd-v0toag.38.9-agree-ping-page.test.js` · `tests/portal/bd-v0toag.49-report-page-useful.test.js` · `tests/portal/bd-v0toag.80-cancel-keeps-reasons.test.js` · `tests/portal/coaching-report-page.video.test.js`
- `edge-mounts.js` ← `dashboard/tests/cut-link-off-harness.js` · `dashboard/tests/quiz-teacher-mount.service.test.js`
- `edge-security-headers.js` ← `dashboard/tests/edge-security-headers.service.test.js`
- `first-touch.routes.js` ← `dashboard/tests/edge-relay-harness.js` · `dashboard/tests/first-touch-edge.service.test.js`
- `hcp.routes.js` ← `tests/hcp/_shared.js` · `tests/hcp/hcp-access-guard.test.js` · `tests/hcp/hcp-malformed-json.test.js` · `tests/hcp/hcp-teacher-dc.test.js` · `tests/hcp/hcp-teachers-list.test.js`
- `iab-probe.routes.js` ← `tests/observe/iab-probe.test.js`
- `portal-child-test.routes.js` ← `dashboard/tests/sa-r7b-cwpm-switch.service.test.js` · `dashboard/tests/sa-r7b-switches.service.test.js` · `dashboard/tests/sa-r8-offline-switches.service.test.js` · `dashboard/tests/sa-ur-fit-portal-switch.service.test.js` · `tests/coachip/coachip-golden.test.js`
- `portal-coachip-media.routes.js` ← `tests/coachip-media/coachip-media.routes.test.js`
- `portal-coachip.routes.js` ← `tests/coachip/coachip-assert-clean.test.js` · `tests/coachip/coachip-coach-read.test.js` · `tests/coachip/coachip-golden.test.js` · `tests/coachip/coachip-write.test.js` · `tests/coachip/helpers/app.js`
- `portal-fln-links.routes.js` ← `tests/portal/fln-links-routes.real-access.test.js` · `tests/portal/fln-links-routes.real-corpus.test.js` · `tests/portal/fln-links-routes.test.js`
- `portal-fln-send.routes.js` ← `tests/portal/fln-send-routes.test.js`
- `portal-fln.routes.js` ← `tests/coachip/coachip-golden.test.js` · `tests/portal/fln-ab-isolation.test.js` · `tests/portal/fln-links-mount.test.js` · `tests/portal/fln-media-presign.test.js` · `tests/portal/fln-routes.test.js` · `tests/portal/fln-userkey-helper.test.js` (+2: `python3 kg/kg.py who-reads dashboard/routes/portal-fln.routes.js`)
- `portal-link.routes.js` ← `tests/app-funnel/funnel-events-route.test.js` · `tests/lp-v8/web-lessons-portal-link.test.js` · `tests/observe/iab-probe.test.js` · `tests/portal/bd-fmf24g.15-ready-link.test.js` · `tests/portal/fln-link-scope.test.js` · `tests/training/web-training-portal-link.test.js`
- `portal-share.routes.js` ← `tests/portal/bd-fmf24g.30-share-route.test.js`
- `portal-teacher-attendance.routes.js` ← `tests/portal/bd-fmf24g.7-teacher-attendance.test.js`
- `portal-teacher-coaching.routes.js` ← `tests/portal/bd-fmf24g.4-teacher-coaching.test.js`
- `portal-teacher-home.routes.js` ← `tests/portal/portal-teacher-home.quiz-tile.test.js` · `tests/portal/portal-teacher-home.routes.test.js`
- `portal-teacher-lessons.routes.js` ← `tests/portal/bd-fmf24g.3-grade-subjects.test.js` · `tests/portal/bd-fmf24g.3-lp-history.test.js`
- `portal-teacher-notices.routes.js` ← `tests/portal/bd-fmf24g.15-teacher-notices-routes.test.js`
- `portal-teacher-push.routes.js` ← `dashboard/tests/portal-teacher-push.service.test.js`
- `portal-teacher-thing-to-try.routes.js` ← `tests/portal/bd-v0toag.8-thing-to-try.test.js`
- `portal.routes.js` ← `tests/coachip/coachip-flags.test.js` · `tests/coachip/coachip-golden.test.js` · `tests/dashboard/portal-proxy-harness.js` · `tests/portal/account-school-name.test.js` · `tests/portal/analytics-coaching-route.test.js` · `tests/portal/analytics-date-filter.test.js` (+66: `python3 kg/kg.py who-reads dashboard/routes/portal.routes.js`)
- `push-remind.routes.js` ← `dashboard/tests/push-remind-edge.service.test.js`
- `quiz-go.routes.js` ← `bot/tests/first-touch/walk-persona-seam.test.js` · `dashboard/tests/edge-relay-harness.js` · `dashboard/tests/quiz-go-edge.service.test.js`
- `quiz-join.routes.js` ← `dashboard/tests/quiz-join-adventure.service.test.js` · `dashboard/tests/quiz-join-early-tap.service.test.js` · `dashboard/tests/quiz-join-edge.service.test.js` · `dashboard/tests/quiz-join-one-face.service.test.js` · `dashboard/tests/quiz-join-wait-word.service.test.js`
- `quiz-teacher.routes.js` ← `dashboard/tests/edge-relay-harness.js` · `dashboard/tests/quiz-teacher-edge.service.test.js` · `dashboard/tests/quiz-teacher-mount.service.test.js` · `dashboard/tests/quiz-teacher-server-timing.service.test.js`
- `sa-battery-switches.js` ← `bot/tests/child-test/sa-rdf-w3.test.js` · `dashboard/tests/sa-engine-routes-cold-start.service.test.js` · `dashboard/tests/sa-r4-cell-pace.service.test.js` · `dashboard/tests/sa-r4-coach-last-word.service.test.js` · `dashboard/tests/sa-r4-comp-all-variants.service.test.js` · `dashboard/tests/sa-r4-comp-all.service.test.js` (+17: `python3 kg/kg.py who-reads dashboard/routes/sa-battery-switches.js`)
- `sa-engine.routes.js` ← `dashboard/tests/sa-dev-tools-gate.service.test.js` · `dashboard/tests/sa-engine-routes-cold-start.service.test.js` · `dashboard/tests/sa-engine-routes.service.test.js` · `dashboard/tests/sa-r5-auto-child-last-word.service.test.js` · `dashboard/tests/sa-r6-manual-app-asks.service.test.js` · `dashboard/tests/sa-r7-auto-no-last-word.service.test.js` (+13: `python3 kg/kg.py who-reads dashboard/routes/sa-engine.routes.js`)
- `sa-game.routes.js` ← `dashboard/tests/sa-switch.service.test.js`
- `sa-r7a-content.js` ← `dashboard/tests/sa-r7a-child-screens.service.test.js` · `dashboard/tests/sa-r8-say-next-q.service.test.js`
- `sa-switch.js` ← `dashboard/tests/sa-switch.service.test.js`
- `teacher-report.routes.js` ← `dashboard/tests/class-round-edge.service.test.js` · `dashboard/tests/edge-relay-harness.js` · `dashboard/tests/teacher-class-week-edge.service.test.js` · `dashboard/tests/teacher-jugnu-edge.service.test.js` · `dashboard/tests/teacher-report-timing-edge.service.test.js` · `dashboard/tests/web-quiz-class-link-edge.service.test.js` (+1: `python3 kg/kg.py who-reads dashboard/routes/teacher-report.routes.js`)
- `teacher-stories.routes.js` ← `dashboard/tests/edge-relay-harness.js`
- `training-library.routes.js` ← `tests/portal/bd-s42dye-1-training-library.test.js`
- `video-reco.routes.js` ← `tests/portal/video-reco-choice.test.js` · `tests/portal/video-reco-routes.test.js`
- `web-quiz-brotli-flag.js` ← `dashboard/tests/push-remind-edge.service.test.js` · `dashboard/tests/sa-r8-switch-hold.service.test.js`
- `web-quiz-canonical.js` ← `bot/tests/first-touch/maker.canonical.test.js`
- `web-quiz-class-link.js` ← `bot/tests/quiz/web-quiz/web-quiz-class-link.test.js`?
- `web-quiz-preview.js` ← `dashboard/tests/web-quiz-preview-urdu-digits.service.test.js`
- `web-quiz-ra-preload.js` ← `dashboard/tests/web-quiz-ra-preload.service.test.js`
- `web-quiz-story-assets.js` ← `dashboard/tests/web-quiz-head-guess-honest.service.test.js` · `dashboard/tests/web-quiz-story-assets.service.test.js` · `dashboard/tests/web-quiz-story-object.service.test.js`
- `web-quiz.routes.js` ← `bot/tests/quiz/web-quiz/teacher-reminder-live-preview.test.js` · `dashboard/tests/class-round-back-edge.service.test.js` · `dashboard/tests/edge-security-headers.service.test.js` · `dashboard/tests/fixtures/closed-lang-scenarios.js` · `dashboard/tests/quiz-join-edge.service.test.js` · `dashboard/tests/quiz-join-one-face.service.test.js` (+60: `python3 kg/kg.py who-reads dashboard/routes/web-quiz.routes.js`)

## Related (all, generated)
- docs: `dashboard/CLAUDE.md`? · `docs/app-funnel-telemetry.md`? · `docs/reports/bug131-phase2-portal-quiz-ui.md`? · `docs/reports/bug131-phase3-grand-quiz.md`? · `docs/reports/bug131-phase4-media-complete.md`? · `tests/BASELINE.md`?
