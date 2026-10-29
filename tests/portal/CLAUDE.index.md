# portal — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/portal -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 4 files: 0 test + 4 support) |
| `helpers/` | Shared fake of the supabase query builder for portal route and service tests → `helpers/CLAUDE.md` |
| `_fln-access-stub.js` | Test helper: faithful stub of dashboard fln-access middleware (noStore, 401, 404 gate) injected into FLN route suites |
| `_fln-http-get.js` | Test helper: fetch-shaped GET over plain http with Connection: close so FLN route suites leave no open sockets |
| `account-school-name.test.js` | Pins GET /dashboard user.schoolName (users.school_id to schools.name, legacy fallback) in dashboard/routes/portal.routes |
| `analytics-account-not-in-broadcast.test.js` | Pins that the analytics-only account made by create-analytics-user is never swept into an all-users broadcast |
| `analytics-coaching-route.test.js` | Pins GET /analytics/coaching (bd-97x22y.1): analytics-viewer gate, date window, six ICT regions, in portal.routes |
| `analytics-date-filter.test.js` | Pins the Analytics page ?from=&to= window reaching every dated query in Pakistan time; blank means all time |
| `analytics-lists-v8.test.js` | Pins schools-analytics v8 lists (FDE schools, RDF teacher and coach rosters) in lib/analytics-lists, fail-closed |
| `analytics-lp-engagement-route.test.js` | Pins GET /analytics/lp-engagement: Active/Non-Active teacher split, viewer gate, window and region rules |
| `analytics-observations-route.test.js` | Pins GET /analytics/observations (bd-97x22y.5): Human/Digital Coach FICO section breakdown behind the analytics gate |
| `analytics-schools-route.test.js` | Pins the portal_analytics_only access gate, GET /analytics/schools and the analyticsOnly flag on the user payload |
| `analytics-training-levels-route.test.js` | Pins GET /analytics/training-levels (bd-97x22y.4): Trainings tab by band, region validation, gate checked every request |
| `analytics-v8-services.test.js` | Pins what the v8 teacher/school lists change in the schools, coaching and observations analytics services |
| `android-app-links-assetlinks.test.js` | Pins dashboard/lib/asset-links and GET /.well-known/assetlinks.json so Android opens portal links in the NIETE app |
| `android-app-links.test.js` | Pins the native half of Android App Links: manifest intent filter, gradle host from VITE_API_BASE_URL, @capacitor/app |
| `android-build-pipeline.test.js` | Pins bd-2553: build:app script builds in app mode so a web-mode bundle cannot ship to Play (bd-2551 regression) |
| `android-ota-same-origin.test.js` | Pins bd-2554: native shell serving the web bundle under OTA does not throw; uses same-origin path (app-target.cjs) |
| `android-ota.test.js` | Pins bd-2553 remote-first OTA: resolveOtaUrl derives the live portal origin for the native shell (app-target.cjs) |
| `android-release-identity.test.js` | Pins bd-2395 Play release identity: applicationId, no release suffix, versionCode floor in the Android gradle config |
| `android-session-persistence.test.js` | Pins BUG-142 (bd-2402): the Android app keeps the portal session across force-close (persistent cookie handling) |
| `android-staging-identity.test.js` | Pins bd-2554: Android staging build type derives from release, carries a .staging suffix, can never be the Play artifact |
| `api-base-url-never-localhost.test.js` | Pins bd-2559: resolveApiBaseUrl never falls back to localhost on a real host; uses same-origin path (app-target.cjs) |
| `app-links.test.js` | Pins app-links.cjs: resolvePortalOrigin and resolveAppLinkPath turn an incoming Android link into an in-app route |
| `app-target.test.js` | Pins app-target.cjs resolveIsPortal: Capacitor WebView on localhost still counts as the portal |
| `assessment-edit-via-internal-api.test.js` | Pins that assessment.service edit-save posts to the bot internal edit route and holds no edit rule or table reads |
| `assessment-generator-flag.test.js` | Pins bd-2460: portal /config reports the Assessment Generator unavailable until its flag is on, with the bot's wording |
| `assessment-multi-chapter-create.test.js` | Pins bd-ix9uhr: bot internal-api assessment/create accepts chapterNumbers for a multi-chapter portal paper |
| `assessment-paper-file.test.js` | Pins GET /assessment/paper/:id/file: portal streams the paper PDF/answer key for the signed-in owner, else 404 |
| `assessment-portal-every-option.test.js` | Pins bd-fmf24g.6: assessment/create passes seenCount, per-type questionTypes and totalMarks like the WhatsApp Flow |
| `assessment-via-internal-api.test.js` | Pins bd-60067: the portal owns no assessment logic or assessment_papers/textbook reads; it relays to the bot |
| `assessments-run-in-portal.test.js` | Pins bd-2673: assessment routes run in the portal (no blanket WhatsApp redirect) gated by eligibility and answer floor |
| `auth-flow-contracts.test.js` | Source-level guards for bd-2509..2513 portal auth fixes: placeholders, phone format, OTP field, single phone prompt |
| `back-button.test.js` | Pins back-button.cjs resolveBackAction: what the Android hardware back key does (close dialog, go home, exit) |
| `bd-15y1pc-one-step-model.test.js` | Pins bd-15y1pc: coach v2 five-step view agrees with the bot's observe step; unsent report is not shown as sent |
| `bd-2676-allow-navigation.test.js` | Pins bd-2676: Capacitor allowNavigation derives the portal host from VITE_API_BASE_URL so navigation stays in-app |
| `bd-2676-certificate-view-and-download.test.js` | Pins bd-2676: certificates offer View (hidden in native app) and Download (saves in place, never opens a tab) |
| `bd-4ryvw-android-certificate-file.test.js` | Pins bd-4ryvw: CertificateFile Capacitor plugin saves a certificate via MediaStore off the main thread, https only |
| `bd-4ryvw-android-ci-sdk-licenses.test.js` | Pins bd-4ryvw: Android workflows avoid setup-android@v3, accept SDK licenses non-interactively, run Node 22+ |
| `bd-5gyspy.12-selected-tab-contrast.test.js` | Pins bd-5gyspy.12: child hub selected-tab label meets 4.5:1 contrast, read from the shipped wq stylesheets |
| `bd-5gyspy.8-relay-late-answer.test.js` | Pins bd-5gyspy.8: a bot answer arriving after the portal's 504 does not throw ERR_HTTP_HEADERS_SENT in relayToBot |
| `bd-5gyspy.9-10-db-client-timeouts.test.js` | Pins bd-5gyspy.9/.10: held pg client errors are handled and the DB-context budget follows the route budget |
| `bd-5rz1v-coaching-portal-routes.test.js` | Pins bd-5rz1v routes behind the redesigned Coaching pages: upload/start library pick, recent-plans, sessions list |
| `bd-5rz1v.12-new-ui-flag.test.js` | Pins bd-5rz1v.12: portal_new_ui app_settings flag shape and fail-closed rule in feature-flags and /config |
| `bd-5rz1v.6-coach-observation-routes.test.js` | Pins bd-5rz1v.6: coach /observe portal routes are leader-only, session-user-only, dark behind a flag |
| `bd-5rz1v.6.4-teacher-sees-observation.test.js` | Pins bd-5rz1v.6.4: a coach's sent observation appears in the teacher's coaching list and report routes |
| `bd-5rz1v.6.5-my-analytics-sent-observations.test.js` | Pins bd-5rz1v.6.5: teacher /my-analytics counts a coach observation only once the coach has sent it |
| `bd-aqotzx-class-check-history.test.js` | Pins bd-aqotzx: teacher DC history shows not-a-class recordings as Needs your answer / stopped, outside the numbers |
| `bd-bmc9a0.2-save-recording-route.test.js` | Pins bd-bmc9a0.2: /coaching-upload/start forwards saveForLater only as a real boolean true to the bot |
| `bd-c5reix-pending-portal-routes.test.js` | Pins bd-c5reix: /coaching-upload/pending and /check-duplicate relay to the bot, dark when off, 502 when bot is down |
| `bd-eygg2f-reflection-voice-client.test.js` | Pins bd-eygg2f: portal-coaching.client submitReflection posts the audio key and waits 90s+ for transcription |
| `bd-fmf24g-teacher-v2-flag.test.js` | Pins bd-fmf24g.1: portal_teacher_v2 flag shape (all, pilot list, fail closed) in feature-flags and portal routes |
| `bd-fmf24g.10-report-narrative-view.test.js` | Pins bd-fmf24g.10: report-narrative-view maps analysis_data.report_narrative to the report page shape, else null |
| `bd-fmf24g.15-ready-link.test.js` | Pins bd-fmf24g.15: signed /t/<token> ready link names one paper or lesson item for one teacher (portal-link-token) |
| `bd-fmf24g.15-ready-templates.test.js` | Pins bd-fmf24g.15: draft WhatsApp UTILITY templates for the ready fallback fit Meta caps in code points |
| `bd-fmf24g.15-ready-whatsapp.test.js` | Pins bd-fmf24g.15: switched-off-by-default WhatsApp fallback sweep (portal-ready-whatsapp.service) with fake PostgREST |
| `bd-fmf24g.15-teacher-notices-routes.test.js` | Pins bd-fmf24g.15 HTTP routes /me/notices (list, seen) in portal-teacher-notices.routes; DB failure is 502 |
| `bd-fmf24g.15-teacher-notices.test.js` | Pins bd-fmf24g.15 teacher-notices.service: papers and 6-12 lesson plans being made, ready, opened or seen |
| `bd-fmf24g.15-weekday-hours.test.js` | Pins bd-fmf24g.15 weekdayDeadline: Home keeps an item 24 weekday hours in Pakistan time, weekend excluded |
| `bd-fmf24g.3-grade-subjects.test.js` | Pins bd-fmf24g.3 GET /me/grade-subjects: grade-subject pairs from classes or history for the teacher v2 picker |
| `bd-fmf24g.3-lp-history.test.js` | Pins bd-fmf24g.3 lp-history.service and route: All lesson plans KPIs, previous-period compare, class filter |
| `bd-fmf24g.3-subject-vocabulary.test.js` | Pins bd-fmf24g.3 subject-vocabulary.service: five source spellings map to one subject key and localized name |
| `bd-fmf24g.30-share-route.test.js` | Pins bd-fmf24g.30 POST /share/whatsapp route: 401, flag-off 404, validation, real bot result, 502 on failure |
| `bd-fmf24g.30-share-send.test.js` | Pins bd-fmf24g.30 share-send.service: template-only WhatsApp send with sent/unavailable/failed results |
| `bd-fmf24g.4-teacher-coaching.test.js` | Pins bd-fmf24g.4 teacher routes for visits, coaching journey and DC history in teacher-coaching.service |
| `bd-fmf24g.7-teacher-attendance.test.js` | Pins bd-fmf24g.7 teacher attendance routes: classes, roster, mark (bot-relayed), day/month and .xlsx register |
| `bd-fxk3t8-first-paint.test.js` | Pins bd-fxk3t8 server-side first paint: parallel /config flag reads and portal static cache headers |
| `bd-fxk3t8-me.test.js` | Pins bd-fxk3t8 GET /me: same user as /dashboard without the count queries, 401 signed out, 500 on bad read |
| `bd-o15qnr-coach-v2-flag.test.js` | Pins bd-o15qnr.1 portal_coach_v2 flag shape and fail-closed rule, and the /leader/observe gate |
| `bd-o15qnr-coach-v2-routes.test.js` | Pins bd-o15qnr.3 /api/portal/coach/* read routes: 404 when portal_coach_v2 is off, session coach only, input validation |
| `bd-o15qnr-coach-v2-service.test.js` | Pins bd-o15qnr.3 coach-v2.service read side: people, schedule, team numbers computed from existing tables |
| `bd-o15qnr-visit-time.test.js` | Pins bd-o15qnr.2 visit-time: any half hour 7:00-18:30 is bookable, old slots stay valid, create and edit share a rule |
| `bd-o15qnr.10-history-reports.test.js` | Pins bd-o15qnr.10 getCoachTeacher/getCoachObservation: what each History row opens, patch-guarded report |
| `bd-o15qnr.11-edit-teacher.test.js` | Pins bd-o15qnr.11 coach-teacher-admin moveTeacher: patch re-check then bot internal API, 404 outside the patch |
| `bd-o15qnr.13-edit-fields.test.js` | Pins bd-o15qnr.13 editTeacher name/level/role/phone: patch re-check, then bot runs the /observe edit path |
| `bd-o15qnr.17-portal-booking-announce.test.js` | Pins bd-o15qnr.17: portal booking, move and cancel ask the bot to announce once; past dates announce nothing |
| `bd-o15qnr.19-observation-page.test.js` | Pins bd-o15qnr.19 getCoachObservation: one observation's step, score and report key, own-observation and patch guards |
| `bd-o15qnr.20-lp-engagement.test.js` | Pins bd-o15qnr.20: coach-v2 Teacher and Visit pages show exams generated and lesson plans opened (lp-activity.service) |
| `bd-o15qnr.21-pending.test.js` | Pins bd-o15qnr.21: coach-v2 pending banner counts Feedback Form and Debrief observations with ids, behind the v2 gate |
| `bd-o15qnr.22-visit-moved-any-timezone.test.js` | Pins bd-o15qnr.22: did-the-visit-move comparison is timezone-independent (Asia/Karachi server DATE handling) |
| `bd-o15qnr.23-today-in-karachi.test.js` | Pins bd-o15qnr.23: today for visit booking is the Asia/Karachi day, so past-date checks and notices are right 00-05 PKT |
| `bd-o15qnr.8-coach-feedback.test.js` | Pins bd-o15qnr.8 coach v2 round-1 server rules: past-dated visits allowed with no teacher notice, edit and reschedule |
| `bd-o15qnr.9-visit-last.test.js` | Pins bd-o15qnr.9: coach-v2 Visit page Last visit row (id, observer, step, link) via TEACHER_FACTS |
| `bd-q4g7s-android-mic-camera.test.js` | Pins bd-q4g7s: Android manifest declares only mic and network, optional mic, and the KeepScreen plugin keeps screen on |
| `bd-s42dye-1-training-library.test.js` | Pins bd-s42dye.1 coach-only read-only Training Library API: role re-read each request, catalogue, module, readings |
| `bd-tbprit.1-coach-disagreements-routes.test.js` | Pins bd-tbprit.1 coach-disagreements API: list and card for the logged-in coach, 404 when the flag is off |
| `bd-tbprit.1-coach-disagreements-wiring.test.js` | Pins bd-tbprit.1: coach_disagreement_card flag surfaces as features.coachDisagreements; router mounts the API |
| `bd-tbprit.11-coach-plan-routes.test.js` | Pins bd-tbprit.11 POST /coach/disagreements/:id/plan and /suggestion: coach-only, 500 on failed save, null on AI failure |
| `bd-tbprit.12-coach-undone-route.test.js` | Pins bd-tbprit.12 POST /coach/disagreements/:id/undone: moves a card back to To do, hers only, behind the flag |
| `bd-tbprit.2-coach-disagreement-clip-route.test.js` | Pins bd-tbprit.2 GET /coach/disagreements/:id/clip: disputed step as inline never-cached mp3 for the assigned coach |
| `bd-tbprit.4-cv-opens-portal-card.test.js` | Pins bd-tbprit.4: WhatsApp /cv/:token 303s to the portal disagreement card only when both flags are on, else v1 card |
| `bd-v0toag.1.2-report-opened.test.js` | Pins bd-v0toag.1.2: opening one's own report logs coaching.report.opened via dashboard telemetry; none for others |
| `bd-v0toag.18-report-page.test.js` | Pins bd-v0toag.18 GET /cr/:token read-only coaching report page (groups C/D): private, expired link goes to sign-in |
| `bd-v0toag.38.9-agree-ping-page.test.js` | Pins bd-v0toag.38.9 Do-you-agree card and /cr/:token/coach reasons page on the C/D report page |
| `bd-v0toag.38.9-coach-card.test.js` | Pins bd-v0toag.38.9 coach card GET /cv/:token and POST /visited: scores, reasons, voice note, no-store, bad link 404 |
| `bd-v0toag.49-report-page-useful.test.js` | Pins bd-v0toag.49: C/D report page asks WhatsApp's useful question as POST form, stores coaching_quality_metrics answer |
| `bd-v0toag.8-thing-to-try-step.test.js` | Pins bd-v0toag.8 PR3: thing-to-try.service carries the lesson-plan step so the teacher app opens at that heading |
| `bd-v0toag.8-thing-to-try.test.js` | Pins bd-v0toag.8 PR2: GET /teacher/thing-to-try and POST /tap routes, switch and school-draw gates |
| `bd-v0toag.80-cancel-keeps-reasons.test.js` | Pins bd-v0toag.80: Cancel on the C/D tell-my-coach page keeps ticked reasons as user_feedback and asks no coach |
| `bd-xorfy-portal-visit-notice.test.js` | Pins bd-xorfy: portal visit booking/cancel asks the bot (observe-notice.service) to WhatsApp the teacher; outage-safe |
| `bd-z3cadk-report-extras.test.js` | Pins bd-z3cadk report-extras: portal report shows Last time we asked, journey note, repeat-recording date |
| `capstone-submit-budget.test.js` | Pins bd-te5lae: written capstone submit gets a 120s+ route budget in middleware/timeout, marking deadline inside it |
| `certificates-client.test.js` | Pins certificates.service client as a wire: posts session userId to bot, throws on outage or success:false |
| `child-test-portal-routes.test.js` | Pins bd-s1oo0.7 /leader/child-test/* relay: 401/403/404 gates, portal_child_test flag, no child-test logic in portal |
| `coach-school-admin.routes.test.js` | Pins coach school/teacher admin routes: behind coach v2 gate, session coach, EMIS from URL, malformed EMIS 404 |
| `coach-school-admin.test.js` | Pins coach-school-admin.service: school must be one of the coach's own (EMIS), writes go to the bot internal API |
| `coach-school-card-period.test.js` | Pins school-card-period: Today / This week / This month buckets in Pakistan time with future and partial slots |
| `coach-school-card-routes.test.js` | Pins portal_coach_school_card flag and School Card routes: behind coach v2 chain, 404 when off, input validation |
| `coach-school-card-service.test.js` | Pins coach-school-card.service reads (lesson plans, DC observations, rosters) against an in-memory tagged-query fake |
| `coaching-analytics.service.test.js` | Pins coaching-analytics.service summariser/loader behind /analytics/coaching: six regions, coaches, visits, schools |
| `coaching-overall-denominator.test.js` | Pins coaching-frameworks getOverall: the score max equals the sum of domain maxes, not scores.max_marks |
| `coaching-reads-the-real-fields.test.js` | Pins bd-60077: coaching routes read the session's real framework keys, no OECD goal keys, breakdown asked of the bot |
| `coaching-report-page.video.test.js` | Pins bd-gzfdu9: /cr report page adds Watch this next card only with a recommendation, else byte-identical to golden |
| `create-analytics-user.test.js` | Pins scripts/create-analytics-user: dry-run default, project-ref assert, list append, refuses staff phones |
| `curriculum-grades-pagination.test.js` | Pins fetch-all-paged: grade picker pages past PostgREST's 1000-row cap so grades 6-12 are not dropped |
| `curriculum-one-grade-list.test.js` | Pins bd-60083: one Lesson Plans list for grades 1-12 in the portal, no separate 6-12 tab, assessment on its own page |
| `dashboard-stats.test.js` | Pins bd-60079: portal dashboard drops the frozen lesson_plans count and returns what the teacher actually does |
| `exam-pass-mark-and-cooldown.test.js` | Pins bd-2489/bd-2475: exam gate reports the vendor pass mark and real cooldown_hours per exam kind |
| `feature-flags-cache.test.js` | Pins lib/feature-flags cache: 100 concurrent /config requests read each of 13 app_settings keys once per TTL |
| `fln-ab-isolation.test.js` | Pins FLN isolation from the ch3-10 A/B: no lp-ab-ch310 load, niete_lp_opens readers filter plan_kind k5 |
| `fln-access.test.js` | Pins lib/fln-access: lessons/share access rule from role and portal_fln_* flags, requireFln no-store 401/404 |
| `fln-corpus.test.js` | Pins fln-corpus.service: loads the FLN bundle from the mirror by app_settings version, gunzip, version check, in memory |
| `fln-link-scope.test.js` | Pins portal-link.routes portalLinkScope: a lessons-scoped link session reaches the FLN API and nothing else |
| `fln-links-mount.test.js` | Pins the single hook line mounting portal-fln-links.routes inside portal-fln.routes, each behind no-store |
| `fln-links-routes.real-access.test.js` | Runs FLN leader routes under the real fln-access middleware order; skipped where fln-access is absent |
| `fln-links-routes.real-corpus.test.js` | Runs FLN leader routes on the real fln-corpus service and fixture; cold 503, grade 1 list, grade 8 400 |
| `fln-links-routes.test.js` | Pins GET /fln/links and /fln/title/:id (leader-only link builder, public banner title) over real Express |
| `fln-media-presign.test.js` | Pins FLN plan media presigned on the portal's private R2 bucket, daily-stable URLs, never the public mirror |
| `fln-readers.test.js` | Pins that every lesson-plan-open reader (lp-describe, lp-activity, lp-history) copes with an fln plan_kind open |
| `fln-routes.test.js` | Pins portal-fln.routes over real Express: access gating, /me, plan, events, funnel logging with real fln-access |
| `fln-send-routes.test.js` | Pins GET /fln/teachers and POST /fln/send: portal route to in-process bot fln-send route, patch-scoped, keyed ids |
| `fln-userkey-helper.test.js` | Pins that the portal userKeyOf and the bot fln-keys userKey both use web-quiz-kid tk and load without the bot logger |
| `leader-overview-feature-totals.test.js` | Pins bd-60174: leader-overview patch summary totals every feature (attendance, training) and counts engaged teachers |
| `leader-patch-feature-engagement.test.js` | Pins bd-60174: leader-patch SQL and rows carry per-feature engagement, shared by coach and principal views |
| `leader-patch-nameless-teacher.test.js` | Pins leader-patch.service: a teacher with empty first_name still gets a readable findable label, not a blank row |
| `leader-teacher-detail-summary.test.js` | Pins bd-60174: leader-teacher-detail carries a written summary per session; score hidden in UI, kept in the API |
| `lesson-plan-file-proxy.test.js` | Pins bd-5rz1v.10 lib/lesson-plan-file: portal proxies lesson plan PDFs from its configured storage host only |
| `load-analytics-lists.test.js` | Pins scripts/load-analytics-lists: builds the v8 RDF Primary and 6-12 populations as ids only, no phone stored |
| `local-dev.test.js` | Pins bd-hnhlgn.1 lib/local-dev: loopback DB hosts drop SSL, remote hosts keep it, for running the portal API locally |
| `lp-catalogue-via-internal-api.test.js` | Pins bd-60063: portal LP catalogue routes delegate to the bot catalogue client, no lesson-plan table reads |
| `lp-engagement.service.test.js` | Pins lp-engagement.service: Active/Non-Active teachers per band and sector from RDF populations (analytics v8) |
| `lp-leader-bot-calls.test.js` | Pins bd-4joiqz: lp-catalogue and lp612 services tell the bot reader:leader for a coach, teacher calls unchanged |
| `lp-leader-open.test.js` | Pins bd-4joiqz: a leader's lesson-plan open is not logged as a teacher's use, for K-5, 6-12 and FLN plans |
| `lp-open-logging.test.js` | Pins bd-5rz1v.15: viewer open of a lesson plan writes one deduped niete_lp_opens row; 404 records none |
| `lp-open-survey-trigger.test.js` | Pins bd-qvevax.2: a recorded viewer open asks the bot's internal API for the lesson-plan survey with only the open id |
| `lp-render-endpoint-retired.test.js` | Pins bd-60063: POST /curriculum/lp/:uuid/render stays retired; portal enqueues no render and never requires bot queue |
| `lp612-via-internal-api.test.js` | Pins bd-60082: portal grades 6-12 lesson plans come from the bot via lp612.service, no lp612 table reads |
| `my-attendance.test.js` | Pins GET /my-attendance: the principal attendance page scoped to the signed-in teacher only, ignoring request teacherId |
| `no-local-grading-in-portal-routes.test.js` | Tripwire (bd-2673): portal.routes holds no marking, answer-correctness or pass-bar logic; the bot decides |
| `observations-analytics.service.test.js` | Pins observations-analytics.service (bd-97x22y.5): Human and DC FICO sections B/C/D, pooled percentages, never a fake 0 |
| `open-file-page.test.js` | Pins bd-fmf24g.61 portal/public/open-file.html: forwards to allowed hosts, delayed fallback link, NIETE branding |
| `portal-assessment-editing-flag.test.js` | Pins bd-6faz8m: portal_assessment_editing_enabled truth table falls back to the old key; failed read is off |
| `portal-auth-log-quiet.test.js` | Pins requirePortalAuth logging: silent when signed in, one single-line entry on a refusal (log-rate cap) |
| `portal-build-pipeline.test.js` | Pins bd-2555: build:portal script builds and emits into the committed served dist and installs dashboard deps |
| `portal-coaching-live.test.js` | Pins bd-v0toag.31: coaching-upload/start forwards the live-moves record; session user only, behind portal auth |
| `portal-coaching-upload.test.js` | Pins bd-lfzoz self-observation routes: upload presign, start, session progress; session user only, bot relayed |
| `portal-code-sign-in.test.js` | Pins bd-x7aprz.3 /request-code WhatsApp code sign-in: who gets a code, resend limit, no activation gate |
| `portal-command-go-link.test.js` | Pins bd-x7aprz.3: bot /portal replies with one button holding the signed /go login link, English and Urdu within caps |
| `portal-config-bot-number.test.js` | Pins GET /config bot field: this tier's bot number from WHATSAPP_BOT_NUMBER or REFERRAL_BOT_NUMBER, else null |
| `portal-language-endpoint.test.js` | Pins GET /me/language and the language write: session user only, one writer, value clamped to the en/ur offer |
| `portal-language-offer.test.js` | Pins portal i18n offers exactly Urdu and English, with no off-market locale bundles or files |
| `portal-login-account-name.test.js` | Pins bd-s6qbts.5: analytics-only accounts sign in with an account name (analytics-account-name rules), not a phone |
| `portal-login-no-password.test.js` | Pins POST /login for an activated account with no password hash: 4xx set-password message, no bcrypt crash, Axiom event |
| `portal-name-once.test.js` | Pins that the dashboard payload, /validate-token and PortalInviteService render a user's name once (users.name only) |
| `portal-reaches-bot-modules.test.js` | Pins bd-60085: portal routes must not require bot modules the portal service cannot resolve (POST /training/bands) |
| `portal-self-observation-flag.test.js` | Pins bd-3bvfj: portal_self_observation flag is fail-closed in isFlagEnabledForUser; self-observation ships dark |
| `portal-session-user-id.test.js` | Pins that requirePortalAuth routes read the session id, not req.portalUser, which only the leader gate sets |
| `portal-setup-no-password.test.js` | Pins /validate-token and /setup letting an activated-but-passwordless account set a password from the invite link |
| `portal-teacher-home.quiz-tile.test.js` | Pins GET /me/home quizTile: on only with portal_teacher_home_quiz_tile for the session user and a bot quiz home |
| `portal-teacher-home.routes.test.js` | Pins GET /me/home and POST /me/home/tap: gates, card ladder, bot-down fallback, tap logging |
| `portal-ui-contracts.test.js` | Source-level guards for bd-2465..2467: WhatsApp CTAs use the tier's bot number from lib/whatsapp.ts, no hardcoded wa.me |
| `principal-school-scope.test.js` | Pins principal school-analytics scope: roster from the session user and role, outside-school teacher 404 |
| `progress-counts.db.test.js` | Pins bd-5rz1v.17/.15 Home count rules as real SQL in a rolled-back transaction (progress.service, lp-activity.service) |
| `progress-range.test.js` | Pins bd-5rz1v.17 pk-range: Home date presets resolved as calendar periods in Asia/Karachi, default this month |
| `progress-routes.test.js` | Pins GET /progress and /progress/:metric: five counts per range, one statement, items behind each count |
| `r2-presign-content-disposition.test.js` | Pins bd-2492 generatePresignedUrl: inline disposition and inferred content type for PDF, video, audio, image |
| `resolve-media-url-disposition.test.js` | Pins bd-2492 _resolveMediaUrl in portal.routes: forwards disposition options, passes non-R2 public URLs through |
| `school-analytics-observations.test.js` | Pins school-analytics.service: Human vs Digital Coach observation counts, ratings and progress line from Human only |
| `schools-analytics.service.test.js` | Pins schools-analytics.service (FDE/AEO view): overview, regions, schools key sets, counts only, no teacher-level data |
| `score-bands.test.js` | Pins bot score-bands scoreBandFor: observation scores show as Excellent..Poor brackets at 20/40/60/80, never a number |
| `session-rolling.test.js` | Pins bd-x7aprz.3: portal session cookie is 30 days rolling from last visit, flags unchanged (lib/local-dev) |
| `steps-removed.test.js` | Pins removal of GET /leader/steps and the STEPS grid builder; attendance with no window is all time |
| `teacher-analytics.test.js` | Pins a teacher's own Analytics page: exams generated count, remarks received, Digital Coach rating on her page |
| `teacher-home-order.service.test.js` | Pins teacher-home-order.service: per-teacher tile ranking (28-day, 14-day half-life) and the Home card ladder |
| `training-levels-analytics.service.test.js` | Pins the v8 Trainings tab service: RDF primary population, certificate-wins level rule, band/region filters, snapshot |
| `training-rules-client.test.js` | Pins bd-2480/2481 training-rules.service: portal asks the bot for training decisions, verbatim, with timeout |
| `video-reco-api.test.js` | Pins bd-gzfdu9 coaching-session video_recommendation: absent when VIDEO_RECO_ENABLED is off, null or clip when on |
| `video-reco-choice.test.js` | Pins bd-9dbhh0.1 /v/:token Not now / Stop clips / resume form posts via clip-pref, token ids only |
| `video-reco-player-events.test.js` | Pins bd-gzfdu9 /v player script: play row written on the media playing event once, not on play() alone |
| `video-reco-routes.test.js` | Pins bd-gzfdu9 /v/:token tracked clip page, /v/:token/e beacons and thumbnail route in video-reco.routes |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `dashboard/lib/CLAUDE.md`? · `dashboard/middleware/CLAUDE.md`? · `dashboard/middleware/rbac/CLAUDE.md`? · `infrastructure/templates/drafts/README.md`? · `portal/ANDROID.md`? · `tests/CLAUDE.md`?
