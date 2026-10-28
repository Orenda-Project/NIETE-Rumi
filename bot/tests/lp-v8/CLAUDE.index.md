# lp-v8 — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests/lp-v8 -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `ab-ch310.test.js` | Pins the ICT G1-5 ch3-10 lesson-plan A/B: group A gets the v8 PDF, B the v9 render, by school (bd-5o0ay.10.1) |
| `backfill-lp-asset-sources.test.js` | Pins backfill-lp-asset-sources: only a matrix row whose link names the served asset's hash is imported (PLAN R8 2.2) |
| `bd-eb1ec-context-language-pin.test.js` | Pins the lesson context message names the reply language so an Urdu lesson block cannot flip an English reply (bd-eb1ec) |
| `bd-hgwfo-gamma-door.test.js` | Pins that 'make me a lesson plan' opens the browse Flow, not the not-in-catalog reply (bd-hgwfo, bd-jnfbd) |
| `bd-k3ry8-pupil-says-label.test.js` | Pins the lp-v9 mistakes-box label covering spoken and written answers in English and Urdu (bd-k3ry8) |
| `bd-lp-writeout-max-tokens.test.js` | Pins a lesson block riding with the turn raises text max_tokens to at least 1000; voice limit unchanged (bd-lp-writeout) |
| `bd-oak77-cutover-inflight.test.js` | Pins cutover for an in-flight Gamma job: drained and failed, teacher handed menu with a user-id flow token (bd-oak77.4) |
| `bd-oak77-endpoint-route-all.test.js` | Pins that the LP Flow endpoint with LP_612_ROUTE_ALL stops falling back to the old Oxbridge picker (bd-oak77.4 LEAK 2) |
| `bd-oak77-route-all.test.js` | Pins LP_612_ROUTE_ALL/ROUTE_K5 flags: default off, only narrow, old 6-12 picker unreachable from free text (bd-oak77.4) |
| `bd-psa3u-urdu-badges.test.js` | Pins that Urdu lp-v9 lesson plans use Urdu digits and letters for section badges and the board-order list (bd-psa3u) |
| `bd-wpupy-context-position.test.js` | Pins the lesson context rides as its own message right before the teacher's turn, not in the system prompt (bd-wpupy) |
| `bd-wpupy-delivery-marker.test.js` | Pins delivery marker: one assistant row per lesson delivery, no lesson content, deduped within window (bd-wpupy F5) |
| `bd-wpupy-followup-context.test.js` | Pins a deictic 'this' in a follow-up reaches the lesson just delivered, using the real production failures (bd-wpupy) |
| `bd-wssa3-no-lp-keyword-nudge.test.js` | Pins that the feature-intro keyword nudge no longer fires on 'lesson plan' (detectAndOfferVideo scorer) (bd-wssa3) |
| `catalog-builder.test.js` | Tests LP catalog builder: pure normalisation to Meta NavigationList caps, dedupeTopic and merging (FEAT-059, bd-82qs3) |
| `delivery.test.js` | Tests deliverV8Lesson: presigned R2 URL, sent/failed rows, filename; Supabase, R2, WhatsApp mocked (bd-2054, bd-2407) |
| `elective-catalog-merge.test.js` | Pins that G1-5 electives (Islamiat etc.) merge into lp_catalog.json without changing the core books (bd-6640j.1.8) |
| `elective-menu-names.test.js` | Pins elective menu names per medium (Urdu vs English), unique subject keys and 30-code-point title cap (bd-6640j.1.3) |
| `elevenlabs-key-fallback.test.js` | Pins ElevenLabs key-level fallback: retry on the global key only on quota exhaustion, never on a 429 (bd-errbx) |
| `endpoint-dispatch.test.js` | Tests Pakistan LP endpoint dispatch: INIT grade picker, v8 grades 1-5 path, Oxbridge 6-10 unchanged (FEAT-059, bd-fg3p4) |
| `endpoint-items.test.js` | Tests v8 NavigationList item builders: caps, tick marks, pagination, hiding subjects with nothing available (bd-fg3p4) |
| `flow-json.test.js` | Structural test of pakistan-lp-flow-v3.json: version, six screens, forward-only routing, Meta caps (bd-m3gre) |
| `flow-response-telemetry.test.js` | Pins lp612.flow.response telemetry: each data_exchange, INIT, BACK logs outcome, items, bytes, duration (bd-oak77.26) |
| `history-cache-hygiene.test.js` | Pins that the conversation-history cache never carries system prompts or flushed feature context (bd-njn7u Phase 2.0) |
| `ingest-lp-v9-html.test.js` | Pins ingest-lp-v9-html: an HTML is ingested only when its PDF sha1 matches a served asset, never overwriting a script |
| `live-schema-limits.test.js` | Pins PostgREST db-max-rows 1000 limit: availableLessonIds and downloadedLessonIds page through whole corpus (FEAT-059) |
| `lp-coaching-ask-worker-wiring.test.js` | Pins that the coaching_after_lp handler is registered on the sweeping main-queue worker only, not video workers |
| `lp-context-app-opens.test.js` | Pins that chat grounding includes lessons a teacher opened only in the app viewer (niete_lp_opens), narrow and capped |
| `lp-context-builder.test.js` | Tests buildLpContext: identity line plus full block, by delivered content_hash, in lesson_reference (bd-njn7u Phase 2) |
| `lp-context-gate.test.js` | Tests Tier-B gate: detectIntent treats questions about a received lesson as general, asks for lp_ref (bd-njn7u 3) |
| `lp-intent.test.js` | Pins LP keyword intercept as a receptionist: only a bare artefact name fires, anything longer goes to LLM (bd-hgwfo) |
| `lp-shelf-flush-points.test.js` | Pins menu tap, coaching, video and attendance flushing the LP shelf; failures never block (bd-njn7u 1.3) |
| `lp-shelf-plumbing.test.js` | Pins lp-shelf wiring: deliverV8Lesson pushes an exact-version entry; failures never break delivery (bd-njn7u 1) |
| `menu-entry.test.js` | Pins that /menu Lesson Plans opens the same LP Flow as the keyword intercept with a user-id-first token (bd-72dth) |
| `migration-018.test.js` | Static shape guard on migration 018 (niete_lp_assets, niete_lp_downloads): idempotent IF NOT EXISTS DDL (bd-t56hp) |
| `migration-v158-ab-assignment.test.js` | Static guard on migration V1.5.8 niete_lp_ab_assignment: re-runnable, non-destructive, group is A or B (bd-5o0ay.10.2) |
| `migration-v168-niete-lp-taken.test.js` | Static guard on migration V1.6.8 niete_lp_taken view: one 'took a lesson' definition, RLS-respecting (bd-2wgr3d.22.2) |
| `portal-subject-order.test.js` | Pins that the portal subject list uses the same core-then-electives order as the WhatsApp menu (bd-6640j.1.8.8) |
| `publish-script.test.js` | Pins publish-pakistan-lp-flow.py defaults to the Flow JSON the endpoint serves and allows a rollback path (FEAT-059) |
| `religious-reverence.test.js` | Pins that religious reverence rules ride every conversational prompt: no impersonation, finality, honorifics per figure |
| `sara-voice-delta.test.js` | Pins Sara voice delta: honorific marks banned from payload text, spoken phrases gendered, ligature ok (bd-njn7u 4) |
| `subject-menu-order.test.js` | Pins buildSubjectItems order: core books first, then electives, books with nothing available omitted (bd-6640j.1.8.7) |
| `tick-app-opens.test.js` | Pins that the lesson tick counts lessons opened in the teacher app for both the Flow list and the app list |
| `unsupported-message.test.js` | Pins unsupported-message contract: reactions silent, video gets contextual line, gender-neutral fallback (bd-fbih0) |
| `upload-writes-slide-script.test.js` | Pins that the uploader writes the slide script with the same asset row and hash in one run (PLAN R8 2.2 lane S) |
| `uploader-card-kind.test.js` | Pins uploader --kind card: v10 coaching cards become their own asset kind, own R2 key, no answer key (bd-v0toag.50.1) |
| `uploader-r2-only.test.js` | Pins uploader --r2-only: uploads bytes and prepares superseding SQL without writing rows before migration 018 (FEAT-059) |
| `uploader-resumable.test.js` | Pins the uploader's PDF compression is byte-deterministic so re-runs after interruption give the same sha1 (FEAT-059) |
| `uploader.test.js` | Tests the v8 uploader: lp-cache/v8 R2 key shape, idempotency, old-cache guard (FEAT-059, bd-9s1ie, bd-9dmq2) |
| `voice-reply-quality.test.js` | Pins the Urdu LP Q&A voice prompt: no mandated filler words, no male first person, feminine self-reference (bd-z5olm) |
| `voicenote-delivery.test.js` | Pins v8 voicenote delivery after the PDF as an .ogg voice message and the survey only when audio arrived (bd-vw0aj) |
| `voicenote-survey.test.js` | Pins the voicenote survey: thumbs-up asks whether the teacher taught it, silent with no voice note (bd-vw0aj) |

