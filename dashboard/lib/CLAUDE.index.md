# lib — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/lib -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `insights/` | COACHIP nightly insight job: stage modules run by job.js, writing coachip_* tables → `insights/CLAUDE.md` |
| `analytics-account-name.js` | Lets analytics-only accounts sign in with an account name instead of a phone number; bd-s6qbts.5. |
| `analytics-lists.js` | One loader of the three school lists (FDE EMIS, RDF, etc.) that every schools-analytics tab counts against. |
| `analytics-viewer.js` | Middleware gating analytics-only endpoints to user ids listed in app_settings portal_analytics_only; 403/500 on fail. |
| `assessment-rate-limit.js` | Per-teacher soft limit on paper generation: 10 per hour, 30 per day, to protect the shared worker queue. |
| `asset-links.js` | Serves Android Digital Asset Links (/.well-known/assetlinks.json) so the NIETE app opens portal links directly. |
| `closed-inline-switch.js` | Reads app_settings web_quiz_closed_inline (strict boolean, fail-closed) to answer closed child links in the same stream. |
| `closed-way-back-switch.js` | Reads app_settings web_quiz_closed_way_back (strict, fail-closed) so closed pages carry a tap back to WhatsApp. |
| `edge-learn.js` | Lets a fresh portal process learn the web-quiz page switches before its first page (app_settings web_quiz_edge_learn). |
| `edge-redis.js` | Tiny shared-Redis wrapper (get/set with TTL, never throws) for edge answers such as a shared link's page facts. |
| `feature-flags.js` | Fail-closed feature flags backed by app_settings, shared by bot and dashboard so both surfaces give one answer; bd-2460. |
| `fetch-all-paged.js` | Pages a Supabase query past the 1000-row cap so whole-table scans (e.g. curriculum grades) never truncate. |
| `final-error-handler.js` | Last Express error handler: handles malformed JSON bodies and renders error pages safely; bd-nmwmr4.2. |
| `fln-access.js` | Single access rule for Reading Hour and Numeracy (FLN): portal_fln_lessons and portal_fln_share switches per user. |
| `health.js` | GET /health handler including db_writable check so a read-only DB is caught by deploy proof; bd-sex15q.19. |
| `leader-role.js` | Middleware gating the Leader Portal (My Patch, roster) to the school-leader role family; bd-2434, port of bd-2385. |
| `lesson-plan-file.js` | Relays a lesson-plan PDF from storage through the portal's own origin so the in-app pdf.js viewer works; bd-5rz1v.10. |
| `local-dev.js` | Laptop-only tweaks (no SSL to loopback DB, relaxed session cookie) for scripts/dev-portal.sh; no-op in prod. |
| `media-url.js` | Shared presign-or-passthrough helper for training/portal media URLs, moved out of portal.routes.js; bd-s42dye.1. |
| `pk-range.js` | Teacher Home date-range presets computed in Asia/Karachi calendar days, both ends inclusive; bd-5rz1v.17. |
| `portal-host.js` | Decides whether a request targets the portal.* hostname, mirroring the frontend resolveIsPortal rule; bd-2467. |
| `portal-static-cache.js` | Cache-Control policy for the portal's static bundle files so returning browsers need not refetch everything; bd-fxk3t8. |
| `school-card-period.js` | Coach School Card periods (today/week/etc.) in Pakistan time with per-weekday buckets; pure functions. |
| `teacher-observation.js` | Rule for when a coach's leader_observation becomes visible to the observed teacher (not while still a draft). |
| `user-school-name.js` | Resolves the signed-in user's school name for the portal My account page (users.school_id to schools.name first). |
| `visit-time.js` | Validates coach visit times (24h HH:MM from the coach app v2 toggles) accepted by the portal; bd-o15qnr.2. |
| `web-quiz-landing-face.js` | Builds the shared-link landing's inline Urdu font-face (data: URL subset of wq-nastaliq woff2) for a script-less page. |
| `web-quiz-landing-face.json` | Generated metadata (hashes, size, glyph codepoints) for the landing Urdu font subset from landing-urdu-face/build.py. |
| `web-quiz-landing-face.woff2` | (unmapped) |
| `weekday-hours.js` | Counts hours only on Pakistan weekdays so a ready lesson/paper stays on Home for 24 weekday hours; bd-fmf24g.15. |

