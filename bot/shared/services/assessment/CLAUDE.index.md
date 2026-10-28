# assessment — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/assessment -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `patterns/` | Board-pattern definitions (FDE grades 1, 2, 5) as frozen data → `patterns/CLAUDE.md` |
| `topics/` | Curriculum-matrix rows to the tickable topics of a chapter; pure grouping → `topics/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `assessment-browse.service.js` | Surface-neutral lists of what a teacher may offer/download for assessments; feeds Flow and portal browse |
| `assessment-changes.js` | Applies a portal-sent list of paper changes (edits, removals, restores, additions) using WhatsApp's edit rules |
| `assessment-delivery.js` | Sends a finished paper PDF with its Edit Flow button, and the answer key, over WhatsApp; used by the orchestrator |
| `assessment-edit.js` | Defines question shapes, pre-fills each edit screen and writes edited answers back into the question tree |
| `assessment-editor.service.js` | Portal paper-editor backend (versions, questions, validate, save); gated by portal_assessment_editing_enabled |
| `assessment-format.js` | Single place choosing PDF vs Word renderer and filename extension so a .docx is never a PDF |
| `assessment-generation.service.js` | Core generator: textbook pages in, exam question JSON out via ict-prompts.json and board-pattern writers |
| `assessment-json.util.js` | Repairs and extracts JSON from model replies (fences, missing commas, raw newlines, truncation) |
| `assessment-orchestrator.service.js` | Runs a queued assessment request end to end: generate, check, render, deliver, record, and failure messages |
| `assessment-paper-fde.renderer.js` | Renders board-pattern (FDE) papers and their marking schemes to HTML from the paper's _layout |
| `assessment-paper-view.service.js` | Read-only view of a finished paper's questions for the portal paper page (bd-fmf24g.31) |
| `assessment-paper.renderer.js` | Renders the plain exam paper HTML teachers print: marking header, instructions, questions |
| `assessment-request.service.js` | Creates the assessment_requests row and queued job together so both agree; called by surfaces (Flow, portal) |
| `assessment-revision.service.js` | Re-renders and sends an edited paper without calling a model; backs the review Flow's Edit path |
| `assessment-selection.js` | Names questions inside a paper tree and builds the smaller tree from ticked or removed names |
| `assessment-vocabulary.js` | One shared map of grade and subject display names, replacing copies in Flow endpoint, orchestrator, revision |
| `blueprint-check.js` | Reads a board-pattern paper back against its table of specification for thinking-level mark splits (bd-5jmnfj.2) |
| `book-content.service.js` | Fetches textbook pages for a chapter or page list and assembles them under '=== Page N ===' markers for prompts |
| `composition-criteria.js` | Fixed marking criteria templates for written compositions, scaled to a question's marks |
| `english-check.js` | Code-checks English items: anagram MCQ key correctness and rhyming-word items set on poem lines |
| `fde-early-prompt.js` | Prompts and reply checks for Grade 1-2 FDE practice papers, built on Grade 5's builder (bd-5jmnfj.4.1) |
| `fde-early-writer.js` | Writes a Grade 1-2 FDE practice paper section by section with pictures and an oral part (bd-5jmnfj.4.1) |
| `fde-layout.js` | Fits model output into a board pattern's slots without editing wording; drops extras, counts marks, guards give-aways |
| `fde-match-block.js` | Prints Grade 1-2 match questions as two columns with a drawing gap (bd-5jmnfj.4.23) |
| `fde-oral-sheet.js` | Builds the oral teacher sheet in a Grade 1-2 marking scheme (bd-5jmnfj.4.4) |
| `fde-order-block.js` | Re-numbers Put-in-Order steps so the printed numbering never gives away the key (bd-5jmnfj.4.46) |
| `fde-picture-block.js` | Lays out a Grade 1-2 picture item from an embedded data-URI image (bd-5jmnfj.4.3) |
| `fde-picture-kie.js` | Requests Grade 1-2 object/scene images from Kie nano-banana-pro: create, poll, download (bd-5jmnfj.4.3) |
| `fde-picture-svg.js` | Draws Grade 1-2 pictures as black-and-white SVG: dots, shapes, clock, plant (bd-5jmnfj.4.3) |
| `fde-pictures.js` | Resolves every picture on a Grade 1-2 paper to a data-URI src before the paper is saved (bd-5jmnfj.4.3) |
| `fde-reader.js` | Model reader pass that flags Section A Q1 items answerable from text printed elsewhere on the paper |
| `fde-stem-check.js` | One-read check of each question against its answer and marking; rewords incoherent stems (bd-5jmnfj.22) |
| `ict-prompts.json` | Thirteen generation prompts (system/user, per subject) used unchanged by assessment-generation.service.js |
| `marking-scheme.js` | Normalises a model-written marking scheme to the pattern slot: point sums, kinds, code-point caps |
| `maths-check.js` | Recomputes plain arithmetic in a maths marking scheme with exact BigInt fractions to catch wrong keys |
| `question-types.js` | Per-subject catalogue of question types and default counts the generation prompts understand |
| `topic-key.renderer.js` | Answer-key extras for topic papers: topic per question and one-line-per-topic summary |

## Who reads this (all, generated)
- `assessment-browse.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:1451:707d6edd` · `bot/shared/services/portal-ready-whatsapp.service.js:213:0aebdda4` · `bot/shared/services/share-send.service.js:66:0803f77f`
- `assessment-changes.js` ← imported by `bot/shared/services/assessment/assessment-editor.service.js:17:ef7581ec`
- `assessment-delivery.js` ← imported by `bot/shared/services/assessment/assessment-orchestrator.service.js:55:343662fe` · `bot/shared/services/assessment/assessment-revision.service.js:27:343662fe`
- `assessment-edit.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:228:1dd0e6b5` · `bot/shared/services/assessment/assessment-changes.js:13:078b0c58` · `bot/shared/services/assessment/assessment-editor.service.js:12:078b0c58` · `bot/shared/services/assessment/assessment-revision.service.js:23:078b0c58`
- `assessment-editor.service.js` ← imported by `bot/shared/routes/internal-assessment-edit.routes.js:49:6752ab81`
- `assessment-format.js` ← imported by `bot/scripts/assessment/backfill-paper-versions.js:104:bb283576` · `bot/shared/routes/assessment-gen-endpoint.js:1725:5ff2c133` · `bot/shared/services/assessment/assessment-orchestrator.service.js:39:02db64e0` · `bot/shared/services/assessment/assessment-revision.service.js:24:02db64e0`
- `assessment-generation.service.js` ← imported by `scripts/assessment/eval-per-type-counts.js:38:cdaf4880` · `scripts/assessment/eval-run.js:43:cdaf4880` · `bot/shared/services/assessment/assessment-orchestrator.service.js:32:c19e5a2e`
- `assessment-json.util.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:24:25a8c06a`
- `assessment-orchestrator.service.js` ← imported by `bot/workers/sqs-worker.js:654:9e887360` · `bot/shared/services/assessment/assessment-revision.service.js:141:68277ac4`
- `assessment-paper-fde.renderer.js` ← imported by `bot/shared/services/assessment/assessment-editor.service.js:19:2af0ac15` · `bot/shared/services/assessment/assessment-generation.service.js:1651:1f701a06` · `bot/shared/services/assessment/assessment-orchestrator.service.js:35:2af0ac15` · `bot/shared/services/assessment/assessment-paper-view.service.js:70:2af0ac15` (+2: `python3 kg/kg.py who-reads assessment-paper-fde.renderer.js`)
- `assessment-paper-view.service.js` ← imported by `bot/shared/routes/internal-assessment-view.routes.js:20:0107c1d0`
- `assessment-paper.renderer.js` ← imported by `bot/scripts/assessment/backfill-paper-versions.js:103:10ace4e3` · `bot/shared/routes/assessment-gen-endpoint.js:754:7568e5aa` · `scripts/assessment/eval-run.js:44:50489814` · `bot/shared/services/assessment/assessment-changes.js:61:0fc01171` (+7: `python3 kg/kg.py who-reads assessment-paper.renderer.js`)
- `assessment-request.service.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:1980:9f9f0555` · `bot/shared/routes/internal-api.routes.js:1650:9f9f0555`
- `assessment-revision.service.js` ← imported by `bot/scripts/assessment/backfill-paper-versions.js:124:e1ed7ff3` · `bot/shared/routes/assessment-gen-endpoint.js:230:75a68a6a` · `bot/shared/services/assessment/assessment-browse.service.js:195:2a120a3f` · `bot/shared/services/assessment/assessment-editor.service.js:11:638c5c30` (+1: `python3 kg/kg.py who-reads assessment-revision.service.js`)
- `assessment-selection.js` ← imported by `bot/scripts/assessment/backfill-paper-versions.js:42:3ca84ad0` · `bot/shared/routes/assessment-gen-endpoint.js:227:d0d392e8` · `bot/shared/services/assessment/assessment-changes.js:14:c8c747c7` · `bot/shared/services/assessment/assessment-editor.service.js:13:c8c747c7` (+2: `python3 kg/kg.py who-reads assessment-selection.js`)
- `assessment-vocabulary.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:35:0bbbf370` · `bot/shared/services/portal-ready-whatsapp.service.js:45:ac2a62e8` · `bot/shared/services/share-send.service.js:113:ac2a62e8` · `dashboard/services/progress.service.js:48:41b16ae0` (+7: `python3 kg/kg.py who-reads assessment-vocabulary.js`)
- `blueprint-check.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:749:2919ed2d` · `bot/shared/services/assessment/fde-early-writer.js:23:6eac933d`
- `book-content.service.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:25:f17a4a91` · `scripts/assessment/eval-per-type-counts.js:37:f6eb81ab` · `scripts/assessment/eval-run.js:42:f6eb81ab` · `bot/shared/services/assessment/assessment-generation.service.js:757:5ef65bae` (+2: `python3 kg/kg.py who-reads book-content.service.js`)
- `composition-criteria.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:1216:4fa69c72`
- `english-check.js` ← imported by `bot/shared/services/assessment/fde-layout.js:621:ff9c711c`
- `fde-early-prompt.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:24:22239650`
- `fde-early-writer.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:752:c2c60a6e`
- `fde-layout.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:746:bc88b652` · `bot/shared/services/assessment/fde-early-writer.js:20:bb20a8b5`
- `fde-match-block.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:34:83f2dade` · `bot/shared/services/assessment/patterns/early/g1-gk.js:10:5690ba0f` · `bot/shared/services/assessment/patterns/early/g2-gk.js:9:5690ba0f`
- `fde-oral-sheet.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:35:34052293`
- `fde-order-block.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:25:24e8927b`
- `fde-picture-block.js` ← imported by `bot/shared/services/assessment/assessment-paper-fde.renderer.js:33:5632313c`
- `fde-picture-kie.js` ← imported by `bot/shared/services/assessment/fde-pictures.js:25:1aa3a461`
- `fde-picture-svg.js` ← imported by `bot/shared/services/assessment/fde-pictures.js:24:aff3165e`
- `fde-pictures.js` ← imported by `bot/shared/services/assessment/fde-early-writer.js:32:2b0fc696`
- `fde-reader.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:750:6a56d59d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:58:de0a339b`
- `fde-stem-check.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:751:f84e0d14` · `bot/shared/services/assessment/assessment-orchestrator.service.js:57:c549dad8`
- `ict-prompts.json` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:26:07597eaf`
- `marking-scheme.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:747:6a87ce14` · `bot/shared/services/assessment/blueprint-check.js:11:f0655cc4` · `bot/shared/services/assessment/fde-early-writer.js:21:6a87ce14`
- `maths-check.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:748:82cd9d27` · `bot/shared/services/assessment/fde-early-writer.js:22:82cd9d27` · `bot/shared/services/assessment/fde-layout.js:620:b9e22d6a`
- `question-types.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:26:6c8431b2` · `bot/shared/routes/internal-api.routes.js:1483:6c8431b2` · `scripts/assessment/eval-plan.js:16:3a2d72d0` · `scripts/assessment/eval-per-type-counts.js:39:3a2d72d0` (+4: `python3 kg/kg.py who-reads question-types.js`)
- `topic-key.renderer.js` ← imported by `bot/shared/services/assessment/assessment-orchestrator.service.js:34:370417ae` · `bot/shared/services/assessment/assessment-paper.renderer.js:544:9064e1bd`
- column `assessment_papers.attempt` (written by `assessment-revision.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:143:1661513d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:417:ea7ca533`
- column `assessment_papers.edited_from` (written by `assessment-revision.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:144:8f1aa092` · `bot/scripts/assessment/repair-backfilled-v1-created-at.js:69:e3ab478d` · `bot/shared/services/assessment/assessment-browse.service.js:162:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:416:62e6c849`
- column `assessment_papers.question_count` (written by `assessment-revision.service.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:414:2e6454e9`
- column `assessment_papers.request_id` (written by `assessment-orchestrator.service.js`, `assessment-revision.service.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:162:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:415:a62a38f3` · `bot/shared/services/assessment/assessment-revision.service.js:102:dc9b27f2`
- column `assessment_papers.status` (written by `assessment-orchestrator.service.js`, `assessment-revision.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:169:d06d822d` · `bot/shared/services/assessment/assessment-browse.service.js:162:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:144:71e60a4b` · `bot/shared/services/assessment/assessment-revision.service.js:102:dc9b27f2`
- column `assessment_papers.total_marks` (written by `assessment-revision.service.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:414:2e6454e9`
- column `assessment_papers.updated_at` (written by `assessment-revision.service.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:414:2e6454e9`
- column `assessment_requests.chapter_number` (written by `assessment-request.service.js`) ← read by `bot/shared/services/portal-ready-whatsapp.service.js:114:b99a43d6` · `bot/shared/services/share-send.service.js:106:1c461d0f`
- column `assessment_requests.grade_code` (written by `assessment-request.service.js`) ← read by `bot/shared/services/portal-ready-whatsapp.service.js:114:b99a43d6` · `bot/shared/services/share-send.service.js:106:1c461d0f`
- column `assessment_requests.question_count` (written by `assessment-request.service.js`) ← read by `bot/shared/services/portal-ready-whatsapp.service.js:114:b99a43d6` · `bot/shared/services/share-send.service.js:106:1c461d0f`
- column `assessment_requests.question_types` (written by `assessment-request.service.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:250:64e1a363`
- column `assessment_requests.subject_code` (written by `assessment-request.service.js`) ← read by `bot/shared/services/portal-ready-whatsapp.service.js:114:b99a43d6` · `bot/shared/services/share-send.service.js:106:1c461d0f` · `bot/shared/services/assessment/assessment-browse.service.js:250:64e1a363`
- column `assessment_requests.surface` (written by `assessment-request.service.js`) ← read by `bot/shared/services/portal-ready-whatsapp.service.js:116:dbdd5706`
- column `assessment_requests.user_id` (written by `assessment-request.service.js`) ← read by `bot/shared/services/portal-ready-whatsapp.service.js:114:b99a43d6` · `bot/shared/services/share-send.service.js:107:8327a7f7` · `dashboard/routes/portal.routes.js:1194:8c12ba89` · `dashboard/services/teacher-home-order.service.js:231:b5e302a6` (+1: `python3 kg/kg.py who-reads assessment_requests.user_id`)
- table `assessment_papers` (written by `assessment-orchestrator.service.js`, `assessment-revision.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:143:1661513d`? · `bot/scripts/assessment/repair-backfilled-v1-created-at.js:69:e3ab478d`? · `dashboard/routes/portal.routes.js:1756:f8c4de9c`? · `bot/shared/services/assessment/assessment-browse.service.js:161:d5e4566e`? (+2: `python3 kg/kg.py who-reads assessment_papers`)
- table `assessment_requests` (written by `assessment-request.service.js`) ← read by `bot/shared/services/portal-ready-whatsapp.service.js:113:53413c6f`? · `bot/shared/services/share-send.service.js:105:53413c6f`? · `dashboard/routes/portal.routes.js:1192:b7d7c184`? · `dashboard/services/teacher-home-order.service.js:231:b5e302a6`? (+1: `python3 kg/kg.py who-reads assessment_requests`)
- env `KIE_API_KEY` read at `bot/shared/services/assessment/fde-picture-kie.js:48:39cdf850`

## Tests (all, generated)
- `assessment-browse.service.js` ← `tests/assessment/assessment-browse-page-past-end.test.js` · `tests/assessment/assessment-browse-service.test.js` · `tests/assessment/assessment-browse-version-tie.test.js` · `tests/assessment/assessment-browse-versions.test.js` · `tests/assessment/fde-paper-view.test.js` · `tests/portal/bd-fmf24g.30-share-send.test.js`
- `assessment-changes.js` ← `tests/assessment/assessment-add-types.test.js` · `tests/assessment/assessment-changes.test.js`
- `assessment-delivery.js` ← `tests/assessment/assessment-edit-button-delivery.test.js` · `tests/assessment/assessment-portal-flag-whatsapp-unaffected.test.js`
- `assessment-edit.js` ← `tests/assessment/assessment-edit-shape.test.js` · `tests/assessment/fde-edit-marks.test.js` · `tests/assessment/fde-edit.test.js` · `tests/assessment/fde-revision.test.js`
- `assessment-editor.service.js` ← `tests/assessment/assessment-editor-service.test.js` · `tests/assessment/fde-edit.test.js`
- `assessment-format.js` ← `tests/assessment/assessment-docx-flag.test.js` · `tests/assessment/assessment-format.test.js`
- `assessment-generation.service.js` ← `tests/assessment/assessment-answers-and-lines.test.js` · `tests/assessment/assessment-generation.service.test.js` · `tests/assessment/assessment-per-type-counts.test.js` · `tests/assessment/assessment-seen-unseen.test.js` · `tests/assessment/assessment-total-marks.test.js` · `tests/assessment/draw-it-prompt.test.js` (+77: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-generation.service.js`)
- `assessment-json.util.js` ← `tests/assessment/assessment-json.util.test.js` · `tests/assessment/fde-r7-json-parse-first.test.js`
- `assessment-orchestrator.service.js` ← `tests/assessment/assessment-answer-key-persisted.test.js` · `tests/assessment/assessment-build-paper-seam.test.js` · `tests/assessment/assessment-delivery.test.js` · `tests/assessment/assessment-orchestrator-versions.test.js` · `tests/assessment/assessment-orchestrator.service.test.js` · `tests/assessment/assessment-seen-unseen.test.js` (+13: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-orchestrator.service.js`)
- `assessment-paper-fde.renderer.js` ← `tests/assessment/assessment-paper-fde.renderer.test.js` · `tests/assessment/fde-early-paper.test.js` · `tests/assessment/fde-fixtures-chain.test.js` · `tests/assessment/fde-match.test.js` · `tests/assessment/fde-maths-angle-options.test.js` · `tests/assessment/fde-no-disclaimer.test.js` (+30: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-paper-fde.renderer.js`)
- `assessment-paper-view.service.js` ← `tests/assessment/assessment-paper-view.test.js` · `tests/assessment/fde-paper-view-choice-items.test.js` · `tests/assessment/fde-paper-view.test.js`
- `assessment-paper.renderer.js` ← `tests/assessment/answer-key-marks.test.js` · `tests/assessment/assessment-add-types.test.js` · `tests/assessment/assessment-answers-and-lines.test.js` · `tests/assessment/assessment-edit-shape.test.js` · `tests/assessment/assessment-paper.renderer.test.js` · `tests/assessment/assessment-rtl-latin.test.js` (+10: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-paper.renderer.js`)
- `assessment-request.service.js` ← `tests/assessment/assessment-answer-key-always.test.js` · `tests/assessment/assessment-marks-budget-seam.test.js` · `tests/assessment/assessment-request-enqueue.test.js` · `tests/assessment/assessment-seen-unseen.test.js` · `tests/assessment/fde-create.test.js` · `tests/assessment/golden.test.js`
- `assessment-revision.service.js` ← `tests/assessment/assessment-build-version.test.js` · `tests/assessment/assessment-review-list.test.js` · `tests/assessment/assessment-revision.test.js` · `tests/assessment/assessment-versions-completion.test.js` · `tests/assessment/assessment-versions-service.test.js` · `tests/assessment/fde-revision.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-revision.service.js`)
- `assessment-selection.js` ← `tests/assessment/assessment-add-types.test.js` · `tests/assessment/assessment-build-version.test.js` · `tests/assessment/assessment-changes.test.js` · `tests/assessment/assessment-editor-service.test.js` · `tests/assessment/assessment-option-title-urdu.test.js` · `tests/assessment/assessment-review-list.test.js` (+11: `python3 kg/kg.py who-reads bot/shared/services/assessment/assessment-selection.js`)
- `assessment-vocabulary.js` ← `tests/assessment/assessment-vocabulary.test.js`
- `blueprint-check.js` ← `tests/assessment/fde-blueprint-check.test.js` · `tests/assessment/fde-english-levels.test.js` · `tests/assessment/fde-section-levels.test.js`
- `book-content.service.js` ← `tests/assessment/book-content.service.test.js`
- `composition-criteria.js` ← `tests/assessment/composition-criteria.test.js`
- `english-check.js` ← `tests/assessment/fde-r8-check.test.js`
- `fde-early-prompt.js` ← `tests/assessment/fde-early-answers.test.js` · `tests/assessment/fde-early-asked.test.js` · `tests/assessment/fde-early-pictures-pattern.test.js` · `tests/assessment/fde-early-prompt.test.js` · `tests/assessment/fde-early-writer.test.js` · `tests/assessment/fde-plant-label.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-early-prompt.js`)
- `fde-early-writer.js` ← `tests/assessment/fde-early-dispatch.test.js` · `tests/assessment/fde-early-writer.test.js`
- `fde-layout.js` ← `tests/assessment/assessment-paper-fde.renderer.test.js` · `tests/assessment/fde-blueprint-check.test.js` · `tests/assessment/fde-edit-marks.test.js` · `tests/assessment/fde-edit.test.js` · `tests/assessment/fde-fixtures-chain.test.js` · `tests/assessment/fde-generation.test.js` (+70: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-layout.js`)
- `fde-match-block.js` ← `tests/assessment/fde-match-block.test.js` · `tests/assessment/fde-v19-paper-fixes.test.js` · `tests/assessment/fde-v21-key-fixes.test.js`
- `fde-oral-sheet.js` ← `tests/assessment/fde-oral-sheet.test.js` · `tests/assessment/fde-v21-key-fixes.test.js`
- `fde-order-block.js` ← `tests/assessment/fde-order-block.test.js`
- `fde-picture-block.js` ← `tests/assessment/fde-picture-block.test.js` · `tests/assessment/fde-plant-label.test.js` · `tests/assessment/fde-v19-paper-fixes.test.js` · `tests/assessment/fde-v20-paper-fixes.test.js`
- `fde-picture-kie.js` ← `tests/assessment/fde-picture-frame.test.js` · `tests/assessment/fde-picture-kie.test.js`
- `fde-picture-svg.js` ← `tests/assessment/fde-picture-svg.test.js` · `tests/assessment/fde-plant-label.test.js`
- `fde-pictures.js` ← `tests/assessment/fde-picture-frame.test.js` · `tests/assessment/fde-pictures.test.js`
- `fde-reader.js` ← `tests/assessment/fde-r17-sst.test.js` · `tests/assessment/fde-r17-urdu.test.js` · `tests/assessment/fde-r17b-sst.test.js` · `tests/assessment/fde-r17c-sst.test.js` · `tests/assessment/fde-r17d-sst.test.js` · `tests/assessment/fde-r17e-sst.test.js` (+16: `python3 kg/kg.py who-reads bot/shared/services/assessment/fde-reader.js`)
- `fde-stem-check.js` ← `tests/assessment/fde-stem-check-parts.test.js` · `tests/assessment/fde-stem-check-topics.test.js` · `tests/assessment/fde-stem-check.test.js`
- `ict-prompts.json` ← `tests/assessment/assessment-generation.service.test.js`
- `marking-scheme.js` ← `tests/assessment/assessment-paper-fde.renderer.test.js` · `tests/assessment/fde-fixtures-chain.test.js` · `tests/assessment/fde-match.test.js` · `tests/assessment/fde-maths-angle-options.test.js` · `tests/assessment/fde-orchestrator.test.js` · `tests/assessment/fde-r12-urdu.test.js` (+15: `python3 kg/kg.py who-reads bot/shared/services/assessment/marking-scheme.js`)
- `maths-check.js` ← `tests/assessment/assessment-paper-fde.renderer.test.js` · `tests/assessment/fde-fixtures-chain.test.js` · `tests/assessment/fde-orchestrator.test.js` · `tests/assessment/fde-r10-place.test.js` · `tests/assessment/fde-r5-rt3a-s2.test.js` · `tests/assessment/fde-r5-rt3a.test.js` (+8: `python3 kg/kg.py who-reads bot/shared/services/assessment/maths-check.js`)
- `question-types.js` ← `tests/assessment/assessment-browse-service.test.js` · `tests/assessment/assessment-limit-and-errors.test.js` · `tests/assessment/assessment-per-type-counts.test.js` · `tests/assessment/assessment-question-count.test.js` · `tests/assessment/assessment-total-marks.test.js` · `tests/assessment/assessment-types-limit.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/assessment/question-types.js`)
- `topic-key.renderer.js` ← `tests/assessment/topics/topic-key.test.js`

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/assessment/CLAUDE.index.md`? · `bot/shared/services/assessment/CLAUDE.md`? · `bot/shared/services/assessment/patterns/CLAUDE.index.md`? · `bot/shared/services/assessment/patterns/CLAUDE.md`? · `bot/shared/services/assessment/topics/CLAUDE.index.md`? · `bot/shared/services/assessment/topics/CLAUDE.md`? · `tests/assessment/CLAUDE.index.md`? · `tests/assessment/topics/CLAUDE.index.md`? · `tests/assessment/topics/CLAUDE.md`? · `tests/portal/CLAUDE.index.md`? · `tests/portal/CLAUDE.md`? · `todo.md`?
