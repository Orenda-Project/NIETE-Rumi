# video-reco — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/video-reco -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `arm.js` | Assigns a recommendation's A/B arm by salted teacher-id hash; control rows are stored as shadow (bd-gzfdu9) |
| `caption-link.js` | Appends the clip's /v link to the report caption instead of a separate billed WhatsApp message (bd-9dbhh0.1) |
| `card-image.js` | Renders the 16:9 "watch this clip" header image (thumbnail, play circle, length pill, title) via htmlToImage |
| `catalog.js` | Loads and caches the versioned training-video catalogue JSON (modules, chapters) the engine reads (bd-gzfdu9) |
| `clip-pref.js` | Stores a teacher's clip "not now"/"stop"/resume choice in users.preferences.video_clips (bd-9dbhh0.1) |
| `content-terms.js` | Hand-curated Urdu loanword list the name redactor must not mask as a child's name (bd-8hhqhf r7) |
| `copy-rules.js` | Pure teacher-facing copy rules for clip text: vocative stripping, gendered Urdu checks, card fallback (bd-8hhqhf R7b) |
| `copy.js` | Fills clip message strings: minutes, Urdu digits, language name, and LTR isolates for English runs in Urdu |
| `engine.js` | recommendForReport: never-throwing pipeline from flag and target to shortlist, one LLM pick, redaction, stored row |
| `flags.js` | Call-time env switches for video recommendation (enabled, A/B, mode, allowlist, reason); unset means off |
| `link-token.js` | Signs and verifies the 120-day HMAC token and URL opening one recommended clip at /v/<token> (bd-gzfdu9) |
| `name-lexicon.js` | Generated name and vocabulary lists (Urdu and Latin) that redact-names uses to mask people's names |
| `prompt.js` | Video picker prompt (version vr-11) and redacted transcript excerpts it may quote (bd-gzfdu9) |
| `redact-names.js` | Pure redactor stripping people's names from transcript text before prompts, quotes or pages (VIDREC H8) |
| `report-via.js` | Records on the recommendation row which path delivered the report (image, slim, template, pdf) for A/B exposure |
| `select.js` | The single completeJson pick (coaching.videoReco job) and the validation every answer passes before storage |
| `send.js` | Sends the one "watch this clip" cta_url message after the report, with picture, once per session (bd-gzfdu9) |
| `shortlist.js` | Deterministic BM25 shortlist of candidate chapters by indicator tag or card text, with subject/grade filters |
| `silence.js` | Pure rules for when the engine stays silent: no mixed-level moment, off-subject label, non-imperative card (R7b) |
| `status-events.js` | Maps Meta delivered/read/failed statuses on a clip wamid into video_reco_events rows; no-op when flag off |
| `store.js` | Storage for video_recommendations rows plus teacher history, ladder progress, grade bands; never throws |
| `strip.js` | Picks the clip strip drawn on the report image, waiting a capped time for the engine's pick (R7m) |
| `target.js` | Pure choice of what a recommended clip is for: plan step, next step, card indicator, else card text |
| `urdu-terms.js` | Reads the reviewer-owned Urdu move/answer terms file and builds the Urdu transcript frame line (R7j) |

