# training — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/training -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `bd-2672-backfill-assignment.test.js` | bd-2672: deriveBands maps grade ids to PRIMARY/MIDDLE/HIGH for backfilling training assignments of new users |
| `bd-2676-certificate-inline-view.test.js` | bd-2676: the bot's R2 presigner can sign an inline application/pdf URL so certificates open viewable |
| `bd-43478-band-apply.test.js` | bd-43478: applyBandSelection writes training_bands and assignments for both bot Flow and portal, leaving users.levels |
| `bd-43478-band-picker-flow.test.js` | bd-43478: BAND_PICKER screen in the training Flow JSON replaces the no-training dead end, forward-only routing |
| `bd-43478-band-selection.test.js` | bd-43478: bandsToPrograms mapping and the 48-hour band-change cooldown in band-selection.service |
| `bd-43478-ghost-slot-visibility.test.js` | bd-43478: TRAINING_HOME hides unused level slots instead of dotting them; endpoint sets the visible flag |
| `bd-43478-portal-bands.test.js` | bd-43478: static contract that portal GET/POST /training/bands exist, need portal auth and read the session user |
| `bd-43496-exam-question-body-cap.test.js` | bd-43496: an exam question over WhatsApp's 1024-char body cap is declined or Flowed, and never freezes the attempt |
| `bd-60113-capstone-points-per-vendor.test.js` | bd-60113: pointsPerQuestionFor gives per-vendor capstone points (default 5, I-SAPS 10) in capstone-points.rules |
| `bd-60113-isaps-cert-gate.test.js` | bd-60113: I-SAPS certificate gate collects level totals (possible vs earned) in isaps-grading.rules |
| `bd-60113-isaps-certificate-template.test.js` | bd-60113: I-SAPS gets its own certificate template, and templateIdFor does not fall through to another vendor's |
| `bd-60113-isaps-composite-grading.test.js` | bd-60113: I-SAPS weighted composite grading rules (25/50/25 weights, component pass bars) in isaps-grading.rules |
| `bd-60113-isaps-crq-extract.test.js` | bd-60113: splitCrqItems parses an I-SAPS CRQ .docx into items with concept, marks and scenario |
| `bd-60113-isaps-unit-ref.test.js` | bd-60113: parseUnitRef normalises the I-SAPS "Place After Unit" column's spellings in isaps-import.rules |
| `bd-60116-answer-key-index.test.js` | bd-60116: answerKeyToIndex converts I-SAPS letter answer keys to the 1-based correct_option index |
| `bd-60118-question-option-images.test.js` | bd-60118: parseOptionImages reads image-option questions (JSON array or string), empty or malformed yields none |
| `bd-60119-isaps-module-scoped-listing.test.js` | bd-60119: only I-SAPS lists modules then units in a level; other vendors keep the flat listing (isaps-listing.rules) |
| `bd-60120-isaps-module-exam.test.js` | bd-60120: per-module quiz ids (source_quiz_id 900+module) round trip; legacy ids are not module exams |
| `bd-60120-module-exam-start.test.js` | bd-60120: level-exam lookup skips per-module quizzes; startModuleExam preconditions and export in quiz-delivery |
| `bd-60124-module-exam-offer.test.js` | bd-60124: shouldOfferModuleExam offers the I-SAPS module exam on finishing a module instead of skipping to the next unit |
| `bd-60126-module-exam-not-a-level-pass.test.js` | bd-60126: isLevelCertifyingAttempt: a module exam pass must not announce a level pass or issue a level certificate |
| `bd-60128-crq-as-last-question.test.js` | bd-60128: an I-SAPS CRQ is the module exam's last question; isOpenEndedQuestion rules in isaps-crq-paper.rules |
| `bd-60128-crq-serving-and-capture.test.js` | bd-60128: selectPaperWithOneCrq serves sampled MCQs plus exactly one stable CRQ last, and captures its text answer |
| `bd-60129-attempt-total-matches-served.test.js` | bd-60129: an attempt's total_questions is sized to the served paper, not the bank, so the CRQ answer is captured |
| `bd-60130-hide-absent-level-exam.test.js` | bd-60130: when a level has no exam the level screen's exam slot is blank and never mentions exams or sessions |
| `bd-60131-bank-projection-classification.test.js` | bd-60131: open-ended classification is not run on thin bank rows lacking options, so no CRQ is invented |
| `bd-60133-nonprod-certificate-banner.test.js` | bd-60133: certificates generated outside production carry a not-real banner; isProductionEnv fails safe |
| `bd-60137-crq-capture-executes.test.js` | bd-60137: routeOpenEndedAnswer actually runs, claims a typed CRQ answer and writes the answer row with a rubric mark |
| `bd-60139-module-exams-gate-certificate.test.js` | bd-60139: a per-module-assessed level certifies only when allModuleExamsPassed, not on unit quick-checks |
| `bd-60141-module-exam-samples-two-mcqs.test.js` | bd-60141/bd-vej4h: an I-SAPS module exam samples 4 MCQs plus 1 CRQ from the bank, never the whole bank |
| `bd-60142-module-exam-attempts-certification.test.js` | bd-60142: passing the last module exam attempts certification via maybeIssueQuizScoreCertificate; one pass still refuses |
| `bd-60143-module-pass-message-denominator.test.js` | bd-60143: the module pass message shows marks over marks (e.g. 12/12), never marks over question count |
| `bd-60144-certify-from-exam-with-null-module.test.js` | bd-60144: certification from a module-exam attempt works though training_module_id is null, resolving level otherwise |
| `bd-60145-portal-certifies-via-guard.test.js` | bd-60145: portal certifies through the bot's internal certify-level guard, one implementation, level id supplied |
| `bd-60146-offer-announces-served-paper.test.js` | bd-60146: the module exam offer announces the served paper size (4 MCQs plus CRQ), not the question bank size |
| `bd-60149-portal-module-exam.test.js` | bd-60149: the bot exposes module-exam gate, start and submit internal endpoints so the portal can sit module exams |
| `bd-60161-crq-rubric-marking.helpers.js` | Test helper: shared captured-payload and canned-reply state for the bd-60161 rubric-marking test's hoisted jest.mock |
| `bd-60161-crq-rubric-marking.test.js` | bd-60161: a CRQ is marked against its own rubric (every band described; unreachable band declared) |
| `bd-60169-exam-autosave.test.js` | bd-60169: exam answers autosave as drafts (unmarked, unique key) and a late save cannot overwrite a graded paper |
| `bd-60170-certificate-honesty.test.js` | bd-60170: a failed certificate insert reports issued:false, never a code for a row that does not exist |
| `bd-bos0ki-crq-rubric-reaches-grader.test.js` | bd-bos0ki: the question rubric reaches the CRQ grader on both the WhatsApp and portal background grading paths |
| `bd-mo5pru-portal-grade-no-null-send.test.js` | bd-mo5pru: a portal-graded module exam with no phone never sends a WhatsApp to a missing recipient |
| `bd-qd1p3-multi-program-level-exam.test.js` | bd-qd1p3: a teacher on two programs can still submit a portal level exam; one-program path unchanged |
| `bd-s42dye-4-legacy-media-rehost.test.js` | bd-s42dye.4: legacy-media-rehost rules pick unplayable media and key it identically across environments |
| `bd-s42dye-4-legacy-vendor-coach-only.test.js` | bd-s42dye.4: the TALEEMABAD_LEGACY vendor is coach-library only, hidden from teachers, never certified |
| `bd-s42dye5-release-held-attempts.test.js` | bd-s42dye.5: releasing held I-SAPS CRQ attempts script: flag pre-check, dry-run versus --apply, backfill |
| `bd-s42dye5-retry-copy-follows-cooldown.test.js` | bd-s42dye.5: failed-exam retry copy quotes the vendor's real cooldown_hours (0 immediate, 48 etc.), not a fixed 24 |
| `bd-w2daa-8-fewer-bubbles.test.js` | bd-w2daa.8: Teacher Training merges verdict and next question into fewer billed WhatsApp sends, same words |
| `bd-yef5iq-6-isaps-level2-readings.test.js` | bd-yef5iq.6: I-SAPS Level 2 reading lists (13 mandatory) linked per module, via readingsForCourse |
| `bd-yef5iq-isaps-level2-certificate.test.js` | bd-yef5iq: the I-SAPS certificate body line names the level finished, while Level 1 wording is unchanged |
| `capstone-delivery.test.js` | bd-2233: Beacon House open-ended capstone delivery (offer, 400-char minimum, 0-5 scoring) in capstone-delivery.service |
| `capstone-multi-open-answer-routing.test.js` | bd-5tn5d: a typed capstone answer is consumed and written to the latest attempt even with several capstones open |
| `capstone-pure-rules.test.js` | bd-2673: capstone answer floor and pure rules reusable by the portal (no WhatsApp dependency) |
| `capstone-reachable.test.js` | bd-2472/2473/2474: the capstone is offered after the last quizzed module of a Beacon House level; no dead end |
| `certificate-fetch-or-mint.test.js` | Pins fetch-or-mint, the single certificate PDF path: legacy rows with null pdf_r2_key are rendered on demand |
| `certificate-flow-entry.test.js` | bd-2665: a tappable /training certificate route with level-named rows, in teacher-training-endpoint |
| `certificate-one-per-level.test.js` | bd-2670: issueCertificate is idempotent per (user, level), returning the first-earned certificate |
| `certificate-pdf-delivery.test.js` | Pins that every surface issuing a certificate also sends the PDF, falling back to a text congratulation |
| `certificate-pdf-issuance.test.js` | Pins that issueCertificate returns the PDF key and still issues when PDF generation throws or returns null |
| `certificate-pdf.test.js` | Pins certificate PDF render, store at certs/{user}/{code}.pdf, retrieve and deliver in certificate-pdf.service |
| `certificate-service.test.js` | Pins certificate.service certCodePrefix (env-driven CERT_CODE_PREFIX, BOT_NAME, ORG_NAME) and shared issuance |
| `certificate-triggers.test.js` | bd-2234: per-subject certificate triggers: Oxbridge needs every module quiz at 70 percent or more |
| `certificate-vendor-templates.test.js` | Pins per-vendor certificate PDF templates (NIETE/AKU-IED accreditation text and others) in certificate-pdf.service |
| `certificate-whatsapp-command.test.js` | Pins parseCertificateCommand and /certificate <CODE> on WhatsApp using the same fetch-or-mint as the portal |
| `exam-caption-served-count.test.js` | bd-2499: the /training exam caption counts the served (capped) paper, not the whole question bank |
| `fde-delta-sync.test.js` | bd-2528: legacy-to-Supabase delta sync migration and the training_sync_runs ledger with its retirement signal |
| `grand-quiz-level-resolution.test.js` | bd-2392/2393: startGrandQuiz resolves the level inside the teacher's scoped catalog, not a global order_index |
| `isaps-cert-module-exams-only.test.js` | Pins that the I-SAPS Level 1 certificate gates only on all module exams passed, with no unit chaining |
| `isaps-crq-hold.test.js` | bd-hxm7a: I-SAPS written answers are graded but HELD; only an explicit true in the release setting shows results |
| `isaps-exam-attempt-review.test.js` | bd-2exhl: submitting an I-SAPS module exam leaves in_progress at once (failed or pending_review), with a record |
| `isaps-golive-gates.test.js` | bd-vej4h: I-SAPS go-live gates: open modules, per-module unit chaining, module exam waits for its units |
| `isaps-level-composite.test.js` | Pins the counting in isaps-level-grade (paper-based summative possible, whole-pool formative), not weights |
| `isaps-pilot-watermark.test.js` | bd-vej4h: I-SAPS certificates are clean in production but watermarked outside it, like other vendors |
| `isaps-portal-wiring.test.js` | bd-vej4h: source-level pins that the portal gets unit locks and score sheet from bot internal endpoints |
| `isaps-readings.rules.test.js` | Pins isaps-readings.rules: which Level 1 reading list belongs to which course (13 mandatory, each linked) |
| `isaps-score-sheet.test.js` | bd-vej4h: buildIsapsScoreSheet lists modules, units, best quiz percentage and split MCQ/written exam marks |
| `isaps-ungated-unit-quiz.test.js` | bd-60163: a vendor's unit quizzes can be pure formative (pass regardless of score), but an empty quiz still fails |
| `legacy-s3-media-rehosted.test.js` | bd-2666: training media must be served from a header-controlled host; legacy S3 octet-stream assets are rehosted |
| `level-passed-requires-exam-not-diagnostic.test.js` | bd-43491: a passed diagnostic must not certify or chain-unlock a level; only a real exam pass does |
| `level-passed-requires-grand-attempt.test.js` | bd-2391: a passed module quick-check must not certify or chain-unlock a level; only a passed GRAND attempt does |
| `level-ready-requires-all-modules.test.js` | bd-2447: "Ready for exam" in the training Flow means every module is passed, not one per course |
| `level-unlock-gate.test.js` | bd-2479: checkLevelUnlocked, the level-scoped gate the portal asks before courses, modules and quiz submit |
| `locked-starts-are-gated.test.js` | bd-2451..2454: every locked /training state (grand quiz, modules) refuses the start, not only a caption |
| `module-cta-copy.test.js` | bd-2446: the module button copy describes what the tap does (quiz first vs video) in content-delivery |
| `module-order-is-total.test.js` | bd-u2td8: tied order_index values still yield one deterministic module sequence in the picker |
| `module-payload-deliverable.test.js` | Guard: every active training module resolves to deliverable media, and audio_url never holds a PDF |
| `module-quiz-gates-progress.test.js` | bd-2390: the module quiz gates progress and next-module delivery instead of firing in parallel on tap |
| `module-quiz-never-goes-silent.test.js` | bd-2wzpi: every exit of startTrainingQuiz (bad id, no lookup, empty bank) sends the teacher a reply |
| `module-sequencing-lock.test.js` | bd-2448: the module picker marks open versus locked so a teacher cannot skip ahead |
| `msq-select-range.test.js` | bd-2502: the multi-select Flow binds max-selected-items from data instead of a frozen 10 |
| `no-exam-level-completes.test.js` | bd-2503: a level with no exam reaches a terminal passed state once certified, not stuck ready_for_quiz |
| `paper-marking-shared.test.js` | bd-2673: paper-marking.service is the one marking rule (multi-answer detection, set normalisation) for bot and portal |
| `pdf-module-delivery.test.js` | Pins deliverPdfModule: sendDocumentByLink with URL, filename and caption, event emitted, text fallback |
| `pdf-module-presigns-r2.test.js` | Pins that an R2-hosted PDF module is presigned before the link goes to WhatsApp; public non-R2 links pass as-is |
| `portal-capstone-submit.test.js` | bd-2673: portal written-capstone submit scores each answer with the bot rubric, passes at the bar, mints certificate |
| `portal-certificates.test.js` | Pins the portal certificates routes: auth, session user only, and delegation of list and PDF to the bot |
| `portal-exam-no-options-is-written.test.js` | Pins that a question with no options is treated as written (isOpenEndedQuestion), even with a stray key |
| `portal-grand-quiz-served.test.js` | bd-klecr.7: the portal level exam serves the bot's per-attempt paper, resumes the same attempt on reload |
| `portal-grand-quiz.test.js` | Pins the portal grand-quiz (level exam) endpoints: gate state, paper questions, attempts, eligibility |
| `portal-level-unlock-logic.test.js` | bd-2129/2235: portal /training/levels honours training_vendors.unlock_logic (all_modules never locks, chain does) |
| `portal-levels-scoping.test.js` | bd-2237: portal /training/levels honours teacher program scopes (primary versus middle/high), empty without assignment |
| `portal-mark-complete.test.js` | Pins POST /api/portal/training/module/:id/complete for quiz-less modules: auth, id validation, 404 |
| `portal-module-media.test.js` | Pins GET /api/portal/training/module/:id media resolution: presign R2 video/audio, pass external URLs, PDF handling |
| `portal-quiz-multi.test.js` | bd-2138: multi-answer questions on the portal expose a multi flag (never the key) and grade by set equality |
| `portal-quiz-per-question.test.js` | bd-klecr.6: portal module quiz one question at a time (start, answer) with a verdict after each answer |
| `portal-quiz-questions.test.js` | Pins GET /api/portal/training/module/:id/questions: auth, 400/404, active questions served for the quiz form |
| `portal-quiz-submit.test.js` | Pins POST /api/portal/training/module/:id/quiz-attempts: server-side grading, persistence, validation |
| `portal-training-attempts.test.js` | Pins GET /api/portal/training/module/:id/attempts: the teacher's own module quiz attempts, empty list when none |
| `portal-training-vendors.test.js` | Pins GET /api/portal/training/vendors: vendors the teacher's programs allow, with per-vendor rollups |
| `quiz-immediate-feedback.test.js` | bd-2523/2525: a training quiz sends a right/wrong verdict per question, recorded before sending, ahead of the next |
| `quiz-multi-select-flow.test.js` | bd-2501: multi-answer quiz questions go out as a Flow CheckboxGroup (token has attempt and index); single stays a list |
| `quiz-multi-select.test.js` | bd-2138: WhatsApp multi-answer quiz delivery with a Done row, select-all instruction and set-based answering |
| `quiz-option-truncation.test.js` | bd-2230: long quiz options move to the message body in full (letter-only rows) instead of 72-char row truncation |
| `quiz-serving-delivery.test.js` | Pins quiz-serving wired in quiz-delivery: the served count (one per Bloom level) is snapshotted and announced |
| `quiz-serving-selection.test.js` | Pins quiz-serving.service pure selection: one question per Bloom level in order, floor of 2, vendor-config driven |
| `r2-presign-attachment.test.js` | Pins r2 getPresignedUrl attachment mode (Content-Disposition) for certificates, existing callers unchanged |
| `training-home-ghost-slot-nonempty.test.js` | BUG-144: ghostSlotData fills unused TRAINING_HOME level slots with non-empty values so the Flow opens |
| `training-home-level-labels.test.js` | bd-2137: TRAINING_HOME and LEVEL_DETAIL use vendor-aware level labels (chain ladder vs all_modules plain subject) |
| `training-home-program-distinct.test.js` | bd-2102: /training partitions levels by vendor with vendor name, unlock_logic and progress per group |
| `training-home-unique-option-ids.test.js` | Regression: /training dropdown option ids stay unique when two programs' level order_index values collide |
| `training-init-entry-screen.test.js` | BUG-144: INIT must return a routing-model entry screen of teacher-training-flow-v1.json, no extra tap |
| `training-quiz.test.js` | Pins content-delivery to quiz-delivery wiring: handleModuleDone fires the module quiz when questions exist |
| `training-trigger-no-slash.test.js` | OPS-108: a whole-word case-insensitive "training"/"trainings" message (no slash) opens Teacher Training |
| `web-training-link-logging.test.js` | Pins that the training link token never appears in the request log and link opens log training.web_link_open |
| `web-training-link.test.js` | Pins opening Training sending the training_open_v1 web-link template when web_training_enabled allows the teacher |
| `web-training-portal-link.test.js` | Pins GET /t/<token>: a genuine link starts a training-only portal session; expired or throwing lookup shows expired page |

