# Teacher-app funnel telemetry (bd-4r3rei)

One teacher, one **journey**: she sends a command on WhatsApp, the bot decides about the app link, she opens it in
WhatsApp's browser, uses pages, and leaves. A random **journey id** joins all of those rows in Axiom, so the funnel
shows where she dropped, and the last page she was seen on. Rows go to Axiom only: no table, no screen change, no
message change.

Dataset: `niete-logs` (production and staging, filter `env`); the sandbox rung is its own dataset `rumi-sandbox`
(`env == "sandbox"`). See the `axiom-logging` skill.

## The journey, hop by hop

| Hop | What happens | Where |
|---|---|---|
| 1. command | the bot decides about the app link for a command; mints `journeyId` (`j_` + 16 hex, random, says nothing about her) | `bot/shared/services/app-journey.js` `newJourneyId`; `app-redirect.service.js` `startJourney` (lines 110-114), called from `decideRedirect` (387, 393, 397) |
| 2. link | the id goes INSIDE the encrypted `/go` token (never in the clear in the URL) | `app-redirect.service.js:347` `signAppLink(userId, feature, journeyId)`; `app-login-link.js:97` writes `j`, `:121` reads it back (null for links sent before this change) |
| 3. open | `/go/:token` logs `app_link.open` with the id and stores it in the portal session for 24 h | `dashboard/routes/app-login.routes.js:126` (`payload.j`), `:151` (`req.session.appJourney`) |
| 4. pages | the SPA reports pages; the server attributes them from the SESSION (never the request body) | `portal/src/portal/components/AppFunnelTracker.tsx` (mounted `portal/src/App.tsx:169`), `portal/src/portal/lib/appFunnel.ts`; server `dashboard/routes/app-funnel.routes.js` `who` (:78), `toRow` (:125), route `/funnel/events` (:150), mounted `dashboard/index.js:2810` |
| 5. actions | key API calls are logged server-side once they answer 2xx/3xx | `app-funnel.routes.js` `actionLogger` (:232), mounted before the portal routers `dashboard/index.js:2809` |
| 6. funnel | the queries below, or `scripts/app-funnel/funnel.py` | this folder |

