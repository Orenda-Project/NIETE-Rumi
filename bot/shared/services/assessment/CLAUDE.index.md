# assessment — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/assessment -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `board-6-12/` | (no description yet) → `board-6-12/CLAUDE.md` |
| `board-checks/` | (no description yet) → `board-checks/CLAUDE.md` |
| `board-render/` | (no description yet) → `board-render/CLAUDE.md` |
| `patterns/` | Board-pattern definitions (FDE grades 1, 2, 5) as frozen data → `patterns/CLAUDE.md` |
| `slo-map/` | (no description yet) → `slo-map/CLAUDE.md` |
| `subject-config/` | (no description yet) → `subject-config/CLAUDE.md` |
| `topics/` | Curriculum-matrix rows to the tickable topics of a chapter; pure grouping → `topics/CLAUDE.md` |
| `assessment-browse.service.js` | Surface-neutral lists of what a teacher may offer/download for assessments; feeds Flow and portal browse |
| `assessment-changes.js` | Applies a portal-sent list of paper changes (edits, removals, restores, additions) using WhatsApp's edit rules |
| `assessment-delivery.js` | Sends a finished paper PDF with its Edit Flow button, and the answer key, over WhatsApp; used by the orchestrator |
| `assessment-edit.js` | Defines question shapes, pre-fills each edit screen and writes edited answers back into the question tree |
| `assessment-editor.service.js` | Portal paper-editor backend (versions, questions, validate, save); gated by portal_assessment_editing_enabled |
| `assessment-feedback.service.js` | (unmapped) |
| `assessment-format.js` | Single place choosing PDF vs Word renderer and filename extension so a .docx is never a PDF |
| `assessment-generation.service.js` | Core generator: textbook pages in, exam question JSON out via ict-prompts.json and board-pattern writers |
| `assessment-json.util.js` | Repairs and extracts JSON from model replies (fences, missing commas, raw newlines, truncation) |
| `assessment-orchestrator.service.js` | Runs a queued assessment request end to end: generate, check, render, deliver, record, and failure messages |
| `assessment-order.js` | (unmapped) |
| `assessment-paper-board.renderer.js` | (unmapped) |
| `assessment-paper-fde.renderer.js` | Renders board-pattern (FDE) papers and their marking schemes to HTML from the paper's _layout |
| `assessment-paper-view.service.js` | Read-only view of a finished paper's questions for the portal paper page (bd-fmf24g.31) |
| `assessment-paper.renderer.js` | Renders the plain exam paper HTML teachers print: marking header, instructions, questions |
| `assessment-request.service.js` | Creates the assessment_requests row and queued job together so both agree; called by surfaces (Flow, portal) |
| `assessment-revision.service.js` | Re-renders and sends an edited paper without calling a model; backs the review Flow's Edit path |
| `assessment-scheme-board.renderer.js` | (unmapped) |
| `assessment-selection.js` | Names questions inside a paper tree and builds the smaller tree from ticked or removed names |
| `assessment-vocabulary.js` | One shared map of grade and subject display names, replacing copies in Flow endpoint, orchestrator, revision |
| `bloom-ceiling.js` | (unmapped) |
| `blueprint-check.js` | Reads a board-pattern paper back against its table of specification for thinking-level mark splits (bd-5jmnfj.2) |
| `board-layout.js` | (unmapped) |
| `board-writer.js` | (unmapped) |
| `book-content.service.js` | Fetches textbook pages for a chapter or page list and assembles them under '=== Page N ===' markers for prompts |
| `composition-criteria.js` | Fixed marking criteria templates for written compositions, scaled to a question's marks |
| `english-check.js` | Code-checks English items: anagram MCQ key correctness and rhyming-word items set on poem lines |
| `fde-accept-alternatives.js` | (unmapped) |
| `fde-accept-line.js` | (unmapped) |
| `fde-answer-repeats.js` | (unmapped) |
| `fde-answer-sheet-wording.js` | (unmapped) |
| `fde-banned-words.js` | (unmapped) |
| `fde-circuit-frame.js` | (unmapped) |
| `fde-common-error-check.js` | (unmapped) |
| `fde-common-error-numbers.js` | (unmapped) |
| `fde-common-error-series.js` | (unmapped) |
| `fde-concept-caps.js` | (unmapped) |
| `fde-concept-count.js` | (unmapped) |
| `fde-concept-repeats.js` | (unmapped) |
| `fde-cross-item-answers.js` | (unmapped) |
| `fde-directed-tasks.js` | (unmapped) |
| `fde-division-steps.js` | (unmapped) |
| `fde-early-dupes.js` | (unmapped) |
| `fde-early-english-accepts.js` | (unmapped) |
| `fde-early-english-fixes-2.js` | (unmapped) |
| `fde-early-english-fixes.js` | (unmapped) |
| `fde-early-giveaways.js` | (unmapped) |
| `fde-early-key-fixes.js` | (unmapped) |
| `fde-early-maths-fixes.js` | (unmapped) |
| `fde-early-prompt.js` | Prompts and reply checks for Grade 1-2 FDE practice papers, built on Grade 5's builder (bd-5jmnfj.4.1) |
| `fde-early-urdu-boxkeys.js` | (unmapped) |
| `fde-early-urdu-fixes.js` | (unmapped) |
| `fde-early-urdu-letters.js` | (unmapped) |
| `fde-early-urdu-marking.js` | (unmapped) |
| `fde-early-urdu-mcq.js` | (unmapped) |
| `fde-early-urdu-oral.js` | (unmapped) |
| `fde-early-urdu-repeat.js` | (unmapped) |
| `fde-early-urdu-topic.js` | (unmapped) |
| `fde-early-urdu-verbs.js` | (unmapped) |
| `fde-early-urdu-walk.js` | (unmapped) |
| `fde-early-urdu-wordbox.js` | (unmapped) |
| `fde-early-writer.js` | Writes a Grade 1-2 FDE practice paper section by section with pictures and an oral part (bd-5jmnfj.4.1) |
| `fde-english-r3-mends.js` | (unmapped) |
| `fde-fraction-giveaway.js` | (unmapped) |
| `fde-frame-bank.js` | (unmapped) |
| `fde-g1-scene-accept.js` | (unmapped) |
| `fde-g1-story-question.js` | (unmapped) |
| `fde-g5-criteria-2.js` | (unmapped) |
| `fde-g5-criteria.js` | (unmapped) |
| `fde-g5-key-fixes-2.js` | (unmapped) |
| `fde-g5-key-fixes.js` | (unmapped) |
| `fde-g5-lang-checks.js` | (unmapped) |
| `fde-g5-lang-fixes.js` | (unmapped) |
| `fde-g5-lang-giveaways.js` | (unmapped) |
| `fde-g5-lang-key-mends.js` | (unmapped) |
| `fde-g5-lang-repeats.js` | (unmapped) |
| `fde-g5-paper-giveaways.js` | (unmapped) |
| `fde-g5-urdu-mends.js` | (unmapped) |
| `fde-glyph-check.js` | (unmapped) |
| `fde-keep-missing.js` | (unmapped) |
| `fde-key-checks.js` | (unmapped) |
| `fde-key-pattern.js` | (unmapped) |
| `fde-key-term-giveaway.js` | (unmapped) |
| `fde-key-truth.js` | (unmapped) |
| `fde-lang-cross-asks.js` | (unmapped) |
| `fde-layout.js` | Fits model output into a board pattern's slots without editing wording; drops extras, counts marks, guards give-aways |
| `fde-lcm-ladder.js` | (unmapped) |
| `fde-listening-asks.js` | (unmapped) |
| `fde-listening-check.js` | (unmapped) |
| `fde-marks-line.js` | (unmapped) |
| `fde-match-block.js` | Prints Grade 1-2 match questions as two columns with a drawing gap (bd-5jmnfj.4.23) |
| `fde-match-rows.js` | (unmapped) |
| `fde-maths-keys.js` | (unmapped) |
| `fde-maths-marking.js` | (unmapped) |
| `fde-maths-name-giveaway.js` | (unmapped) |
| `fde-maths-repeats.js` | (unmapped) |
| `fde-maths-skill-twice.js` | (unmapped) |
| `fde-maths-slips.js` | (unmapped) |
| `fde-mcq-arithmetic.js` | (unmapped) |
| `fde-mcq-giveaway.js` | (unmapped) |
| `fde-mcq-key-tells.js` | (unmapped) |
| `fde-mcq-stem.js` | (unmapped) |
| `fde-mcq-truth.js` | (unmapped) |
| `fde-meaning-key.js` | (unmapped) |
| `fde-mid-key-fixes.js` | (unmapped) |
| `fde-mid-legend.js` | (unmapped) |
| `fde-mid-match.js` | (unmapped) |
| `fde-mid-maths-repeats.js` | (unmapped) |
| `fde-mid-steer.js` | (unmapped) |
| `fde-near-repeats.js` | (unmapped) |
| `fde-no-arrows.js` | (unmapped) |
| `fde-oral-fresh-words.js` | (unmapped) |
| `fde-oral-numbers.js` | (unmapped) |
| `fde-oral-prep.js` | (unmapped) |
| `fde-oral-sentence-repeats.js` | (unmapped) |
| `fde-oral-sheet.js` | Builds the oral teacher sheet in a Grade 1-2 marking scheme (bd-5jmnfj.4.4) |
| `fde-order-block.js` | Re-numbers Put-in-Order steps so the printed numbering never gives away the key (bd-5jmnfj.4.46) |
| `fde-order-check.js` | (unmapped) |
| `fde-part-name.js` | (unmapped) |
| `fde-pick-key.js` | (unmapped) |
| `fde-picture-block.js` | Lays out a Grade 1-2 picture item from an embedded data-URI image (bd-5jmnfj.4.3) |
| `fde-picture-describe.js` | (unmapped) |
| `fde-picture-inset-frame.js` | (unmapped) |
| `fde-picture-kie.js` | Requests Grade 1-2 object/scene images from Kie nano-banana-pro: create, poll, download (bd-5jmnfj.4.3) |
| `fde-picture-optional.js` | (unmapped) |
| `fde-picture-scene.js` | (unmapped) |
| `fde-picture-svg.js` | Draws Grade 1-2 pictures as black-and-white SVG: dots, shapes, clock, plant (bd-5jmnfj.4.3) |
| `fde-picture-word-count.js` | (unmapped) |
| `fde-pictures.js` | Resolves every picture on a Grade 1-2 paper to a data-URI src before the paper is saved (bd-5jmnfj.4.3) |
| `fde-place-digit.js` | (unmapped) |
| `fde-placeholder-check.js` | (unmapped) |
| `fde-poem-title-giveaway.js` | (unmapped) |
| `fde-printed-letter-note.js` | (unmapped) |
| `fde-punctuate-check.js` | (unmapped) |
| `fde-read-aloud-antecedent.js` | (unmapped) |
| `fde-read-aloud-grammar.js` | (unmapped) |
| `fde-reader.js` | Model reader pass that flags Section A Q1 items answerable from text printed elsewhere on the paper |
| `fde-religious-terms.js` | (unmapped) |
| `fde-render-v37.js` | (unmapped) |
| `fde-scheme-checks.js` | (unmapped) |
| `fde-scheme-cover.js` | (unmapped) |
| `fde-scheme-figures.js` | (unmapped) |
| `fde-scheme-shape.js` | (unmapped) |
| `fde-science-giveaway-drop.js` | (unmapped) |
| `fde-science-key-points.js` | (unmapped) |
| `fde-science-key-stem.js` | (unmapped) |
| `fde-science-keys.js` | (unmapped) |
| `fde-science-mcq-reask.js` | (unmapped) |
| `fde-science-option-keys.js` | (unmapped) |
| `fde-science-r2.js` | (unmapped) |
| `fde-science-repeats.js` | (unmapped) |
| `fde-science-shared-facts.js` | (unmapped) |
| `fde-science-task-repeats.js` | (unmapped) |
| `fde-scramble-block.js` | (unmapped) |
| `fde-sentence-count.js` | (unmapped) |
| `fde-situation-check.js` | (unmapped) |
| `fde-slot-fit.js` | (unmapped) |
| `fde-stem-check.js` | One-read check of each question against its answer and marking; rewords incoherent stems (bd-5jmnfj.22) |
| `fde-stem-repeats.js` | (unmapped) |
| `fde-sub-answers.js` | (unmapped) |
| `fde-task-line.js` | (unmapped) |
| `fde-teacher-slot.js` | (unmapped) |
| `fde-tense-count.js` | (unmapped) |
| `fde-urdu-antonyms.js` | (unmapped) |
| `fde-urdu-common-error-lang.js` | (unmapped) |
| `fde-urdu-first-action.js` | (unmapped) |
| `fde-urdu-form-lines.js` | (unmapped) |
| `fde-urdu-g5-checks.js` | (unmapped) |
| `fde-urdu-nonword.js` | (unmapped) |
| `fde-urdu-notes.js` | (unmapped) |
| `fde-urdu-punct.js` | (unmapped) |
| `fde-urdu-quoted-word.js` | (unmapped) |
| `fde-urdu-r3-checks.js` | (unmapped) |
| `fde-urdu-r4.js` | (unmapped) |
| `fde-urdu-spelling.js` | (unmapped) |
| `fde-urdu-use-word.js` | (unmapped) |
| `fde-urdu-walk-all.js` | (unmapped) |
| `fde-who-said-check.js` | (unmapped) |
| `fde-whole-marks.js` | (unmapped) |
| `fde-word-box-spare.js` | (unmapped) |
| `fde-word-box.js` | (unmapped) |
| `fde-work-space.js` | (unmapped) |
| `free-secondary-checks.js` | (unmapped) |
| `free-secondary-chrome.data.json` | (unmapped) |
| `free-secondary-chrome.js` | (unmapped) |
| `free-secondary-grammar.js` | (unmapped) |
| `free-secondary-keys.js` | (unmapped) |
| `free-secondary-levels.js` | (unmapped) |
| `free-secondary-pool.js` | (unmapped) |
| `free-secondary-print.js` | (unmapped) |
| `free-secondary-review.js` | (unmapped) |
| `free-secondary-rewrite.js` | (unmapped) |
| `free-secondary-rules.js` | (unmapped) |
| `free-secondary-scheme.js` | (unmapped) |
| `free-secondary-tidy.js` | (unmapped) |
| `free-secondary.service.js` | (unmapped) |
| `gk-sst-en-prompts.json` | (unmapped) |
| `grade-gate.js` | (unmapped) |
| `ict-prompts.json` | Thirteen generation prompts (system/user, per subject) used unchanged by assessment-generation.service.js |
| `marking-scheme.js` | Normalises a model-written marking scheme to the pattern slot: point sums, kinds, code-point caps |
| `maths-check.js` | Recomputes plain arithmetic in a maths marking scheme with exact BigInt fractions to catch wrong keys |
| `prompts-6-12.js` | (unmapped) |
| `prompts-review-pending.json` | (unmapped) |
| `question-types-6-12.data.json` | (unmapped) |
| `question-types-6-12.js` | (unmapped) |
| `question-types.js` | Per-subject catalogue of question types and default counts the generation prompts understand |
| `repeat-guard.js` | (unmapped) |
| `scheme-accept-check.js` | (unmapped) |
| `subject-config.js` | (unmapped) |
| `topic-key.renderer.js` | Answer-key extras for topic papers: topic per question and one-line-per-topic summary |

