# child-test — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests/child-test -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `record-sa-voice-v4-equals.test.js` | (unmapped) |
| `record-sa-voice-v4-praise.test.js` | (unmapped) |
| `record-sa-voice-v4-sounds.test.js` | (unmapped) |
| `record-sa-voice-v4.test.js` | Pins record-sa-voice.js --set v4: whole bank re-voiced per provider into sa/v4 keys with respellings and tashdeed |
| `sa-add-child.test.js` | Pins the sa_add_child switch: seating an off-roster child via draw.addChild, refusals, and no name in logs |
| `sa-all-grade-forms.test.js` | Pins coach forms for Grades 1-5 resolving coach.G<grade>.A with items shared from existing forms |
| `sa-all-grades.test.js` | Pins the sa_all_grades switch: a named grade yields that grade's list on a :g<N> day key, OFF ignores the grade |
| `sa-any-school.test.js` | Pins the sa_any_school switch: school list scope, list opening and seating at any live school, fail-closed reads |
| `sa-bank.test.js` | Pins the generated SA battery bank: official sourcing, response modes, stop rules, en+ur copy and gender-neutral lines |
| `sa-block-history.test.js` | Pins sa_block_by_history: block picked by rotation excluding blocks the visit holds and the child already took |
| `sa-device-events.test.js` | Pins round 8 device readiness events (device_ready, voice_not_ready, voice_retry) being kept; offline/online dropped |
| `sa-extra.test.js` | Pins the extra SA subtasks built from item-bank.sa-extra.v1.json: official items, placement, engine runs them |
| `sa-grade-with-visit.test.js` | Pins sa_all_grades at a school with today's observe visit: the named grade is honoured, never the visit's list |
| `sa-last-word-hint.test.js` | Pins lastWordIndex alignment, saLastWordHint and its internal route for the sa_coach_last_word suggestion |
| `sa-practice-only.test.js` | Pins child_test_practice_only: practice coaches get only is_probable_test schools, isPracticeCoach, pilot unchanged |
| `sa-r8-counts-score.test.js` | Pins round 8 sa_r8_counts scoring against the counts form the phone ran, never dropping extra items |
| `sa-r8-slice2-lines.test.js` | (unmapped) |
| `sa-rdf-w3-server.test.js` | Pins RDF auto/manual server behaviour under sa_rdf_w3_forms: accepted blocks when on, refused or not_ready when off |
| `sa-rdf-w3.test.js` | Pins the RDF auto/manual W3 form shape: task list, official items with src, one-at-a-time display, coach_text |
| `sa-rdf.test.js` | Pins the RDF short form under sa_rdf_form: block 'rdf' accepted when on, unknown when off, not_ready without rdf[] |
| `sa-reading-2.test.js` | Pins SA second passages/listening stories on game islands, English phoneme segmentation and test-word-free game lines |
| `sa-reading-3.test.js` | Pins SA English dictation as typed spelling, Urdu picture vocabulary and orientation to print on Grade 1-3 forms |
| `sa-reading.test.js` | Pins SA reading tap-option rules (one right tile per prompt, no length giveaways) and the reading extras (DESIGN 2b) |
| `sa-restart.test.js` | Pins sa_end_test_restart: restartAttempt sets aside the ended attempt's rows, moves events, refuses when off |
| `sa-results.test.js` | Pins saResults per-task output (attempted, correct, chance-corrected score, stop reason) with no names or ids |
| `sa-resume-repick.test.js` | Pins sa_resume_repick: a re-sent present with repick moves an unfinished session to the coach's block |
| `sa-review-store.test.js` | Pins the review store (V1.7.4 child_test_sa_item_reviews): session rows read and reviewer mark upsert |
| `sa-review.test.js` | Pins saReview read and saReviewMark write: recording links, agent marks, suspect flag, reviewer ear, admin access |
| `sa-reviewed-lines.test.js` | Pins applyReviewed: reviewer wording laid over every form, new clip keys for changed text, committed bank carries it |
| `sa-rulings.test.js` | Pins SA design rules in the bank: 18 v3 tasks, tap first-row stops at chance, spelling task, engine lines in both... |
| `sa-runtime.test.js` | Pins runtime batteries sa.<form>.<lang>.json validating in the engine (sa-core) with blocks, islands and stop rules |
| `sa-same-day-reuse.test.js` | Pins sa_all_grades reuse of today's un-graded day list when the named grade matches, else a :g<N> list |
| `sa-score-bank-retry.test.js` | Pins task_not_in_bank as a backoff retry (1,2,4 min, max 1h, fail after 24h) so build skew self-heals |
| `sa-score-defects.test.js` | Pins two scorer defects: late EN comprehension clips scored while coach waits, and no-speech clips never correct |
| `sa-score-echo.test.js` | Pins the speech gate rejecting comprehension answers the child never gave when STT hears a stray word |
| `sa-score-last-word.test.js` | Pins scoring words attempted from the recording with the coach's last word as cross-check (sa_coach_last_word) |
| `sa-score-second-voice.test.js` | Pins CHILD_TEST_SA_SECOND_VOICE: a second voice in a clip is flagged on marks and in Results |
| `sa-score-section.test.js` | Pins sa_section_recording: one recording per oral task cut into per-item stretches from the phone's rec_marks |
| `sa-score-stale-claim.test.js` | Pins per-process claim tokens and takeover of claims older than 2 min or left by a restart |
| `sa-score-sweep-claims.test.js` | Pins per-sweep claim tokens, timed-out sweeps giving up only their own claims, and the MAX_INFLIGHT cap |
| `sa-score-timeouts.test.js` | Pins bounded outbound calls and the 90s sweep deadline so the SA scorer cannot be pinned by a hung call |
| `sa-score-variant-wait.test.js` | Pins sa_r8_variant_wait: passages wait for the questions row naming the shown variant instead of a hash guess |
| `sa-score.test.js` | Pins the SA scorer (CHILD_TEST_SA_SCORER): claim, score against the shown passage, write marks, W3 forms, saRegister... |
| `sa-sessions-dash-filters.test.js` | Pins saSessions under sa_dash_filters: mode, block, coach, start, stops and stopSessions fields |
| `sa-sessions-dash-origin.test.js` | Pins saSessions origin (added vs drawn) and incomplete_move_on stop under sa_dash_filters |
| `sa-sessions-practice-r8.test.js` | Pins round 8 saSessions practice-school flag and coach-name guard switches |
| `sa-sessions.test.js` | Pins saSessions: every SA session per coach or admin in Results shape with school and sub-region, no child identifiers |
| `sa-stop-rules-gates.test.js` | Pins RWP comprehension and multiplication gates and RDF no-stop flags under sa_stop_rules (panel RULING G-12) |
| `sa-stop-rules-ready.test.js` | Pins the sa_stop_rules deadlock fix: passage map holds only passages and no row waits on itself |
| `sa-stop-rules.test.js` | Pins EGRA first-row rule for W3 grids and skipping comprehension after a stopped passage (sa_stop_rules) |
| `sa-tester-fixes.test.js` | Pins external tester fixes A08/A11/A13/A14: no language mixing, maths practice, picture patterns, RDF short form |
| `sa-voice-sustained-sounds.test.js` | Pins letter-sound clips saying each sound once (continuants held) using ffmpeg silencedetect on served clips |
| `sa-voice-tashdeed.test.js` | Pins sa_voice_tashdeed: voice gets shadda-marked Urdu lines while screen text and clip keys stay as written |
| `sa-voice.test.js` | Pins the SA voice manifest naming each clip once and record-sa-voice voicing only missing clips under a spend cap |
| `sa-w2-story-lines.test.js` | Pins one-sentence-per-line Wave 2 passages on every variant, print_lines, needs_line and first-sentence stop (W3-12) |
| `store-draw-origins.test.js` | Pins getSessionDrawOrigins: draw algo_version and seed_digest per session id, 100 per read |
| `store-list-students-batched.test.js` | Pins listStudents batching so a school with hundreds of children no longer dies on a long .in() URL |
| `store-sa-sessions.test.js` | Pins store reads for the dashboard: listSaSessions, listBlocksForSessions, getSchoolsByIds query shapes |
| `store-user-names.test.js` | Pins getUserNamesByIds reading coach names 100 ids at a time, failures as ok:false |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/child-test/CLAUDE.md`? · `bot/shared/data/child-test/CLAUDE.md`? · `bot/shared/services/child-test/app/CLAUDE.md`? · `bot/shared/services/child-test/sa/CLAUDE.md`? · `bot/shared/services/child-test/scoring/CLAUDE.md`? · `bot/shared/services/settings/CLAUDE.md`? · `bot/tests/CLAUDE.md`?