## Who reads this (all, generated)
- `arm.js` ← imported by `bot/shared/services/coaching/video-reco/engine.js:16:7d74e8c3`
- `caption-link.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:496:ed5e1060` · `bot/shared/services/observe/observe-send.service.js:1332:57c92833`
- `card-image.js` ← imported by `bot/shared/services/coaching/video-reco/send.js:37:9fa2579b`
- `catalog.js` ← imported by `dashboard/services/video-reco-events.js:127:2852bd16` · `bot/shared/services/coaching/video-reco/caption-link.js:54:5d4ef082` · `bot/shared/services/coaching/video-reco/engine.js:795:51e3b16b` · `bot/shared/services/coaching/video-reco/send.js:34:597906d8` (+1: `python3 kg/kg.py who-reads catalog.js`)
- `clip-pref.js` ← imported by `dashboard/routes/video-reco.routes.js:25:4765b520` · `dashboard/services/video-reco-events.js:66:4c13258b` · `bot/shared/services/coaching/video-reco/engine.js:17:e4e7b8a4` · `bot/shared/services/coaching/video-reco/store.js:180:53483160`
- `content-terms.js` ← imported by `bot/shared/services/coaching/video-reco/select.js:12:30b90379`
- `copy-rules.js` ← imported by `bot/shared/services/coaching/video-reco/engine.js:24:30f0abf5` · `bot/shared/services/coaching/video-reco/prompt.js:9:74adc4e5` · `bot/shared/services/coaching/video-reco/select.js:15:7ff26a68` · `bot/shared/services/coaching/video-reco/urdu-terms.js:12:e1d1d5bc`
- `copy.js` ← imported by `dashboard/routes/video-reco.routes.js:23:acc21039` · `dashboard/services/coaching-report-page.js:17:07c6eb0f` · `dashboard/services/video-reco-events.js:14:acc21039` · `dashboard/services/video-reco-page.js:21:acc21039` (+6: `python3 kg/kg.py who-reads copy.js`)
- `engine.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:207:48908afe` · `bot/shared/services/observe/observe-send.service.js:1324:c71bd275`
- `flags.js` ← imported by `dashboard/services/video-reco-events.js:75:f1208529` · `bot/shared/services/coaching/video-reco/arm.js:12:0666eb1f` · `bot/shared/services/coaching/video-reco/caption-link.js:31:91c28048` · `bot/shared/services/coaching/video-reco/engine.js:15:1e1d4949` (+3: `python3 kg/kg.py who-reads flags.js`)
- `link-token.js` ← imported by `dashboard/routes/video-reco.routes.js:21:92d6d54a` · `dashboard/services/video-reco-events.js:101:bc9c7e45` · `bot/shared/services/coaching/video-reco/caption-link.js:52:252ee47e` · `bot/shared/services/coaching/video-reco/send.js:22:6443a1fc` (+1: `python3 kg/kg.py who-reads link-token.js`)
- `name-lexicon.js` ← imported by `bot/shared/services/coaching/video-reco/copy-rules.js:7:7d0ccf95` · `bot/shared/services/coaching/video-reco/redact-names.js:26:7d0ccf95` · `bot/shared/services/coaching/video-reco/select.js:13:7d0ccf95`
- `prompt.js` ← imported by `bot/shared/services/coaching/video-reco/engine.js:20:39ff7290`
- `redact-names.js` ← imported by `bot/shared/services/coaching/video-reco/copy-rules.js:6:7f4bd4ed` · `bot/shared/services/coaching/video-reco/engine.js:26:facd2e0f` · `bot/shared/services/coaching/video-reco/prompt.js:8:7f4bd4ed` · `bot/shared/services/coaching/video-reco/select.js:9:e5c7a56a` (+1: `python3 kg/kg.py who-reads redact-names.js`)
- `report-via.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:488:893ed232`
- `select.js` ← imported by `bot/shared/services/coaching/video-reco/engine.js:21:fd674c69`
- `send.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:711:28403a4f` · `bot/shared/services/observe/observe-send.service.js:1365:9a07e31a`
- `shortlist.js` ← imported by `bot/shared/services/coaching/video-reco/engine.js:19:d3dcbd40` · `bot/shared/services/coaching/video-reco/select.js:10:65eabdad`
- `silence.js` ← imported by `bot/shared/services/coaching/video-reco/copy-rules.js:8:7b43229e` · `bot/shared/services/coaching/video-reco/engine.js:22:54e4d52d` · `bot/shared/services/coaching/video-reco/select.js:14:915c6a8f` · `bot/shared/services/coaching/video-reco/shortlist.js:21:c81aacb0`
- `status-events.js` ← imported by `bot/whatsapp-bot.js:147:9a040a2d`
- `store.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:522:dfac1b4e` · `bot/shared/services/observe/observe-send.service.js:1354:4cc1fcfa` · `bot/shared/services/coaching/video-reco/caption-link.js:46:8a970f19` · `bot/shared/services/coaching/video-reco/engine.js:187:63e8f4b6` (+2: `python3 kg/kg.py who-reads store.js`)
- `strip.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:433:bbd343a0` · `bot/shared/services/coaching/report-v2/hero-report.template.js:268:29cb4541` · `bot/shared/services/coaching/report-v2/slim-card.template.js:68:d1f59f39` · `bot/shared/services/coaching/video-reco/caption-link.js:42:4b7b7635`
- `target.js` ← imported by `bot/shared/services/coaching/video-reco/engine.js:18:d32c0d66`
- `urdu-terms.js` ← imported by `bot/shared/services/coaching/video-reco/copy.js:12:3b168c43` · `bot/shared/services/coaching/video-reco/engine.js:25:3b168c43` · `bot/shared/services/coaching/video-reco/prompt.js:10:fba79dd0`
- column `users.preferences` (written by `clip-pref.js`) ← read by `bot/shared/handlers/flow-response.handler.js:761:6d7fc8d6` · `bot/shared/routes/settings-endpoint.js:49:f26864bf` · `bot/shared/services/coaching/frameworks/framework-selector.js:65:ff3cc75a` · `dashboard/services/video-reco-events.js:64:b29a87bb`
- table `users` whole row (`*`) (written by `clip-pref.js`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687`? · `bot/shared/database/queries.js:14:77bc023b`? · `dashboard/database/queries.js:687:7a0c163a`? · `dashboard/routes/portal.routes.js:314:d2b02c3e`? (+1: `python3 kg/kg.py who-reads users`)
- table `users` (written by `clip-pref.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? · `bot/shared/calls/call-tools.repo.js:242:774e00e5`? · `bot/shared/database/bot-helpers.js:17:61dfd735`? (+168: `python3 kg/kg.py who-reads users`)
- env `INTERNAL_API_KEY` read at `bot/shared/services/coaching/video-reco/link-token.js:40:237d5f3b`
- env `PORTAL_URL` read at `bot/shared/services/coaching/video-reco/link-token.js:82:5940e29a`
- env `SUPABASE_URL` read at `bot/shared/services/coaching/video-reco/link-token.js:28:a60b88ec`
- env `VIDEO_RECO_REPORT_VIA` read at `bot/shared/services/coaching/video-reco/report-via.js:29:fa950625`

## Tests (all, generated)
- `arm.js` ← `tests/coaching/video-reco/arm.test.js` · `tests/coaching/video-reco/engine.test.js` · `tests/coaching/video-reco/r7e-allowlist.test.js` · `tests/coaching/video-reco/skip-iab.test.js`
- `caption-link.js` ← `tests/coaching/video-reco/skip-iab.test.js`
- `card-image.js` ← `tests/coaching/video-reco/card-image.test.js`
- `catalog.js` ← `tests/coaching/video-reco/catalog.test.js` · `tests/coaching/video-reco/engine.test.js` · `tests/coaching/video-reco/grade-band-chapters.test.js` · `tests/coaching/video-reco/prompt.test.js` · `tests/coaching/video-reco/r7b-catalog.test.js` · `tests/coaching/video-reco/r7b-copy.test.js` (+48: `python3 kg/kg.py who-reads bot/shared/services/coaching/video-reco/catalog.js`)
- `clip-pref.js` ← `tests/coaching/video-reco/skip-iab.test.js`
- `copy-rules.js` ← `tests/coaching/video-reco/r7b-copy.test.js` · `tests/coaching/video-reco/r7e-moment.test.js` · `tests/coaching/video-reco/r7f.test.js` · `tests/coaching/video-reco/r7i-s12.test.js` · `tests/coaching/video-reco/r7k-card-opener.test.js` · `tests/coaching/video-reco/r7k-elision.test.js`
- `copy.js` ← `tests/coaching/video-reco/copy.test.js` · `tests/coaching/video-reco/r7b-copy.test.js` · `tests/coaching/video-reco/r7c.test.js` · `tests/coaching/video-reco/r7d.test.js` · `tests/coaching/video-reco/r7e-moment.test.js` · `tests/coaching/video-reco/r7f.test.js` (+7: `python3 kg/kg.py who-reads bot/shared/services/coaching/video-reco/copy.js`)
- `engine.js` ← `tests/coaching/video-reco/engine.test.js` · `tests/coaching/video-reco/r7b-copy.test.js` · `tests/coaching/video-reco/r7b-silence.test.js` · `tests/coaching/video-reco/r7c.test.js` · `tests/coaching/video-reco/r7d.test.js` · `tests/coaching/video-reco/r7e-allowlist.test.js` (+36: `python3 kg/kg.py who-reads bot/shared/services/coaching/video-reco/engine.js`)
- `flags.js` ← `tests/coaching/video-reco/flags.test.js` · `tests/coaching/video-reco/r7e-allowlist.test.js` · `tests/coaching/video-reco/r7k-reason-mode.test.js` · `tests/coaching/video-reco/r7r-cr-card.test.js` · `tests/coaching/video-reco/skip-iab.test.js`
- `link-token.js` ← `tests/coaching/video-reco/link-token.test.js` · `tests/coaching/video-reco/r7p-app-card.test.js` · `tests/coaching/video-reco/send.test.js` · `tests/coaching/video-reco/skip-iab-report.test.js` · `tests/coaching/video-reco/skip-iab.test.js` · `tests/portal/coaching-report-page.video.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/coaching/video-reco/link-token.js`)
- `prompt.js` ← `tests/coaching/video-reco/prompt.test.js` · `tests/coaching/video-reco/r7b-copy.test.js` · `tests/coaching/video-reco/r7c.test.js` · `tests/coaching/video-reco/r7g.test.js` · `tests/coaching/video-reco/r7j-urdu.test.js` · `tests/coaching/video-reco/review-v13.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/coaching/video-reco/prompt.js`)
- `redact-names.js` ← `tests/coaching/video-reco/r7g-redact.test.js` · `tests/coaching/video-reco/r7i-redact.test.js` · `tests/coaching/video-reco/r7k-vocative.test.js` · `tests/coaching/video-reco/r7v-cpu.test.js` · `tests/coaching/video-reco/redact-names.test.js` · `tests/coaching/video-reco/v13f.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/coaching/video-reco/redact-names.js`)
- `report-via.js` ← `tests/coaching/video-reco/r7pb-report-via.test.js`
- `select.js` ← `tests/coaching/video-reco/r7b-copy.test.js` · `tests/coaching/video-reco/r7c.test.js` · `tests/coaching/video-reco/r7d.test.js` · `tests/coaching/video-reco/r7e-allowlist.test.js` · `tests/coaching/video-reco/r7e-moment.test.js` · `tests/coaching/video-reco/r7f.test.js` (+23: `python3 kg/kg.py who-reads bot/shared/services/coaching/video-reco/select.js`)
- `send.js` ← `tests/coaching/video-reco/no-level-badge.test.js` · `tests/coaching/video-reco/r7m-strip-wait.test.js` · `tests/coaching/video-reco/send.test.js` · `tests/coaching/video-reco/skip-iab.test.js`
- `shortlist.js` ← `tests/coaching/video-reco/grade-band-chapters.test.js` · `tests/coaching/video-reco/r7b-catalog.test.js` · `tests/coaching/video-reco/r7c.test.js` · `tests/coaching/video-reco/r7d.test.js` · `tests/coaching/video-reco/r7e-moment.test.js` · `tests/coaching/video-reco/r7f.test.js` (+11: `python3 kg/kg.py who-reads bot/shared/services/coaching/video-reco/shortlist.js`)
- `silence.js` ← `tests/coaching/video-reco/r7b-silence.test.js` · `tests/coaching/video-reco/r7c.test.js` · `tests/coaching/video-reco/r7d.test.js` · `tests/coaching/video-reco/r7e-moment.test.js` · `tests/coaching/video-reco/r7f.test.js` · `tests/coaching/video-reco/r7g.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/services/coaching/video-reco/silence.js`)
- `status-events.js` ← `tests/coaching/video-reco/status-events.test.js`
- `store.js` ← `tests/coaching/video-reco/r7n-attempts-check.test.js` · `tests/coaching/video-reco/retrieval-v13.test.js` · `tests/coaching/video-reco/store.test.js`
- `strip.js` ← `tests/coaching/video-reco/no-level-badge.test.js` · `tests/coaching/video-reco/r7m-strip-wait.test.js` · `tests/coaching/video-reco/r7p-strip-where.test.js` · `tests/coaching/video-reco/r7pb-report-via.test.js` · `tests/coaching/video-reco/report-image-strip.test.js` · `tests/coaching/video-reco/skip-iab.test.js`
- `target.js` ← `tests/coaching/video-reco/r7t-card-label.test.js` · `tests/coaching/video-reco/review-v13.test.js` · `tests/coaching/video-reco/target.test.js` · `tests/coaching/video-reco/v13b.test.js` · `tests/coaching/video-reco/v13f.test.js` · `tests/observe2/work-on-coaching-areas.test.js`
- `urdu-terms.js` ← `tests/coaching/video-reco/r7k-urdu-v2.test.js`

## Related (all, generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`?
