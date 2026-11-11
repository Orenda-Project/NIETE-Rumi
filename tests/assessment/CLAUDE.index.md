# assessment — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/assessment -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 214 files: 0 test + 214 support) |
| `helpers/` | Shared fakes and replay helpers for the assessment tests (not test files themselves) → `helpers/CLAUDE.md` |
| `topics/` | Tests for assessment topics: curriculum-matrix grouping, topic papers, topic answer key → `topics/CLAUDE.md` |
| `answer-key-marks.test.js` | Pins renderAnswerKey (assessment-paper.renderer) printing each question's marks beside its answer, comprehension too |
| `assessment-add-types.test.js` | bd-0eupi: pins portal add-question for every text-only type by layout (assessment-changes/selection/renderer) |
| `assessment-answer-key-always.test.js` | bd-bfnsk: generator Flow drops the answer-key option; every request is made with a key (endpoint, request.service) |
| `assessment-answer-key-persisted.test.js` | bd-60068: pins that the orchestrator persists the answer key's storage location on the paper row, not just a log line |
| `assessment-answers-and-lines.test.js` | bd-bfnsk AG 1.2 items 3-4: answers always requested and normalised so keys stop being dashes (generation, renderer) |
| `assessment-browse-page-past-end.test.js` | Pins listPapers treating a PostgREST past-the-end range error (PGRST103) as an empty page (assessment-browse.service) |
| `assessment-browse-service.test.js` | Portal 'My papers' browse service: what a teacher may list and download, ownership enforced, no Flow-shaped rows |
| `assessment-browse-version-tie.test.js` | bd-5ioto.11: listPapers shows a family's latest version even when versions share a created_at (browse.service) |
| `assessment-browse-versions.test.js` | Pins My papers listing one entry per paper family with its latest version and a 'Version N' suffix (browse.service) |
| `assessment-build-paper-seam.test.js` | S1: pins buildPaper (make/store a paper, no WhatsApp) as the seam split from process() delivery in the orchestrator |
| `assessment-build-version.test.js` | Pins every 'Make my paper' as a new version row naming its parent; a ready version is never rewritten (revision.service) |
| `assessment-changes.test.js` | Unit tests for assessment-changes (portal edit-change application) against assessment-selection question addressing |
| `assessment-chapter-cap.test.js` | Pins the COVERAGE screen no longer capping chapters at six, within Meta's list limits (assessment-gen-endpoint) |
| `assessment-chat-ack.test.js` | Pins generation and rebuild ending by closing the Flow with an in-chat acknowledgement, not a SUBMITTED screen |
| `assessment-content-type.test.js` | Pins that uploadExamBuffer declares the content type of the bytes it is given (PDF vs docx), not a hardcoded .docx |
| `assessment-counts-seen-and-legacy.test.js` | Pins the 'seen' path using its own Seen screen and total box, and the legacy question_count path still working |
| `assessment-delivery.test.js` | Pins that a paper is 'ready' only once actually sent, and the trim-the-paper offer (bd-60023) (orchestrator.service) |
| `assessment-docx-flag.test.js` | Pins the Word flag: confirm screen offers .docx only when on, server renders only what it offers (assessment-format) |
| `assessment-edit-button-delivery.test.js` | Pins delivery of a paper with its Edit button as one Flow message headed by the PDF, with fallback (assessment-delivery) |
| `assessment-edit-findable.test.js` | bd-q3rfn AG 1.2 item 6: review offer says what Edit does and Edit is the main button on PICK (ux-strings, endpoint) |
| `assessment-edit-flow.test.js` | Pins the edit journey KEEP -> PICK -> one screen per question -> rebuild in the assessment Flow endpoint |
| `assessment-edit-routes.test.js` | Route tests for the internal portal edit endpoints in internal-assessment-edit.routes |
| `assessment-edit-shape.test.js` | Pins shapeOf/fieldsFor: which edit screen and pre-filled fields each question shape gets (assessment-edit.js) |
| `assessment-editor-service.test.js` | Portal editor service: versions, questions, add-kinds, validate, save; gated by portal_assessment_editing_enabled |
| `assessment-flow-contract.test.js` | Pins that every data key the Flow JSON declares is one the endpoint actually sends, avoiding Meta 'Something went wrong' |
| `assessment-flow-document-header.test.js` | Pins the interactive Flow message with a document header (PDF + Edit button) built by whatsapp.service |
| `assessment-flow-entry.test.js` | Pins that a Flow opens on screens[0] and every other screen is reachable by a forward route (docs/flows JSON) |
| `assessment-format.test.js` | Pins PDF-or-Word rendering where bytes match the extension: rendererFor and the html-to-docx output is a real Word file |
| `assessment-generation.service.test.js` | Unit tests for assessment-generation.service prompt assembly (system/user prompts from ict-prompts.json) |
| `assessment-json.util.test.js` | Unit tests for repairJson/fixControlCharsInStrings: defensive parsing of fenced, truncated or malformed model JSON |
| `assessment-limit-and-errors.test.js` | Pins the 50-question ceiling and that refusals show on the screen the teacher is looking at (question-types, endpoint) |
| `assessment-marks-budget-seam.test.js` | Pins that the total-marks budget survives request service -> SQS payload -> orchestrator -> generator |
| `assessment-multi-chapter.test.js` | Pins that the COVERAGE screen lets a teacher tick several chapters and the summary line reads correctly (endpoint) |
| `assessment-navfit-urdu.test.js` | Pins navFit keeping Urdu row titles readable (no \W stripping) and counting code points as Meta does (endpoint) |
| `assessment-option-title-urdu.test.js` | Pins optionTitle never producing an empty title for Urdu questions, which Meta refuses (assessment-selection) |
| `assessment-orchestrator-versions.test.js` | Pins delivery with assessment_versions_enabled ON (Edit button, key follows) versus OFF (unchanged) in the orchestrator |
| `assessment-orchestrator.service.test.js` | Unit tests for the orchestrator: queued request to delivered paper, recorded steps, and actionable failure messages |
| `assessment-paper-fde.renderer.test.js` | Pins the printed board-pattern paper and marking scheme: recomputed counts, header total 100, choiceLine (fde renderer) |
| `assessment-paper-view-routes.test.js` | Route tests for the portal paper-view endpoint in internal-assessment-view.routes |
| `assessment-paper-view.test.js` | bd-fmf24g.31: buildPaperView reads a finished paper's questions for the portal paper page; owner-only, answers withheld |
| `assessment-paper.renderer.test.js` | Pins the printed A4 paper (marking header, instructions, six question shapes) rendered by assessment-paper.renderer |
| `assessment-per-type-counts.test.js` | Pins the COUNTS screen: one count per picked type instead of one total divided evenly (endpoint, question-types) |
| `assessment-pick-navigation.test.js` | Pins that the PICK list has a way out and back, given a NavigationList must be the only component on its screen |
| `assessment-portal-flag-whatsapp-unaffected.test.js` | bd-6faz8m: pins that the portal editing switch does not affect WhatsApp editing (assessment-delivery) |
| `assessment-question-count.test.js` | Pins parseQuestionCount and the typed question-count QUESTIONS screen replacing the 10/15/20/25/30 dropdown |
| `assessment-rebuild-completion.test.js` | Pins that a closed review Flow still rebuilds the paper because PICK_DONE completes without calling the endpoint |
| `assessment-rebuild-sync-budget.test.js` | Pins that the review Flow's rebuild answers inside Meta's data_exchange budget even with no pacing slot free |
| `assessment-request-enqueue.test.js` | S2/S3: pins createAndQueue as the single place a request becomes a job, and deliver flags (request.service) |
| `assessment-review-flow-v8.test.js` | Pins the shape of docs/flows/assessment-review-flow.json (forward screens, routing model) that Meta's validator accepted |
| `assessment-review-list.test.js` | Pins the check/cross list: paging, drafts for edits, removals, add-back and new questions (endpoint, revision.service) |
| `assessment-review-routing-contract.test.js` | Pins that every screen the review endpoint returns is one the client can move to (e.g. LIST_MORE to ADD_TYPE) |
| `assessment-review-screen.test.js` | Pins the KEEP screen where teachers untick questions: opening, paging keeps ticks (endpoint) |
| `assessment-revision.test.js` | Pins rerender: an edit becomes a document via render, upload and send-by-link; asserts the DB columns exist (bd-60024) |
| `assessment-rtl-latin.test.js` | Pins that an Urdu (dir=rtl) paper isolates Latin runs so bidi does not reorder English (assessment-paper.renderer) |
| `assessment-seen-unseen.test.js` | Pins the Seen/Unseen wording, screens and counts on every path (endpoint, generation, request.service) |
| `assessment-selection.test.js` | Pins stable question ids and applySelection: unticking questions yields the tree a new PDF is built from |
| `assessment-subjects-follow-grade.test.js` | Pins that picking a grade makes the endpoint return that grade's subjects on the CLASS screen |
| `assessment-submit-coverage.test.js` | Pins that every submitted request records its page ranges, fixing chapter picks that violated page_ranges NOT NULL |
| `assessment-terminal-completion.test.js` | Pins that every terminal Flow screen has a completion branch that does the work its button promises |
| `assessment-total-marks-screen.test.js` | Pins the optional total-marks box on QUESTIONS and the review summary of target versus actual (endpoint) |
| `assessment-total-marks.test.js` | Pins parseTotalMarks and that the marks budget reaches the generation prompt (generation.service, question-types) |
| `assessment-type-selection-by-category.test.js` | Pins that question-type selection is routed by content category, not an opt-in tick-box (endpoint) |
| `assessment-types-limit.test.js` | Pins the TYPES screen's 'up to 8' notice and that every refusal is logged (question-types, endpoint) |
| `assessment-urdu-fixtures.test.js` | Meta-test: every Flow test that builds a title, description or row must carry an Urdu fixture (reads sibling test files) |
| `assessment-versions-completion.test.js` | Pins chat order after the review Flow closes: ack first, new version with Edit button, then its key (endpoint) |
| `assessment-versions-flag.test.js` | Pins the assessment_versions_enabled switch in feature-flags (list vs KEEP, Edit button, Make my paper) |
| `assessment-versions-migration.test.js` | SQL-text test of migration V1.5.6 (and its rollback): paper versions as one column on assessment_papers |
| `assessment-versions-model.test.js` | Pins reconstructLegacy: turns an old overwritten paper into two versions (assessment-selection, renderer) |
| `assessment-versions-service.test.js` | Pins createVersion/versionNumberOf: each Make my paper is a new row and no ready version is rewritten (revision.service) |
| `assessment-vocabulary.test.js` | Pins shortType and defaultInstruction copy that fits the check/cross list row's 20 code points (assessment-vocabulary) |
| `backfill-paper-versions.test.js` | Pins the backfill script that splits each old-style edited paper into v1 and v2 with deterministic UUIDv5 ids |
| `book-content.service.test.js` | Unit tests for book-content.service: parsePageRanges, normaliseSubject and chapter/page text assembly for the model |
| `composition-criteria.test.js` | Pins fixed marking-scheme criteria templates for compositions (criteriaFor/kindFor, composition-criteria, patterns) |
| `deploy-killed-paper.test.js` | Pins orchestrator stale take-over and the worker keeping a live paper's row fresh so a deploy cannot strand it |
| `draw-it-prompt.test.js` | Pins the prompt for Mind Map, Flow Chart and Graph types the child draws from text (generation.service) |
| `eval-plan.test.js` | Unit tests for scripts/assessment/eval-plan: which chapters get an exam and what each exam spec asks for |
| `fde-answer-repeats.test.js` | (unmapped) |
| `fde-blueprint-check.test.js` | bd-5jmnfj.2: pins the blueprint check recomputing totals, slot counts and thinking-level split versus the board pattern |
| `fde-blueprint-regenerate.test.js` | bd-5jmnfj.18: pins one regeneration of a board paper off FDE's level split, the nearer paper returned, both runs billed |
| `fde-blueprint-wiring.test.js` | bd-5jmnfj.2: pins that the level target comes from the pattern and every board paper carries the blueprint result |
| `fde-build-failed-shortfall.test.js` | Pins that a short pattern paper logs which request and slot (PATTERN_SHORT_SLOT) in the orchestrator's build-failed line |
| `fde-chain.test.js` | End-to-end board-pattern paper from create route to two stored files, mocking only DB, queue, storage, PDF engine, model |
| `fde-create-race.test.js` | Pins that three simultaneous board-pattern creates for one class make a single paper (internal-api.routes 409 guard) |
| `fde-create.test.js` | Pins POST /assessment/create for a board pattern: ordered checks and the request row it writes (internal-api.routes) |
| `fde-early-answers.test.js` | bd-5jmnfj.4.22: pins Grade 1-2 slots and checks that stop answer keys contradicting their own question (answerShortfall) |
| `fde-early-asked.test.js` | bd-5jmnfj.4.16: pins that a Grade 1-2 paper never asks a fact twice (askedNote, fde-early-prompt) |
| `fde-early-chrome.test.js` | bd-5jmnfj.4.2: pins Grade 1-2 pattern builders: slot defaults, shared header, oral-rubric sum check (early/chrome) |
| `fde-early-dispatch.test.js` | bd-5jmnfj.4.1: pins that a Grade 1-2 pattern job goes to the early writer and is written once (fde-early-writer) |
| `fde-early-paper.test.js` | Pins the printed Grade 1-2 paper: every item has writing space, picture-naming is picture+box (loads fixtures/early) |
| `fde-early-pictures-pattern.test.js` | bd-5jmnfj.4.19: pins that Grade 1-2 patterns carry pictures where non-fluent readers need them (patterns, early/chrome) |
| `fde-early-prompt.test.js` | bd-5jmnfj.4.1: pins Grade 1-2 prompts and checks on replies (oralContent, pictureShortfall) in fde-early-prompt |
| `fde-early-registry.test.js` | bd-5jmnfj.4.2: pins the FDE Grade 1 and 2 patterns as data: marks sum to FDE totals, unique slot ids, oral parts |
| `fde-early-writer.test.js` | bd-5jmnfj.4.1: pins the Grade 1-2 writer with a faked model: every subject lays out whole with pictures and oral part |
| `fde-edit-marks.test.js` | Pins marks on board-pattern edits: an echoed mark is no edit, a changed one is refused (PATTERN_FIXED_MARKS) |
| `fde-edit.test.js` | Pins editing a board-pattern paper: selection keeps _layout, a changed answer drops worked scheme points (E8.1/E8.2) |
| `fde-english-levels.test.js` | bd-5jmnfj.26: pins English's thinking-level split counted the way FDE counts it, inside each question |
| `fde-fixtures-chain.test.js` | Runs three whole board papers (Maths, Urdu, Science) through applyLayout, scheme, maths check and both renderers |
| `fde-frame-bank.test.js` | (unmapped) |
| `fde-g1-english-q9.test.js` | bd-5jmnfj.4.38: pins that Grade 1 English Q9 fill-in sentences leave only one right word (patterns) |
| `fde-generation.test.js` | Pins generatePatternExam: one parallel model call per section and the section prompts (generation.service, patterns) |
| `fde-held-terms.test.js` | Pins held content on board papers: Social Studies religious-text items held, paper fails; Urdu stock wording passes |
| `fde-key-pattern.test.js` | (unmapped) |
| `fde-layout.test.js` | Pins applyLayout: puts model output into FDE's shape, deciding slot placement and marks (fde-layout, patterns) |
| `fde-listening-check.test.js` | (unmapped) |
| `fde-match-block.test.js` | bd-5jmnfj.4.23: pins match Column B ordering: sorted, turned so no answer sits beside its stem (fde-match-block) |
| `fde-match.test.js` | bd-5jmnfj.4.23: pins the Urdu match slot printing two columns of stems and shuffled answers (patterns, fde renderer) |
| `fde-maths-angle-options.test.js` | bd-5jmnfj.11: pins Maths Q4 printing its three angle options i) ii) iii) through layout, scheme and renderer |
| `fde-model-switch.test.js` | Pins the separate assessment.generate.fde model job and the per-section output ceiling (generation.service) |
| `fde-named-child-pronoun.test.js` | bd-5jmnfj.23: pins that a named child or a boy/girl is never 'they' in generated stems (generation.service) |
| `fde-no-arrows.test.js` | (unmapped) |
| `fde-no-disclaimer.test.js` | bd-5jmnfj.4.26: pins that no pattern prints the 'not an official paper' disclaimer (patterns, fde renderer) |
| `fde-options.test.js` | Pins POST /assessment/options telling the app about a board pattern, only when flagged on and grade+subject have one |
| `fde-oral-sheet.test.js` | bd-5jmnfj.4.4: pins the oral teacher sheet in Grade 1-2 marking schemes: scripts, rubric, class grid (fde-oral-sheet) |
| `fde-orchestrator.test.js` | Pins a board-pattern job through buildPaper: both PDFs, real page counts, and the paper row written before return |
| `fde-order-block.test.js` | bd-5jmnfj.4.46: pins Put-in-Order re-numbering each item so the key is not a visible pattern (fde-order-block) |
| `fde-paper-view-choice-items.test.js` | Pins that the phone paper view passes slot items to choiceLine so single-item '{q}' prompts are filled |
| `fde-paper-view.test.js` | Pins a board-pattern paper on the portal paper page and papers list, built from the laid-out tree (paper-view.service) |
| `fde-pattern-module.test.js` | Pins the FDE Grade 5 board pattern as frozen data: marks add up, counts consistent, registry lists it |
| `fde-pic-grid-break.test.js` | (unmapped) |
| `fde-picture-block.test.js` | bd-5jmnfj.4.3: pins how a Grade 1-2 picture prints; an item without an image fails the render (fde-picture-block) |
| `fde-picture-frame.test.js` | bd-5jmnfj.4.36/37: pins that framed pictures are rejected and plain objects carry no face (fde-pictures, picture-kie) |
| `fde-picture-kie.test.js` | bd-5jmnfj.4.3: pins Kie image-model prompt and create/poll/download task for Grade 1-2 pictures, with fetch injected |
| `fde-picture-place.test.js` | (unmapped) |
| `fde-picture-svg.test.js` | bd-5jmnfj.4.3: pins SVG drawing of dots, shapes and a clock face; unsupported pictures throw (fde-picture-svg) |
| `fde-pictures.test.js` | bd-5jmnfj.4.3: pins resolving every Grade 1-2 picture before save: SVG in place, R2 cache, else image model, one retry |
| `fde-plant-label.test.js` | bd-5jmnfj.4.33: pins the G2 GK Q9 'label the plant' picture and slot, no arrows (fde-picture-svg, early-prompt) |
| `fde-prompt-cache.test.js` | Pins writing the shared pattern prompt prefix to the Anthropic cache once before the sections read it (model-settings) |
| `fde-r10-place.test.js` | Round 10: pins the maths place-value oracle reading the number-first stem form (maths-check) |
| `fde-r10-sst.test.js` | Round 10: pins Social Studies keys from the book's three-tier government table, p.29 (fixtures/fde/r10-sst-p29.txt) |
| `fde-r10-urdu.test.js` | Round 10: pins Urdu Section A not giving away Section C answers (Q1 vs Q4 hold, re-ask) using recorded sandbox papers |
| `fde-r11-sst.test.js` | Round 11: pins Social Studies which-government-does-a-job keys and the re-ask note on recorded replies |
| `fde-r11-urdu.test.js` | Round 11: pins that an Urdu Q1 stem printing a Q4 sentence is held (layout) on a recorded sandbox paper |
| `fde-r12-sst.test.js` | Round 12: pins Social Studies Q5/Q7 answers printing a Q1 MCQ whole being held, and one question once per slot |
| `fde-r12-urdu.test.js` | Round 12: pins Urdu Q1/Q4 give-aways via accepted answers and chips for unscheduled Q2 questions (layout, scheme) |
| `fde-r13-sst.test.js` | Round 13: pins holding a D.Q6 item that contains a Q5 item's marking points and the re-ask note |
| `fde-r13-urdu.test.js` | Round 13: pins Urdu twin-item dedupe and Section A not giving away Section C in three shapes |
| `fde-r14-sst.test.js` | Round 14: pins Social Studies Section D written after C and told C's Q5 items; Q7 vs Q1 spelling fold |
| `fde-r14-urdu.test.js` | Round 14: pins Urdu Section A re-ask told the kept Q1 items so a kept fact is not asked twice |
| `fde-r14b-urdu.test.js` | Round 14b: pins three Urdu Section A shapes a local run printed after the twin hold (Q1/Q4 sentence, own key) |
| `fde-r14c-urdu.test.js` | Round 14c: pins Urdu names-as-topic give-away hold and the Section A top-up of a recorded paper |
| `fde-r15-sst.test.js` | Round 15: pins the Social Studies point-set hold as a list of rows (Q6/Q7 against Q5/Q6) on eight local papers |
| `fde-r16-urdu.test.js` | Round 16: pins Urdu give-aways: spelling item printing its key, Q1 key holding a Q5 idiom (recorded papers) |
| `fde-r17-sst.test.js` | Round 17: pins the reader pass on Social Studies Q5-Q7 and that a caught question never prints, on recorded papers |
| `fde-r17-urdu.test.js` | Round 17: pins Urdu give-aways with the reader on: Q1 idiom meaning vs Q5, multi-word keys (fde-reader) |
| `fde-r17b-sst.test.js` | Round 17b: pins Social Studies reader-caught items never printing even if the slot is short, and first-ask spares |
| `fde-r17c-sst.test.js` | Round 17c: pins D slot short after reader taking unplaced spares, a Q7 keyed on a Q1 key held, Q6 not a history fact |
| `fde-r17d-sst.test.js` | Round 17d: pins the reader naming composite give-aways and holding a Q6 that asks only book facts in a situation |
| `fde-r17e-sst.test.js` | Round 17e: pins fact-stating scheme points, placeholder words in the point-set hold, and recall-only Q6 held |
| `fde-r17f-sst.test.js` | Round 17f: pins that name-only marking points state facts so a Q6 on those names is held against the Q5 |
| `fde-r17g-sst.test.js` | Round 17g: pins the reader naming two Section D give-aways and a Q6 that only names a government as recall |
| `fde-r17h-sst-probes.test.js` | Round 17h probes: religious premise without honorific held; reader never refuses for an item its D top-up gives away |
| `fde-r17h-sst.test.js` | Round 17h: pins religious-premise items held, a Q6 relaying a named child's question as recall, and Q1 give-aways |
| `fde-r17i-sst-premise.test.js` | Pins the Social Studies premise term for Allah held in every written form but never a personal name |
| `fde-r17i-sst.test.js` | Round 17i: pins Social Studies Q1 recall/understand mix and Q6 as a decision, with the reader (generation, patterns) |
| `fde-r17j-sst-reader-cost.test.js` | Pins that first-ask spares are read only when Section D would be short without them (reader pass cost) |
| `fde-r17j-sst.test.js` | Round 17j: pins premise words without honorifics held and Q1 keys a C/D stem names (loads the ch4-6 book text) |
| `fde-r18-urdu.test.js` | Round 18: pins Urdu held-lessons filter, Section A quoting held lessons, chapters paper numbering |
| `fde-r19-urdu.test.js` | Round 19: pins Urdu grammar-term MCQs whose stem prints a word of the key being held, plus the Section A prompt |
| `fde-r20-urdu.test.js` | Round 20: pins the reader treating a defining stem and a quoted key word as Urdu give-aways, and the Section A prompt |
| `fde-r21-urdu-probes.test.js` | Round 21 probes: pins Urdu Q1 story-name cue, key letters and one grammar concept once, by swapping recorded items |
| `fde-r21-urdu.test.js` | Round 21: pins Urdu Q1 story pairs where a stem names another item's key, and the key rules |
| `fde-r21b-urdu.test.js` | Round 21b: pins Urdu Q1 grammar only from the chosen lessons, in the layout hold and Section A prompt |
| `fde-r21c-urdu.test.js` | Round 21c: pins Section A rules naming only chosen lessons' grammar and holds reaching the log after the re-ask |
| `fde-r21d-urdu-verse.test.js` | Round 21d: pins Q6 verses from a lesson outside the chosen ones printing their source lesson and pages |
| `fde-r21d-urdu.test.js` | Round 21d: pins one-concept rules for similar-spelling words and antonym/synonym asked once on lessons 4-5 |
| `fde-r21e-urdu.test.js` | Round 21e: pins that on chosen lessons a repeated grammar concept never refills a Q1 place (antonym printed twice) |
| `fde-r21f-urdu.test.js` | Round 21f: pins the single-prose-story lessons case capping Q1 story items that name each other |
| `fde-r21g-urdu.test.js` | Round 21g: pins Urdu concept rows that missed (adjective asked twice, cross-lesson antonym) across wider scopes |
| `fde-r5-layout.test.js` | Round 5: pins MCQ key spreading (no letter over 35%) and singular chapter naming in the layout (fde-layout) |
| `fde-r5-renderer.test.js` | Round 5: pins word lists printing only for word-bank slots and no double lettering via the real chain |
| `fde-r5-rt3a-s2.test.js` | Red-team round 2: probes the maths-check unit-conversion guard on fictional fixtures |
| `fde-r5-rt3a.test.js` | Red-team probes of board-paper fixes (maths key working check, key spreading); test.failing marks documented findings |
| `fde-r5-scheme.test.js` | Round 5: pins maths keys that carry their own working being checked, and scheme lines printing whole (marking-scheme) |
| `fde-r6-layout.test.js` | Round 6: pins MCQ keys spread with the fewest turns, and MCQs with two same-valued options (fde-layout) |
| `fde-r6-prompt.test.js` | Round 6: pins the rules a board-pattern section prompt carries via buildPatternUserPrompt |
| `fde-r6-render.test.js` | Round 6: pins the 100 mm Social Studies map frame and a slot's last item never starting a page alone |
| `fde-r6s2.test.js` | Round 6 second pass: pins that appended source/chapter/level tags never print and the pages-paper covers line |
| `fde-r7-engine.test.js` | Round 7: pins a re-ask topping up a short slot (maths Q1a) and a failed pattern paper keeping exam_json and model |
| `fde-r7-json-parse-first.test.js` | Pins that valid JSON replies are parsed as-is and repairs only run on unparseable text (assessment-json.util) |
| `fde-r7-maths-adversarial.test.js` | Red-team probes of mcqPropertyVerdict and its wiring in fde-layout printable: legitimate stems are never dropped |
| `fde-r7-maths-check.test.js` | Round 7: pins property MCQs ('divisible by 11') being placed only with exactly one right option (maths-check) |
| `fde-r7-prompt.test.js` | Round 7: pins round-3 prompt rules for board-pattern sections via buildPatternUserPrompt |
| `fde-r7-render.test.js` | Round 7: pins review markers kept off prints and page lists of whole units printing the units |
| `fde-r7-scheme-rt.test.js` | Red-team probes: the marking scheme never prints a bare-number 'lump chip' (normaliseScheme, renderMarkingScheme) |
| `fde-r7-scheme.test.js` | Round 7: pins normaliseScheme giving a pointless written row one Accuracy point instead of a bare chip |
| `fde-r8-check.test.js` | Round 8: pins maths estimate keys never rewritten and English anagram items placed only with one anagram |
| `fde-r8-prompt.test.js` | Round 8: pins round-4 prompt rules for board-pattern sections via buildPatternUserPrompt |
| `fde-r9-check.test.js` | Round 9: pins the maths place-value MCQ oracle and the plain-words before-the-exam box |
| `fde-r9-english.test.js` | Round 9: pins English pattern prompt rules and the Q5 poem through generatePatternExam |
| `fde-r9-layout-engine.test.js` | Round 9: pins the cross-section hold through generatePatternExam: a held item makes a section short, asked once more |
| `fde-r9-layout.test.js` | Round 9: pins an item the slot letters printing its letter once, and English Q1(a) MCQs carrying a Q4 word held |
| `fde-r9-prompt.test.js` | Round 9: pins prompt rules for Maths defects and unnamed people across subjects |
| `fde-r9-sst.test.js` | Round 9: pins Social Studies Q5/Q7 not re-asking Section A or Q6 facts and one level per choice group |
| `fde-r9-urdu-b.test.js` | Pins that Urdu model-authored text carries no religious maxim, hadith, verse, dua or worship act (prompt and backstop) |
| `fde-r9-urdu.test.js` | Pins Urdu word-list slots: the printed instruction stands and a model-written restated question is dropped |
| `fde-r9b-reask.test.js` | Round 9b: pins the one re-ask after the cross-section hold being told what the paper already tests (generatePatternExam) |
| `fde-reader-gate.test.js` | Pins assessment_fde_reader_pass_subjects: read per pattern paper by the orchestrator, fail closed, subject-limited |
| `fde-reader-refuse-text.test.js` | Pins that the reader-pass record on a paper never stops it printing, and its failure paths (fde-reader) |
| `fde-reader-urdu.test.js` | Pins the Urdu reader pass after final layout: a flagged item does not print, versus the recorded paper as printed today |
| `fde-recorded-replies.test.js` | Replays real board-pattern model replies (Urdu held-lessons filter, Maths cutoff) to pin the first real-paper failures |
| `fde-render-dispatch.test.js` | Pins renderPaper/renderAnswerKey routing a _layout paper to the FDE renderer and others to the old one |
| `fde-revision.test.js` | Pins a board-pattern new version re-rendering both paper and marking scheme with their own PDF options (E8.4) |
| `fde-scheme-cover.test.js` | (unmapped) |
| `fde-scheme-figures.test.js` | (unmapped) |
| `fde-science-q3-levels.test.js` | bd-5jmnfj.14: pins Science Section C's level rule per FDE's table of specification (generation.service, patterns) |
| `fde-scramble-block.test.js` | (unmapped) |
| `fde-section-levels.test.js` | bd-5jmnfj.19: pins each section being asked for its own thinking-level split, not the whole paper's |
| `fde-section-reask.test.js` | Pins a short board-pattern section being asked once more before the paper fails (PATTERN_SHORT_SLOT) |
| `fde-split-retry-setting.test.js` | bd-5jmnfj.18: pins assessment_fde_split_retry read by the orchestrator per pattern paper and failing safe |
| `fde-status-versions.test.js` | Pins that POST /assessment/status and /edit/versions name a board-pattern request so a reopened page can resume |
| `fde-stem-check-engine.test.js` | bd-5jmnfj.22: pins the stem check inside the paper writer: rewords unclear questions, records changes, billed |
| `fde-stem-check-gate.test.js` | bd-5jmnfj.22: pins assessment_fde_stem_check_subjects read per paper, fail closed, English/Maths/Science only |
| `fde-stem-check-parts.test.js` | bd-5jmnfj.29: pins the stem check seeing an unseen passage's lettered sub-questions (fde-stem-check) |
| `fde-stem-check-topics.test.js` | bd-5jmnfj.28: pins the stem check seeing the topics an item prints (English Q8 paragraph topics) |
| `fde-stem-check.test.js` | bd-5jmnfj.22: pins the stem-check prompt and reply reading that catches self-contradicting questions (fde-stem-check) |
| `fde-urdu-lesson-scope-probes.test.js` | Probes Urdu Q1 grammar limited to chosen lessons and its hold; full syllabus and other subjects must not move |
| `fde-urdu-notes.test.js` | (unmapped) |
| `fde-v18-paper-fixes.test.js` | Pins v18 sandbox paper fixes: all-same MCQ choices (4.35) and G1 GK land-or-water pictures (4.34) |
| `fde-v19-paper-fixes.test.js` | Pins v19 fixes: match pairs not printed already joined (4.43) and the speech-bubble tail outline (4.40) |
| `fde-v20-paper-fixes.test.js` | Pins v20 fixes: land-and-water animals keyed both (4.45) and Q13 gift/bubble tail corrections (4.40) |
| `fde-v21-key-fixes.test.js` | Pins v21 fixes: Column B neither beside its stem nor a shift (4.47) and rhyme key naming the picture (4.48) |
| `fde-v22-reading-key.test.js` | (unmapped) |
| `fde-v23-accept-list.test.js` | (unmapped) |
| `fde-v23-banned-words.test.js` | (unmapped) |
| `fde-v23-g2-place-value.test.js` | (unmapped) |
| `fde-v23-g2-reading-answer-space.test.js` | (unmapped) |
| `fde-v23-g5-keys.test.js` | (unmapped) |
| `fde-v23-g5-science-label-frame.test.js` | (unmapped) |
| `fde-v23-key-picture-line.test.js` | (unmapped) |
| `fde-v23-maths-key-box.test.js` | (unmapped) |
| `fde-v23-oral-cover-line.test.js` | (unmapped) |
| `fde-v23-oral-notes.test.js` | (unmapped) |
| `fde-v23-order-key.test.js` | (unmapped) |
| `fde-v23-repeats.test.js` | (unmapped) |
| `fde-v23-urdu-key-notes.test.js` | (unmapped) |
| `fde-v24-giveaway-topup.test.js` | (unmapped) |
| `fde-v24-urdu-q6-no-naat.test.js` | (unmapped) |
| `fde-v25-cover-pictures.test.js` | (unmapped) |
| `fde-v25-g1-pictures.test.js` | (unmapped) |
| `fde-v25-key-content.test.js` | (unmapped) |
| `fde-v25-maths-keys.test.js` | (unmapped) |
| `fde-v25-render-labels.test.js` | (unmapped) |
| `fde-v25-repeats-writers.test.js` | (unmapped) |
| `fde-v25-repeats.test.js` | (unmapped) |
| `fde-v26-common-errors.test.js` | (unmapped) |
| `fde-v26-g1.test.js` | (unmapped) |
| `fde-v26-g5-patterns.test.js` | (unmapped) |
| `fde-v26-key-checks.test.js` | (unmapped) |
| `fde-v26-oral.test.js` | (unmapped) |
| `fde-v26-repeats.test.js` | (unmapped) |
| `generation-hardening.test.js` | Pins the paper model call's max_tokens ceiling and one retry on an empty reply (generation.service) |
| `golden.test.js` | Golden test: pins today's generator prompts, printed papers/keys and options payloads for non-board-pattern papers |
| `llm-passthrough.test.js` | Pins that max_tokens and a per-call timeout reach the SDK through the shared model client (model-settings) |
| `marking-scheme.test.js` | Unit tests for normaliseScheme: fixes model-written scheme sums, kinds, MCQ schemes and comprehension words |
| `maths-check.test.js` | Unit tests for the maths key check: parseForm and recomputing percentages/arithmetic in exact integers and fractions |
| `orchestrator-duplicate-delivery.test.js` | Pins one request, one paper, one model call when SQS delivers the job twice (orchestrator.service) |
| `pattern-question-cap.test.js` | Pins that every FDE pattern's slot-count sum fits the DB question_count cap (reads migrations; patterns) |
| `picture-types-hidden.test.js` | Pins that Label the Diagram and Picture Description are no longer offered (question-types, create route, renderer) |
| `r2-list-keys.test.js` | Unit test for r2.listKeys(prefix) used by the version backfill to find a paper's first-delivered PDF |
| `repair-backfilled-v1-created-at.test.js` | bd-5ioto.11: pins the repair script moving backfilled v1 rows' created_at off their child's timestamp |
| `revision-ack-without-text.test.js` | Pins that remaking a paper is acknowledged without an extra text message on versioned and old rebuild paths |
| `rt-r17s9-premise.test.js` | Pins the Social Studies premise term for Khuda holding its izafat form but never the name Khuda Bakhsh |
| `rt-r21u3-probes.test.js` | Red-team probes: Urdu Q1 concept rules on chosen lessons, hold counts, Q4 syllable hold, verse source line |
| `rt-r21u4-probes.test.js` | Red-team probes: on chosen lessons a grammar concept never prints twice after put-back (recorded sandbox papers) |
| `rt-r21u5-probes.test.js` | Red-team probes: Urdu one-story Q1 rules: story-item cap across re-layouts, name cue, reader candidate list |
| `scheme-accept-check.test.js` | (unmapped) |
| `worker-assessment-heartbeat.test.js` | Pins the SQS worker keeping an assessment message invisible while a paper is made and finishing it on deploy |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/assessment/CLAUDE.md`? · `bot/shared/services/assessment/CLAUDE.md`? · `bot/shared/services/assessment/patterns/CLAUDE.md`? · `bot/shared/services/assessment/patterns/early/CLAUDE.md`? · `scripts/assessment/CLAUDE.md`? · `tests/CLAUDE.md`? · `todo.md`?
