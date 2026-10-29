# services — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/services -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `api-health/` | One module per vendor for the API-health admin page, aggregated → `api-health/CLAUDE.md` |
| `queue/` | SQS client for portal-only async jobs → `queue/CLAUDE.md` |
| `access-scope.service.js` | Manages partner access scopes (all/country/school/phone_list/combined) used for RLS on the observability dashboard. |
| `ama.service.js` | Open-source AMA (Ask Me Anything) stub using safe parameterized queries instead of the removed exec_sql RPC. |
| `assessment.service.js` | HTTP client to the bot for the Assessment Generator (the portal's only route to making a paper); holds no logic. |
| `attendance-detail.service.js` | Shapes attendance for a principal: grade-group summaries, day-wise splits and per-person day cells (2026-09-17 design). |
| `attendance-repository.service.js` | Teacher-attendance persistence: Supabase repository and an in-memory mock chosen by ATTENDANCE_REPO/NODE_ENV (STEPS-P). |
| `auth.service.js` | Dashboard RBAC auth: bcrypt login, password management, role checks and access-scope fetch for dashboard_users. |
| `billing.service.js` | Checks Anthropic, WhatsApp and OpenAI usage/quota for the observability billing page (P5). |
| `byof-agent.service.js` | BYOF "Forge" Claude chat agent for bug reporting and feature planning using the Anthropic SDK. |
| `byof.service.js` | BYOF data layer: role checks, session CRUD, message storage and plan management for the byof tables. |
| `certificates.service.js` | HTTP client to the bot for a teacher's certificates (list, render, signed download); no logic in the portal. |
| `coach-card-token.js` | Pure HMAC token for the coach-card link /cv/<token> naming one coach_visit_requests row; 30 days, bd-v0toag.38.9. |
| `coach-disagreement-clip.js` | Cuts the disputed step of a teacher's recording to mp3 with ffmpeg for the assigned coach; bd-tbprit.2. |
| `coach-disagreement-evidence.js` | Pure: turns analysis_data and teacher reason codes into the grader's scores, quotes and timestamps; bd-tbprit.1. |
| `coach-disagreement-pattern.js` | Pure counts for "Is this a pattern?": recent scores, average/best, recording rate vs ICT, repeat misses; bd-tbprit.10. |
| `coach-disagreement-plan.js` | Saves and shapes the coach's coaching-suggestion plan on coach_visit_requests.coach_plan; bd-tbprit.11. |
| `coach-disagreements.service.js` | Coach's disagreements list/card: To do and Done requests with tags (recordingLess, waiting, repeat, short); bd-tbprit.1. |
| `coach-note-store.js` | Stores a teacher's short voice note for their coach in R2 until the coach marks the visit done; bd-v0toag.38.9. |
| `coach-ping-page.js` | Pure HTML for the C/D coach ping: reasons page (ticks, voice note, coach pick) and the coach card. |
| `coach-ping-reasons.js` | The four tickable reasons (en/ur) a C/D teacher gives when disagreeing with a report; stored in reasons column. |
| `coach-school-admin.service.js` | Portal half of coach add/remove school and teacher; relays the writes to the bot's /observe admin over the internal API. |
| `coach-school-card.service.js` | Coach School Card read side: school and teacher cards, feature grids, items, reports, counted from existing tables. |
| `coach-teacher-admin.service.js` | Portal guard for the coach app's Edit teacher: checks the teacher is in the coach's patch, then relays to the bot. |
| `coach-v2.service.js` | Coach app v2 read side (portal_coach_v2): visits, HITL vs DC sessions, training progress; stores nothing; bd-o15qnr.3. |
| `coach-visit-request.js` | Writes the C/D coach ping: coachesFor and requestVisit create one coach_visit_requests row per report, then ping. |
| `coaching-analytics.service.js` | Analytics-only Coaching tab at /api/portal/analytics/coaching; set-based reads, reuses schools-analytics; bd-97x22y.1. |
| `coaching-breakdown.service.js` | Client asking the bot how a coaching session was scored, replacing the portal's hardcoded OECD goal assembly. |
| `coaching-frameworks.service.js` | Normalizes overall coaching score across FICO and legacy OECD analysis_data into points/max/percentage; bd-2434. |
| `coaching-observability.service.js` | Admin dashboard coaching session queries with pagination, status and date filters using the RLS dbClient. |
| `coaching-report-page.js` | Pure HTML for the C/D coaching report: card screen and detail screen in the ICT-3 template; bd-v0toag.18/.55. |
| `coaching-report-style.js` | Shell for the coaching report page: HTML escaping, document wrapper and CSS (step colors, bars, dark mode). |
| `coaching-report-view.js` | Shapes a coaching session row, first name and past scores into the card/detail view data; leaves out anything missing. |
| `coaching-useful.js` | Stores the C/D report thumbs-up/down in coaching_quality_metrics (satisfaction rating, feedback); bd-v0toag.49. |
| `coachip-clip.service.js` | COACHIP R2 helper: 300s presign for ffmpeg and Range streaming of objects without leaking keys or URLs; bd-sex15q.16. |
| `coachip-coach-read.service.js` | COACHIP coach read handlers: home (S1), weakness page (S2/S3), schools tab, intervention (S5); bd-sex15q.13. |
| `coachip-codes.service.js` | COACHIP teacher-key HMAC codec from COACHIP_TEACHER_KEY_SECRET shared by nightly job and routes; 503 if unset. |
| `coachip-listen-read.service.js` | COACHIP coach Listen feed, player, Stats and Results read handlers over coachip_* tables; never reads analysis_data. |
| `coachip-moment.js` | The single COACHIP Moment builder (clip, step strip, pair) shared by Home and Listen reads; teachers only as codes. |
| `coachip-rm-read.service.js` | COACHIP RM reads (rm/home, rm/coach/:id, rm/circle): per-coach and per-school aggregates, never a teacher. |
| `coachip-rules.service.js` | COACHIP loop rules: visits from observation_schedules, check-by rule, Step chip, step/note shapes shared by routes. |
| `coachip-scope.service.js` | COACHIP scope: which real schools, HMAC-keyed teachers and coaches a coach or RM may see, computed per request. |
| `coachip-sector-coaches.js` | Labels a sector's coaches (name else C-01, C-02 by first school); separate module to avoid a circular dependency. |
| `coachip-shapes.js` | COACHIP shared wire pieces: input grammar, error bodies, Karachi dates, Window/Count/Text builders, copy, library. |
| `coachip-write.service.js` | COACHIP's seven write handlers (steps, check-by, RM notes, audit), scope-before-content with one 404 body; bd-sex15q.13. |
| `code-chunker.service.js` | Regex-based function/class chunker for code files, feeding the Forge's vector search without heavy AST deps. |
| `code-embedder.service.js` | Generates text-embedding-3-small embeddings for code chunks for the Forge vector search. |
| `email.service.js` | Nodemailer-based invitation and notification email sender (gmail or SMTP) for dashboard users. |
| `fln-corpus.service.js` | Loads and caches the versioned FLN (Reading Hour + Numeracy) corpus bundle from the content mirror. |
| `fln-media-sign.js` | Rewrites FLN plan media URLs to presigned GETs on the portal's private R2 bucket by key, avoiding mirror rate-limits. |
| `github-api.service.js` | Fetches files, directories and trees from GitHub so the BYOF agent reads code without a local filesystem. |
| `gpt-cache.service.js` | Redis cache for GPT-4o-mini responses (SHA256 keys, TTLs, graceful fallback when Redis is down). |
| `grade-subjects.service.js` | Builds the grade-subject pairs picker (classes first, then history) for GET /me/grade-subjects; bd-fmf24g.3. |
| `invitation.service.js` | Partner-admin invitations: create with scope, email a token link, set credentials, create the dashboard account. |
| `leader-assignment.service.js` | Deprecated-dependency service still touching leader_teachers (coach/school/teacher allocation); blocks dropping it. |
| `leader-observations.service.js` | Leader Observations resolver: upcoming, pending debriefs and completed /observe items in one payload; bd-2455. |
| `leader-overview.service.js` | Pure My Patch overview: KPIs and focus list over getPatchTeachers output; averages only scored teachers; bd-2386. |
| `leader-patch.service.js` | Resolves a leader's patch teachers (joined to Rumi users, coaching/LP counts, latest score); bd-2387. |
| `leader-schedule-write.service.js` | Portal write side for observation_schedules: create and cancel a visit (no edit, operator 2026-08-13); bd-2676. |
| `leader-teacher-detail.service.js` | Single-teacher detail for a leader; proves patch membership first and returns null (404) otherwise; bd-2388. |
| `lp-activity.service.js` | Which lesson plans a teacher used and when, unioning three ledgers (opens, WhatsApp downloads, 6-12); bd-5rz1v.15. |
| `lp-catalogue.service.js` | HTTP client to the bot for the lesson-plan catalogue (which plans exist); the portal holds no catalogue logic. |
| `lp-engagement.service.js` | Analytics-only LP Engagement tab: Active vs Non-Active teachers on RDF numbers, GET /analytics/lp-engagement (v8). |
| `lp-history.service.js` | Teacher-app "All lesson plans": history for a date range, four counts and previous-period counts from the use ledgers. |
| `lp-open-survey.client.js` | After a recorded plan open, tells the bot the niete_lp_opens row id so the bot runs the usefulness survey; bd-qvevax.2. |
| `lp-reader.service.js` | Decides who is opening a lesson plan and what that open records; leader opens skip niete_lp_opens; bd-4joiqz. |
| `lp612.service.js` | HTTP client to the bot for grades 6-12 lesson plans; no query rules in the portal. |
| `materialized-views.service.js` | Reads the dashboard materialized views (mv_dashboard_stats, users activity, retention) replacing 17 live queries. |
| `mv-refresh-scheduler.service.js` | Refreshes the dashboard materialized views concurrently every 15 minutes from one cluster-owner worker. |
| `observations-analytics.service.js` | Analytics-only Observations tab (human and digital coach) at GET /analytics/observations; bd-97x22y.5. |
| `observe-notice.service.js` | Asks the bot to notify the teacher of a visit booked, moved or cancelled on the portal; bd-xorfy, bd-o15qnr.17. |
| `observe-teacher-admin.client.js` | HTTP client asking the bot to run /observe teacher admin for the coach app's Edit teacher; never throws; bd-o15qnr.11. |
| `password-reset.service.js` | Portal password reset: 6-digit code via the bot's internal API over WhatsApp, 10-minute expiry, rate limits. |
| `portal-child-test.client.js` | HTTP client relaying the coach-app child test calls to the bot with the session user's id; bd-s1oo0.7. |
| `portal-coaching.client.js` | HTTP client that starts a classroom analysis from an upload and answers its reflective question via the bot; bd-lfzoz. |
| `progress.service.js` | The new Home's "what you did" five counts and lists per date range; activity not ratings; bd-5rz1v.17. |
| `r2.service.js` | R2 storage proxy for the observability portal: authenticated downloads and presigned URLs from the private bucket. |
| `redis-cache.service.js` | Redis cache with circuit breaker (5-minute TTL) around GitHub API calls for the Forge. |
| `report-extras.js` | Reads duplicate-recording flag, report date and "last asked" so the portal report matches the WhatsApp one; bd-z3cadk. |
| `report-narrative-view.js` | Pure mapper exposing only allowed fields of analysis_data.report_narrative to the teacher-app report page; bd-fmf24g.10. |
| `resend-email.service.js` | Resend API email sender for invitations and notifications (requires EMAIL_FROM; no safe default). |
| `retention.service.js` | Cohort retention analytics with RLS and materialized-view fast path, built on calculate_retention. |
| `school-analytics.service.js` | Pure principal school-level coaching analytics: count, average, trend, strongest and weakest domains from session rows. |
| `schools-analytics.service.js` | School-wise analytics across regions for analytics-only accounts: set-based reads and objective counts, no bands. |
| `steps-grid.service.js` | Shared observation scoring (human observations, FICO sections pooled by points) read by Analytics. |
| `steps-presence.service.js` | STEPS "P": aggregates teacher attendance and student attendance sessions for a principal's school. |
| `steps-remarks.service.js` | STEPS "S": aggregates a principal's submitted quarterly supervisor remarks (5 indicators, 1-4); drafts excluded. |
| `subject-vocabulary.service.js` | One subject vocabulary mapping class, lesson-plan and coaching spellings for the teacher app picker; bd-fmf24g.3. |
| `teacher-attendance.service.js` | Teacher-app class attendance via the bot's internal attendance API; portal holds no attendance rule; bd-fmf24g.7. |
| `teacher-coaching.service.js` | Pure Digital Coaching + Observations reads for the teacher app (visits, journey, history); bd-fmf24g.4. |
| `teacher-home-order.service.js` | Per-teacher Home tile order (28-day half-life score) and the one Home card, pure functions plus reads; no writes. |
| `teacher-notices.service.js` | Server record of slow requests (papers, 6-12 plans) as notices with seen/opened state from existing rows; bd-fmf24g.15. |
| `telemetry.service.js` | Portal-side structured telemetry sink (Axiom batching) because the bot's pino logger cannot be required in this service. |
| `thing-to-try.service.js` | Portal copy of the v10 thing-to-try read: latest prioritized_action for groups C/D while ab_v10_enabled; bd-v0toag.8. |
| `training-bands.service.js` | HTTP client to the bot for saving training grade bands and language, writes the portal cannot do (fixes a sandbox 500). |
| `training-levels-analytics.service.js` | Analytics-only Trainings tab at /analytics/training-levels on RDF certificate-card numbers; 719 lines. |
| `training-library.service.js` | Read-only training catalogue (vendors, levels, courses, modules) for coaches; never writes; bd-s42dye.1. |
| `training-rules.service.js` | HTTP client to the bot's rules API for locked/passed/exam-ready decisions; the portal holds no training logic; bd-2480. |
| `transcript-processor.service.js` | GPT-4o-mini pass over classroom transcripts: fixes Urdu spacing, re-infers speakers, groups sections, summarizes. |
| `transcript-ux-helpers.service.js` | Helpers formatting SLO mastery and classroom-climate data with traffic-light indicators for the transcript page. |
| `vector-db.service.js` | In-memory cosine-similarity vector store with JSON-file persistence for the Forge's code search. |
| `video-observability.service.js` | Admin video-gallery queries with pagination, filters and user info using the RLS dbClient. |
| `video-reco-events.js` | Recommended-clip events: user-agent class, hashed device cookie, allow-listed beacon cleaning and writer; bd-gzfdu9. |
| `video-reco-page.js` | Pure HTML player page for a recommended training clip (EN/UR, opens at clip start) for WhatsApp's in-app browser. |
| `video-reco-portal.js` | Adds video_recommendation to GET /coaching-session/:id for the React card only while VIDEO_RECO_ENABLED is on. |
| `whatsapp-broadcast.service.js` | Admin WhatsApp broadcasts: Meta template creation and approval polling, sending and delivery status tracking. |
| `wordcloud.service.js` | Word frequency generation (stop-word filtering) over conversation messages for the observability word cloud. |

## Who reads this (all, generated)
- `access-scope.service.js` ← imported by `dashboard/index.js:75:1e0a6ccd` · `dashboard/services/invitation.service.js:15:cfcf45a5`
- `ama.service.js` ← imported by `dashboard/index.js:72:b5ab1a24` · `dashboard/workers/portal-sqs-worker.js:214:cc7134d2`
- `assessment.service.js` ← imported by `dashboard/routes/portal.routes.js:3098:19fa3ae5` · `dashboard/services/grade-subjects.service.js:142:481bd8c6`
- `attendance-detail.service.js` ← imported by `dashboard/routes/portal.routes.js:147:ab4e8b67`
- `attendance-repository.service.js` ← imported by `bot/workers/attendance-bigquery-export.worker.js:34:34f5025b` · `dashboard/routes/attendance.routes.js:38:d777d415`
- `auth.service.js` ← imported by `dashboard/index.js:29:8ef35abd` · `dashboard/routes/settings.js:8:fffb4120`
- `billing.service.js` ← imported by `dashboard/routes/billing.routes.js:10:ac59fdc1`
- `byof-agent.service.js` ← imported by `dashboard/routes/byof.routes.js:11:16a032fb`
- `byof.service.js` ← imported by `dashboard/routes/byof.routes.js:10:f7ffd89f` · `dashboard/services/byof-agent.service.js:14:236f5ba4`
- `certificates.service.js` ← imported by `dashboard/routes/portal.routes.js:4359:987b6967`
- `coach-card-token.js` ← imported by `dashboard/routes/coach-card.routes.js:19:864c80cf` · `dashboard/services/coach-visit-request.js:21:df247ede`
- `coach-disagreement-clip.js` ← imported by `dashboard/lib/insights/clips.js:12:baa561a2` · `dashboard/routes/coach-disagreements.routes.js:23:59ca3a41` · `dashboard/routes/portal.routes.js:2332:571db6ca` · `dashboard/routes/web-quiz-story-assets.js:82:4aa7fc7d` (+1: `python3 kg/kg.py who-reads coach-disagreement-clip.js`)
- `coach-disagreement-evidence.js` ← imported by `dashboard/services/coach-disagreements.service.js:25:05ec6692` · `dashboard/services/coach-school-card.service.js:31:7d2dd38e`
- `coach-disagreement-pattern.js` ← imported by `dashboard/services/coach-disagreements.service.js:26:d65ddfd0`
- `coach-disagreement-plan.js` ← imported by `dashboard/routes/portal.routes.js:2302:6cffc86f` · `dashboard/services/coach-disagreements.service.js:27:8c18d643`
- `coach-disagreements.service.js` ← imported by `dashboard/routes/portal.routes.js:2298:b1dd5a42`
- `coach-note-store.js` ← imported by `dashboard/routes/portal.routes.js:2299:83ebe4aa` · `dashboard/services/coach-visit-request.js:76:a071f04d`
- `coach-ping-page.js` ← imported by `dashboard/routes/coach-card.routes.js:20:138d1d01` · `dashboard/routes/coaching-report.routes.js:26:a6bbd322` · `dashboard/services/coaching-report-page.js:16:45e0e625`
- `coach-ping-reasons.js` ← imported by `dashboard/routes/coaching-report.routes.js:27:dfa4f06a` · `dashboard/services/coach-disagreement-evidence.js:13:fb11beed` · `dashboard/services/coach-disagreements.service.js:24:fb11beed` · `dashboard/services/coach-ping-page.js:12:f61633ca` (+1: `python3 kg/kg.py who-reads coach-ping-reasons.js`)
- `coach-school-admin.service.js` ← imported by `dashboard/routes/portal.routes.js:160:89029801`
- `coach-school-card.service.js` ← imported by `dashboard/routes/coach-school-card.routes.js:18:3d906b0e`
- `coach-teacher-admin.service.js` ← imported by `dashboard/routes/portal.routes.js:157:9e9a1fb0`
- `coach-v2.service.js` ← imported by `dashboard/routes/portal.routes.js:2275:bf093f00` · `dashboard/services/coach-school-admin.service.js:26:c56d46cd`
- `coach-visit-request.js` ← imported by `dashboard/routes/coach-card.routes.js:46:fc38d1ea` · `dashboard/routes/coaching-report.routes.js:31:d0d60971`
- `coaching-analytics.service.js` ← imported by `dashboard/routes/portal.routes.js:118:c03c726c`
- `coaching-breakdown.service.js` ← imported by `dashboard/routes/portal.routes.js:2673:b9ac8227`
- `coaching-frameworks.service.js` ← imported by `dashboard/routes/portal.routes.js:124:fb9750c6` · `dashboard/services/coach-school-card.service.js:29:844e9b68` · `dashboard/services/coach-v2.service.js:23:844e9b68` · `dashboard/services/leader-observations.service.js:23:844e9b68` (+7: `python3 kg/kg.py who-reads coaching-frameworks.service.js`)
- `coaching-observability.service.js` ← imported by `dashboard/index.js:51:7a03acff`
- `coaching-report-page.js` ← imported by `dashboard/routes/coach-card.routes.js:21:190caeeb` · `dashboard/routes/coaching-report.routes.js:25:a05add50` · `dashboard/routes/video-reco.routes.js:26:190caeeb`
- `coaching-report-style.js` ← imported by `dashboard/services/coach-ping-page.js:11:d00a0515` · `dashboard/services/coaching-report-page.js:12:d00a0515` · `dashboard/services/video-reco-page.js:20:1b931c89`
- `coaching-report-view.js` ← imported by `dashboard/routes/coaching-report.routes.js:28:5f31ca87` · `dashboard/services/coach-disagreements.service.js:179:6ea40ae5` · `dashboard/services/coach-visit-request.js:176:6ea40ae5` · `dashboard/services/coaching-report-page.js:13:aa49823a`
- `coaching-useful.js` ← imported by `dashboard/routes/coaching-report.routes.js:30:3034ffe3`
- `coachip-clip.service.js` ← imported by `dashboard/routes/portal-coachip-media.routes.js:16:8fd477a9`
- `coachip-coach-read.service.js` ← imported by `dashboard/routes/portal-coachip.routes.js:346:8f525311`
- `coachip-codes.service.js` ← imported by `dashboard/routes/portal-coachip.routes.js:379:2cac9e1b`
- `coachip-listen-read.service.js` ← imported by `dashboard/routes/portal-coachip.routes.js:347:bbffd9cb` · `dashboard/services/coachip-rm-read.service.js:18:4fe6cb0c`
- `coachip-moment.js` ← imported by `dashboard/services/coachip-coach-read.service.js:24:ab395bfb` · `dashboard/services/coachip-listen-read.service.js:16:fde929c2`
- `coachip-rm-read.service.js` ← imported by `dashboard/routes/portal-coachip.routes.js:348:c13b1a45`
- `coachip-rules.service.js` ← imported by `dashboard/services/coachip-coach-read.service.js:23:08d9baee` · `dashboard/services/coachip-rm-read.service.js:17:28b61926` · `dashboard/services/coachip-write.service.js:19:08d9baee`
- `coachip-scope.service.js` ← imported by `dashboard/routes/portal-coachip.routes.js:378:130c18e3`
- `coachip-sector-coaches.js` ← imported by `dashboard/services/coachip-listen-read.service.js:17:4f5f3c96` · `dashboard/services/coachip-rm-read.service.js:19:4f5f3c96`
- `coachip-shapes.js` ← imported by `dashboard/routes/portal-coachip-media.routes.js:15:95a3542a` · `dashboard/routes/portal-coachip.routes.js:21:95a3542a` · `dashboard/services/coachip-coach-read.service.js:22:1ad0754a` · `dashboard/services/coachip-listen-read.service.js:15:1ad0754a` (+5: `python3 kg/kg.py who-reads coachip-shapes.js`)
- `coachip-write.service.js` ← imported by `dashboard/routes/portal-coachip.routes.js:349:9c2c7195`
- `fln-corpus.service.js` ← imported by `dashboard/routes/portal-fln-links.routes.js:170:9708fa87` · `dashboard/routes/portal-fln-send.routes.js:64:bef7b8ef` · `dashboard/routes/portal-fln.routes.js:41:383b9f08`
- `fln-media-sign.js` ← imported by `dashboard/routes/portal-fln.routes.js:44:2a70e8f0`
- `github-api.service.js` ← imported by `dashboard/services/byof-agent.service.js:16:30db2334` · `dashboard/services/redis-cache.service.js:9:30db2334`
- `gpt-cache.service.js` ← imported by `dashboard/index.js:57:e2d25ad0` · `dashboard/services/transcript-processor.service.js:13:1cac73a0`
- `grade-subjects.service.js` ← imported by `dashboard/routes/portal-teacher-attendance.routes.js:28:6497bf32` · `dashboard/routes/portal-teacher-lessons.routes.js:18:6497bf32`
- `invitation.service.js` ← imported by `dashboard/index.js:81:8f00ab4b`
- `leader-assignment.service.js` ← imported by `dashboard/routes/portal.routes.js:164:07ab842f`
- `leader-observations.service.js` ← imported by `dashboard/routes/portal.routes.js:152:d05b6158`
- `leader-overview.service.js` ← imported by `dashboard/routes/portal.routes.js:137:218b7dd3`
- `leader-patch.service.js` ← imported by `dashboard/routes/hcp.routes.js:40:894affdf` · `dashboard/routes/portal-fln-send.routes.js:27:894affdf` · `dashboard/routes/portal.routes.js:135:2920771b` · `dashboard/services/coach-teacher-admin.service.js:19:0dff6350` (+3: `python3 kg/kg.py who-reads leader-patch.service.js`)
- `leader-schedule-write.service.js` ← imported by `dashboard/routes/portal.routes.js:154:3962c0c3`
- `leader-teacher-detail.service.js` ← imported by `dashboard/routes/portal.routes.js:149:dfb3f948`
- `lp-activity.service.js` ← imported by `dashboard/routes/portal-fln.routes.js:42:6f3a367c` · `dashboard/routes/portal.routes.js:49:6f3a367c` · `dashboard/services/coach-v2.service.js:25:a12faede` · `dashboard/services/grade-subjects.service.js:140:6583d3cd` (+3: `python3 kg/kg.py who-reads lp-activity.service.js`)
- `lp-catalogue.service.js` ← imported by `dashboard/routes/portal-teacher-lessons.routes.js:20:5d8c401d` · `dashboard/routes/portal.routes.js:2671:5d8c401d` · `dashboard/services/grade-subjects.service.js:141:01b06451`
- `lp-engagement.service.js` ← imported by `dashboard/routes/portal.routes.js:9002:4c3828de`
- `lp-history.service.js` ← imported by `dashboard/routes/portal-teacher-lessons.routes.js:19:5d80e1fc` · `dashboard/services/teacher-coaching.service.js:16:6a9de3e6`
- `lp-open-survey.client.js` ← imported by `dashboard/services/lp-reader.service.js:44:a9b12197`
- `lp-reader.service.js` ← imported by `dashboard/routes/portal-fln.routes.js:43:81842d36` · `dashboard/routes/portal.routes.js:58:81842d36`
- `lp612.service.js` ← imported by `dashboard/routes/portal.routes.js:2857:a4b08fd4` · `dashboard/services/grade-subjects.service.js:182:769b13e4`
- `materialized-views.service.js` ← imported by `dashboard/database/queries.js:13:3d4e1345` · `dashboard/index.js:78:3d7a2e1b` · `dashboard/services/mv-refresh-scheduler.service.js:34:6b533c81` · `dashboard/services/retention.service.js:13:6b533c81`
- `mv-refresh-scheduler.service.js` ← imported by `dashboard/index.js:3862:701d14a4`
- `observations-analytics.service.js` ← imported by `dashboard/routes/portal.routes.js:119:33ff4964`
- `observe-notice.service.js` ← imported by `dashboard/routes/portal.routes.js:155:f8e36ec7`
- `observe-teacher-admin.client.js` ← imported by `dashboard/routes/portal.routes.js:158:b350ff3a`
- `password-reset.service.js` ← imported by `dashboard/routes/portal.routes.js:809:428c28e7`
- `portal-child-test.client.js` ← imported by `dashboard/routes/portal-child-test.routes.js:56:ec0733e4`
- `portal-coaching.client.js` ← imported by `dashboard/routes/portal.routes.js:7576:e3869eed`
- `progress.service.js` ← imported by `dashboard/routes/portal.routes.js:59:f5b0c126`
- `r2.service.js` ← imported by `dashboard/index.js:88:9abc3fe3` · `dashboard/lib/media-url.js:7:a206d415` · `dashboard/routes/portal.routes.js:42:193f114b` · `dashboard/routes/web-quiz-story-assets.js:112:bacee796` (+1: `python3 kg/kg.py who-reads r2.service.js`)
- `redis-cache.service.js` ← imported by `dashboard/services/byof-agent.service.js:15:1bd19dde`
- `report-extras.js` ← imported by `dashboard/routes/portal.routes.js:126:002da4b2`
- `report-narrative-view.js` ← imported by `dashboard/routes/portal.routes.js:125:7bafb190`
- `resend-email.service.js` ← imported by `dashboard/index.js:84:812c3951` · `dashboard/routes/settings.js:9:72f2cdfb`
- `retention.service.js` ← imported by `dashboard/index.js:69:18ebac15`
- `school-analytics.service.js` ← imported by `dashboard/routes/portal.routes.js:140:30146389`
- `schools-analytics.service.js` ← imported by `dashboard/routes/portal.routes.js:117:58eeeb5b` · `dashboard/services/coach-school-card.service.js:30:5209c65f` · `dashboard/services/coaching-analytics.service.js:59:071acc09` · `dashboard/services/lp-engagement.service.js:51:18636010` (+2: `python3 kg/kg.py who-reads schools-analytics.service.js`)
- `steps-grid.service.js` ← imported by `dashboard/services/observations-analytics.service.js:59:78aad438` · `dashboard/services/school-analytics.service.js:36:286b03de` · `dashboard/services/schools-analytics.service.js:85:794dfc45`
- `steps-presence.service.js` ← imported by `dashboard/routes/portal.routes.js:144:69e763b3`
- `steps-remarks.service.js` ← imported by `dashboard/routes/portal.routes.js:145:f87f3484`
- `subject-vocabulary.service.js` ← imported by `dashboard/services/grade-subjects.service.js:32:efaeaac2` · `dashboard/services/lp-engagement.service.js:52:4feb8c0d` · `dashboard/services/lp-history.service.js:33:f04fed96` · `dashboard/services/teacher-attendance.service.js:53:4feb8c0d`
- `teacher-attendance.service.js` ← imported by `dashboard/routes/portal-teacher-attendance.routes.js:27:3486f1f0`
- `teacher-coaching.service.js` ← imported by `dashboard/routes/portal-teacher-coaching.routes.js:25:5a18e3f1`
- `teacher-home-order.service.js` ← imported by `dashboard/routes/portal-teacher-home.routes.js:40:f1a55e85`
- `teacher-notices.service.js` ← imported by `dashboard/routes/portal-teacher-notices.routes.js:21:57135aa9` · `dashboard/services/lp-reader.service.js:45:81c38d8b`
- `telemetry.service.js` ← imported by `dashboard/middleware/latency-logger.js:28:2aa9b460` · `dashboard/routes/app-funnel.routes.js:30:2aa9b460` · `dashboard/routes/app-login.routes.js:21:2aa9b460` · `dashboard/routes/coach-card.routes.js:22:2aa9b460` (+11: `python3 kg/kg.py who-reads telemetry.service.js`)
- `thing-to-try.service.js` ← imported by `dashboard/routes/portal-teacher-thing-to-try.routes.js:18:2942d56d`
- `training-bands.service.js` ← imported by `dashboard/routes/portal.routes.js:40:eb91bd32`
- `training-levels-analytics.service.js` ← imported by `dashboard/routes/portal.routes.js:1873:79fabdbd`
- `training-library.service.js` ← imported by `dashboard/routes/training-library.routes.js:18:94154b77`
- `training-rules.service.js` ← imported by `dashboard/routes/portal.routes.js:63:5f36753b`
- `transcript-processor.service.js` ← imported by `dashboard/index.js:91:fce50392` · `dashboard/workers/portal-sqs-worker.js:55:ff7cdd25` · `dashboard/scripts/backfill-processed-transcripts.js:17:4befdff3`
- `transcript-ux-helpers.service.js` ← imported by `dashboard/index.js:54:e8dd245d`
- `video-observability.service.js` ← imported by `dashboard/index.js:60:eafba43c`
- `video-reco-events.js` ← imported by `dashboard/routes/coaching-report.routes.js:32:9f83ee11` · `dashboard/routes/video-reco.routes.js:27:f4421b6d`
- `video-reco-page.js` ← imported by `dashboard/routes/video-reco.routes.js:24:74889a78`
- `video-reco-portal.js` ← imported by `dashboard/routes/portal.routes.js:127:15432886`
- `whatsapp-broadcast.service.js` ← imported by `dashboard/index.js:3079:c1295629`
- `wordcloud.service.js` ← imported by `dashboard/routes/wordcloud.js:7:84d60556`
- column `coach_visit_requests.status` (written by `coach-visit-request.js`) ← read by `dashboard/services/coach-disagreements.service.js:138:175a43cc`
- column `coach_visit_requests.updated_at` (written by `coach-visit-request.js`) ← read by `dashboard/services/coach-disagreements.service.js:258:a1c017d3`
- column `coach_visit_requests.voice_note_key` (written by `coach-disagreements.service.js`, `coach-visit-request.js`) ← read by `bot/shared/services/coach-voice-note-retention.service.js:32:b852af2a` · `dashboard/services/coach-disagreements.service.js:256:f9788955` · `dashboard/services/coach-visit-request.js:192:687f8c28`
- column `coaching_quality_metrics.coaching_session_id` (written by `coaching-useful.js`) ← read by `bot/shared/services/coaching/coaching-feedback.service.js:100:cfde5128` · `bot/shared/services/coaching/coaching-helpers.service.js:117:3fc9162f` · `bot/shared/services/coaching/weekly-report/reader.js:104:0ea80de6`
- column `dashboard_users.email` (written by `auth.service.js`) ← read by `dashboard/index.js:560:f2112f9b` · `dashboard/services/byof.service.js:359:3df8e978`
- column `dashboard_users.is_active` (written by `auth.service.js`) ← read by `dashboard/services/byof.service.js:359:3df8e978`
- column `dashboard_users.role` (written by `auth.service.js`) ← read by `dashboard/services/byof.service.js:359:3df8e978`
- column `dashboard_users.username` (written by `auth.service.js`) ← read by `dashboard/index.js:560:f2112f9b` · `dashboard/services/byof.service.js:359:3df8e978`
- column `teacher_attendance_records.date` (written by `attendance-repository.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:899:74eda9b1` · `bot/shared/services/attendance-register-delivery.service.js:67:5c2c47be` · `bot/shared/services/attendance-write.service.js:226:755594b8` · `bot/workers/attendance-bigquery-export.worker.js:143:052eb616`
- column `teacher_attendance_records.leave_type` (written by `attendance-repository.service.js`) ← read by `bot/workers/attendance-bigquery-export.worker.js:143:052eb616`
- column `teacher_attendance_records.school_id` (written by `attendance-repository.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:900:917b902f` · `bot/shared/services/attendance-register-delivery.service.js:68:1973a585` · `bot/shared/services/attendance-write.service.js:225:fa423b71` · `bot/workers/attendance-bigquery-export.worker.js:143:052eb616`
- column `teacher_attendance_records.status` (written by `attendance-repository.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:899:74eda9b1` · `bot/shared/services/attendance-register-delivery.service.js:67:5c2c47be` · `bot/workers/attendance-bigquery-export.worker.js:143:052eb616`
- column `teacher_attendance_records.teacher_id` (written by `attendance-repository.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:899:74eda9b1` · `bot/shared/services/attendance-register-delivery.service.js:67:5c2c47be` · `bot/shared/services/attendance-write.service.js:224:ce75da8c` · `bot/workers/attendance-bigquery-export.worker.js:143:052eb616`
- table `dashboard_users` whole row (`*`) (written by `byof.service.js`) ← read by `dashboard/services/auth.service.js:19:d2b02c3e`?
- table `users` whole row (`*`) (written by `password-reset.service.js`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687`? · `bot/shared/database/queries.js:14:77bc023b`? · `dashboard/database/queries.js:687:7a0c163a`? · `dashboard/routes/portal.routes.js:313:d2b02c3e`? (+1: `python3 kg/kg.py who-reads users`)
- table `access_scopes` (written by `access-scope.service.js`) ← read by `dashboard/services/auth.service.js:43:2be8f4d7`?
- table `coach_visit_requests` (written by `coach-disagreement-plan.js`, `coach-disagreements.service.js`, `coach-visit-request.js`) ← read by `bot/shared/services/coach-voice-note-retention.service.js:31:447a8a54`? · `dashboard/routes/coach-card.routes.js:33:d4b16243`? · `dashboard/routes/portal.routes.js:2324:1fdcb761`? · `dashboard/services/coach-disagreement-plan.js:29:9ee72eab`? (+2: `python3 kg/kg.py who-reads coach_visit_requests`)
- table `coaching_quality_metrics` (written by `coaching-useful.js`) ← read by `bot/shared/services/coaching/coaching-feedback.service.js:99:df6ad5d9`? · `bot/shared/services/coaching/coaching-helpers.service.js:115:d42443b2`? · `bot/shared/services/coaching/weekly-report/reader.js:103:527a292b`?
- table `dashboard_users` (written by `auth.service.js`, `byof.service.js`, `invitation.service.js`) ← read by `dashboard/index.js:559:36baffc0`? · `dashboard/middleware/auth.js:76:9a69d293`? · `dashboard/middleware/rbac/feature-access.js:53:9a69d293`? · `dashboard/middleware/rbac/rbac.js:49:9a69d293`? (+5: `python3 kg/kg.py who-reads dashboard_users`)
- table `invitations` (written by `invitation.service.js`) ← read by `dashboard/index.js:2050:535a79c0`?
- table `teacher_attendance_records` (written by `attendance-repository.service.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:898:cac7d040`? · `bot/shared/services/attendance-register-delivery.service.js:66:cac7d040`? · `bot/shared/services/attendance-write.service.js:223:cac7d040`? · `bot/workers/attendance-bigquery-export.worker.js:141:cac7d040`? (+1: `python3 kg/kg.py who-reads teacher_attendance_records`)
- table `users` (written by `password-reset.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? · `bot/shared/calls/call-tools.repo.js:242:774e00e5`? · `bot/shared/database/bot-helpers.js:17:61dfd735`? (+168: `python3 kg/kg.py who-reads users`)
- env `ANTHROPIC_API_KEY` read at `dashboard/services/billing.service.js:11:6137f7d4` · `dashboard/services/byof-agent.service.js:22:4eda5959`
- env `ATTENDANCE_REPO` read at `dashboard/services/attendance-repository.service.js:359:b04b8587`
- env `AXIOM_DATASET` read at `dashboard/services/telemetry.service.js:43:2d836a2a`
- env `AXIOM_TOKEN` read at `dashboard/services/telemetry.service.js:44:b100a856`
- env `BOT_DOMAIN` read at `dashboard/services/whatsapp-broadcast.service.js:22:ba0a0ce3`
- env `CONTENT_R2_PUBLIC_URL` read at `dashboard/services/fln-corpus.service.js:96:c09cb515`
- env `DASHBOARD_URL` read at `dashboard/services/email.service.js:33:05b8d0f2` · `dashboard/services/resend-email.service.js:15:05b8d0f2`
- env `DATABASE_URL` read at `dashboard/services/mv-refresh-scheduler.service.js:72:8feb0fbd`
- env `EMAIL_APP_PASSWORD` read at `dashboard/services/email.service.js:16:ff0d8d9b`
- env `EMAIL_FROM` read at `dashboard/services/email.service.js:32:67187f3b` · `dashboard/services/resend-email.service.js:14:21cde03c`
- env `EMAIL_HOST` read at `dashboard/services/email.service.js:22:9ca3fcca`
- env `EMAIL_PASSWORD` read at `dashboard/services/email.service.js:27:1627ea9f`
- env `EMAIL_PORT` read at `dashboard/services/email.service.js:23:7809b906`
- env `EMAIL_SECURE` read at `dashboard/services/email.service.js:24:9e262301`
- env `EMAIL_SERVICE` read at `dashboard/services/email.service.js:11:4a8aa458`
- env `EMAIL_USER` read at `dashboard/services/email.service.js:15:1289f07d`
- env `FLN_CORPUS_BASE` read at `dashboard/services/fln-corpus.service.js:94:8ee6f939`
- env `FLN_CORPUS_FILE` read at `dashboard/services/fln-corpus.service.js:122:23cfd1e9`
- env `FLN_CORPUS_VERSION` read at `dashboard/services/fln-corpus.service.js:84:49d5e58f`
- env `GITHUB_BRANCH_BOT` read at `dashboard/services/github-api.service.js:16:7bfcc624`
- env `GITHUB_ORG` read at `dashboard/services/github-api.service.js:11:7f60d0a9`
- env `GITHUB_REPO_BOT` read at `dashboard/services/github-api.service.js:15:3976b97a`
- env `GITHUB_REPO_DASHBOARD` read at `dashboard/services/github-api.service.js:20:e246ea42`
- env `GITHUB_REPO_PORTAL` read at `dashboard/services/github-api.service.js:25:ace10233`
- env `GITHUB_REPO_WEBSITE` read at `dashboard/services/github-api.service.js:30:9aeeb11a`
- env `GITHUB_TOKEN` read at `dashboard/services/github-api.service.js:44:0d0c9448`
- env `GPT_CACHE_TTL` read at `dashboard/services/gpt-cache.service.js:20:890b343c`
- env `GRAPH_API_VERSION` read at `dashboard/services/byof.service.js:13:ddcada1f`
- env `INTERNAL_API_KEY` read at `dashboard/services/assessment.service.js:61:9cd0cfe5` · `dashboard/services/certificates.service.js:44:9cd0cfe5` · `dashboard/services/coach-card-token.js:25:237d5f3b` · `dashboard/services/coaching-breakdown.service.js:39:9cd0cfe5` · `dashboard/services/grade-subjects.service.js:109:9cd0cfe5` · `dashboard/services/lp-catalogue.service.js:56:9cd0cfe5` · `dashboard/services/lp-open-survey.client.js:29:66795115` · `dashboard/services/lp612.service.js:47:9cd0cfe5` · `dashboard/services/observe-notice.service.js:22:66795115` · `dashboard/services/observe-teacher-admin.client.js:16:66795115` · `dashboard/services/password-reset.service.js:55:af81d754` · `dashboard/services/portal-child-test.client.js:23:66795115` · `dashboard/services/portal-coaching.client.js:43:9cd0cfe5` · `dashboard/services/teacher-attendance.service.js:17:9cd0cfe5` · `dashboard/services/training-bands.service.js:54:9cd0cfe5` · `dashboard/services/training-rules.service.js:59:9cd0cfe5`
- env `MAIN_BOT_URL` read at `dashboard/services/assessment.service.js:60:4ac5cb2f` · `dashboard/services/certificates.service.js:43:4ac5cb2f` · `dashboard/services/coaching-breakdown.service.js:38:4ac5cb2f` · `dashboard/services/grade-subjects.service.js:108:4ac5cb2f` · `dashboard/services/lp-catalogue.service.js:55:4ac5cb2f` · `dashboard/services/lp-open-survey.client.js:28:0b216bc4` · `dashboard/services/lp612.service.js:46:4ac5cb2f` · `dashboard/services/observe-notice.service.js:21:0b216bc4` · `dashboard/services/observe-teacher-admin.client.js:15:0b216bc4` · `dashboard/services/password-reset.service.js:54:0a9107fd` · `dashboard/services/portal-child-test.client.js:22:0b216bc4` · `dashboard/services/portal-coaching.client.js:42:4ac5cb2f` · `dashboard/services/teacher-attendance.service.js:16:4ac5cb2f` · `dashboard/services/training-bands.service.js:53:4ac5cb2f` · `dashboard/services/training-rules.service.js:58:4ac5cb2f`
- env `MV_REFRESH_INTERVAL_MS` read at `dashboard/services/mv-refresh-scheduler.service.js:73:d70ed64a`
- env `MV_SCHEDULER_ENABLED` read at `dashboard/services/mv-refresh-scheduler.service.js:62:da51b92d`
- env `MV_SCHEDULER_OWNER` read at `dashboard/services/mv-refresh-scheduler.service.js:67:cb289467`
- env `NODE_ENV` read at `dashboard/services/attendance-repository.service.js:359:b04b8587` · `dashboard/services/telemetry.service.js:48:5993ad62`
- env `NOTIFICATION_ACCESS_TOKEN` read at `dashboard/services/byof.service.js:797:aec3ddc9`
- env `NOTIFICATION_PHONE_ID` read at `dashboard/services/byof.service.js:796:64fe0bd3`
- env `OPENAI_API_KEY` read at `dashboard/services/billing.service.js:12:d7d391c6` · `dashboard/services/code-embedder.service.js:18:f1ad06eb` · `dashboard/services/transcript-processor.service.js:24:206dad27`
- env `PHONE_NUMBER_ID` read at `dashboard/services/coach-visit-request.js:29:b5ad8009` · `dashboard/services/whatsapp-broadcast.service.js:17:c79e4792`
- env `PORTAL_URL` read at `dashboard/services/coach-card-token.js:60:5940e29a` · `dashboard/services/email.service.js:44:e53f27de`
- env `R2_ACCESS_KEY_ID` read at `dashboard/services/coach-note-store.js:16:5bb05b44` · `dashboard/services/r2.service.js:22:d6f2a7a2`
- env `R2_BUCKET_NAME` read at `dashboard/services/coach-note-store.js:24:c1f513b9` · `dashboard/services/r2.service.js:29:90ddb4d1`
- env `R2_ENDPOINT` read at `dashboard/services/coach-note-store.js:15:2684789e` · `dashboard/services/r2.service.js:20:2684789e`
- env `R2_SECRET_ACCESS_KEY` read at `dashboard/services/coach-note-store.js:16:5bb05b44` · `dashboard/services/r2.service.js:23:5687c9ca`
- env `RAILWAY_SERVICE_NAME` read at `dashboard/services/telemetry.service.js:46:be32cd76`
- env `REDIS_URL` read at `dashboard/services/redis-cache.service.js:30:3c9a24c4`
- env `REGION` read at `dashboard/services/telemetry.service.js:47:59e1f37d`
- env `RESEND_API_KEY` read at `dashboard/services/resend-email.service.js:10:89f961cc`
- env `SERVICE_NAME` read at `dashboard/services/telemetry.service.js:46:be32cd76`
- env `STAGING_PHONE_NUMBER` read at `dashboard/services/byof.service.js:875:a32884fc`
- env `SUPABASE_URL` read at `dashboard/services/coach-card-token.js:27:c0cf07e5`
- env `VECTOR_STORE_PATH` read at `dashboard/services/vector-db.service.js:20:dfd40a6d`
- env `WABA_ID` read at `dashboard/services/billing.service.js:14:59f3a518` · `dashboard/services/whatsapp-broadcast.service.js:18:601afc5a`
- env `WHATSAPP_TOKEN` read at `dashboard/services/billing.service.js:13:60bafac2` · `dashboard/services/coach-visit-request.js:28:250e68a3` · `dashboard/services/whatsapp-broadcast.service.js:16:60bafac2`
- env `WHATSAPP_WABA_ID` read at `dashboard/services/billing.service.js:14:59f3a518`

## Tests (all, generated)
- `ama.service.js` ← `dashboard/tests/ama-service.test.js`
- `assessment.service.js` ← `tests/portal/assessment-edit-via-internal-api.test.js`
- `attendance-detail.service.js` ← `dashboard/tests/attendance-detail.service.test.js`
- `attendance-repository.service.js` ← `tests/attendance/attendance-repository.test.js`
- `billing.service.js` ← `dashboard/tests/billing-service.test.js`
- `byof-agent.service.js` ← `dashboard/tests/byof-agent.test.js`
- `byof.service.js` ← `dashboard/tests/byof-service.test.js`
- `certificates.service.js` ← `tests/portal/certificates-client.test.js`
- `coach-card-token.js` ← `tests/coaching/bd-v0toag.38.9-agree-ping-service.test.js` · `tests/portal/bd-tbprit.4-cv-opens-portal-card.test.js` · `tests/portal/bd-v0toag.38.9-coach-card.test.js`
- `coach-disagreement-clip.js` ← `dashboard/tests/web-quiz-story-assets.service.test.js` · `tests/coaching/bd-tbprit.2-coach-disagreement-clip.test.js` · `tests/coaching/bd-tbprit.9-coach-clip-window.test.js`
- `coach-disagreement-evidence.js` ← `tests/coaching/bd-tbprit.1-coach-disagreement-evidence.test.js`
- `coach-disagreement-pattern.js` ← `tests/coaching/bd-tbprit.10-coach-pattern.test.js`
- `coach-disagreement-plan.js` ← `tests/coaching/bd-tbprit.11-coach-plan.test.js`
- `coach-disagreements.service.js` ← `tests/coaching/bd-tbprit.1-coach-disagreements-service.test.js` · `tests/coaching/bd-tbprit.10-coach-pattern-card.test.js` · `tests/coaching/bd-tbprit.11-coach-plan-card.test.js` · `tests/coaching/bd-tbprit.12-coach-done-undo.test.js` · `tests/coaching/bd-tbprit.16-coach-next-visit.test.js` · `tests/coaching/bd-tbprit.7-coach-list-prototype.test.js` (+1: `python3 kg/kg.py who-reads dashboard/services/coach-disagreements.service.js`)
- `coach-note-store.js` ← `tests/coaching/bd-v0toag.38.9-coach-note-store.test.js`
- `coach-ping-page.js` ← `tests/coaching/bd-v0toag.79-neutral-question.test.js`
- `coach-ping-reasons.js` ← `tests/coaching/bd-v0toag.38.9-agree-ping-service.test.js`
- `coach-school-admin.service.js` ← `tests/portal/coach-school-admin.test.js`
- `coach-school-card.service.js` ← `tests/portal/coach-school-card-service.test.js`
- `coach-teacher-admin.service.js` ← `tests/portal/bd-o15qnr.11-edit-teacher.test.js` · `tests/portal/bd-o15qnr.13-edit-fields.test.js`
- `coach-v2.service.js` ← `tests/portal/bd-15y1pc-one-step-model.test.js` · `tests/portal/bd-o15qnr-coach-v2-service.test.js` · `tests/portal/bd-o15qnr.10-history-reports.test.js` · `tests/portal/bd-o15qnr.13-edit-fields.test.js` · `tests/portal/bd-o15qnr.19-observation-page.test.js` · `tests/portal/bd-o15qnr.20-lp-engagement.test.js` (+4: `python3 kg/kg.py who-reads dashboard/services/coach-v2.service.js`)
- `coach-visit-request.js` ← `tests/coaching/bd-v0toag.38.9-agree-ping-service.test.js` · `tests/coaching/bd-v0toag.45-coach-visit-service.test.js`
- `coaching-analytics.service.js` ← `tests/portal/analytics-lists-v8.test.js` · `tests/portal/analytics-v8-services.test.js` · `tests/portal/coaching-analytics.service.test.js`
- `coaching-breakdown.service.js` ← `tests/portal/bd-5rz1v-coaching-portal-routes.test.js`
- `coaching-frameworks.service.js` ← `tests/portal/coaching-overall-denominator.test.js`
- `coaching-report-page.js` ← `tests/coaching/bd-v0toag.79-neutral-question.test.js` · `tests/coaching/report-page-view.test.js` · `tests/coaching/video-reco/r7r-cr-card.test.js` · `tests/portal/coaching-report-page.video.test.js`
- `coaching-report-style.js` ← `tests/coaching/report-page-style.test.js`
- `coaching-report-view.js` ← `tests/coaching/bd-v0toag.79-neutral-question.test.js` · `tests/coaching/report-page-view.test.js` · `tests/coaching/report-view-model.test.js` · `tests/coaching/video-reco/r7r-cr-card.test.js` · `tests/portal/coaching-report-page.video.test.js`
- `coaching-useful.js` ← `tests/coaching/bd-v0toag.80-metrics-write.test.js` · `tests/portal/bd-v0toag.49-report-page-useful.test.js`
- `coachip-clip.service.js` ← `tests/coachip-media/coachip-clip.service.test.js` · `tests/coachip-media/coachip-media.routes.test.js`
- `coachip-coach-read.service.js` ← `tests/coachip/coachip-library-words.test.js`
- `coachip-codes.service.js` ← `dashboard/tests/insights/source.service.test.js` · `tests/coachip-media/coachip-media.routes.test.js` · `tests/coachip-rm/rm-sector-scope.test.js` · `tests/coachip/coachip-coach-read.test.js` · `tests/coachip/coachip-codes.service.test.js` · `tests/coachip/coachip-listen-read.test.js` (+4: `python3 kg/kg.py who-reads dashboard/services/coachip-codes.service.js`)
- `coachip-scope.service.js` ← `tests/coachip-media/coachip-media.routes.test.js` · `tests/coachip/coachip-coach-read.test.js` · `tests/coachip/coachip-scope.service.test.js` · `tests/coachip/helpers/app.js`
- `coachip-shapes.js` ← `tests/coachip-rm/rm-sector-scope.test.js` · `tests/coachip/coachip-coach-read.test.js` · `tests/coachip/coachip-library-words.test.js` · `tests/coachip/coachip-listen-read.test.js` · `tests/coachip/coachip-rm-read.test.js` · `tests/coachip/coachip-write.test.js`
- `code-chunker.service.js` ← `dashboard/tests/code-chunker.test.js`
- `code-embedder.service.js` ← `dashboard/tests/embedder.test.js`
- `fln-corpus.service.js` ← `tests/portal/fln-ab-isolation.test.js` · `tests/portal/fln-corpus.test.js` · `tests/portal/fln-links-routes.real-corpus.test.js` · `tests/portal/fln-media-presign.test.js` · `tests/portal/fln-routes.test.js` · `tests/portal/fln-send-routes.test.js` (+1: `python3 kg/kg.py who-reads dashboard/services/fln-corpus.service.js`)
- `fln-media-sign.js` ← `tests/portal/fln-media-presign.test.js`
- `github-api.service.js` ← `dashboard/tests/github-api.test.js` · `dashboard/tests/redis-cache.test.js`
- `gpt-cache.service.js` ← `dashboard/tests/gpt-cache.test.js`
- `grade-subjects.service.js` ← `tests/portal/bd-fmf24g.3-grade-subjects.test.js`
- `leader-assignment.service.js` ← `dashboard/tests/leader-assignment.service.test.js` · `tests/observe/bd-44003-roster-scope.test.js` · `tests/portal/bd-o15qnr-visit-time.test.js` · `tests/portal/bd-o15qnr.8-coach-feedback.test.js` · `tests/portal/bd-xorfy-portal-visit-notice.test.js`
- `leader-observations.service.js` ← `dashboard/tests/leader-observations-identity.service.test.js` · `dashboard/tests/leader-observations.service.test.js`
- `leader-overview.service.js` ← `dashboard/tests/leader-overview.service.test.js` · `tests/portal/leader-overview-feature-totals.test.js`
- `leader-patch.service.js` ← `dashboard/tests/leader-patch-observations.service.test.js` · `dashboard/tests/leader-patch-principal.service.test.js` · `dashboard/tests/leader-patch.service.test.js` · `dashboard/tests/leader-teacher-detail-terminal.service.test.js` · `tests/hcp/hcp-access-guard.test.js` · `tests/observe2/work-on-coaching-areas.test.js` (+12: `python3 kg/kg.py who-reads dashboard/services/leader-patch.service.js`)
- `leader-schedule-write.service.js` ← `dashboard/tests/leader-schedule-write.service.test.js` · `tests/portal/bd-o15qnr-visit-time.test.js` · `tests/portal/bd-o15qnr.8-coach-feedback.test.js` · `tests/portal/bd-xorfy-portal-visit-notice.test.js`
- `leader-teacher-detail.service.js` ← `dashboard/tests/leader-teacher-detail-principal.service.test.js` · `dashboard/tests/leader-teacher-detail-terminal.service.test.js` · `dashboard/tests/leader-teacher-detail.service.test.js` · `tests/portal/leader-teacher-detail-summary.test.js`
- `lp-activity.service.js` ← `tests/portal/bd-o15qnr.20-lp-engagement.test.js` · `tests/portal/fln-readers.test.js` · `tests/portal/fln-routes.test.js` · `tests/portal/progress-counts.db.test.js`
- `lp-catalogue.service.js` ← `tests/portal/lp-leader-bot-calls.test.js`
- `lp-engagement.service.js` ← `tests/portal/lp-engagement.service.test.js`
- `lp-history.service.js` ← `tests/portal/bd-fmf24g.3-lp-history.test.js` · `tests/portal/fln-readers.test.js`
- `lp612.service.js` ← `tests/portal/lp-leader-bot-calls.test.js`
- `materialized-views.service.js` ← `dashboard/tests/materialized-views-partner.service.test.js` · `dashboard/tests/materialized-views.test.js`
- `observations-analytics.service.js` ← `tests/portal/analytics-lists-v8.test.js` · `tests/portal/analytics-v8-services.test.js` · `tests/portal/observations-analytics.service.test.js`
- `observe-notice.service.js` ← `tests/portal/bd-xorfy-portal-visit-notice.test.js`
- `password-reset.service.js` ← `dashboard/tests/password-reset-language.service.test.js`
- `portal-coaching.client.js` ← `tests/coaching/bd-bmc9a0.2-iab-save-and-24h.test.js` · `tests/portal/bd-eygg2f-reflection-voice-client.test.js`
- `progress.service.js` ← `tests/portal/progress-counts.db.test.js`
- `r2.service.js` ← `dashboard/tests/web-quiz-story-object.service.test.js` · `tests/portal/bd-5rz1v-coaching-portal-routes.test.js` · `tests/portal/portal-coaching-upload.test.js`
- `redis-cache.service.js` ← `dashboard/tests/redis-cache.test.js`
- `report-extras.js` ← `tests/portal/bd-z3cadk-report-extras.test.js`
- `report-narrative-view.js` ← `tests/portal/bd-fmf24g.10-report-narrative-view.test.js` · `tests/portal/bd-z3cadk-report-extras.test.js`
- `school-analytics.service.js` ← `dashboard/tests/school-analytics.service.test.js` · `tests/portal/school-analytics-observations.test.js` · `tests/portal/teacher-analytics.test.js`
- `schools-analytics.service.js` ← `tests/portal/analytics-lists-v8.test.js` · `tests/portal/analytics-v8-services.test.js` · `tests/portal/coaching-analytics.service.test.js` · `tests/portal/lp-engagement.service.test.js` · `tests/portal/observations-analytics.service.test.js` · `tests/portal/schools-analytics.service.test.js` (+1: `python3 kg/kg.py who-reads dashboard/services/schools-analytics.service.js`)
- `steps-grid.service.js` ← `tests/portal/observations-analytics.service.test.js` · `tests/portal/steps-removed.test.js`
- `steps-presence.service.js` ← `dashboard/tests/steps-presence.service.test.js`
- `steps-remarks.service.js` ← `dashboard/tests/steps-remarks.service.test.js` · `tests/portal/teacher-analytics.test.js`
- `subject-vocabulary.service.js` ← `tests/portal/bd-fmf24g.3-subject-vocabulary.test.js`
- `teacher-coaching.service.js` ← `tests/portal/bd-aqotzx-class-check-history.test.js` · `tests/portal/bd-fmf24g.4-teacher-coaching.test.js`
- `teacher-home-order.service.js` ← `tests/portal/teacher-home-order.service.test.js`
- `teacher-notices.service.js` ← `tests/portal/bd-fmf24g.15-teacher-notices.test.js`
- `telemetry.service.js` ← `tests/lp-v8/web-lessons-portal-link.test.js` · `tests/training/web-training-portal-link.test.js`
- `thing-to-try.service.js` ← `tests/portal/bd-v0toag.8-thing-to-try-step.test.js` · `tests/portal/bd-v0toag.8-thing-to-try.test.js`
- `training-levels-analytics.service.js` ← `tests/portal/training-levels-analytics.service.test.js`
- `training-rules.service.js` ← `tests/portal/training-rules-client.test.js` · `tests/training/portal-grand-quiz-served.test.js`
- `transcript-ux-helpers.service.js` ← `dashboard/tests/transcript-ux-helpers.test.js`
- `vector-db.service.js` ← `dashboard/tests/vector-db.test.js`
- `video-observability.service.js` ← `dashboard/tests/video-observability-service.test.js`
- `video-reco-events.js` ← `tests/coaching/video-reco/no-level-badge.test.js`
- `video-reco-page.js` ← `tests/coaching/video-reco/no-level-badge.test.js` · `tests/portal/video-reco-player-events.test.js`
- `video-reco-portal.js` ← `tests/coaching/video-reco/r7p-app-card.test.js`
- `whatsapp-broadcast.service.js` ← `tests/broadcast/bd-1zyqf-broadcast-language.test.js` · `tests/broadcast/bd-djbrt-direct-send-records-wamid.test.js` · `tests/broadcast/bd-x4njf-approved-template.test.js`

## Related (all, generated)
- docs: `dashboard/CLAUDE.md`? · `docs/attendance-bigquery-sync.md`? · `docs/migration/DEPLOYMENT.md`? · `infrastructure/templates/README.md`?