`journeyId` is a core Axiom column on the bot side (`bot/shared/utils/structured-logger.js:207`) and a plain field on
the portal side, so `where journeyId == "j_..."` works for every row. The bot's other funnel fields (`feature`, `door`,
`verdict`, `why`, `via`, `reason`) sit in `data_json` (the bot's logger stringifies non-core fields); the portal's are
top-level columns.

## Events

| Event | From | Fields |
|---|---|---|
| `app_funnel.command` | bot | `journeyId`, `userId`, `feature` (menu, lesson_plan, assessment_generator, teacher_training, attendance, classes; observe/menu for coaches), `door` (command, bare_command, chip, intent, menu_command, keyword, ...), `verdict` (`link` or `whatsapp`), `why` (when `whatsapp`: not_a_teacher, not_registered, no_account, not_on_teacher_app, account_unreadable), `audience` (teacher, coach or leader; `funnel.py` reports a coach's or leader's journeys as their own funnel, e.g. `lesson_plan@leader`) |
| `app_funnel.link_sent` | bot | `journeyId`, `userId`, `feature`, `door`, `via` (`cta_url` button or `text` when Meta refused the button) |
| `app_funnel.link_failed` | bot | same, plus `reason` (send_refused, send_threw, no_portal_or_key); she is on the WhatsApp flow instead |
| `app_link.open` | portal | `journeyId`, `userId`, `feature` (the link's target: a teacher feature, `coach_*`, `leader_lessons`, or an `fln:` target), `outcome` (ok, invalid, unknown_user, error), `v2` |
| `app_funnel.page_view` | portal | `journeyId` (null if she did not come from a link), `userId`, `appSessionId`, `entry` (`app_link`, `session`, `link:<area>`), `linkFeature`, `route`, `prevRoute`, `feature`, `browser` |
| `app_funnel.page_leave` | portal | as above plus `dwellMs` (time she was actually looking; time hidden excluded) and `how` (`nav`, `hidden`, `pagehide`) |
| `app_funnel.page_resume` | portal | she came back to the page (visible again / restored from the back-forward cache) |
| `app_funnel.action` | portal | `journeyId`, `userId`, `appSessionId`, `action`, `feature`, `lane` (lesson plans), `status` |

Actions logged: `lesson_plan.opened` (lane k5, g612 or fln), `lesson_plan.requested`, `fln.sent` (a leader sent an FLN plan, lane fln_send), `paper.requested`, `paper.edited`,
`attendance.saved`, `attendance.register_sent`, `training.module_opened`, `training.quiz_started`,
`training.quiz_finished`, `training.module_completed`, `training.certificate_issued`, `class.created`,
`class.students_added`, `coaching.recording_submitted`, `coaching.reflection_saved`, `share.whatsapp`,
`observe.started`, `observe.report_sent`, `notice.opened`. The list is the `ACTIONS` table in `app-funnel.routes.js`;
a new action is one row there.

`browser` is classified by the server from the User-Agent / X-Requested-With: `whatsapp-iab`, `webview` (another app's),
`browser`, or `native` (the Android app's own claim). The UA is read, never stored.

## Privacy (in-app-browser-whatsapp, privacy-safety section 3)

Ids and hashes only: `userId` (uuid), `journeyId` (random), `appSessionId` (sha256 of the session id, 12 hex). No name,
phone, free text or token in any row. Routes are normalised (`/portal/coach/visit/:id/record`: query dropped, any
segment that is not a plain lower-case word becomes `:id`) on the page and again on the server. The browser sends only
page shape, kind, dwell and age; user, journey and session come from the portal session. Bodies are capped at 8 KB,
25 events per call, 30 calls and 200 events per session per minute. No third-party SDK, no storage on the device.

## APL

Replace the dataset and `env` (`niete-logs` / `"production"` for production; this window is one Pakistan day). All three
were run against `rumi-sandbox`.

**Funnel per starting command** (journeys that reached each step; a coach's or leader's journeys are their own row, e.g. `lesson_plan@leader`):

```apl
["niete-logs"]
| where _time >= datetime(2026-10-12T19:00:00Z) and _time < datetime(2026-10-13T19:00:00Z) and env == "production"
| where event in ("app_funnel.command", "app_funnel.link_sent", "app_link.open", "app_funnel.page_view", "app_funnel.action")
| where isnotempty(journeyId)
| extend cmdAud = tostring(parse_json(data_json).audience), cmdFeature = tostring(parse_json(data_json).feature)
| extend cmdFeature = iff(isnotempty(cmdAud) and cmdAud != "teacher", strcat(cmdFeature, "@", cmdAud), cmdFeature)
| extend cmdTs = iff(event == "app_funnel.command", _time, datetime(1970-01-01))
| summarize arg_max(cmdTs, cmdFeature), asked = countif(event == "app_funnel.command"), sent = countif(event == "app_funnel.link_sent"), opened = countif(event == "app_link.open" and outcome == "ok"), views = countif(event == "app_funnel.page_view"), pages = dcountif(route, event == "app_funnel.page_view"), acts = countif(event == "app_funnel.action") by journeyId
| where asked > 0
| summarize asked = count(), link_sent = countif(sent > 0), opened = countif(opened > 0), landed = countif(views > 0), went_deeper = countif(pages >= 2), acted = countif(acts > 0) by cmdFeature
```

**Where the drop-offs were last seen** (opened the app, did none of the counted actions; last page by time):

```apl
["niete-logs"]
| where _time >= datetime(2026-10-12T19:00:00Z) and _time < datetime(2026-10-13T19:00:00Z) and env == "production"
| where event in ("app_funnel.command", "app_link.open", "app_funnel.page_view", "app_funnel.page_resume", "app_funnel.action")
| where isnotempty(journeyId)
| extend cmdAud = tostring(parse_json(data_json).audience), cmdFeature = tostring(parse_json(data_json).feature)
| extend cmdFeature = iff(isnotempty(cmdAud) and cmdAud != "teacher", strcat(cmdFeature, "@", cmdAud), cmdFeature)
| extend cmdTs = iff(event == "app_funnel.command", _time, datetime(1970-01-01)), pageTs = iff(event in ("app_funnel.page_view", "app_funnel.page_resume"), _time, datetime(1970-01-01))
| summarize arg_max(cmdTs, cmdFeature), arg_max(pageTs, route), asked = countif(event == "app_funnel.command"), opened = countif(event == "app_link.open" and outcome == "ok"), acts = countif(event == "app_funnel.action") by journeyId
| where asked > 0 and opened > 0 and acts == 0
| extend lastPage = iff(pageTs <= datetime(1970-01-02), "(never landed)", route)
| summarize journeys = count() by cmdFeature, lastPage
| order by journeys desc
```

(`make_list` does not keep time order in Axiom, so the last page is taken with `arg_max` on a page-only timestamp.)

**One journey, in order:**

```apl
["niete-logs"] | where journeyId == "j_0123456789abcdef" | order by _time asc
```

Why the bot rows are not in the last query's pages: `route` exists only on the portal's rows. Why a journey can show
"no command row": it started before the window.

## The script

```bash
AXIOM_TOKEN=... python3 scripts/app-funnel/funnel.py                         # today (Pakistan), production
AXIOM_TOKEN=... python3 scripts/app-funnel/funnel.py --env sandbox --day 2026-10-13
AXIOM_TOKEN=... python3 scripts/app-funnel/funnel.py --feature lesson_plan --json
AXIOM_TOKEN=... python3 scripts/app-funnel/funnel.py --env sandbox --journey j_0123456789abcdef
python3 scripts/app-funnel/test_funnel.py                                    # unit tests, no network
```

It prints, per starting command, the six steps with percentages, who was kept on WhatsApp and why, failed sends, sends
never opened, which door the command came through, the actions done, and the last pages of the drop-offs with the
median time on that page; then the direct (no journey) sessions.

## Not covered

- A teacher who opens the app without a link has `journeyId: null`; the script reports those sessions apart, not as a funnel.
- Template-button links (`/t/:token`, training, "ready") carry no journey; their pages log with `entry: link:<area>`.
- A page that is closed with no `hidden`/`pagehide` event (the OS kills the WebView) has no leave row; the last
  `page_view` still names the last page.
- A journey counts for 24 h, the life of the link. Later use of the same session logs `journeyId: null`.
- Coaches and principals who use the app also report page views (ids and routes only); the funnel only counts journeys
  that started from a bot command.
- A leader's lesson-plan link (bd-a73p5m) lands on `/portal/teacher/lessons`, the same page as a teacher's, so its page
  rows carry `feature: lesson_plan` like hers. The route cannot tell them apart and nothing here keys on it: a journey's
  funnel is named by its command row, so the leader's is `lesson_plan@leader` (its `app_link.open` and page rows also
  carry `leader_lessons` as `feature` / `linkFeature`). Links sent before 23 Oct carry `fln:send` and land on
  `/portal/fln/send`.
- Actions are logged at the API; an action the app performs without an API call is not seen.