## Who reads this (all, generated)
- `analytics-account-name.js` ← imported by `dashboard/routes/portal.routes.js:117:4a8ca079` · `scripts/create-analytics-user.js:56:7dc5528c`
- `analytics-lists.js` ← imported by `dashboard/routes/portal.routes.js:121:de843ac4` · `dashboard/services/coachip-scope.service.js:23:f5343854` · `dashboard/services/lp-engagement.service.js:53:9c155943` · `dashboard/services/observations-analytics.service.js:58:e6baeab1` (+3: `python3 kg/kg.py who-reads analytics-lists.js`)
- `analytics-viewer.js` ← imported by `dashboard/routes/portal.routes.js:115:8016df50`
- `assessment-rate-limit.js` ← imported by `dashboard/routes/portal.routes.js:3100:69f9223e`
- `asset-links.js` ← imported by `dashboard/index.js:165:60938a24`
- `closed-inline-switch.js` ← imported by `dashboard/routes/web-quiz.routes.js:48:13a7f7b2`
- `closed-way-back-switch.js` ← imported by `dashboard/routes/quiz-go.routes.js:31:03c0d9ed` · `dashboard/routes/web-quiz.routes.js:47:03c0d9ed`
- `edge-learn.js` ← imported by `dashboard/routes/web-quiz.routes.js:1345:75655047`
- `edge-redis.js` ← imported by `dashboard/index.js:237:5bfd3abc` · `dashboard/routes/web-quiz.routes.js:1940:d3c71ffc`
- `feature-flags.js` ← imported by `dashboard/routes/app-login.routes.js:115:56e747e4` · `dashboard/routes/coach-card.routes.js:36:2687a7b5` · `dashboard/routes/portal-child-test.routes.js:55:fcf4ec1d` · `dashboard/routes/portal-coachip.routes.js:377:8026b0e0` (+13: `python3 kg/kg.py who-reads feature-flags.js`)
- `fetch-all-paged.js` ← imported by `dashboard/routes/portal.routes.js:44:f63ad678` · `dashboard/services/training-library.service.js:17:f63ad678` · `scripts/load-analytics-lists.js:231:c7f81231`
- `final-error-handler.js` ← imported by `dashboard/index.js:3832:9a939a1b`
- `fln-access.js` ← imported by `dashboard/routes/portal-fln-links.routes.js:19:9e499725` · `dashboard/routes/portal-fln-send.routes.js:76:06d869fe` · `dashboard/routes/portal-fln.routes.js:40:03f88d41`
- `health.js` ← imported by `dashboard/index.js:3765:93291bde`
- `leader-role.js` ← imported by `dashboard/routes/hcp.routes.js:39:7f62b386` · `dashboard/routes/portal-child-test.routes.js:52:7f62b386` · `dashboard/routes/portal-coachip.routes.js:20:3b203e06` · `dashboard/routes/portal.routes.js:108:9cce833e` (+2: `python3 kg/kg.py who-reads leader-role.js`)
- `lesson-plan-file.js` ← imported by `dashboard/routes/portal.routes.js:46:9341eb55`
- `local-dev.js` ← imported by `dashboard/config/database.js:15:2f21d74f` · `dashboard/index.js:10:8ee1c78d`
- `media-url.js` ← imported by `dashboard/routes/portal.routes.js:4961:4bdd2404` · `dashboard/routes/video-reco.routes.js:52:d0ee1aba` · `dashboard/services/training-library.service.js:18:e6d2fabe`
- `pk-range.js` ← imported by `dashboard/routes/portal-teacher-coaching.routes.js:26:a69bbe61` · `dashboard/routes/portal-teacher-lessons.routes.js:21:150648cb` · `dashboard/routes/portal.routes.js:61:150648cb` · `dashboard/services/lp-activity.service.js:119:0070d575` (+3: `python3 kg/kg.py who-reads pk-range.js`)
- `portal-host.js` ← imported by `dashboard/index.js:3785:02854100`
- `portal-static-cache.js` ← imported by `dashboard/index.js:3795:595624d3`
- `school-card-period.js` ← imported by `dashboard/routes/coach-school-card.routes.js:20:99711cf0` · `dashboard/services/coach-school-card.service.js:38:fe0880b0`
- `teacher-observation.js` ← imported by `dashboard/routes/portal-teacher-home.routes.js:39:18c3fdef` · `dashboard/routes/portal.routes.js:124:18c3fdef` · `dashboard/services/progress.service.js:41:18c3fdef` · `dashboard/services/teacher-home-order.service.js:53:18c3fdef`
- `user-school-name.js` ← imported by `dashboard/routes/portal.routes.js:122:fd6341ed`
- `visit-time.js` ← imported by `dashboard/routes/coach-school-card.routes.js:21:b13361c4` · `dashboard/services/coach-school-card.service.js:39:b13361c4` · `dashboard/services/coach-v2.service.js:28:b13361c4` · `dashboard/services/leader-assignment.service.js:67:78fa166f` (+2: `python3 kg/kg.py who-reads visit-time.js`)
- `weekday-hours.js` ← imported by `dashboard/services/teacher-notices.service.js:36:2b07e944`
- env `FLAG_CACHE_TTL_MS` read at `dashboard/lib/feature-flags.js:46:15f765ee`
- env `NODE_ENV` read at `dashboard/lib/final-error-handler.js:23:e3ded45c` · `dashboard/lib/health.js:64:f48a92b6`
- env `R2_BUCKET_NAME` read at `dashboard/lib/lesson-plan-file.js:48:e6f424df`
- env `R2_ENDPOINT` read at `dashboard/lib/lesson-plan-file.js:49:699c5628`

