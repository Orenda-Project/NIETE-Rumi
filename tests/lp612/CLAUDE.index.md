# lp612 — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/lp612 -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__fixtures__/` | → (no door; 7 files: 0 test + 7 support) |
| `helpers/` | Shared harnesses and doubles for the lp612 E2E and unit suites → `helpers/CLAUDE.md` |
| `atom-unknown-element.test.js` | bd-8lifl: pins the diagram engine raising ATOM_UNKNOWN_ELEMENT for an unknown atom instead of drawing hydrogen |
| `author-advisory-prompt.test.js` | bd-owx8t: pins that revision prompts in lp612-author.service carry only blocking defects, not advisory BUDGET lines |
| `author-brief-gender-neutral.test.js` | bd-oak77.32: pins author brief v3 requiring gender-neutral unnamed characters in worked scenarios |
| `author-ladder-stop.test.js` | bd-wbvtb: pins the authoring revision ladder stopping when only non-blocking BUDGET defects remain (zero rounds) |
| `author-religious-marks-blocking.test.js` | Pins RELIGIOUS_MARKS as a blocking defect: a lesson missing an honorific is refused by the ladder, never delivered |
| `author-render-gate.test.js` | Pins the render gate (page-count overflow) running inside the author revision ladder and triggering a revision round |
| `author-schema-tier.test.js` | bd-jddcu: pins the author ladder never preferring a schema-invalid candidate over one that passed schema |
| `author-worker.test.js` | Pins lp612-author.worker end to end: author, render, store, deliver to every waiter, plus the failure paths |
| `author.test.js` | Pins lp612-author.service (port of author_lp.py): model resolution, revision ladder and prompts, with llm-client doubled |
| `bd-3emr5-diagram-latex.test.js` | bd-3emr5: pins diagram.spec text rendering maths as Unicode, never raw TeX, in the PDF panels |
| `bd-lafr9-onescreen-latex.test.js` | bd-lafr9: pins lp612-serving buildBody never putting TeX source in the WhatsApp one-screen body |
| `bd-oak77-11-checkpoint.test.js` | bd-oak77.11: pins the author worker writing a checkpoint of each ladder candidate so a crash costs one round |
| `bd-oak77-11-reaper-checkpoint.test.js` | bd-oak77.11: pins isStrandedAuthoring treating a fresh checkpoint as a living owner, not a stranded row |
| `bd-oak77-11-resume.test.js` | bd-oak77.11: pins author resumeFrom skipping the initial LLM call when a deliverable checkpoint exists |
| `bidi-caps.test.js` | Pins the vendored 6-12 renderer's bidi pass and language-aware page caps for Urdu and English |
| `book-crop-legibility.test.js` | bd-8lifl: pins the template's book-crop image clamp being no tighter than the diagram slot height |
| `book-figure-counts.test.js` | bd-8lifl: pins the author brief's textbook-figure rules (4b.1 vs 4b.4) not contradicting each other |
| `brief-field-coverage.test.js` | bd-8lifl: reverse drift guard that every field the diagram engine reads is documented in the author brief |
| `caption-subject-language.test.js` | bd-63dea: pins the Urdu delivery caption carrying an Urdu subject name in lp612-serving |
| `catalog-grades-cap.test.js` | Pins lp612-catalog buildGradeItems not depending on a full-table scan past PostgREST max-rows |
| `catalog-long-names.test.js` | bd-3uiev: pins long chapter/subtopic names not losing information (chapter number leads, no ellipsis) in menu rows |
| `catalog-row-consistency.test.js` | bd-tnvpg: pins one menu row shape for every chapter: name on the same line whether short or long |
| `catalog-rowcap.test.js` | bd-oak77.27: pins that no lp612 catalogue read depends on row count (PostgREST max-rows truncates silently) |
| `catalog-urdu-furniture.test.js` | bd-t8mbl: pins Urdu chapter/subtopic menu rows using Urdu nouns (اسباق) with Urdu digits |
| `catalog-urdu-subject-row.test.js` | Pins the subject menu row of an Urdu subject counting chapters in Urdu (ابواب) |
| `catalog.test.js` | Pins the 6-12 menu grade->subject->chapter->subtopic in lp612-catalog, incl. religious hold applied at the query |
| `chapter-book-collision.test.js` | bd-oak77.5: pins chapter rows keyed by book so colliding chapter_keys across books are not merged |
| `chapter-pagination.test.js` | Pins the chapter screen paginating with a More row so no chapter is unreachable |
| `context-one-screen.test.js` | Pins a 6-12 shelf entry's one-screen summary being rendered into the prompt block by lp-context.service |
| `continuous-lib.test.js` | bd-f01ob: pins lib/continuous.js usableSizes contract for the joined two-page print |
| `continuous-two-page-pdf.test.js` | bd-f01ob: pins the printed 6-12 file being two pages, teaching then teacher support |
| `cost-names-the-lesson.test.js` | bd-b0qwk.6: pins model-call cost events for writing a 6-12 lesson naming its render and segment |
| `degraded-copy.test.js` | bd-oak77.14: pins teacher-facing copy for an imperfect or missing 6-12 lesson naming the actual state (rule 24d) |
| `delivery-context.test.js` | Pins deliverRender leaving conversation state, a shelf entry and a download row so the chat can see a 6-12 lesson |
| `delivery-honesty.test.js` | bd-m1xyt: pins a falsy sendDocumentByLink result counting as a failed 6-12 delivery, never as delivered |
| `delivery-ledger.test.js` | Pins each received 6-12 lesson writing a durable niete_lp612_deliveries row (who, which render); none on failed send |
| `diagram-label-floor.test.js` | bd-oak77.15: pins the diagram label floor as one 14px constant across the vendored diagram engine |
| `diagram-roster.test.js` | Pins the vendored diagram roster matching its manifest, asserted on the serving copy |
| `diagram-solid-bar-thermo.test.js` | bd-yggj4o.2: pins the vendored engine rendering solid (3-D shape), bar and thermometer diagram types |
| `direct-lane-native.test.js` | bd-oak77.29: pins the direct Anthropic lane on the official SDK: payload translation, caching, cost, credit fallback |
| `edit-intent.test.js` | Pins the lp612 edit-intent scope classifier (free path with no model call, then model path) for follow-up edit replies |
| `edit-keys.test.js` | Pins the storage key for an edited 6-12 lesson: a per-user fork under lp612/ prefix, never the shared render key |
| `edit-router-new-request.test.js` | bd-1r3k2h: pins a new-lesson-plan request sent while a 6-12 lesson is on the shelf classed new_request, not an edit |
| `edit-router.test.js` | Pins lp612-edit-router: whether a reply is about the shelf lesson and what is owed (nothing sent if no shelf entry) |
| `endpoint-flow-ack.test.js` | bd-2ym0h: pins the Flow SUCCESS screen text via real pakistan-lp-endpoint dispatch; no 'a moment' promise |
| `endpoint-rowcap.test.js` | bd-oak77.27: pins pakistan-lp-endpoint's own reads (fetchOxbridgeRows) not depending on row count |
| `endpoint.test.js` | Pins the 6-12 lane inside the Pakistan LP Flow endpoint: LP_612_ENABLED off changes nothing; grade 9 still Oxbridge |
| `erq-heading-teacher-words.test.js` | bd-a8veu.17: pins the long-question section heading worded for teachers, in both languages (template, overlay) |
| `export-segments.test.js` | bd-a8veu.24: pins export-lp612-segments / import-lp612-segments round trip as a fixed point for video-pick refresh |
| `family-author-wiring.test.js` | bd-u6za9: pins subject-family model and flash brief reaching the real authorLessonPlan call (physics on pilot model) |
| `family-model-routing.test.js` | bd-u6za9: pins pure per-family author-model routing helpers and the three-family set ported from the bake-off |
| `family-worker-wiring.test.js` | bd-u6za9: pins lp612-author.worker resolving the author model per subject family, the only production caller |
| `fbise-section-ssc-only.test.js` | bd-a8veu.18: pins the FBISE-format questions section printed for SSC grades only; support index closes up for 6-8 |
| `fbise-slo-chips.test.js` | bd-f01ob: pins each FBISE SLO showing its own Summative/Formative chip in the outcome box (template, validate, overlay) |
| `feedback.test.js` | bd-86ivw: pins a delivered 6-12 lesson scheduling a teacher feedback prompt from deliverRender, with its handling |
| `figure-notes-additive.test.js` | bd-17mht: pins apply-lp612-figure-notes appending the figure directive to existing segment notes, never overwriting |
| `figure-repair-telemetry.test.js` | bd-oak77.14: pins lp612.render.figure_repaired event emitted when a render had to widen a figure (lp612-render) |
| `figure-upload-keys.test.js` | bd-17mht: pins figure uploads only writing under the lp612/ prefix of the shared R2 bucket |
| `figure-widen-repair.test.js` | bd-oak77.14: reproduces the first Urdu-tap incident: a figure missing the label floor is widened, not reported (fixture) |
| `flags.test.js` | Pins lp612-flags: LP_612_ENABLED off by default, LP_612_RELIGIOUS_ENABLED a separate flag not reachable from it |
| `flow-placement.test.js` | bd-a8veu.10: pins common mistakes and differentiation rendering inline in the lesson flow, not in Reference |
| `flow-v31-asset.test.js` | Pins the pakistan-lp-flow v3.1 asset: both lesson screens can route to SELECT_LANGUAGE |
| `footer-page-ref-visible.test.js` | bd-5o0ay.10.38: pins the footer page reference in its own run after the chapter so ellipsis cannot eat it |
| `golden-path-races.test.js` | Pins lp612-serving under concurrency: lost insert race reads the append answer, finished winner serves the waiter |
| `graph-axes.test.js` | bd-gel97: pins GRAPH_AXES lint (both axes named) and graph points agreeing with their curve in diagrams |
| `grid-cell-text-overlap.test.js` | bd-dmttc: pins grid diagram cell text not overprinting itself, on the page-2 board figure case |
| `handler-wiring.test.js` | Pins the 6-12 follow-up edit router actually called and obeyed by text-message.handler (executed, not grepped) |
| `honest-eta.test.js` | bd-2ym0h: pins no interstitial promising two minutes; the wait estimate is one constant in ux-strings |
| `import-salutation-carried.test.js` | bd-d6c8y: pins import-lp612-segments carrying the book's salutation into menu rows naming the Prophet |
| `import.test.js` | Pins import-lp612-segments loading the segmentation corpus idempotently, computing is_religious at import |
| `key-words-not-a-pill.test.js` | bd-3wjme: pins a key-word entry not rendered as a pill (radius wrong beyond one line) in the template |
| `labelact.test.js` | Pins LABELACT lint: a board draw_order line must open with an imperative verb, not just name what is there |
| `language-menu.test.js` | Pins the final language step (Urdu/English) under LP_612_LANG_MENU: off serves stored preference immediately |
| `language-serving.test.js` | Pins lp612-serving's two language territories: document lang frozen into job/R2 key vs UI-language acks and caption |
| `language-worker.test.js` | Pins the worker's overlay_dropped persistence for an Urdu render of an English-medium book lacking its overlay |
| `latin-honorific-normalise.test.js` | bd-b7txa: unit pins lp612-latin-honorific normaliser for Latin-script honorific shapes the corpus prints |
| `lp-design-review.test.js` | bd-a8veu.1-.11: pins PDF design-review items as document properties (e.g. question row uses whole measure) |
| `missing-column-guard.test.js` | bd-oak77.14: pins the author worker's row patch retrying without a column the DB lacks (PGRST204) so lesson still ships |
| `molecule-formula-prose.test.js` | bd-oak77.24: pins lint blocking a molecule spec with prose in its formula slot |
| `nastaliq-ltr-metrics.test.js` | bd-b8ypq: pins Nastaliq line-box metrics applied to Urdu runs on English pages |
| `never-fail-delivery.test.js` | bd-oak77.14: pins the worker delivering a damaged-but-whole lesson (figure and page-count defects), never failing it |
| `numberline-label-overlap.test.js` | bd-fa86m: pins number-line diagram labels not overlapping, on the page-3 sentence-length-label figure |
| `objective-chip-numbering.test.js` | bd-oak77.32: pins duplicate placeholder objective codes sanitised so Urdu chips read O1/O2/O3 |
| `one-screen-format.test.js` | bd-uu4lr: pins the shape of the WhatsApp one_screen message sent before the PDF |
| `one-screen-reuse-gate.test.js` | bd-jpfww: pins a stored document whose one_screen has no shape being refused for reuse and re-authored |
| `outcome-one-voice-render.test.js` | bd-a8veu.14: pins the template's outcome box printing one statement of the outcome, not three |
| `outcome-voice.test.js` | bd-a8veu.3: pins OUTCOME_VOICE lint: every authored line of the outcome box addresses the pupil in one voice |
| `over-cap-delivery.test.js` | bd-vjk68: pins the author worker delivering an over-cap (too many pages) lesson instead of failing it |
| `over-time-delivery.test.js` | bd-0cdug: pins AUTHOR_TIMEOUT delivering the best clean-rendered document already in hand |
| `overflow-absorb.test.js` | bd-c3le6: pins absorbPlan telling reclaimable page-bottom furniture overflow from real clipping in lp612-render |
| `overlay-backfill-driver.test.js` | bd-vrt20: pins the overlay-backfill driver entry point: no flags is an inventory, uploads nothing, patches no row |
| `overlay-backfill-over-cap.e2e.test.js` | bd-0t9ce: e2e: an over-cap lesson is repaired in place by the overlay backfill and served in Urdu |
| `overlay-backfill-over-cap.test.js` | bd-0t9ce: pins overlay repairRow not being stricter than delivery: over-cap renders are written back |
| `overlay-backfill.e2e.test.js` | bd-idneu: e2e of overlay corpus driver writing repaired docs back to the cache; default run writes nothing |
| `overlay-backfill.test.js` | bd-idneu: unit pins where an overlay repair may land (the row's own r2 key) in the backfill driver |
| `overlay-chrome-reuse-gate.test.js` | bd-yhd16/bd-idneu: pins a stored Urdu doc lacking a title overlay being refused for reuse and re-authored |
| `overlay-chrome-reuse.e2e.test.js` | bd-yhd16/bd-idneu: e2e that an Urdu tap delivers a lesson titled in Urdu; cached doc keeps the overlay |
| `overlay-contract.test.js` | bd-vnyuw: pins the LANGUAGE directive no longer contradicting the brief for an EN-medium book asked for in Urdu |
| `overlay-deferred.test.js` | bd-zle0u step 1: pins the Urdu overlay deferred out of the revision ladder (author English, emit no inline overlay) |
| `overlay-machine-fields.test.js` | bd-oak77.23: pins overlayTargets excluding every renderer-parsed field so Urdu overlay cannot write into them |
| `overlay-pass-worker.test.js` | bd-zle0u step 2: pins the worker running the separate Urdu overlay pass after acceptance, falling back to English |
| `overlay-pass.test.js` | bd-zle0u step 2: pins overlayLessonPlan as one model call on the finished document (lp612-author.service) |
| `overlay-sanitize.test.js` | Pins ur_overlay repair before the schema wall: an array overlay is dropped, shape that failed on staging |
| `overlay-telemetry.test.js` | bd-vnyuw: pins the worker emitting lp612.overlay.* events (rate, deferred), not only the overlay_dropped column |
| `overlay-topup-religious-gate.e2e.test.js` | E2E: the overlay top-up repair lane may not publish uncleared religious Urdu to R2 or the renders row |
| `overlay-topup-religious-gate.test.js` | Pins GATE 3: overlay may not publish religious content lacking honorifics; refused like authoring's G5c hold |
| `overlay-topup-urdu-gate.e2e.test.js` | bd-htw51/bd-idneu: e2e that a correctly translated provenance top-up is repaired, not refused for low Urdu share |
| `overlay-topup-urdu-gate.test.js` | bd-htw51: pins the overlay Urdu gate judging the whole page it lands in, not just the small patch |
| `overlay-topup.e2e.test.js` | bd-idneu: e2e of the overlay top-up: exactly one model call carrying only the missing pointers, real linter/renderer |
| `overlay-topup.test.js` | bd-idneu: pins lp612-overlay-topup deriving the delta of missing overlay pointers rather than re-authoring |
| `overlay-urdu-chrome.test.js` | bd-x3dn6/bd-8g1u7: pins which provenance fields (title, chapter) the Urdu overlay can translate, gated per field |
| `overlay-urdu-gate.test.js` | bd-y478d: pins OVERLAY_MIN_URDU gate measuring a glossed Urdu delta as a translation, not an English page |
| `page-cap-policy.test.js` | bd-vjk68: pins page-cap policy: English teach 4/support 3 hard caps plus an unreadable-length ceiling in render_lp |
| `page-cap.test.js` | Pins the documented 25-page hard cap enforced by lp612-pagetruth/author (brief_segment_v2) |
| `page-count-advice.test.js` | bd-a8veu.1: pins the page-count defect text saying how many pages over and which part, from the real packer |
| `page-count-part.test.js` | bd-a8veu.13: pins the page-count repair instruction naming the over-cap part (teach vs support) and its containers |
| `page-furniture-trim.test.js` | Pins the page footer printing no author-run version date and taking minimal space in the template |
| `page-packer.test.js` | bd-vvcna: pins the exact lp-v9 page packer (packAtoms) beating greedy first-fit page counts |
| `page-target-ladder.test.js` | bd-a8veu.22: pins a soft page-target breach buying exactly one revision round in the author ladder |
| `page-truth-upload.test.js` | Pins upload-lp612-page-truth key layout lp612/page-truth/<book_stem>/<file> that the author reads |
| `page1-blocks.test.js` | bd-a8veu.16: pins page 1 materials, pacing and key words each as their own filled block |
| `page1-internal-tag.test.js` | bd-ydz6z: pins the internal lp_type enum never appearing in rendered page-1 HTML |
| `page2-answer-keys-optional.test.js` | bd-s19g8: pins page2.model_answers and homework_key as optional sections on the support page |
| `page2-exam-bank-optional.test.js` | bd-x0pw1: pins the exam bank section's optional semantics (prints under the stated conditions, not default-off) |
| `page2-next-period-removed.test.js` | bd-a8veu.20: pins the support page no longer carrying Next period / Not going today; reference order for grade 6 |
| `pagetruth.test.js` | Pins lp612-pagetruth.service fetchPages (ported retrieve.py): local-dir and R2 sources return book, toc, pages |
| `phone-page.test.js` | bd-oak77.16: pins the v9.3 phone-first page: body font size at/above the arm's-length reading floor |
| `pickup-and-recovery.test.js` | bd-dr216/bd-7yxsu: pins the author worker stamping picked_up_at before authoring so the reaper can measure staleness |
| `portal-browse.test.js` | Pins lp612-browse.service: 6-12 corpus in browser-renderable shape, religious hold enforced in the query |
| `portal-claim.test.js` | bd-5rz1v.21: pins every portal teacher asking for a ready 6-12 lesson being able to open it, not just the first asker |
| `portal-surface.test.js` | Pins requestLesson serving a surface with no phone number (portal) while WhatsApp behaviour stays unchanged |
| `postgrest-paged.test.js` | bd-oak77.27: pins pagedRows, the single pager that reads a whole PostgREST result set (one trip if under a page) |
| `prompt-caching.test.js` | bd-w65g9: pins Anthropic prompt caching on the author ladder: flag OFF leaves plain strings, ON adds cache_control |
| `prompt-fingerprint.test.js` | bd-5w13w: pins buildRevisionPrompt byte-identical for the same inputs and the lp612.author.prompt_reissued event |
| `python-dict-repair.test.js` | Pins the author's rescue of a reply returned as a Python dict (single quotes) into parseable JSON |
| `quranic-annotation-marks.test.js` | bd-ihole: pins Quranic annotation marks having a glyph in the embedded font; ayah text prints unbroken |
| `r2-prefix-guard.test.js` | Pins that nothing the lp612 lane writes to the shared R2 bucket leaves the lp612/ prefix |
| `ray-diagram-plane-mirror.test.js` | Pins ray_diagram manifest accepting a plane mirror (lints clean) without silently allowing a curved one |
| `readability-blocks.test.js` | bd-a8veu.11: pins colour-block section bands and type hierarchy tokens in the 6-12 template |
| `redundant.test.js` | Pins REDUNDANT lint (render-law 23): a legend that exactly repeats its caption fails |
| `reference-header.test.js` | bd-a8veu.9: pins the Reference page header as a running head within three line boxes, pill in the meta line |
| `religious-facts.test.js` | bd-nnd27p: pins religious_facts lint (e.g. muqatta'at letters used as a surah name fails, naming the surahs) |
| `religious-marks-cleared-names-en-realfile.test.js` | bd-5t71f: pins the shipped g5c_cleared_names_en.json (real file, not a mock) is a decided, non-empty list |
| `religious-marks-cleared-names-en.e2e.test.js` | bd-5t71f: e2e that a cleared Latin name reaches the teacher in round 0 without a demanded honorific |
| `religious-marks-cleared-names-en.test.js` | bd-5t71f: pins a review-cleared Latin name no longer blocking delivery in the RELIGIOUS_MARKS gate (mocked list) |
| `religious-marks-cleared-names.e2e.test.js` | bd-zipoe: e2e that a cleared Urdu given name reaches the teacher lint-clean in round 0 |
| `religious-marks-cleared-names.test.js` | bd-zipoe: pins review-cleared Urdu names (e.g. a common given name) no longer demanding an honorific, shadda-tolerant |
| `religious-marks-compound-name.test.js` | bd-gyrg8: pins محمد opening another person's compound name not being treated as a mention of the Prophet |
| `religious-marks-delivery.e2e.test.js` | bd-kpqu6: e2e that a religious lesson production once refused now reaches the teacher lint-clean in zero rounds |
| `religious-marks-en-name-chain.e2e.test.js` | bd-6ld74: e2e that a chained Latin name saluted at the end of the chain reaches the teacher in round 0 |
| `religious-marks-en-name-chain.test.js` | bd-6ld74: pins the English gate reading a chained name saluted at the chain's end (grade 8 unit title) |
| `religious-marks-english-medium.test.js` | bd-b8ypq: pins the script mandate as Urdu-medium only: Latin names are correct on English-medium lessons |
| `religious-marks-english.e2e.test.js` | bd-xo6mb/bd-c61xh: e2e of the English-medium rulings: chained name on one salutation reaches the teacher |
| `religious-marks-english.test.js` | Pins RELIGIOUS_MARKS English lane: name keeps the book's Latin spelling and our salutation is carried |
| `religious-marks-false-positives.test.js` | bd-kpqu6: pins RELIGIOUS_MARKS not blocking stock chapter titles/regex false positives that failed three real lessons |
| `religious-marks-latin-honorific.e2e.test.js` | bd-b7txa: e2e of accept-and-normalise: a Latin PBUH/SAW satisfies the gate and reaches the teacher |
| `religious-marks-ra-adjacency.test.js` | bd-6tfw6: pins 'RA' counting as an honorific only when adjacent to a name, not the RA value on a diagram |
| `render-concurrency.test.js` | bd-htueq: pins Chromium launches capped at LP612_RENDER_CONCURRENCY per process in lp612-render.service |
| `render-lifecycle-honesty.test.js` | bd-dr216/bd-w36m5: pins niete_lp612_renders status/error_code never lying: reap window vs SQS visibility, heartbeat |
| `render-overlay-surface.test.js` | Pins lp612-render surfacing overlayApplied (pointers the ur_overlay replaced); empty list when absent |
| `render-slow-telemetry.test.js` | bd-htueq: pins lp612.render.slow firing past 2x expected duration, separating queue wait from render time |
| `render.test.js` | Pins lp612-render.service renderLessonPlan: lp_doc to HTML to A4 PDF via vendored render_lp.js; paths, page count |
| `reuse-previous-version.test.js` | bd-oak77.12: pins bumping LP_612_TEMPLATE_VERSION reusing the previous version's stored document instead of re-authoring |
| `revise.test.js` | Pins reviseLessonPlan: one teacher instruction applied to an existing lesson with no authoring call (revision round 1) |
| `revision-reply-telemetry.test.js` | bd-oak77.19: pins describeInvalidReply logging why a patch or schema-invalid reply was rejected |
| `send-copy-logged.test.js` | bd-oak77.20: pins deliverRender logging the summary body and document caption on lp612.send.sent |
| `sequence-id-leak.test.js` | bd-w56zx: pins sanitizeSequence dropping internal segment ids from the teacher-facing sequence strip |
| `sequence-strip-paragraphs.test.js` | bd-a8veu.15: pins each leg of the sequence strip (current, next, checkpoint) as its own paragraph |
| `serve-step-ack-language.test.js` | bd-15l6c: pins the lp612_serve closing screen in the teacher's language (Urdu teacher gets Urdu ack) |
| `serving.test.js` | Pins lp612-serving requestLesson branches: cache hit sends the PDF, miss enqueues authoring, acks and failures |
| `shared-grade-book.test.js` | Pins import-lp612-segments reading a '9-10' grade span as primary grade plus others (shared chemistry practicals book) |
| `sidecar-audit.test.js` | bd-oak77.18: pins lp612-sidecar-audit finding cached lessons whose .lp.json sidecar is missing (NoSuchKey/404) |
| `spec-contract.test.js` | bd-8lifl: pins SPEC_CONTRACT lint: a required diagram spec field that is absent is named, not defaulted |
| `sqs-visibility-heartbeat.test.js` | Pins the reusable startVisibilityHeartbeat helper in isolation: rejects a missing extend function |
| `stage-figures.test.js` | bd-17mht: pins staging of textbook_figure crops referenced by a doc from R2 page-truth into the render out dir |
| `stranded-authoring.test.js` | Pins isStrandedAuthoring telling a live run from a corpse so a 'preparing' lesson is recovered after worker death |
| `stylesheet-integrity.test.js` | bd-a8veu.19: pins every rule in the emitted stylesheet having a real selector (no unclosed CSS comment swallowing rules) |
| `subject-order.test.js` | bd-y5vx3: pins the subject menu ordered core-first (English before Biology) on WhatsApp and portal browse |
| `surface-ladder.test.js` | bd-a8veu.23: pins the template's surface and label ladders: no block paints a background with its own hex literal |
| `table-block.test.js` | bd-a8veu.21: pins the table block primitive in the lp_doc schema, validator and renderer |
| `targeted-revision.test.js` | bd-ga7xz: pins LP612_TARGETED_REVISION (default off): allowed pointers and patch-only revision rounds |
| `telemetry-lane.test.js` | bd-86ivw: pins semantic lp612.tap.received events from the Flow tap (segment, language, correlation id) |
| `telemetry-stages.test.js` | bd-86ivw: pins lp612.author.completed and render events naming model, family, tier and lint outcome |
| `telemetry-worker.test.js` | bd-86ivw: pins a FAILED render row recording model_used (e.g. AUTHOR_TIMEOUT rows no longer carry NULL) |
| `tex-mixed-number.test.js` | Pins convertMath/tex-to-unicode keeping a mixed number's whole part apart from its fraction on every text path |
| `textbook-figure-ref.test.js` | bd-17mht: pins a textbook_figure carrying only a ref embedding the staged crop in the template |
| `type-scale.test.js` | bd-oak77.12: pins the v9.2 type scale: body 21px, v9.1 reference kept at 18 (niete-brand) |
| `unworded-q-catch-rate.test.js` | bd-oak77.34: pins unworded() lint catching 100% of the known-bad corpus of question strings with nothing to do |
| `urdu-board-gloss.test.js` | bd-oak77.42: pins the board block on an Urdu render of an English-medium book keeping English plus one Urdu gloss line |
| `urdu-body-font.test.js` | bd-jdtdl: pins the Nastaliq face chosen by document content, not label pack, for Urdu-medium lessons |
| `urdu-objectives-reuse-gate.test.js` | bd-oak77.40: pins a stored Urdu doc with an English objective being refused for reuse and re-authored |
| `urdu-plan-english-residue.test.js` | bd-oak77.40: pins an Urdu plan of an English-medium book printing the Urdu subject name and no English residue |
| `used-in-class-journey.test.js` | bd-b708h: pins the whole 6-12 survey as the teacher walks it, replaying taps from what was sent |
| `used-in-class.test.js` | bd-b708h: pins the 6-12 'did you use it in class?' follow-up after a thumbs-up and its used_in_class storage |
| `v6-two-page-layout.test.js` | bd-f01ob: pins the v6 two-page layout: page 1 teaches, board plan is the first lettered support section |
| `vendor-integrity.test.js` | Pins integrity of the vendored bot/vendor/lp-v9 pipeline (brief, schemas, lint, renderer) against its upstream manifest |
| `video-enhancement.test.js` | bd-a8veu.4: pins the resources line naming the video by title and not shipping a re-read as the exemplar |
| `video-resources-slot.test.js` | Pins the video link in a resources line in page-1 furniture above the first section band |
| `video-withdrawal.test.js` | bd-a8veu.12: pins import-lp612-segments clearing a withdrawn video pick instead of carrying it forward |
| `visibility-heartbeat.test.js` | bd-awqt3: pins lp612_author SQS visibility extended for the job's entire run via heartbeat in sqs-worker |
| `visual-contract-substitutive.test.js` | bd-07bhi: pins a figure replacing the prose it draws, not following it, in the visual contract lint |
| `visual-contract.test.js` | Pins the brief 4b visual contract wired into the gate of record (lint_lp, visual_check, types_manifest) |
| `visual-ladder.test.js` | Pins the revision ladder stating the visual contract before the page-count instruction (figures vs pages) |
| `waiter-stampede.test.js` | bd-phdqv: pins joining an in-flight render atomically via a database function, not a client-side array append |
| `warmtopic.test.js` | Pins WARMTOPIC lint (render-law 22): a warm-up item must be about today's lesson, not a generic icebreaker |
| `warmup-provenance-layout.test.js` | bd-oak77.31: pins a long spaced-review provenance label not squeezing the warm-up question |
| `wide-segment-blast-radius.test.js` | bd-oak77.30: blast-radius proof that LP612_WIDE_SEGMENTS on leaves ordinary segments' bytes and prompts unchanged |
| `wide-segment-delivery.test.js` | bd-oak77.30: pins wide segments (e.g. 32 printed pages) no longer refused PAGE_RANGE_TOO_LARGE when the flag is on |
| `worked-example-in-practice.test.js` | bd-4pw4y: pins lint requiring the worked example in the practice/teaching flow, not in Reference |
| `worker-queues-boot-warning.test.js` | bd-awqt3: pins resolveWorkerQueuesBootStatus reporting an unset WORKER_QUEUES as defaulted to all three queues |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/data/CLAUDE.md`? · `bot/vendor/lp-v9/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `bot/vendor/lp-v9/diagrams/CLAUDE.md`? · `bot/vendor/lp-v9/diagrams/lib/CLAUDE.md`? · `bot/vendor/lp-v9/lib/CLAUDE.md`? · `docs/lp612/video-enhancement-test.md`? · `tests/BASELINE.md`? · `tests/CLAUDE.md`?