## Who reads this (all, generated)
- `assessment-browse.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:1621:707d6edd` · `bot/shared/services/portal-ready-whatsapp.service.js:218:0aebdda4` · `bot/shared/services/share-send.service.js:76:0803f77f`
- `assessment-changes.js` ← imported by `bot/shared/services/assessment/assessment-editor.service.js:17:ef7581ec`
- `assessment-delivery.js` ← imported by `bot/shared/services/assessment/assessment-orchestrator.service.js:55:343662fe` · `bot/shared/services/assessment/assessment-revision.service.js:27:343662fe`
- `assessment-edit.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:284:1dd0e6b5` · `bot/shared/services/assessment/assessment-changes.js:13:078b0c58` · `bot/shared/services/assessment/assessment-editor.service.js:12:078b0c58` · `bot/shared/services/assessment/assessment-revision.service.js:23:078b0c58`
- `assessment-editor.service.js` ← imported by `bot/shared/routes/internal-assessment-edit.routes.js:54:6752ab81`
- `assessment-feedback.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:354:95c8879a` · `bot/whatsapp-bot.js:901:e2c49386` · `bot/shared/services/assessment/assessment-orchestrator.service.js:926:77279d94`
- `assessment-format.js` ← imported by `bot/scripts/assessment/backfill-paper-versions.js:104:bb283576` · `bot/shared/routes/assessment-gen-endpoint.js:1797:5ff2c133` · `bot/shared/services/assessment/assessment-orchestrator.service.js:39:02db64e0` · `bot/shared/services/assessment/assessment-revision.service.js:24:02db64e0`
- `assessment-generation.service.js` ← imported by `scripts/assessment/eval-per-type-counts.js:38:cdaf4880` · `scripts/assessment/eval-run.js:43:cdaf4880` · `bot/shared/services/assessment/assessment-orchestrator.service.js:32:c19e5a2e` · `bot/shared/services/assessment/free-secondary.service.js:41:da50c4cc`
- `assessment-json.util.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:24:25a8c06a` · `bot/shared/services/assessment/free-secondary.service.js:38:25a8c06a`
- `assessment-orchestrator.service.js` ← imported by `bot/workers/sqs-worker.js:654:9e887360` · `bot/shared/services/assessment/assessment-revision.service.js:147:68277ac4`
- `assessment-order.js` ← imported by `bot/shared/services/assessment/assessment-paper.renderer.js:23:0e1ab750` · `bot/shared/services/assessment/assessment-selection.js:2:0e1ab750`
- `assessment-paper-board.renderer.js` ← imported by `bot/shared/services/assessment/assessment-paper.renderer.js:357:029998fa`
- `assessment-paper-fde.renderer.js` ← imported by `bot/shared/services/assessment/assessment-editor.service.js:19:2af0ac15` · `bot/shared/services/assessment/assessment-generation.service.js:1732:1f701a06` · `bot/shared/services/assessment/assessment-orchestrator.service.js:35:2af0ac15` · `bot/shared/services/assessment/assessment-paper-view.service.js:70:2af0ac15` (+2: `python3 kg/kg.py who-reads assessment-paper-fde.renderer.js`)
- `assessment-paper-view.service.js` ← imported by `bot/shared/routes/internal-assessment-view.routes.js:20:0107c1d0`
- `assessment-paper.renderer.js` ← imported by `bot/scripts/assessment/backfill-paper-versions.js:103:10ace4e3` · `bot/shared/routes/assessment-gen-endpoint.js:810:7568e5aa` · `scripts/assessment/eval-run.js:44:50489814` · `bot/shared/services/assessment/assessment-changes.js:61:0fc01171` (+8: `python3 kg/kg.py who-reads assessment-paper.renderer.js`)
- `assessment-request.service.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:2069:9f9f0555` · `bot/shared/routes/internal-api.routes.js:1869:9f9f0555`
- `assessment-revision.service.js` ← imported by `bot/scripts/assessment/backfill-paper-versions.js:124:e1ed7ff3` · `bot/shared/routes/assessment-gen-endpoint.js:286:75a68a6a` · `bot/shared/services/assessment/assessment-browse.service.js:207:2a120a3f` · `bot/shared/services/assessment/assessment-editor.service.js:11:638c5c30` (+1: `python3 kg/kg.py who-reads assessment-revision.service.js`)
- `assessment-scheme-board.renderer.js` ← imported by `bot/shared/services/assessment/assessment-paper.renderer.js:483:a13cc5e1`
- `assessment-selection.js` ← imported by `bot/scripts/assessment/backfill-paper-versions.js:42:3ca84ad0` · `bot/shared/routes/assessment-gen-endpoint.js:283:d0d392e8` · `bot/shared/services/assessment/assessment-changes.js:14:c8c747c7` · `bot/shared/services/assessment/assessment-editor.service.js:13:c8c747c7` (+2: `python3 kg/kg.py who-reads assessment-selection.js`)
- `assessment-vocabulary.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:36:0bbbf370` · `bot/shared/services/portal-ready-whatsapp.service.js:50:ac2a62e8` · `bot/shared/services/share-send.service.js:123:ac2a62e8` · `dashboard/services/coach-school-card.service.js:48:41b16ae0` (+7: `python3 kg/kg.py who-reads assessment-vocabulary.js`)
- `bloom-ceiling.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:26:8e9d7e4a` · `bot/shared/services/assessment/free-secondary.service.js:40:8e9d7e4a` · `bot/shared/services/assessment/repeat-guard.js:12:f2f45e82`
- `blueprint-check.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:768:2919ed2d` · `bot/shared/services/assessment/fde-early-writer.js:23:6eac933d`
- `board-layout.js` ← imported by `bot/shared/services/assessment/board-writer.js:14:38ee8d98`
- `board-writer.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:773:27a9aa34`
- `book-content.service.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:25:f17a4a91` · `bot/shared/services/lp-own-book.js:44:d840d659` · `scripts/assessment/eval-per-type-counts.js:37:f6eb81ab` · `scripts/assessment/eval-run.js:42:f6eb81ab` (+3: `python3 kg/kg.py who-reads book-content.service.js`)
- `composition-criteria.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:1300:4fa69c72` · `bot/shared/services/assessment/fde-g5-key-fixes.js:15:7777e707` · `bot/shared/services/assessment/fde-picture-word-count.js:11:7777e707`
- `english-check.js` ← imported by `bot/shared/services/assessment/fde-layout.js:631:ff9c711c`
- `fde-accept-alternatives.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:787:f6a4f752` · `bot/shared/services/assessment/fde-early-writer.js:32:4565fa79` · `bot/shared/services/assessment/fde-key-checks.js:15:e6405b14`
- `fde-accept-line.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:48:2c177a07`
- `fde-answer-repeats.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:764:a24b183f` · `bot/shared/services/assessment/fde-early-writer.js:28:534385ed` · `bot/shared/services/assessment/fde-oral-fresh-words.js:13:a1c69ffd`
- `fde-answer-sheet-wording.js` ← imported by `bot/shared/services/assessment/fde-g5-key-fixes.js:20:4caa27d1`
- `fde-banned-words.js` ← imported by `bot/shared/services/assessment/fde-early-prompt.js:15:16d27e9b`
- `fde-circuit-frame.js` ← imported by `bot/shared/services/assessment/fde-pictures.js:27:ed48c9c0`
- `fde-common-error-check.js` ← imported by `bot/shared/services/assessment/maths-check.js:20:d1e69729`
- `fde-common-error-numbers.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:32:4565fa79`
- `fde-common-error-series.js` ← imported by `bot/shared/services/assessment/fde-common-error-numbers.js:14:4989a28e`
- `fde-concept-caps.js` ← imported by `bot/shared/services/assessment/fde-g5-paper-giveaways.js:10:9a9507d6`
- `fde-concept-count.js` ← imported by `bot/shared/services/assessment/fde-g5-paper-giveaways.js:8:49457773`
- `fde-concept-repeats.js` ← imported by `bot/shared/services/assessment/fde-answer-repeats.js:43:dbd22d17`
- `fde-cross-item-answers.js` ← imported by `bot/shared/services/assessment/fde-g5-paper-giveaways.js:15:ec066ebd`
- `fde-directed-tasks.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:778:e80e08e0`
- `fde-division-steps.js` ← imported by `bot/shared/services/assessment/fde-maths-slips.js:16:8eb9eaaa` · `bot/shared/services/assessment/fde-mid-key-fixes.js:14:238cf801`
- `fde-early-dupes.js` ← imported by `bot/shared/services/assessment/fde-key-checks.js:14:63791c54`
- `fde-early-english-accepts.js` ← imported by `bot/shared/services/assessment/fde-early-english-fixes-2.js:16:31ad06e6`
- `fde-early-english-fixes-2.js` ← imported by `bot/shared/services/assessment/fde-early-english-fixes.js:14:1bbeebb2`
- `fde-early-english-fixes.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:32:4565fa79`
- `fde-early-giveaways.js` ← imported by `bot/shared/services/assessment/fde-g5-paper-giveaways.js:18:96b2f38f`
- `fde-early-key-fixes.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:32:4565fa79`
- `fde-early-maths-fixes.js` ← imported by `bot/shared/services/assessment/fde-early-key-fixes.js:20:47ca4b69`
- `fde-early-prompt.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:24:22239650` · `bot/shared/services/assessment/topics/topic-oral.js:9:5079b523`
- `fde-early-urdu-boxkeys.js` ← imported by `bot/shared/services/assessment/fde-early-urdu-fixes.js:19:6983f423` · `bot/shared/services/assessment/fde-g5-urdu-mends.js:13:6983f423`
- `fde-early-urdu-fixes.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:32:4565fa79`
- `fde-early-urdu-letters.js` ← imported by `bot/shared/services/assessment/fde-key-checks.js:12:4e743537`
- `fde-early-urdu-marking.js` ← imported by `bot/shared/services/assessment/fde-early-urdu-fixes.js:18:44614c31`
- `fde-early-urdu-mcq.js` ← imported by `bot/shared/services/assessment/patterns/early/g1-urdu.js:10:c4d09434` · `bot/shared/services/assessment/patterns/early/g2-urdu.js:11:744ecc40`
- `fde-early-urdu-oral.js` ← imported by `bot/shared/services/assessment/fde-early-prompt.js:102:14428951` · `bot/shared/services/assessment/fde-early-writer.js:31:dd6c4ae1`
- `fde-early-urdu-repeat.js` ← imported by `bot/shared/services/assessment/fde-key-checks.js:17:67297c15`
- `fde-early-urdu-topic.js` ← imported by `bot/shared/services/assessment/fde-early-urdu-fixes.js:15:eea572d1` · `bot/shared/services/assessment/patterns/early/g2-urdu.js:10:00337562`
- `fde-early-urdu-verbs.js` ← imported by `bot/shared/services/assessment/fde-early-urdu-fixes.js:17:961cafbf`
- `fde-early-urdu-walk.js` ← imported by `bot/shared/services/assessment/fde-early-urdu-marking.js:10:5f57bb35` · `bot/shared/services/assessment/fde-early-urdu-repeat.js:10:5f57bb35` · `bot/shared/services/assessment/fde-early-urdu-topic.js:13:5f57bb35` · `bot/shared/services/assessment/fde-early-urdu-verbs.js:13:5f57bb35` (+3: `python3 kg/kg.py who-reads fde-early-urdu-walk.js`)
- `fde-early-urdu-wordbox.js` ← imported by `bot/shared/services/assessment/fde-early-urdu-fixes.js:16:1232e0f8` · `bot/shared/services/assessment/fde-key-checks.js:11:be73c6e7`
- `fde-early-writer.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:771:c2c60a6e` · `bot/shared/services/assessment/topics/topic-oral.js:10:85bcb75c`
- `fde-english-r3-mends.js` ← imported by `bot/shared/services/assessment/fde-early-english-fixes-2.js:15:12c58782` · `bot/shared/services/assessment/fde-g5-lang-fixes.js:14:dfe6b5c8`
- `fde-fraction-giveaway.js` ← imported by `bot/shared/services/assessment/fde-g5-paper-giveaways.js:9:9a2f888d`
- `fde-frame-bank.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:47:4b13be55`
- `fde-g1-scene-accept.js` ← imported by `bot/shared/services/assessment/fde-g5-key-fixes.js:18:3bf42f3c`
- `fde-g1-story-question.js` ← imported by `bot/shared/services/assessment/fde-early-key-fixes.js:21:c2eb74db`
- `fde-g5-criteria-2.js` ← imported by `bot/shared/services/assessment/fde-g5-criteria.js:15:e829b01c`
- `fde-g5-criteria.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:45:6b57be4f`
- `fde-g5-key-fixes-2.js` ← imported by `bot/shared/services/assessment/fde-g5-key-fixes.js:16:9785acba`
- `fde-g5-key-fixes.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:767:80c66852`
- `fde-g5-lang-checks.js` ← imported by `bot/shared/services/assessment/fde-g5-lang-giveaways.js:14:ee0025a6`
- `fde-g5-lang-fixes.js` ← imported by `bot/shared/services/assessment/fde-g5-key-fixes.js:17:9e630b6b`
- `fde-g5-lang-giveaways.js` ← imported by `bot/shared/services/assessment/fde-g5-paper-giveaways.js:13:02997a8b`
- `fde-g5-lang-key-mends.js` ← imported by `bot/shared/services/assessment/fde-g5-lang-fixes.js:12:d750b29c`
- `fde-g5-lang-repeats.js` ← imported by `bot/shared/services/assessment/fde-g5-lang-giveaways.js:16:23608ff8`
- `fde-g5-paper-giveaways.js` ← imported by `bot/shared/services/assessment/fde-answer-repeats.js:46:bdee19a5`
- `fde-g5-urdu-mends.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:796:ce953de9`
- `fde-glyph-check.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:791:5c8cbba8`
- `fde-keep-missing.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:32:4565fa79`
- `fde-key-checks.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:30:f9377eeb`
- `fde-key-pattern.js` ← imported by `bot/shared/services/assessment/fde-layout.js:372:10468b6e`
- `fde-key-term-giveaway.js` ← imported by `bot/shared/services/assessment/fde-g5-paper-giveaways.js:12:faebbeb8`
- `fde-key-truth.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:780:c7ed36f2` · `bot/shared/services/assessment/fde-mid-key-fixes.js:15:67c8aed0` · `bot/shared/services/assessment/fde-scheme-shape.js:17:7b82497a`
- `fde-lang-cross-asks.js` ← imported by `bot/shared/services/assessment/fde-g5-lang-giveaways.js:12:ffbd23be` · `bot/shared/services/assessment/fde-g5-lang-repeats.js:13:17c894b2` · `bot/shared/services/assessment/fde-tense-count.js:12:17c894b2`
- `fde-layout.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:762:bc88b652` · `bot/shared/services/assessment/fde-early-writer.js:20:bb20a8b5`
- `fde-lcm-ladder.js` ← imported by `bot/shared/services/assessment/maths-check.js:21:bc7f1e44`
- `fde-listening-asks.js` ← imported by `bot/shared/services/assessment/fde-early-prompt.js:101:37e97e39`
- `fde-listening-check.js` ← imported by `bot/shared/services/assessment/fde-early-prompt.js:16:a88355ce`
- `fde-marks-line.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:46:c760ca0d`
- `fde-match-block.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:35:b8607cb6` · `bot/shared/services/assessment/fde-match-rows.js:13:c4b3c7b6` · `bot/shared/services/assessment/fde-mid-match.js:9:4a27b46f` · `bot/shared/services/assessment/patterns/early/g1-gk.js:10:5690ba0f` (+1: `python3 kg/kg.py who-reads fde-match-block.js`)
- `fde-match-rows.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:785:4f4a4788`
- `fde-maths-keys.js` ← imported by `bot/shared/services/assessment/fde-g5-key-fixes-2.js:16:07d17017`
- `fde-maths-marking.js` ← imported by `bot/shared/services/assessment/fde-early-key-fixes.js:22:f1ada694` · `bot/shared/services/assessment/fde-maths-keys.js:17:e0907623`
- `fde-maths-name-giveaway.js` ← imported by `bot/shared/services/assessment/fde-g5-paper-giveaways.js:17:a22861fc`
- `fde-maths-repeats.js` ← imported by `bot/shared/services/assessment/fde-g5-paper-giveaways.js:11:c5ffba06`
- `fde-maths-skill-twice.js` ← imported by `bot/shared/services/assessment/fde-g5-paper-giveaways.js:14:4117cf7c`
- `fde-maths-slips.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:779:830bf0bb` · `bot/shared/services/assessment/fde-answer-repeats.js:41:852da23b` · `bot/shared/services/assessment/fde-mid-key-fixes.js:17:7fa6a219`
- `fde-mcq-arithmetic.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:777:06e6cac8`
- `fde-mcq-giveaway.js` ← imported by `bot/shared/services/assessment/fde-g5-paper-giveaways.js:7:358ea885`
- `fde-mcq-key-tells.js` ← imported by `bot/shared/services/assessment/fde-g5-lang-giveaways.js:11:15a0b7d7`
- `fde-mcq-stem.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:782:9a5fec4f`
- `fde-mcq-truth.js` ← imported by `bot/shared/services/assessment/fde-g5-lang-giveaways.js:10:78dda5cb`
- `fde-meaning-key.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:781:13c70489`
- `fde-mid-key-fixes.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:789:b6025623`
- `fde-mid-legend.js` ← imported by `bot/shared/services/assessment/patterns/mid/chrome.js:13:f55083fd`
- `fde-mid-match.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:36:9bfe89a5`
- `fde-mid-maths-repeats.js` ← imported by `bot/shared/services/assessment/fde-answer-repeats.js:40:fc9f5bc5`
- `fde-mid-steer.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:776:d271b2b7`
- `fde-near-repeats.js` ← imported by `bot/shared/services/assessment/fde-answer-repeats.js:39:cc246831` · `bot/shared/services/assessment/fde-concept-caps.js:16:3a65e219` · `bot/shared/services/assessment/fde-concept-count.js:14:3a65e219` · `bot/shared/services/assessment/fde-concept-repeats.js:24:84732600` (+24: `python3 kg/kg.py who-reads fde-near-repeats.js`)
- `fde-no-arrows.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:775:236e10eb` · `bot/shared/services/assessment/fde-early-writer.js:27:236e10eb`
- `fde-oral-fresh-words.js` ← imported by `bot/shared/services/assessment/fde-early-urdu-oral.js:12:7e70469e` · `bot/shared/services/assessment/fde-early-writer.js:31:dd6c4ae1`
- `fde-oral-numbers.js` ← imported by `bot/shared/services/assessment/fde-early-prompt.js:100:52238705`
- `fde-oral-prep.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:38:100445d4`
- `fde-oral-sentence-repeats.js` ← imported by `bot/shared/services/assessment/fde-answer-repeats.js:45:66479adf`
- `fde-oral-sheet.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:37:8803150c` · `bot/shared/services/assessment/assessment-paper.renderer.js:492:efc840c0`
- `fde-order-block.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:40:d67de7ed` · `bot/shared/services/assessment/fde-early-writer.js:26:24e8927b` · `bot/shared/services/assessment/fde-scramble-block.js:12:c5fa47a1`
- `fde-order-check.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:43:b0226f32` · `bot/shared/services/assessment/fde-layout.js:1762:c55787cd`
- `fde-part-name.js` ← imported by `bot/shared/services/assessment/fde-scheme-cover.js:19:357371dc`
- `fde-pick-key.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:42:18c4417c`
- `fde-picture-block.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:33:5632313c`
- `fde-picture-describe.js` ← imported by `bot/shared/services/assessment/fde-picture-kie.js:10:00c3c8dd` · `bot/shared/services/assessment/fde-pictures.js:26:00c3c8dd`
- `fde-picture-inset-frame.js` ← imported by `bot/shared/services/assessment/fde-pictures.js:28:970f102a`
- `fde-picture-kie.js` ← imported by `bot/shared/services/assessment/fde-pictures.js:25:1aa3a461`
- `fde-picture-optional.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:25:2672d739`
- `fde-picture-scene.js` ← imported by `bot/shared/services/assessment/fde-pictures.js:268:c02928fb` · `bot/shared/services/assessment/fde-urdu-g5-checks.js:10:9678db11`
- `fde-picture-svg.js` ← imported by `bot/shared/services/assessment/fde-circuit-frame.js:10:b1d0cf72` · `bot/shared/services/assessment/fde-pictures.js:24:aff3165e`
- `fde-picture-word-count.js` ← imported by `bot/shared/services/assessment/fde-g5-key-fixes.js:19:ec2766d5`
- `fde-pictures.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:3137:bb0952f4` · `bot/shared/services/assessment/fde-early-writer.js:39:2b0fc696`
- `fde-place-digit.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:798:b9e99df9`
- `fde-placeholder-check.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:790:7d3764c0`
- `fde-poem-title-giveaway.js` ← imported by `bot/shared/services/assessment/fde-g5-urdu-mends.js:12:8facdee8`
- `fde-printed-letter-note.js` ← imported by `bot/shared/services/assessment/marking-scheme.js:25:c7db78d2`
- `fde-punctuate-check.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:792:8a307e4c`
- `fde-read-aloud-antecedent.js` ← imported by `bot/shared/services/assessment/fde-early-prompt.js:102:14428951`
- `fde-read-aloud-grammar.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:32:4565fa79`
- `fde-reader.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:769:6a56d59d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:58:de0a339b`
- `fde-religious-terms.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:1217:de2fc872` · `bot/shared/services/assessment/fde-key-checks.js:13:bbb8c6ee`
- `fde-render-v37.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:51:fbed5f0c` · `bot/shared/services/assessment/fde-oral-sheet.js:23:199daf53`
- `fde-scheme-checks.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:786:fc42f462`
- `fde-scheme-cover.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:49:16445aa5`
- `fde-scheme-figures.js` ← imported by `bot/shared/services/assessment/maths-check.js:19:97434eea`
- `fde-scheme-shape.js` ← imported by `bot/shared/services/assessment/fde-mid-key-fixes.js:16:8efd9a02`
- `fde-science-giveaway-drop.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:794:32faddc7` · `bot/shared/services/assessment/fde-science-mcq-reask.js:11:45eba715`
- `fde-science-key-points.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:793:df6c1d23`
- `fde-science-key-stem.js` ← imported by `bot/shared/services/assessment/fde-science-key-points.js:11:4f40d2ba`
- `fde-science-keys.js` ← imported by `bot/shared/services/assessment/fde-g5-key-fixes-2.js:15:91ae16b1`
- `fde-science-mcq-reask.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:795:d0f4740e`
- `fde-science-option-keys.js` ← imported by `bot/shared/services/assessment/fde-science-giveaway-drop.js:16:62c07446`
- `fde-science-r2.js` ← imported by `bot/shared/services/assessment/fde-science-keys.js:28:e3199233` · `bot/shared/services/assessment/marking-scheme.js:27:4cc7bfde`
- `fde-science-repeats.js` ← imported by `bot/shared/services/assessment/fde-g5-paper-giveaways.js:16:d3f5bbb7`
- `fde-science-shared-facts.js` ← imported by `bot/shared/services/assessment/fde-science-repeats.js:13:27576454`
- `fde-science-task-repeats.js` ← imported by `bot/shared/services/assessment/fde-science-repeats.js:14:493eed94`
- `fde-scramble-block.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:29:67039c38`
- `fde-sentence-count.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:765:e965d64b`
- `fde-situation-check.js` ← imported by `bot/shared/services/assessment/fde-answer-repeats.js:44:eb0ad918`
- `fde-slot-fit.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:34:e9241106`
- `fde-stem-check.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:770:f84e0d14` · `bot/shared/services/assessment/assessment-orchestrator.service.js:57:c549dad8`
- `fde-stem-repeats.js` ← imported by `bot/shared/services/assessment/fde-answer-repeats.js:42:54aa04fb`
- `fde-sub-answers.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:39:1123ed7a` · `bot/shared/services/assessment/marking-scheme.js:26:ba6f9a37`
- `fde-task-line.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:44:dc7e1520` · `bot/shared/services/assessment/fde-layout.js:1761:589a0819`
- `fde-teacher-slot.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:50:16a34110`
- `fde-tense-count.js` ← imported by `bot/shared/services/assessment/fde-g5-lang-giveaways.js:13:36f7b841`
- `fde-urdu-antonyms.js` ← imported by `bot/shared/services/assessment/fde-g5-urdu-mends.js:10:bfd06f72`
- `fde-urdu-common-error-lang.js` ← imported by `bot/shared/services/assessment/fde-early-urdu-fixes.js:22:177fbdc7`
- `fde-urdu-first-action.js` ← imported by `bot/shared/services/assessment/fde-g5-urdu-mends.js:14:931ad091`
- `fde-urdu-form-lines.js` ← imported by `bot/shared/services/assessment/fde-g5-urdu-mends.js:11:46b3abb0`
- `fde-urdu-g5-checks.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:797:7596fb20`
- `fde-urdu-nonword.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:788:afc1d712` · `bot/shared/services/assessment/fde-early-writer.js:32:4565fa79`
- `fde-urdu-notes.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:41:46241001`
- `fde-urdu-punct.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:799:b109b66c`
- `fde-urdu-quoted-word.js` ← imported by `bot/shared/services/assessment/fde-early-urdu-fixes.js:20:04c5fa5c` · `bot/shared/services/assessment/fde-key-checks.js:18:3d7f7eca`
- `fde-urdu-r3-checks.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:797:7596fb20` · `bot/shared/services/assessment/fde-key-checks.js:16:564627c5`
- `fde-urdu-r4.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:797:7596fb20` · `bot/shared/services/assessment/fde-early-writer.js:31:dd6c4ae1`
- `fde-urdu-spelling.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:3102:e1a516e2` · `bot/shared/services/assessment/fde-early-urdu-fixes.js:14:bc7f29e2`
- `fde-urdu-use-word.js` ← imported by `bot/shared/services/assessment/fde-early-urdu-fixes.js:21:7f1faf90` · `bot/shared/services/assessment/fde-key-checks.js:19:3104fae7`
- `fde-urdu-walk-all.js` ← imported by `bot/shared/services/assessment/fde-poem-title-giveaway.js:10:449a8696` · `bot/shared/services/assessment/fde-urdu-antonyms.js:10:449a8696` · `bot/shared/services/assessment/fde-urdu-first-action.js:9:646b7d66` · `bot/shared/services/assessment/fde-urdu-form-lines.js:13:449a8696` (+2: `python3 kg/kg.py who-reads fde-urdu-walk-all.js`)
- `fde-who-said-check.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:31:dd6c4ae1`
- `fde-whole-marks.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:797:7596fb20`
- `fde-word-box-spare.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:784:59f4763f`
- `fde-word-box.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:783:e2f2ae8b`
- `fde-work-space.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:32:3cb44865`
- `free-secondary-checks.js` ← imported by `bot/shared/services/assessment/free-secondary-grammar.js:8:9903993a` · `bot/shared/services/assessment/free-secondary-levels.js:14:9903993a` · `bot/shared/services/assessment/free-secondary-pool.js:11:9903993a` · `bot/shared/services/assessment/free-secondary-review.js:11:9903993a` (+2: `python3 kg/kg.py who-reads free-secondary-checks.js`)
- `free-secondary-chrome.data.json` ← imported by `bot/shared/services/assessment/free-secondary-chrome.js:10:5bc0d768`
- `free-secondary-chrome.js` ← imported by `bot/shared/services/assessment/assessment-paper.renderer.js:22:5b0cef62`
- `free-secondary-grammar.js` ← imported by `bot/shared/services/assessment/free-secondary.service.js:51:8af664f8`
- `free-secondary-keys.js` ← imported by `bot/shared/services/assessment/free-secondary-checks.js:22:b3df4c03` · `bot/shared/services/assessment/free-secondary-pool.js:12:fddc990c` · `bot/shared/services/assessment/free-secondary-review.js:12:fce97b64` · `bot/shared/services/assessment/free-secondary.service.js:46:af3bea18`
- `free-secondary-levels.js` ← imported by `bot/shared/services/assessment/free-secondary.service.js:50:1ba7ea75`
- `free-secondary-pool.js` ← imported by `bot/shared/services/assessment/free-secondary.service.js:48:9493296f`
- `free-secondary-print.js` ← imported by `bot/shared/services/assessment/assessment-paper.renderer.js:21:bfc14719` · `bot/shared/services/assessment/free-secondary-chrome.js:12:bfc14719`
- `free-secondary-review.js` ← imported by `bot/shared/services/assessment/free-secondary.service.js:49:1cf0eae1`
- `free-secondary-rewrite.js` ← imported by `bot/shared/services/assessment/free-secondary.service.js:47:70e7217c`
- `free-secondary-rules.js` ← imported by `bot/shared/services/assessment/free-secondary-checks.js:21:1b1b4639` · `bot/shared/services/assessment/free-secondary-review.js:13:02e61d53` · `bot/shared/services/assessment/free-secondary-rewrite.js:12:5de8c5d0` · `bot/shared/services/assessment/free-secondary.service.js:44:2f30841c`
- `free-secondary-scheme.js` ← imported by `bot/shared/services/assessment/free-secondary-checks.js:23:fc5ac00f`
- `free-secondary-tidy.js` ← imported by `bot/shared/services/assessment/free-secondary.service.js:52:6d81f22c`
- `free-secondary.service.js` ← imported by `bot/shared/services/assessment/assessment-orchestrator.service.js:624:392eefc6`
- `grade-gate.js` ← imported by `bot/shared/config/feature-flags.js:14:f16f55f6` · `bot/shared/routes/assessment-gen-endpoint.js:41:f16f55f6` · `bot/shared/routes/internal-api.routes.js:1560:f16f55f6`
- `ict-prompts.json` ← imported by `bot/shared/services/assessment/free-secondary.service.js:43:07597eaf` · `bot/shared/services/assessment/prompts-6-12.js:10:07597eaf`
- `marking-scheme.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:763:6a87ce14` · `bot/shared/services/assessment/blueprint-check.js:11:f0655cc4` · `bot/shared/services/assessment/fde-early-writer.js:21:6a87ce14`
- `maths-check.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:766:82cd9d27` · `bot/shared/services/assessment/fde-early-writer.js:22:82cd9d27` · `bot/shared/services/assessment/fde-layout.js:630:b9e22d6a`
- `prompts-6-12.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:2684:3659f7c9` · `bot/shared/services/assessment/board-6-12/section-prompt.js:7:422013a5`
- `question-types-6-12.data.json` ← imported by `bot/shared/services/assessment/free-secondary-chrome.js:11:f1235a2a` · `bot/shared/services/assessment/question-types-6-12.js:13:15079dd2`
- `question-types-6-12.js` ← imported by `bot/shared/services/assessment/question-types.js:112:cfb280e0`
- `question-types.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:27:6c8431b2` · `bot/shared/routes/internal-api.routes.js:1662:6c8431b2` · `scripts/assessment/eval-plan.js:16:3a2d72d0` · `scripts/assessment/eval-per-type-counts.js:39:3a2d72d0` (+4: `python3 kg/kg.py who-reads question-types.js`)
- `repeat-guard.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:800:e2df476b` · `bot/shared/services/assessment/assessment-orchestrator.service.js:60:8151c410`
- `scheme-accept-check.js` ← imported by `bot/shared/services/assessment/marking-scheme.js:24:5988947e`
- `subject-config.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:2677:0c9e647f` · `bot/shared/services/assessment/assessment-revision.service.js:33:0c9e647f` · `bot/shared/services/assessment/book-content.service.js:56:746de04c` · `bot/shared/services/assessment/free-secondary.service.js:42:0c9e647f` (+1: `python3 kg/kg.py who-reads subject-config.js`)
- `topic-key.renderer.js` ← imported by `bot/shared/services/assessment/assessment-orchestrator.service.js:34:370417ae` · `bot/shared/services/assessment/assessment-paper.renderer.js:575:9064e1bd`
- column `assessment_papers.attempt` (written by `assessment-revision.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:143:1661513d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:422:ea7ca533`
- column `assessment_papers.edited_from` (written by `assessment-revision.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:144:8f1aa092` · `bot/scripts/assessment/repair-backfilled-v1-created-at.js:69:e3ab478d` · `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:421:62e6c849`
- column `assessment_papers.exam_json` (written by `assessment-revision.service.js`) ← read by `bot/shared/services/assessment/repeat-guard.js:82:57ea56b0`
- column `assessment_papers.question_count` (written by `assessment-revision.service.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:419:2e6454e9`
- column `assessment_papers.request_id` (written by `assessment-orchestrator.service.js`, `assessment-revision.service.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d` · `bot/shared/services/assessment/assessment-feedback.service.js:67:760b644f` · `bot/shared/services/assessment/assessment-orchestrator.service.js:420:a62a38f3` · `bot/shared/services/assessment/assessment-revision.service.js:108:dc9b27f2` (+1: `python3 kg/kg.py who-reads assessment_papers.request_id`)
- column `assessment_papers.status` (written by `assessment-orchestrator.service.js`, `assessment-revision.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:169:d06d822d` · `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:145:71e60a4b` · `bot/shared/services/assessment/assessment-revision.service.js:108:dc9b27f2` (+1: `python3 kg/kg.py who-reads assessment_papers.status`)
- column `assessment_papers.total_marks` (written by `assessment-revision.service.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:419:2e6454e9`
- column `assessment_papers.updated_at` (written by `assessment-revision.service.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:419:2e6454e9`
- column `assessment_requests.chapter_number` (written by `assessment-request.service.js`) ← read by `bot/shared/services/nudges/topic-end-nudge.service.js:161:00c6277c` · `bot/shared/services/portal-ready-whatsapp.service.js:119:b99a43d6` · `bot/shared/services/share-send.service.js:116:1c461d0f` · `bot/shared/services/assessment/assessment-feedback.service.js:70:10ae5357`
- column `assessment_requests.grade_code` (written by `assessment-request.service.js`) ← read by `bot/shared/services/nudges/topic-end-nudge.service.js:160:59e24eac` · `bot/shared/services/portal-ready-whatsapp.service.js:119:b99a43d6` · `bot/shared/services/share-send.service.js:116:1c461d0f` · `bot/shared/services/assessment/assessment-feedback.service.js:70:10ae5357` (+1: `python3 kg/kg.py who-reads assessment_requests.grade_code`)
- column `assessment_requests.page_ranges` (written by `assessment-request.service.js`) ← read by `bot/shared/services/assessment/repeat-guard.js:70:73071f2a`
- column `assessment_requests.question_count` (written by `assessment-request.service.js`) ← read by `bot/shared/services/portal-ready-whatsapp.service.js:119:b99a43d6` · `bot/shared/services/share-send.service.js:116:1c461d0f`
- column `assessment_requests.question_types` (written by `assessment-request.service.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:263:64e1a363`
- column `assessment_requests.subject_code` (written by `assessment-request.service.js`) ← read by `bot/shared/services/nudges/topic-end-nudge.service.js:161:00c6277c` · `bot/shared/services/portal-ready-whatsapp.service.js:119:b99a43d6` · `bot/shared/services/share-send.service.js:116:1c461d0f` · `bot/shared/services/assessment/assessment-browse.service.js:263:64e1a363` (+1: `python3 kg/kg.py who-reads assessment_requests.subject_code`)
- column `assessment_requests.surface` (written by `assessment-request.service.js`) ← read by `bot/shared/services/portal-ready-whatsapp.service.js:121:dbdd5706`
- column `assessment_requests.textbook_id` (written by `assessment-request.service.js`) ← read by `bot/shared/services/assessment/repeat-guard.js:70:73071f2a`
- column `assessment_requests.user_id` (written by `assessment-request.service.js`) ← read by `bot/shared/services/nudges/topic-end-nudge.service.js:160:59e24eac` · `bot/shared/services/portal-ready-whatsapp.service.js:119:b99a43d6` · `bot/shared/services/share-send.service.js:117:8327a7f7` · `dashboard/routes/portal.routes.js:1159:8c12ba89` (+3: `python3 kg/kg.py who-reads assessment_requests.user_id`)
- column `lp_feedback.useful` (written by `assessment-feedback.service.js`) ← read by `bot/shared/services/lp-feedback.service.js:311:4500ad2e`
- column `lp_feedback.user_id` (written by `assessment-feedback.service.js`) ← read by `bot/shared/services/lp-feedback.service.js:313:2c6fea63`
- table `assessment_papers` (written by `assessment-orchestrator.service.js`, `assessment-revision.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:143:1661513d`? · `bot/scripts/assessment/repair-backfilled-v1-created-at.js:69:e3ab478d`? · `dashboard/routes/portal.routes.js:1721:f8c4de9c`? · `bot/shared/services/assessment/assessment-browse.service.js:173:d5e4566e`? (+4: `python3 kg/kg.py who-reads assessment_papers`)
- table `assessment_requests` (written by `assessment-request.service.js`) ← read by `bot/shared/services/nudges/topic-end-nudge.service.js:159:34683b50`? · `bot/shared/services/portal-ready-whatsapp.service.js:118:53413c6f`? · `bot/shared/services/share-send.service.js:115:53413c6f`? · `dashboard/routes/portal.routes.js:1157:b7d7c184`? (+4: `python3 kg/kg.py who-reads assessment_requests`)
- table `lp_feedback` (written by `assessment-feedback.service.js`) ← read by `bot/shared/services/lp-feedback.service.js:310:5cdfa157`? · `bot/scripts/migration/apply-017-lp-feedback.js:74:3f0e2a4e`?
- env `KIE_API_KEY` read at `bot/shared/services/assessment/fde-picture-kie.js:122:39cdf850`

## Tests (all, generated)
- `assessment-browse.service.js` ← `tests/assessment/assessment-browse-curriculum.test.js` · `tests/assessment/assessment-browse-page-past-end.test.js` · `tests/assessment/assessment-browse-service.test.js` · `tests/assessment/assessment-browse-version-tie.test.js` · `tests/assessment/assessment-browse-versions.test.js` · `tests/assessment/fde-paper-view.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-browse.service.js`)
- `assessment-changes.js` ← `tests/assessment/assessment-add-types.test.js` · `tests/assessment/assessment-changes.test.js`
- `assessment-delivery.js` ← `tests/assessment/assessment-edit-button-delivery.test.js` · `tests/assessment/assessment-portal-flag-whatsapp-unaffected.test.js`
- `assessment-edit.js` ← `tests/assessment/assessment-edit-shape.test.js` · `tests/assessment/fde-edit-marks.test.js` · `tests/assessment/fde-edit.test.js` · `tests/assessment/fde-remove-only.test.js` · `tests/assessment/fde-revision.test.js`
- `assessment-editor.service.js` ← `tests/assessment/assessment-editor-service.test.js` · `tests/assessment/fde-edit.test.js`
- `assessment-feedback.service.js` ← `tests/assessment/assessment-feedback.test.js`
- `assessment-format.js` ← `tests/assessment/assessment-docx-flag.test.js` · `tests/assessment/assessment-format.test.js`
- `assessment-generation.service.js` ← `tests/assessment/assessment-answers-and-lines.test.js` · `tests/assessment/assessment-generation.service.test.js` · `tests/assessment/assessment-per-type-counts.test.js` · `tests/assessment/assessment-seen-unseen.test.js` · `tests/assessment/assessment-total-marks.test.js` · `tests/assessment/bloom-ceiling-wiring.test.js` (+99: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-generation.service.js`)
- `assessment-json.util.js` ← `tests/assessment/assessment-json.util.test.js` · `tests/assessment/fde-r7-json-parse-first.test.js`
- `assessment-orchestrator.service.js` ← `tests/assessment/assessment-answer-key-persisted.test.js` · `tests/assessment/assessment-build-paper-seam.test.js` · `tests/assessment/assessment-delivery.test.js` · `tests/assessment/assessment-feedback-hook.test.js` · `tests/assessment/assessment-orchestrator-versions.test.js` · `tests/assessment/assessment-orchestrator.service.test.js` (+18: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-orchestrator.service.js`)
- `assessment-order.js` ← `tests/assessment/assessment-order.test.js`
- `assessment-paper-board.renderer.js` ← `tests/assessment/board-render/exact-misc.test.js` · `tests/assessment/board-render/renderers.test.js` · `tests/assessment/board-render/writer-shape.test.js` · `tests/assessment/board-wiring/board-print.test.js`
- `assessment-paper-fde.renderer.js` ← `tests/assessment/assessment-paper-fde.renderer.test.js` · `tests/assessment/board-wiring/board-orchestrator.test.js` · `tests/assessment/fde-early-paper.test.js` · `tests/assessment/fde-fixtures-chain.test.js` · `tests/assessment/fde-frame-bank.test.js` · `tests/assessment/fde-match.test.js` (+72: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-paper-fde.renderer.js`)
- `assessment-paper-view.service.js` ← `tests/assessment/assessment-paper-view.test.js` · `tests/assessment/board-wiring/board-paper-view.test.js` · `tests/assessment/fde-paper-view-choice-items.test.js` · `tests/assessment/fde-paper-view.test.js`
- `assessment-paper.renderer.js` ← `tests/assessment/answer-key-marks.test.js` · `tests/assessment/assessment-add-types.test.js` · `tests/assessment/assessment-answers-and-lines.test.js` · `tests/assessment/assessment-edit-shape.test.js` · `tests/assessment/assessment-options-grid.test.js` · `tests/assessment/assessment-order.test.js` (+19: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-paper.renderer.js`)
- `assessment-request.service.js` ← `tests/assessment/assessment-answer-key-always.test.js` · `tests/assessment/assessment-marks-budget-seam.test.js` · `tests/assessment/assessment-request-enqueue.test.js` · `tests/assessment/assessment-seen-unseen.test.js` · `tests/assessment/fde-create.test.js` · `tests/assessment/golden.test.js`
- `assessment-revision.service.js` ← `tests/assessment/assessment-build-version.test.js` · `tests/assessment/assessment-review-list.test.js` · `tests/assessment/assessment-revision.test.js` · `tests/assessment/assessment-versions-completion.test.js` · `tests/assessment/assessment-versions-service.test.js` · `tests/assessment/fde-revision.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-revision.service.js`)
- `assessment-scheme-board.renderer.js` ← `tests/assessment/board-render/exact-misc.test.js` · `tests/assessment/board-render/renderers.test.js` · `tests/assessment/board-render/writer-shape.test.js`
- `assessment-selection.js` ← `tests/assessment/assessment-add-types.test.js` · `tests/assessment/assessment-build-version.test.js` · `tests/assessment/assessment-changes.test.js` · `tests/assessment/assessment-editor-service.test.js` · `tests/assessment/assessment-option-title-urdu.test.js` · `tests/assessment/assessment-order.test.js` (+14: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-selection.js`)
- `assessment-vocabulary.js` ← `tests/assessment/assessment-vocabulary.test.js` · `tests/assessment/english-medium-gk-sst-menu.test.js`
- `bloom-ceiling.js` ← `tests/assessment/bloom-ceiling.test.js`
- `blueprint-check.js` ← `tests/assessment/fde-blueprint-check.test.js` · `tests/assessment/fde-english-levels.test.js` · `tests/assessment/fde-mid-g3-layout.test.js` · `tests/assessment/fde-mid-g4-layout.test.js` · `tests/assessment/fde-section-levels.test.js` · `tests/assessment/fde-sst-levels.test.js`
- `board-layout.js` ← `tests/assessment/board-layout/board-layout-edges.test.js` · `tests/assessment/board-render/_fixtures.js` · `tests/assessment/board/fbise-chrome.test.js`
- `board-writer.js` ← `tests/assessment/board-writer/book-level.test.js`
- `book-content.service.js` ← `tests/assessment/assessment-browse-curriculum.test.js` · `tests/assessment/book-content.service.test.js` · `tests/assessment/english-medium-gk-sst-paper.test.js`
- `composition-criteria.js` ← `tests/assessment/composition-criteria.test.js` · `tests/assessment/fde-v26-g5-patterns.test.js` · `tests/assessment/fde-v29-g5-criteria.test.js` · `tests/assessment/fde-v34-g5-lang-criteria.test.js` · `tests/assessment/fde-v37-mathsen-r3.test.js`
- `english-check.js` ← `tests/assessment/fde-r8-check.test.js`
- `fde-accept-alternatives.js` ← `tests/assessment/fde-v37-accept-alternatives.test.js`
- `fde-accept-line.js` ← `tests/assessment/fde-v26-g1.test.js` · `tests/assessment/fde-v27-keys.test.js` · `tests/assessment/fde-v34-early-urdu-verbs.test.js` · `tests/assessment/fde-v42-accept-line-partial.test.js`
- `fde-answer-repeats.js` ← `tests/assessment/fde-answer-repeats.test.js` · `tests/assessment/fde-v23-repeats.test.js` · `tests/assessment/fde-v24-giveaway-topup.test.js` · `tests/assessment/fde-v25-repeats.test.js` · `tests/assessment/fde-v26-repeats.test.js` · `tests/assessment/fde-v27-repeats.test.js` (+12: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-answer-repeats.js`)
- `fde-answer-sheet-wording.js` ← `tests/assessment/fde-answer-sheet-wording.test.js`
- `fde-banned-words.js` ← `tests/assessment/fde-v23-banned-words.test.js`
- `fde-circuit-frame.js` ← `tests/assessment/fde-v27-circuit-frame.test.js` · `tests/assessment/fde-v37-science-r2.test.js`
- `fde-common-error-check.js` ← `tests/assessment/fde-v31-common-errors.test.js`
- `fde-common-error-numbers.js` ← `tests/assessment/fde-v29-common-error-numbers.test.js` · `tests/assessment/fde-v34-early-maths-fixes.test.js`
- `fde-common-error-series.js` ← `tests/assessment/fde-v34-early-maths-fixes.test.js`
- `fde-concept-caps.js` ← `tests/assessment/fde-v34-g5-sci-concept-caps.test.js`
- `fde-concept-count.js` ← `tests/assessment/fde-v29-concept-count.test.js`
- `fde-concept-repeats.js` ← `tests/assessment/fde-v33-concept-repeats.test.js`
- `fde-cross-item-answers.js` ← `tests/assessment/fde-v37-mathsen-r3.test.js`
- `fde-directed-tasks.js` ← `tests/assessment/fde-directed-tasks.test.js`
- `fde-division-steps.js` ← `tests/assessment/fde-v32-division-steps.test.js`
- `fde-early-dupes.js` ← `tests/assessment/fde-v35-early-dupes.test.js`
- `fde-early-english-accepts.js` ← `tests/assessment/fde-early-english-accepts.test.js`
- `fde-early-english-fixes-2.js` ← `tests/assessment/fde-early-english-accepts.test.js` · `tests/assessment/fde-v34-early-en-fixes.test.js` · `tests/assessment/fde-v37-english-r2.test.js` · `tests/assessment/fde-v37-english-r3.test.js`
- `fde-early-english-fixes.js` ← `tests/assessment/fde-v29-early-english-fixes.test.js`
- `fde-early-giveaways.js` ← `tests/assessment/fde-v34-early-en-giveaways.test.js` · `tests/assessment/fde-v37-early-english.test.js`
- `fde-early-key-fixes.js` ← `tests/assessment/fde-v28-early-key-fixes.test.js` · `tests/assessment/fde-v29-early-maths-keys.test.js` · `tests/assessment/fde-v34-early-maths-fixes.test.js` · `tests/assessment/fde-v37-maths-r2.test.js` · `tests/assessment/fde-v37-maths-r3.test.js`
- `fde-early-maths-fixes.js` ← `tests/assessment/fde-v34-early-maths-fixes.test.js`
- `fde-early-prompt.js` ← `tests/assessment/fde-answer-repeats.test.js` · `tests/assessment/fde-early-answers.test.js` · `tests/assessment/fde-early-asked.test.js` · `tests/assessment/fde-early-pictures-pattern.test.js` · `tests/assessment/fde-early-prompt.test.js` · `tests/assessment/fde-early-writer.test.js` (+23: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-early-prompt.js`)
- `fde-early-urdu-boxkeys.js` ← `tests/assessment/fde-v38-early-urdu-boxkeys.test.js`
- `fde-early-urdu-fixes.js` ← `tests/assessment/fde-urdu-common-error-lang.test.js` · `tests/assessment/fde-v29-early-urdu.test.js` · `tests/assessment/fde-v34-early-urdu-marking.test.js` · `tests/assessment/fde-v34-early-urdu-topic.test.js` · `tests/assessment/fde-v34-early-urdu-verbs.test.js` · `tests/assessment/fde-v34-early-urdu-wordbox.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-early-urdu-fixes.js`)
- `fde-early-urdu-letters.js` ← `tests/assessment/fde-v35-urdu-letters.test.js`
- `fde-early-urdu-marking.js` ← `tests/assessment/fde-v34-early-urdu-marking.test.js`
- `fde-early-urdu-mcq.js` ← `tests/assessment/fde-v34-early-urdu-marking.test.js` · `tests/assessment/fde-v34-early-urdu-wiring.test.js`
- `fde-early-urdu-oral.js` ← `tests/assessment/fde-v34-early-urdu-oral.test.js` · `tests/assessment/fde-v37-early-urdu.test.js`
- `fde-early-urdu-repeat.js` ← `tests/assessment/fde-v37-early-urdu.test.js`
- `fde-early-urdu-topic.js` ← `tests/assessment/fde-v34-early-urdu-topic.test.js`
- `fde-early-urdu-verbs.js` ← `tests/assessment/fde-v34-early-urdu-verbs.test.js`
- `fde-early-urdu-walk.js` ← `tests/assessment/fde-v34-early-urdu-walk.test.js`
- `fde-early-urdu-wordbox.js` ← `tests/assessment/fde-v34-early-urdu-wordbox.test.js`
- `fde-early-writer.js` ← `tests/assessment/fde-answer-repeats.test.js` · `tests/assessment/fde-early-dispatch.test.js` · `tests/assessment/fde-early-writer.test.js` · `tests/assessment/fde-v23-repeats.test.js` · `tests/assessment/fde-v25-repeats-writers.test.js` · `tests/assessment/fde-v27-picture-repeats.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-early-writer.js`)
- `fde-fraction-giveaway.js` ← `tests/assessment/fde-v29-fraction-giveaway.test.js`
- `fde-frame-bank.js` ← `tests/assessment/fde-frame-bank.test.js`
- `fde-g1-scene-accept.js` ← `tests/assessment/fde-v37-mathsen-r3.test.js`
- `fde-g1-story-question.js` ← `tests/assessment/fde-v37-maths-r2.test.js`
- `fde-g5-criteria-2.js` ← `tests/assessment/fde-v34-g5-lang-criteria.test.js`
- `fde-g5-criteria.js` ← `tests/assessment/fde-v29-g5-criteria.test.js` · `tests/assessment/fde-v34-g5-lang-criteria.test.js` · `tests/assessment/fde-v37-g5-lang.test.js`
- `fde-g5-key-fixes-2.js` ← `tests/assessment/fde-v29-g5-key-fixes-2.test.js`
- `fde-g5-key-fixes.js` ← `tests/assessment/fde-answer-sheet-wording.test.js` · `tests/assessment/fde-v26-g5-patterns.test.js` · `tests/assessment/fde-v28-g5-key-fixes.test.js` · `tests/assessment/fde-v29-g5-keys.test.js` · `tests/assessment/fde-v37-mathsen-r3.test.js`
- `fde-g5-lang-checks.js` ← `tests/assessment/fde-v37-g5-lang.test.js`
- `fde-g5-lang-fixes.js` ← `tests/assessment/fde-v34-g5-lang-fixes.test.js` · `tests/assessment/fde-v37-english-r3.test.js` · `tests/assessment/fde-v37-g5-lang.test.js`
- `fde-g5-lang-giveaways.js` ← `tests/assessment/fde-v34-g5-lang-giveaways.test.js` · `tests/assessment/fde-v37-english-r2.test.js` · `tests/assessment/fde-v37-g5-lang.test.js`
- `fde-g5-lang-key-mends.js` ← `tests/assessment/fde-v37-g5-lang.test.js`
- `fde-g5-lang-repeats.js` ← `tests/assessment/fde-v37-english-r2.test.js`
- `fde-g5-paper-giveaways.js` ← `tests/assessment/fde-maths-name-giveaway.test.js` · `tests/assessment/fde-v29-g5-paper-giveaways.test.js` · `tests/assessment/fde-v34-early-urdu-wiring.test.js` · `tests/assessment/fde-v34-g5-lang-wiring.test.js` · `tests/assessment/fde-v34-g5-maths-repeats.test.js` · `tests/assessment/fde-v34-g5-sci-concept-caps.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-g5-paper-giveaways.js`)
- `fde-g5-urdu-mends.js` ← `tests/assessment/fde-v38-g5-urdu-mends.test.js`
- `fde-glyph-check.js` ← `tests/assessment/fde-glyph-check.test.js`
- `fde-keep-missing.js` ← `tests/assessment/fde-keep-missing.test.js`
- `fde-key-checks.js` ← `tests/assessment/fde-v26-key-checks.test.js` · `tests/assessment/fde-v34-early-urdu-wiring.test.js` · `tests/assessment/fde-v37-accept-alternatives.test.js` · `tests/assessment/fde-v38-early-urdu-wiring.test.js`
- `fde-key-pattern.js` ← `tests/assessment/fde-key-pattern.test.js`
- `fde-key-term-giveaway.js` ← `tests/assessment/fde-v34-g5-sci-key-terms.test.js`
- `fde-key-truth.js` ← `tests/assessment/fde-v33-key-truth.test.js`
- `fde-lang-cross-asks.js` ← `tests/assessment/fde-v34-g5-lang-cross.test.js`
- `fde-layout.js` ← `tests/assessment/assessment-paper-fde.renderer.test.js` · `tests/assessment/fde-blueprint-check.test.js` · `tests/assessment/fde-edit-marks.test.js` · `tests/assessment/fde-edit.test.js` · `tests/assessment/fde-fixtures-chain.test.js` · `tests/assessment/fde-frame-bank.test.js` (+94: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-layout.js`)
- `fde-lcm-ladder.js` ← `tests/assessment/fde-v27-lcm-ladder.test.js`
- `fde-listening-asks.js` ← `tests/assessment/fde-v29-listening-asks.test.js`
- `fde-listening-check.js` ← `tests/assessment/fde-listening-check.test.js`
- `fde-marks-line.js` ← `tests/assessment/fde-v27-marks-line.test.js`
- `fde-match-block.js` ← `tests/assessment/fde-match-block.test.js` · `tests/assessment/fde-no-arrows.test.js` · `tests/assessment/fde-scramble-block.test.js` · `tests/assessment/fde-v19-paper-fixes.test.js` · `tests/assessment/fde-v21-key-fixes.test.js` · `tests/assessment/fde-v33-mid-match.test.js`
- `fde-match-rows.js` ← `tests/assessment/fde-v36-match-colb.test.js` · `tests/assessment/fde-v36-match-rows.test.js`
- `fde-maths-keys.js` ← `tests/assessment/fde-v34-g5-maths-keys.test.js` · `tests/assessment/fde-v37-maths-r3.test.js`
- `fde-maths-marking.js` ← `tests/assessment/fde-maths-name-giveaway.test.js` · `tests/assessment/fde-v37-maths-r3.test.js`
- `fde-maths-name-giveaway.js` ← `tests/assessment/fde-maths-name-giveaway.test.js`
- `fde-maths-repeats.js` ← `tests/assessment/fde-v34-g5-maths-repeats.test.js`
- `fde-maths-skill-twice.js` ← `tests/assessment/fde-v37-g5-mathsci.test.js`
- `fde-maths-slips.js` ← `tests/assessment/fde-v33-maths-mcq-key.test.js` · `tests/assessment/fde-v33-maths-slips.test.js`
- `fde-mcq-arithmetic.js` ← `tests/assessment/fde-mcq-arithmetic.test.js`
- `fde-mcq-giveaway.js` ← `tests/assessment/fde-v29-g5-giveaways.test.js`
- `fde-mcq-key-tells.js` ← `tests/assessment/fde-v34-g5-lang-key-tells.test.js`
- `fde-mcq-stem.js` ← `tests/assessment/fde-v36-mcq-stem.test.js` · `tests/assessment/fde-v39-mcq-form.test.js`
- `fde-mcq-truth.js` ← `tests/assessment/fde-v34-g5-lang-mcq-truth.test.js`
- `fde-meaning-key.js` ← `tests/assessment/fde-v36-meaning-key.test.js`
- `fde-mid-key-fixes.js` ← `tests/assessment/fde-v32-mid-key-fixes.test.js` · `tests/assessment/fde-v33-maths-mcq-key.test.js` · `tests/assessment/fde-v33-maths-slips.test.js`
- `fde-mid-legend.js` ← `tests/assessment/fde-v33-mid-legend.test.js`
- `fde-mid-match.js` ← `tests/assessment/fde-v33-mid-match.test.js`
- `fde-mid-maths-repeats.js` ← `tests/assessment/fde-v33-maths-repeats.test.js`
- `fde-mid-steer.js` ← `tests/assessment/fde-mid-steer.test.js`
- `fde-near-repeats.js` ← `tests/assessment/fde-v26-repeats.test.js` · `tests/assessment/fde-v28-near-repeats-stop.test.js` · `tests/assessment/fde-v34-g5-sci-keys.test.js`
- `fde-no-arrows.js` ← `tests/assessment/fde-no-arrows.test.js`
- `fde-oral-fresh-words.js` ← `tests/assessment/fde-v29-urdu-oral.test.js` · `tests/assessment/fde-v34-early-en-oral.test.js`
- `fde-oral-numbers.js` ← `tests/assessment/fde-v27-oral-numbers.test.js`
- `fde-oral-prep.js` ← `tests/assessment/fde-v29-oral-prep.test.js`
- `fde-oral-sentence-repeats.js` ← `tests/assessment/fde-v29-oral-sentence-repeats.test.js`
- `fde-oral-sheet.js` ← `tests/assessment/fde-oral-sheet.test.js` · `tests/assessment/fde-oral-teacher-fills.test.js` · `tests/assessment/fde-v21-key-fixes.test.js` · `tests/assessment/fde-v26-oral.test.js` · `tests/assessment/fde-v27-oral-dialogue.test.js` · `tests/assessment/fde-v28-oral-child-card.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-oral-sheet.js`)
- `fde-order-block.js` ← `tests/assessment/fde-order-block.test.js`
- `fde-order-check.js` ← `tests/assessment/fde-v27-order-check.test.js`
- `fde-part-name.js` ← `tests/assessment/fde-v33-part-name.test.js`
- `fde-pick-key.js` ← `tests/assessment/fde-v37-pick-key-accept.test.js`
- `fde-picture-block.js` ← `tests/assessment/fde-picture-block.test.js` · `tests/assessment/fde-plant-label.test.js` · `tests/assessment/fde-v19-paper-fixes.test.js` · `tests/assessment/fde-v20-paper-fixes.test.js` · `tests/assessment/fde-v34-layout.test.js`
- `fde-picture-describe.js` ← `tests/assessment/fde-v27-picture-describe.test.js`
- `fde-picture-inset-frame.js` ← `tests/assessment/fde-v34-layout.test.js`
- `fde-picture-kie.js` ← `tests/assessment/fde-no-arrows.test.js` · `tests/assessment/fde-picture-frame.test.js` · `tests/assessment/fde-picture-kie.test.js` · `tests/assessment/fde-picture-place.test.js` · `tests/assessment/fde-v25-g1-pictures.test.js` · `tests/assessment/fde-v26-g1.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-picture-kie.js`)
- `fde-picture-optional.js` ← `tests/assessment/fde-picture-optional.test.js`?
- `fde-picture-svg.js` ← `tests/assessment/fde-picture-groups.test.js` · `tests/assessment/fde-picture-svg.test.js` · `tests/assessment/fde-plant-label.test.js` · `tests/assessment/fde-v27-clock-svg.test.js`
- `fde-picture-word-count.js` ← `tests/assessment/fde-v37-mathsen-r3.test.js`
- `fde-pictures.js` ← `tests/assessment/fde-picture-frame.test.js` · `tests/assessment/fde-picture-groups.test.js` · `tests/assessment/fde-picture-place.test.js` · `tests/assessment/fde-pictures.test.js` · `tests/assessment/fde-v25-cover-pictures.test.js` · `tests/assessment/fde-v25-g1-pictures.test.js` (+6: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-pictures.js`)
- `fde-place-digit.js` ← `tests/assessment/fde-v37-place-digit.test.js`
- `fde-placeholder-check.js` ← `tests/assessment/fde-v28-placeholder.test.js`
- `fde-poem-title-giveaway.js` ← `tests/assessment/fde-v38-poem-title-giveaway.test.js`
- `fde-printed-letter-note.js` ← `tests/assessment/fde-v27-printed-letter-note.test.js`
- `fde-punctuate-check.js` ← `tests/assessment/fde-v29-punctuate-check.test.js`
- `fde-read-aloud-antecedent.js` ← `tests/assessment/fde-v37-english-r3.test.js`
- `fde-read-aloud-grammar.js` ← `tests/assessment/fde-v37-read-aloud-grammar.test.js`
- `fde-reader.js` ← `tests/assessment/fde-r17-sst.test.js` · `tests/assessment/fde-r17-urdu.test.js` · `tests/assessment/fde-r17b-sst.test.js` · `tests/assessment/fde-r17c-sst.test.js` · `tests/assessment/fde-r17d-sst.test.js` · `tests/assessment/fde-r17e-sst.test.js` (+16: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-reader.js`)
- `fde-religious-terms.js` ← `tests/assessment/fde-v35-religious-terms.test.js`
- `fde-render-v37.js` ← `tests/assessment/fde-v37-render.test.js`
- `fde-scheme-checks.js` ← `tests/assessment/fde-v35-scheme-checks.test.js` · `tests/assessment/fde-v37-g5-lang.test.js`
- `fde-scheme-cover.js` ← `tests/assessment/fde-scheme-cover.test.js` · `tests/assessment/fde-v33-part-name.test.js`
- `fde-scheme-figures.js` ← `tests/assessment/fde-scheme-figures.test.js`
- `fde-scheme-shape.js` ← `tests/assessment/fde-v33-scheme-shape.test.js`
- `fde-science-giveaway-drop.js` ← `tests/assessment/fde-science-mcq-reask.test.js` · `tests/assessment/fde-science-option-keys.test.js` · `tests/assessment/fde-v37-science-r3.test.js`
- `fde-science-key-points.js` ← `tests/assessment/fde-science-key-stem.test.js` · `tests/assessment/fde-v37-science-r3.test.js`
- `fde-science-key-stem.js` ← `tests/assessment/fde-science-key-stem.test.js`
- `fde-science-keys.js` ← `tests/assessment/fde-v34-g5-sci-keys.test.js` · `tests/assessment/fde-v37-g5-mathsci.test.js` · `tests/assessment/fde-v37-science-r2.test.js`
- `fde-science-mcq-reask.js` ← `tests/assessment/fde-science-mcq-reask.test.js`
- `fde-science-option-keys.js` ← `tests/assessment/fde-science-option-keys.test.js`
- `fde-science-r2.js` ← `tests/assessment/fde-v37-science-r2.test.js`
- `fde-science-repeats.js` ← `tests/assessment/fde-science-task-repeats.test.js` · `tests/assessment/fde-v37-g5-mathsci.test.js` · `tests/assessment/fde-v37-science-r2.test.js`
- `fde-science-shared-facts.js` ← `tests/assessment/fde-v37-science-r2.test.js`
- `fde-science-task-repeats.js` ← `tests/assessment/fde-science-task-repeats.test.js`
- `fde-scramble-block.js` ← `tests/assessment/fde-scramble-block.test.js` · `tests/assessment/fde-v26-key-checks.test.js`
- `fde-sentence-count.js` ← `tests/assessment/fde-v27-sentence-count.test.js`
- `fde-situation-check.js` ← `tests/assessment/fde-v27-situation.test.js`
- `fde-slot-fit.js` ← `tests/assessment/fde-v29-layout.test.js` · `tests/assessment/fde-v29-slot-fit.test.js` · `tests/assessment/fde-v34-layout.test.js` · `tests/assessment/fde-v42-short-slot-fit.test.js`
- `fde-stem-check.js` ← `tests/assessment/fde-stem-check-parts.test.js` · `tests/assessment/fde-stem-check-topics.test.js` · `tests/assessment/fde-stem-check.test.js` · `tests/assessment/fde-v28-stem-check-rule4.test.js`
- `fde-stem-repeats.js` ← `tests/assessment/fde-v32-stem-repeats.test.js`
- `fde-sub-answers.js` ← `tests/assessment/fde-v22-reading-key.test.js` · `tests/assessment/fde-v37-reading-parent.test.js`
- `fde-task-line.js` ← `tests/assessment/fde-v27-task-line.test.js`
- `fde-teacher-slot.js` ← `tests/assessment/fde-teacher-slot.test.js`
- `fde-tense-count.js` ← `tests/assessment/fde-v34-g5-lang-tense.test.js`
- `fde-urdu-antonyms.js` ← `tests/assessment/fde-v38-urdu-antonyms.test.js`
- `fde-urdu-common-error-lang.js` ← `tests/assessment/fde-urdu-common-error-lang.test.js`
- `fde-urdu-first-action.js` ← `tests/assessment/fde-v38-urdu-first-action.test.js`
- `fde-urdu-form-lines.js` ← `tests/assessment/fde-v38-urdu-form-lines.test.js`
- `fde-urdu-nonword.js` ← `tests/assessment/fde-v37-urdu-nonword.test.js`
- `fde-urdu-notes.js` ← `tests/assessment/fde-urdu-notes.test.js`
- `fde-urdu-punct.js` ← `tests/assessment/fde-v28-urdu-punct.test.js`
- `fde-urdu-quoted-word.js` ← `tests/assessment/fde-v38-urdu-quoted-word.test.js`
- `fde-urdu-spelling.js` ← `tests/assessment/fde-v29-urdu-spelling.test.js`
- `fde-urdu-use-word.js` ← `tests/assessment/fde-v38-urdu-use-word.test.js`
- `fde-urdu-walk-all.js` ← `tests/assessment/fde-v38-urdu-walk-all.test.js`
- `fde-who-said-check.js` ← `tests/assessment/fde-v27-who-said.test.js`
- `fde-word-box-spare.js` ← `tests/assessment/fde-v38-word-box-spare.test.js`
- `fde-word-box.js` ← `tests/assessment/fde-v36-word-box.test.js`
- `fde-work-space.js` ← `tests/assessment/fde-work-space.test.js`
- `free-secondary-checks.js` ← `tests/assessment/free-secondary-checks.test.js` · `tests/assessment/free-secondary-pool.test.js` · `tests/assessment/free-secondary-rewrite.test.js` · `tests/assessment/free-secondary-rules.test.js` · `tests/assessment/free-secondary-scheme.test.js`
- `free-secondary-chrome.data.json` ← `tests/assessment/free-secondary-chrome.test.js`
- `free-secondary-chrome.js` ← `tests/assessment/free-secondary-chrome.test.js`
- `free-secondary-grammar.js` ← `tests/assessment/free-secondary-grammar.test.js`
- `free-secondary-keys.js` ← `tests/assessment/free-secondary-keys.test.js`
- `free-secondary-levels.js` ← `tests/assessment/free-secondary-levels.test.js`
- `free-secondary-pool.js` ← `tests/assessment/free-secondary-pool.test.js`
- `free-secondary-print.js` ← `tests/assessment/free-secondary-print.test.js`
- `free-secondary-review.js` ← `tests/assessment/free-secondary-review-written.test.js` · `tests/assessment/free-secondary-review.test.js`
- `free-secondary-rewrite.js` ← `tests/assessment/free-secondary-a8-wiring.test.js` · `tests/assessment/free-secondary-rewrite.test.js`
- `free-secondary-rules.js` ← `tests/assessment/free-secondary-a8-prompts.test.js` · `tests/assessment/free-secondary-review.test.js` · `tests/assessment/free-secondary-rules.test.js`
- `free-secondary-scheme.js` ← `tests/assessment/free-secondary-scheme.test.js`
- `free-secondary-tidy.js` ← `tests/assessment/free-secondary-tidy.test.js`
- `free-secondary.service.js` ← `tests/assessment/free-secondary-a8-wiring.test.js` · `tests/assessment/free-secondary-reviewer.test.js` · `tests/assessment/free-secondary.service.test.js`
- `grade-gate.js` ← `tests/assessment/grade-gate.test.js`
- `ict-prompts.json` ← `tests/assessment/assessment-generation.service.test.js` · `tests/assessment/board-writer/real-reply.test.js` · `tests/assessment/free-secondary.service.test.js` · `tests/assessment/prompts-6-12.test.js`
- `marking-scheme.js` ← `tests/assessment/assessment-paper-fde.renderer.test.js` · `tests/assessment/fde-fixtures-chain.test.js` · `tests/assessment/fde-frame-bank.test.js` · `tests/assessment/fde-match.test.js` · `tests/assessment/fde-maths-angle-options.test.js` · `tests/assessment/fde-orchestrator.test.js` (+30: `python3 kg/kg.py who-reads bot/shared/services/assessment/marking-scheme.js`)
- `maths-check.js` ← `tests/assessment/assessment-paper-fde.renderer.test.js` · `tests/assessment/fde-fixtures-chain.test.js` · `tests/assessment/fde-orchestrator.test.js` · `tests/assessment/fde-r10-place.test.js` · `tests/assessment/fde-r5-rt3a-s2.test.js` · `tests/assessment/fde-r5-rt3a.test.js` (+14: `python3 kg/kg.py who-reads bot/shared/services/assessment/maths-check.js`)
- `prompts-6-12.js` ← `tests/assessment/prompts-6-12.test.js`
- `prompts-review-pending.json` ← `tests/assessment/prompts-6-12.test.js`
- `question-types-6-12.js` ← `tests/assessment/question-types-6-12.test.js`
- `question-types.js` ← `tests/assessment/assessment-browse-service.test.js` · `tests/assessment/assessment-limit-and-errors.test.js` · `tests/assessment/assessment-per-type-counts.test.js` · `tests/assessment/assessment-question-count.test.js` · `tests/assessment/assessment-total-marks.test.js` · `tests/assessment/assessment-types-limit.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/assessment/question-types.js`)
- `repeat-guard.js` ← `tests/assessment/repeat-guard.test.js`
- `scheme-accept-check.js` ← `tests/assessment/scheme-accept-check.test.js`
- `subject-config.js` ← `tests/assessment/g612-subjects-migration.test.js` · `tests/assessment/subject-config.test.js`
- `topic-key.renderer.js` ← `tests/assessment/topics/topic-key.test.js`

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.md`? · `todo.md`?