## Tests (all, generated)
- `analytics-account-name.js` ← `tests/portal/portal-login-account-name.test.js`
- `analytics-lists.js` ← `tests/portal/analytics-lists-v8.test.js` · `tests/portal/analytics-training-levels-route.test.js` · `tests/portal/analytics-v8-services.test.js`
- `analytics-viewer.js` ← `tests/portal/analytics-schools-route.test.js`
- `assessment-rate-limit.js` ← `tests/dashboard/assessment-rate-limit.test.js`
- `asset-links.js` ← `tests/portal/android-app-links-assetlinks.test.js`
- `closed-inline-switch.js` ← `dashboard/tests/web-quiz-closed-inline.service.test.js`
- `closed-way-back-switch.js` ← `dashboard/tests/closed-way-back-switch.service.test.js`
- `edge-redis.js` ← `dashboard/tests/web-quiz-card-fast.service.test.js`
- `feature-flags.js` ← `dashboard/tests/login-intl-flag.service.test.js` · `tests/app-redirect/app-link-coach.test.js` · `tests/app-redirect/app-link-every-teacher.test.js` · `tests/coachip-rm/rm-sector-scope.test.js` · `tests/coachip/coachip-flags.test.js` · `tests/coachip/helpers/app.js` (+10: `python3 kg/kg.py who-reads dashboard/lib/feature-flags.js`)
- `fetch-all-paged.js` ← `tests/portal/curriculum-grades-pagination.test.js`
- `final-error-handler.js` ← `tests/hcp/hcp-malformed-json.test.js`
- `fln-access.js` ← `tests/portal/fln-access.test.js` · `tests/portal/fln-links-mount.test.js` · `tests/portal/fln-routes.test.js`
- `health.js` ← `dashboard/tests/health-db-writable.service.test.js`
- `leader-role.js` ← `dashboard/tests/leader-role.middleware.test.js` · `tests/portal/analytics-schools-route.test.js` · `tests/portal/portal-name-once.test.js`
- `lesson-plan-file.js` ← `tests/portal/lesson-plan-file-proxy.test.js`
- `local-dev.js` ← `tests/portal/local-dev.test.js` · `tests/portal/session-rolling.test.js`
- `pk-range.js` ← `tests/portal/progress-range.test.js`
- `portal-host.js` ← `dashboard/tests/portal-host.service.test.js`
- `portal-static-cache.js` ← `dashboard/tests/cut-link-off-harness.js` · `dashboard/tests/quiz-go-edge.service.test.js` · `tests/portal/bd-fxk3t8-first-paint.test.js`
- `school-card-period.js` ← `tests/portal/coach-school-card-period.test.js`
- `teacher-observation.js` ← `tests/portal/bd-5rz1v.6.5-my-analytics-sent-observations.test.js`
- `visit-time.js` ← `tests/portal/bd-o15qnr-visit-time.test.js` · `tests/portal/bd-o15qnr.8-coach-feedback.test.js`
- `web-quiz-landing-face.js` ← `dashboard/tests/web-quiz-landing-face.service.test.js`
- `weekday-hours.js` ← `tests/portal/bd-fmf24g.15-weekday-hours.test.js`

## Related (all, generated)
- docs: `dashboard/CLAUDE.md`? · `docs/onboarding/local-portal.md`? · `portal/ANDROID.md`? · `portal/src/portal/newui/DESIGN.md`?