## Who reads this (all, generated)
- env `NODE_ENV` read at `tests/training/bd-60133-nonprod-certificate-banner.test.js:132:ecc79012`
- env `OPENROUTER_API_KEY` read at `tests/training/bd-43496-exam-question-body-cap.test.js:106:6d424b49` · `tests/training/bd-w2daa-8-fewer-bubbles.test.js:117:6d424b49` · `tests/training/exam-caption-served-count.test.js:72:6d424b49` · `tests/training/level-unlock-gate.test.js:84:6d424b49` · `tests/training/locked-starts-are-gated.test.js:112:6d424b49` · `tests/training/msq-select-range.test.js:151:6d424b49` · `tests/training/no-exam-level-completes.test.js:83:6d424b49` · `tests/training/portal-level-unlock-logic.test.js:214:6d424b49` · `tests/training/quiz-immediate-feedback.test.js:102:6d424b49`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/setup/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/training/CLAUDE.index.md`? · `bot/shared/services/training/CLAUDE.md`? · `dashboard/routes/CLAUDE.index.md`? · `dashboard/services/CLAUDE.index.md`? · `docs/flows/CLAUDE.index.md`? · `docs/reports/bug131-phase2-portal-quiz-ui.md`? · `docs/reports/bug131-phase3-grand-quiz.md`? · `docs/reports/bug131-phase4-media-complete.md`? · `scripts/CLAUDE.index.md`? · `scripts/lib/CLAUDE.index.md`? · `scripts/lib/CLAUDE.md`? · `tests/BASELINE.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/training/CLAUDE.index.md`? · `tests/training/CLAUDE.md`?
