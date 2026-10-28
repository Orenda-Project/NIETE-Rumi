# video-reco — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/coaching/video-reco -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 2 test files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `arm.test.js` | bd-gzfdu9: video-reco A/B arm assigned at recommendation time by a pre-registered salt constant; off means video arm |
| `build-catalog.test.js` | bd-gzfdu9: build-catalog turns the catalog contract into the bot data file; validator refuses untrustworthy files |
| `card-image.test.js` | bd-gzfdu9: 480x270 watch-this-clip card image HTML (thumbnail, play circle, m:ss pill, title), fonts embedded |
| `catalog.test.js` | bd-gzfdu9: the shipped video-catalog.v1.json loads with version, aliases and modules; load() is cached |
| `complete-json-reasoning.test.js` | bd-gzfdu9: GPT5MiniService.completeJson sends reasoning effort only when the optional reasoningEffort is set |
| `copy.test.js` | bd-gzfdu9 VIDREC: en/ur words of the watch-this-clip message, /cr card and player; Meta caps in code points |
| `engine.test.js` | bd-gzfdu9: engine.recommendForReport: flag off is a no-op, never throws, retries reuse row, shadow storage, none reasons |
| `fixtures-r7p-app-card.json` | Fixture rows of longest quoted reasons per report language from an R7 replay run; anonymised, used by r7p tests |
| `fixtures-strip.js` | Shared fixtures: hero (794) and slim (480) report HTML rendered live both ways, used by report-image-strip.test.js |
| `flags.test.js` | bd-gzfdu9: video-reco switches are read from process.env at call time, unset means off (flags) |
| `grade-band-chapters.test.js` | bd-8hhqhf R7: grade gate reads a chapter's own grade_band before its module's (catalog, shortlist) |
| `hero-report.video-strip.test.js` | bd-gzfdu9 4.9: generateHeroReport passes opts.videoStrip to both full and slim images; unchanged without it |
| `link-token.test.js` | bd-gzfdu9: /v/<token> link to one recommended clip, own label and kind so report tokens never open clips |
| `no-level-badge.test.js` | bd-gzfdu9: no surface (card, strip, send) badges a clip with a training level like Aspiring or Level 1 |
| `observe-send.video-reco-send.test.js` | bd-gzfdu9 hook B2: on /observe the clip goes to the teacher once after their report image, never the coach preview |
| `observe-send.video-reco.test.js` | bd-gzfdu9 hook A2: recommendation started in observe-send deliver/teacher_tap and never blocks the coach send |
| `prompt.test.js` | bd-gzfdu9: prompt.build (vr-11) and the diarized transcript moments it may quote, with names redacted |
| `r7b-catalog.test.js` | bd-8hhqhf R7b: shipped catalogue shortlist rules for C1 and B6 shapes (panel scale review rows, anonymised) |
| `r7b-copy.test.js` | bd-8hhqhf R7b: message copy as the teacher reads it; name lexicon, gendered-Urdu and unsupported-claim validators |
| `r7b-silence.test.js` | bd-8hhqhf R7b: the engine stays silent when there is no move to find, one test per panel row shape |
| `r7c.test.js` | bd-8hhqhf R7c: seven panel-driven asks before the A/B, e.g. a child's name in the card never reaches the fallback |
| `r7d.test.js` | bd-8hhqhf R7d: seven panel-driven asks: name in card sentence refuses fallback, failed checks look for a second moment |
| `r7e-allowlist.test.js` | bd-8hhqhf R7e: VIDEO_RECO_ALLOWLIST proven-chapters mode; off-list pick is none/allowlist, control arm stays shadow |
| `r7e-moment.test.js` | bd-8hhqhf R7e: moment rule (no greeting-time moments), B10 closure chapters and copy residuals from panel rows |
| `r7f.test.js` | bd-8hhqhf R7f: routes, gap, closure, Urdu line and owed silences from panel rows; retry citing a greeting |
| `r7g-redact.test.js` | bd-8hhqhf R7g: a dictionary-word child name beside a masked name is redacted in excerpt, quote and reasons |
| `r7g.test.js` | bd-8hhqhf R7g: retired step-text route, F5-label closed-question rule, card-frame move check, tag leaks and silences |
| `r7i-redact.test.js` | bd-8hhqhf R7i: one-word call before a masked name is a name; a token masked once is masked in every output |
| `r7i-s12.test.js` | bd-8hhqhf R7i S12: a possessive child name in the card sentence makes it unquotable (copy-rules) |
| `r7j-urdu.test.js` | bd-8hhqhf R7j: the engine reads Urdu terms only from the shipped urdu-terms data; slash forms retired |
| `r7j.test.js` | bd-8hhqhf R7j: tag-route and word-match picks for modules 96 and 148; card frame reads the card's own move |
| `r7k-card-opener.test.js` | bd-8hhqhf R7k: a dictionary-word Urdu name heading the card sentence is the address, not a content word |
| `r7k-elision.test.js` | bd-8hhqhf R7k: the quoted card keeps its imperative verb before the example (childFreeCard, fitClauses) |
| `r7k-head-move.test.js` | bd-8hhqhf R7k: the card's head move decides the clip (why-probe puts 51-s1 first, pair talk 50-s2 later) |
| `r7k-reason-mode.test.js` | bd-8hhqhf R7k: VIDEO_RECO_REASON=card uses the card frame or silence with no model call; unset is today |
| `r7k-routine.test.js` | bd-8hhqhf R7k: a cited greeting, page call or filler falls back to the card frame (routineLine, cardRoutine) |
| `r7k-urdu-v2.test.js` | bd-8hhqhf R7k: Urdu reason line is built from the term's kind, never says the teacher did the clip's move |
| `r7k-vetoes.test.js` | bd-8hhqhf R7k: modules 11 and 80 are vetoed in the shipped catalogue (voice-overs enact nothing) but stay on the ladder |
| `r7k-vocative.test.js` | bd-8hhqhf R7k: a child name used as the closing vocative of the cited question never survives in stored quote or reasons |
| `r7l.test.js` | bd-8hhqhf R7l: no-lesson no-pick, route gates from ped/vetoes.json, next-chapter not a reminder; live-branch tests |
| `r7m-strip-wait.test.js` | R7m: report image waits for the pick only as long as reason mode needs (shadow 0, card 1.5 s, llm 5 s, env override) |
| `r7n-attempts-check.test.js` | bd-8hhqhf R7n: store.write sends only values the V1.7.1/V1.7.2 CHECK constraints (attempts 1-2, route) allow |
| `r7o-71.test.js` | bd-8hhqhf R7o: module 71 carries a card_text route gate; a writing task on a disallowed C1 card is refused |
| `r7o-a.test.js` | bd-8hhqhf R7o-a: quoted card sentence passes the strict name redactor; slow recording with no talk is not a lesson |
| `r7o-b.test.js` | bd-8hhqhf R7o-b: card-mode shapes: non-breaking hyphen, tiered tail after open-question head, on the shipped catalogue |
| `r7o-c.test.js` | bd-8hhqhf R7o-c: why/wait rescue only when the card head asks; no doubled full stop after the closing quote |
| `r7o-nfs.test.js` | bd-8hhqhf R7o-b: shortlist reads not_for_subjects before free-text not_for prose, so modules keep their own subject |
| `r7p-app-card.test.js` | bd-gzfdu9 R7p: portal report-page VideoRecoCard shows the stored reason verbatim and a /v link signed for portal surface |
| `r7p-strip-where.test.js` | bd-gzfdu9 R7p: the report-image strip hint tells the truth about where the clip is (app, next message) on every path |
| `r7pb-report-via.test.js` | bd-gzfdu9 R7p-b: video_recommendations.report_via (V1.7.9) records image/slim/template/pdf on every row |
| `r7q.test.js` | bd-gzfdu9 R7q: card sentence with another script (Cyrillic) uses the plain frame, never the quote; chapter clause kept |
| `r7r-cr-card.test.js` | bd-gzfdu9 R7r: for the A/B the /cr page carries no clip card when the flag is set; byte-identical otherwise |
| `r7s-pick-waves.test.js` | bd-8hhqhf R7s: card-mode pick collapses serial Supabase read waves, measured on a virtual clock (groupForEager) |
| `r7t-card-label.test.js` | bd-8hhqhf R7t: card indicator stored as Name (ID) label picks and stores the bare id, never the label |
| `r7v-cpu.test.js` | bd-8hhqhf R7v: card-mode pick builds BM25 index and redactor vocab once, not per call or per transcript line |
| `r7v-pick-time.test.js` | bd-8hhqhf R7v: card-mode pick p90 under 600 ms at peak RTT, read waves and report-path safety on a virtual clock |
| `redact-names.test.js` | VIDREC H8: redactNames masks teacher, coach, school and roster child names, using invented names and held-out shapes |
| `report-generator.video-reco-send.test.js` | bd-gzfdu9 hook B: clip sent as one message after the report only while the 24 h window is open; strip handed to hero |
| `report-generator.video-reco.test.js` | bd-gzfdu9 hook A: flag off leaves report-generator calls byte-identical; flag on starts the engine once |
| `report-image-strip.test.js` | bd-gzfdu9 4.9: report image carries a Watch next block (thumbnail, play badge, title) on hero and slim templates |
| `retrieval-v13.test.js` | bd-gzfdu9 SPEC v1.3 retrieval rules R1-R3: level is a preference not a filter, tag route up to 12, step-text route |
| `review-v13.test.js` | bd-gzfdu9: #3313 review deviations and validator rulings folded into v1.3; one test per item |
| `select.test.js` | bd-gzfdu9: select.pick makes one completeJson call for job coaching.videoReco; truncation marked |
| `send.test.js` | bd-gzfdu9 VIDREC: the watch-this-clip message after the report: cta_url with card header, else no picture, else text |
| `shortlist.test.js` | bd-gzfdu9: shortlist.build deterministic candidate chapters (language, level, vetoes) with no LLM and no I/O |
| `skip-iab-observe.test.js` | bd-9dbhh0.1: on /observe the clip's /v link ends the teacher's report image caption; no separate clip message |
| `skip-iab-report.test.js` | bd-9dbhh0.1: on the real report path the clip link ends the report image caption and no clip message follows |
| `skip-iab.test.js` | bd-9dbhh0.1: no WhatsApp clip message unless VIDEO_RECO_WA_MESSAGE is on; link in the caption and strip hint |
| `status-events.test.js` | bd-gzfdu9: Meta delivered/read/failed status for the clip message becomes video_reco_events rows by wamid |
| `store.test.js` | bd-gzfdu9: video-reco store functions never throw; a DB error is one warn log and the safe answer |
| `target.test.js` | bd-gzfdu9: target.pick chooses the one thing a recommended clip is for (next step wins, plan-phase steps, 37-id scheme) |
| `v13b.test.js` | bd-gzfdu9 SPEC v1.3b: prompt wording, one bounded validation retry, attempts and first_none_reason stored (V1.7.2) |
| `v13c-stub-floor.test.js` | bd-gzfdu9 v1.3c-4: stub floor (6 content words) on the step-text route; contentWords ignores function words and tags |
| `v13c-vr5.test.js` | bd-gzfdu9 v1.3c-3: cross-language rule: reason paraphrases the moment in the report language, quoting few words |
| `v13c.test.js` | bd-gzfdu9 v1.3c: post-redaction of reasons and quote after validation; card-sentence fallback when the retry also fails |
| `v13e.test.js` | bd-gzfdu9 v1.3c-5: the card-sentence fallback never opens with a placeholder or an address vocative |
| `v13f.test.js` | bd-8hhqhf: card-sentence fallback trims long sentences at a word boundary; name check ignores honorifics and roles |
| `v13g.test.js` | bd-8hhqhf: strict excerpt redactor stops masking content words as children's names so the model sees the subject word |
| `v13h.test.js` | bd-8hhqhf: a vocabulary word never shields a lexicon name or address slot; the isolate wraps the accepted moment span |
| `v13i.test.js` | bd-8hhqhf: a bare speaker label is not words; a scorer-path quote must appear in the full transcript |
| `v13j.test.js` | bd-8hhqhf: a reason that copied the transcript line prefix (time, speaker) has it removed at composition |
| `v13k.test.js` | bd-8hhqhf: scorer commentary or empty transcript never becomes the moment from your lesson (none no_moment) |
| `v13l.test.js` | bd-8hhqhf: teacher-facing reason carries no clock time or speaker label; prompt rule 2 no longer asks for [mm:ss] |
| `v13m.test.js` | bd-8hhqhf: a reason or quote that would open with a masked-name placeholder is rewritten; mid-reason ones stay |
| `v13n.test.js` | bd-8hhqhf: stored moment_quote drops a real speaker label, trailing (mm:ss) and wrapping quote marks |
| `validate.test.js` | bd-gzfdu9: select.validate checks a pick (moment in transcript, rules) before anything is stored or sent |
| `whatsapp.sendCtaUrl.header.test.js` | bd-gzfdu9 VIDREC: sendCtaUrl gains an optional image header; payload unchanged without it (whatsapp.service) |

## Who reads this (all, generated)
- env `VIDEO_RECO_ENABLED` read at `tests/coaching/video-reco/engine.test.js:81:63e25da7` · `tests/coaching/video-reco/flags.test.js:38:63e25da7`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/video-reco/CLAUDE.md`? · `bot/shared/data/CLAUDE.md`? · `bot/shared/services/child-test/scoring/tasks/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/report-v2/CLAUDE.index.md`? · `bot/shared/services/coaching/video-reco/CLAUDE.index.md`? · `bot/shared/services/coaching/video-reco/CLAUDE.md`? · `bot/shared/services/nudges/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.index.md`? · `dashboard/services/CLAUDE.index.md`? · `portal/src/components/ui/CLAUDE.index.md`? · `tests/coaching/CLAUDE.index.md`? · `tests/coaching/CLAUDE.md`? · `tests/coaching/video-reco/CLAUDE.index.md`? · `tests/coaching/video-reco/CLAUDE.md`?