## Who reads this (all, generated)
- env `ELEVENLABS_API_KEY` read at `bot/tests/lp-v8/voice-reply-quality.test.js:27:6b9b8a4e`
- env `LP_SEGMENTATION_DIR` read at `bot/tests/lp-v8/catalog-builder.test.js:408:44438fa6`
- env `LP_TOC_DIR` read at `bot/tests/lp-v8/catalog-builder.test.js:409:55bd7564`
- env `LP_V8_MANIFEST` read at `bot/tests/lp-v8/catalog-builder.test.js:368:5bc340e0`
- env `LP_V8_SAMPLE_PDF` read at `bot/tests/lp-v8/uploader-resumable.test.js:49:179c48d2` · `bot/tests/lp-v8/uploader.test.js:177:63251145`
- env `OPENAI_API_KEY` read at `bot/tests/lp-v8/elevenlabs-key-fallback.test.js:27:e5dc7491` · `bot/tests/lp-v8/lp-coaching-ask-worker-wiring.test.js:12:acce1dae` · `bot/tests/lp-v8/voice-reply-quality.test.js:28:e5dc7491`
- env `OPENROUTER_API_KEY` read at `bot/tests/lp-v8/lp-coaching-ask-worker-wiring.test.js:11:1370b6dc` · `bot/tests/lp-v8/lp-shelf-flush-points.test.js:21:f4d0ab1b`
- env `PAKISTAN_LP_FLOW_ID` read at `bot/tests/lp-v8/menu-entry.test.js:66:edfff9ee`
- env `PHONE_NUMBER_ID` read at `bot/tests/lp-v8/voice-reply-quality.test.js:30:988fd1ac`
- env `TEACHER_NUDGES_ENABLED` read at `bot/tests/lp-v8/lp-coaching-ask-worker-wiring.test.js:102:2808cd9c`
- env `WHATSAPP_TOKEN` read at `bot/tests/lp-v8/voice-reply-quality.test.js:29:da42c668`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/CLAUDE.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/nudges/CLAUDE.index.md`? · `bot/shared/services/nudges/CLAUDE.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/services/video/CLAUDE.index.md`? · `bot/shared/services/video/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? · `bot/tests/lp-v8/CLAUDE.index.md`? · `bot/tests/lp-v8/CLAUDE.md`? · `bot/vendor/lp-v9/lib/CLAUDE.index.md`? · `bot/vendor/lp-v9/lib/CLAUDE.md`? · `bot/workers/CLAUDE.index.md`? · `bot/workers/CLAUDE.md`? · `docs/flows/CLAUDE.index.md`? · `docs/flows/CLAUDE.md`?
