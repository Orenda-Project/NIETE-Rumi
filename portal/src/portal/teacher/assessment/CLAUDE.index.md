# assessment — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/assessment -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 files) |
| `__snapshots__/` | → (not mapped: excluded; 2 files) |
| `AssessmentAll.tsx` | All papers page (See all from Recent papers): server total, class filter, ready papers by day with Show more paging |
| `AssessmentHub.tsx` | Assessment main page: New paper entry (plus FDE board-pattern door), Being made jobs, collapsible Recent papers |
| `EditPages.tsx` | Edit a finished paper and edit/add one question; Save makes a new version via /assessment/edit routes (bd-fmf24g.6) |
| `FdeCheck.tsx` | FDE board-pattern 'Check and make' screen: Paper style, Class, Syllabus rows with trays, then Make my paper |
| `NewPaperSteps.tsx` | New paper step routes: Class, Cover (chapters or pages), Questions, Check and make, all using the shared picks store |
| `PaperBody.tsx` | Renders a paper's structured sections and questions (marks, MCQ options, columns, passages) in the paper's own direction |
| `PaperPage.tsx` | One paper's page: class, chapter, marks, version, with Download, Answer key, Send on WhatsApp and Versions |
| `QuestionForm.tsx` | Input boxes for editing or adding one question, shaped by its fields or type; sends what the bot's editor sends |
| `RequestPage.tsx` | Page for one requested paper through writing, failed and ready states, including the in-viewer paper and answer key |
| `StemChips.tsx` | (unmapped) |
| `TopicsStep.tsx` | Topics step after Chapters when one chapter with topics is picked: Whole chapter or Select topics with Tick all |
| `VersionsPage.tsx` | Lists a paper's versions and opens each as a file; board-pattern papers get an FDE chip and marking-scheme row |
| `allPapersMore.test.tsx` | Pins All papers 'Show more': a second tap while page 2 loads must not skip or over-ask the next page (AssessmentAll) |
| `api.ts` | Assessment data layer over portal.* calls: catalogue/options (grades, types, pattern offer), papers, status, create |
| `assessment.ur.test.tsx` | Renders hub, steps, Check, paper, Edit pages in Urdu and asserts none of the frame words stay English (bd-fmf24g.13.1) |
| `checks.test.tsx` | Style and copy guard for Assessment pages: logical start/end only, motion-safe, copy.ts words, 56px targets, routes |
| `classStep.report.test.tsx` | Pins Class step with ?origin=report&grade&subject&chapter: prefills, tags the paper origin report (bd-pw1ccr.2) |
| `classStep.test.tsx` | Pins New paper step 1 Class as one ClassPicker over the live catalogue, own classes starred (bd-fmf24g.14) |
| `classStep.topics.test.tsx` | (unmapped) |
| `copy.ts` | English and Urdu words for every Assessment screen (machine-drafted Urdu), registered as COPY_ENTRY |
| `editForm.test.ts` | Pins that edit and add question forms send exactly the keys today's editor sends (editForm.ts, bd-fmf24g.6) |
| `editForm.ts` | Maps a question's shape to its form boxes and builds the save/add payload the bot's editor expects |
| `editPages.test.tsx` | Pins editing a board-pattern paper: willSay lines per choice group, Add refused with its reason, honest no-choice text |
| `failure.ts` | Turns the bot's failure codes and server refusals into short teacher-facing labels and retry-time text |
| `fde.early.test.tsx` | Pins that FDE door, chips and held note follow patternGrades from /assessment/options, not a fixed Grade 5 (bd-5jmnfj.4) |
| `fde.model.test.ts` | Pins FDE steps (Class, Check) and a create spec naming the pattern; non-pattern papers unchanged (model.ts) |
| `fde.pages.test.tsx` | Pins FDE board-pattern screens: hub door, Class to Check path, three-tray Check, server refusals in teacher words |
| `fde.r5.edit.test.tsx` | Pins PATTERN_NO_EDIT and PATTERN_NO_ADD handling when editing a board-pattern paper the server cannot edit |
| `fde.r5.test.tsx` | Pins FDE screens under slow/refused/absent options reads: Cover, door tap in flight, Check failed read, Syllabus tray |
| `fde.r6.test.tsx` | Pins FDE round 6: WhatsApp Android hand-off per file row, no scheme chip on Ready, Marks hidden in the editor |
| `fde.r8.banner.test.tsx` | Pins that the Paper ready banner never covers Make: Check's dock pads by the banner height and releases it |
| `homeRecent.test.tsx` | Pins Assessment home Recent papers: latest papers, See all to All papers, empty state, All papers route (bd-fmf24g.34) |
| `linkPicks.test.ts` | Tests readLink: reads origin=report and the grade/subject/chapter prefill, ignoring a prefill without origin (bd-pw1ccr) |
| `linkPicks.ts` | Parses the A/B report button's link into origin and class/chapter prefill for New paper (bd-pw1ccr.1/.2) |
| `model.test.ts` | Tests New paper rules in model.ts: seen plus per-type counts add up, marks budget, caps, step reasons (bd-fmf24g.6) |
| `model.ts` | Pure New paper model: picks, steps (plain, topics, FDE), question-type slots and caps mirroring the bot's Flow rules |
| `openArtifact.ts` | Opens a board-pattern paper's question-paper or marking-scheme file, via the browser hand-off inside WhatsApp Android |
| `pages.test.tsx` | Pins v2 Assessment over mocked portal.* routes: Make paper sends every option, refusals stay on page, Pages step |
| `paperBody.test.tsx` | Pins the paper page rendering the paper: sections, numbered questions, options, parts, RTL for Urdu (bd-fmf24g.31) |
| `paperCache.ts` | In-memory cache of papers My papers has read so a paper page opens from a row, with findPaper after a reload |
| `paperReady.test.tsx` | Pins Paper ready for a plain paper: chips, in-viewer paper, Answer key swap, no Make another (bd-7tgiyc) |
| `papersList.ts` | Groups ready papers by Pakistan day into HistoryList rows, shared by Recent papers and All papers |
| `paths.ts` | Path builders for every Assessment page under /portal/teacher/assessment: new paper, request, paper, versions, edit |
| `questionsFlow.test.tsx` | Pins the four-step New paper and Questions screen: seen count, chosen unseen types, Add a type, marks, blocked reasons |
| `reasons.ts` | Turns model.ts step and page-range reasons into English or Urdu text shared by docks and fields (bd-fmf24g.34) |
| `routes.tsx` | Registers the lazy Assessment pages (hub, steps, request, paper, versions, edit, all) under /portal/teacher/assessment |
| `stemChips.test.tsx` | (unmapped) |
| `store.ts` | Shared New paper picks store held in memory and mirrored to sessionStorage so Back and reload keep choices |
| `topics.api.test.ts` | Tests loadTopics: one chapter's topics from portal.getAssessmentTopics; empty chapter gives [], failure throws |
| `topics.test.ts` | Tests Topics step rules: whole chapter vs ticked topics, headings by language, all ticked equals chapter, 10 marks |
| `topics.ts` | Pure Topics rules: group topics by skill heading, tick-all, suggested types and default marks for a topic paper |
| `topicsStep.test.tsx` | Pins the Topics step on screen: only for one chapter with topics, Whole chapter or Select topics, else skipped |
| `ui.tsx` | Assessment's own small pieces: step frame and bar, tabs, stepper, switch, radio choice, dock buttons, load states |
| `useJobs.ts` | Hook tracking the teacher's Being made papers through usePaperJobs, kept per phone in session so refresh keeps them |
| `versions.test.tsx` | Pins Versions of a board-pattern paper: FDE chip, Marking scheme row per ready version; a plain paper unchanged |
| `whyRules.test.ts` | Tests digitsOnly, checkPages and the New paper limits with reasons (50 questions, 8 slots, 1000 marks, page range) |

## Who reads this (all, generated)
- `AssessmentAll.tsx` ← imported by `portal/src/portal/teacher/assessment/routes.tsx:7:d19cccd1`
- `AssessmentHub.tsx` ← imported by `portal/src/portal/teacher/assessment/routes.tsx:8:07a007b9`
- `EditPages.tsx` ← imported by `portal/src/portal/teacher/assessment/routes.tsx:9:f07b8545`
- `FdeCheck.tsx` ← imported by `portal/src/portal/teacher/assessment/NewPaperSteps.tsx:17:75177211`
- `NewPaperSteps.tsx` ← imported by `portal/src/portal/teacher/assessment/routes.tsx:11:74cc3b41`
- `PaperBody.tsx` ← imported by `portal/src/portal/teacher/assessment/PaperPage.tsx:21:1b525706`
- `PaperPage.tsx` ← imported by `portal/src/portal/teacher/assessment/routes.tsx:15:4b443fb0`
- `QuestionForm.tsx` ← imported by `portal/src/portal/teacher/assessment/EditPages.tsx:19:a6a4fcc3`
- `RequestPage.tsx` ← imported by `portal/src/portal/teacher/assessment/routes.tsx:17:8e9eebd2`
- `StemChips.tsx` ← imported by `portal/src/portal/teacher/assessment/NewPaperSteps.tsx:18:cb11fc53`
- `TopicsStep.tsx` ← imported by `portal/src/portal/teacher/assessment/routes.tsx:18:c415430e`
- `VersionsPage.tsx` ← imported by `portal/src/portal/teacher/assessment/routes.tsx:16:78282cff`
- `api.ts` ← imported by `portal/src/portal/teacher/assessment/AssessmentAll.tsx:11:6fdcfa3f` · `portal/src/portal/teacher/assessment/AssessmentHub.tsx:14:6add6e26` · `portal/src/portal/teacher/assessment/FdeCheck.tsx:12:b858b542` · `portal/src/portal/teacher/assessment/NewPaperSteps.tsx:12:4627dabe` (+4: `python3 kg/kg.py who-reads api.ts`)
- `copy.ts` ← imported by `portal/src/portal/teacher/notices/NoticeHost.tsx:6:ecf5e3dc` · `portal/src/portal/teacher/notices/useNoticeWords.ts:2:ecf5e3dc` · `portal/src/portal/teacher/assessment/AssessmentAll.tsx:9:bbd1d9a0` · `portal/src/portal/teacher/assessment/AssessmentHub.tsx:12:bbd1d9a0` (+14: `python3 kg/kg.py who-reads copy.ts`)
- `editForm.ts` ← imported by `portal/src/portal/teacher/assessment/EditPages.tsx:17:4b503829` · `portal/src/portal/teacher/assessment/QuestionForm.tsx:8:e84b61f1`
- `failure.ts` ← imported by `portal/src/portal/teacher/notices/NoticeHost.tsx:5:4748ce86` · `portal/src/portal/teacher/assessment/AssessmentHub.tsx:21:55d09057` · `portal/src/portal/teacher/assessment/FdeCheck.tsx:13:eb1c0b2b` · `portal/src/portal/teacher/assessment/NewPaperSteps.tsx:19:eb1c0b2b` (+1: `python3 kg/kg.py who-reads failure.ts`)
- `linkPicks.ts` ← imported by `portal/src/portal/teacher/assessment/NewPaperSteps.tsx:23:56bbc316`
- `model.ts` ← imported by `portal/src/portal/teacher/assessment/AssessmentHub.tsx:19:fad69eae` · `portal/src/portal/teacher/assessment/FdeCheck.tsx:14:82ea77ad` · `portal/src/portal/teacher/assessment/NewPaperSteps.tsx:16:74d4b72c` · `portal/src/portal/teacher/assessment/PaperPage.tsx:16:e1291789` (+11: `python3 kg/kg.py who-reads model.ts`)
- `openArtifact.ts` ← imported by `portal/src/portal/teacher/assessment/PaperPage.tsx:18:77ce2649` · `portal/src/portal/teacher/assessment/RequestPage.tsx:25:77ce2649`
- `paperCache.ts` ← imported by `portal/src/portal/teacher/assessment/AssessmentAll.tsx:12:1cc75ac5` · `portal/src/portal/teacher/assessment/AssessmentHub.tsx:16:1cc75ac5` · `portal/src/portal/teacher/assessment/PaperPage.tsx:17:8999cf1b` · `portal/src/portal/teacher/assessment/RequestPage.tsx:10:8999cf1b` (+1: `python3 kg/kg.py who-reads paperCache.ts`)
- `papersList.ts` ← imported by `portal/src/portal/teacher/assessment/AssessmentAll.tsx:13:74fec99e` · `portal/src/portal/teacher/assessment/AssessmentHub.tsx:15:74fec99e`
- `paths.ts` ← imported by `portal/src/portal/teacher/notices/serverNotices.ts:2:caeffa9b` · `portal/src/portal/teacher/notices/useOpenNotice.ts:4:752191e3` · `portal/src/portal/teacher/assessment/AssessmentAll.tsx:14:d0274fb7` · `portal/src/portal/teacher/assessment/AssessmentHub.tsx:17:73cfbe46` (+10: `python3 kg/kg.py who-reads paths.ts`)
- `reasons.ts` ← imported by `portal/src/portal/teacher/assessment/FdeCheck.tsx:16:960ac170` · `portal/src/portal/teacher/assessment/NewPaperSteps.tsx:20:cce2a270` · `portal/src/portal/teacher/assessment/TopicsStep.tsx:11:960ac170`
- `store.ts` ← imported by `portal/src/portal/teacher/assessment/AssessmentHub.tsx:18:b471d983` · `portal/src/portal/teacher/assessment/FdeCheck.tsx:17:217ffc66` · `portal/src/portal/teacher/assessment/NewPaperSteps.tsx:22:217ffc66` · `portal/src/portal/teacher/assessment/RequestPage.tsx:27:b471d983` (+1: `python3 kg/kg.py who-reads store.ts`)
- `topics.ts` ← imported by `portal/src/portal/teacher/assessment/NewPaperSteps.tsx:24:d658f56a` · `portal/src/portal/teacher/assessment/TopicsStep.tsx:15:f112baab`
- `ui.tsx` ← imported by `portal/src/portal/teacher/assessment/AssessmentAll.tsx:15:d2da209f` · `portal/src/portal/teacher/assessment/AssessmentHub.tsx:23:91eaf752` · `portal/src/portal/teacher/assessment/EditPages.tsx:20:9e7ebe6f` · `portal/src/portal/teacher/assessment/FdeCheck.tsx:19:8d2565b1` (+5: `python3 kg/kg.py who-reads ui.tsx`)
- `useJobs.ts` ← imported by `portal/src/portal/teacher/assessment/AssessmentHub.tsx:22:a89649f2` · `portal/src/portal/teacher/assessment/FdeCheck.tsx:18:a89649f2` · `portal/src/portal/teacher/assessment/NewPaperSteps.tsx:25:a89649f2` · `portal/src/portal/teacher/assessment/RequestPage.tsx:28:a89649f2`

## Tests (all, generated)
- `AssessmentAll.tsx` ← `portal/src/portal/teacher/assessment/allPapersMore.test.tsx` · `portal/src/portal/teacher/assessment/homeRecent.test.tsx`
- `AssessmentHub.tsx` ← `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` · `portal/src/portal/teacher/assessment/fde.early.test.tsx` · `portal/src/portal/teacher/assessment/fde.pages.test.tsx` · `portal/src/portal/teacher/assessment/fde.r5.test.tsx` · `portal/src/portal/teacher/assessment/homeRecent.test.tsx` · `portal/src/portal/teacher/assessment/pages.test.tsx`
- `EditPages.tsx` ← `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` · `portal/src/portal/teacher/assessment/editPages.test.tsx` · `portal/src/portal/teacher/assessment/fde.r5.edit.test.tsx` · `portal/src/portal/teacher/assessment/fde.r6.test.tsx`
- `NewPaperSteps.tsx` ← `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` · `portal/src/portal/teacher/assessment/classStep.report.test.tsx` · `portal/src/portal/teacher/assessment/classStep.test.tsx` · `portal/src/portal/teacher/assessment/classStep.topics.test.tsx` · `portal/src/portal/teacher/assessment/fde.early.test.tsx` · `portal/src/portal/teacher/assessment/fde.pages.test.tsx` (+6: `python3 kg/kg.py who-reads portal/src/portal/teacher/assessment/NewPaperSteps.tsx`)
- `PaperPage.tsx` ← `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` · `portal/src/portal/teacher/assessment/fde.pages.test.tsx` · `portal/src/portal/teacher/assessment/fde.r6.test.tsx` · `portal/src/portal/teacher/assessment/pages.test.tsx` · `portal/src/portal/teacher/assessment/paperBody.test.tsx`
- `QuestionForm.tsx` ← `portal/src/portal/teacher/assessment/checks.test.tsx`
- `RequestPage.tsx` ← `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` · `portal/src/portal/teacher/assessment/fde.pages.test.tsx` · `portal/src/portal/teacher/assessment/fde.r5.test.tsx` · `portal/src/portal/teacher/assessment/fde.r6.test.tsx` · `portal/src/portal/teacher/assessment/paperReady.test.tsx` · `portal/src/portal/teacher/notices/wiring.test.tsx`
- `VersionsPage.tsx` ← `portal/src/portal/teacher/assessment/fde.r5.edit.test.tsx` · `portal/src/portal/teacher/assessment/fde.r6.test.tsx` · `portal/src/portal/teacher/assessment/versions.test.tsx`
- `api.ts` ← `portal/src/portal/teacher/assessment/allPapersMore.test.tsx` · `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` · `portal/src/portal/teacher/assessment/classStep.report.test.tsx` · `portal/src/portal/teacher/assessment/classStep.test.tsx` · `portal/src/portal/teacher/assessment/classStep.topics.test.tsx` · `portal/src/portal/teacher/assessment/fde.early.test.tsx` (+12: `python3 kg/kg.py who-reads portal/src/portal/teacher/assessment/api.ts`)
- `copy.ts` ← `portal/src/portal/teacher/assessment/allPapersMore.test.tsx` · `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` · `portal/src/portal/teacher/assessment/checks.test.tsx` · `portal/src/portal/teacher/assessment/classStep.test.tsx` · `portal/src/portal/teacher/assessment/editPages.test.tsx` · `portal/src/portal/teacher/assessment/fde.early.test.tsx` (+13: `python3 kg/kg.py who-reads portal/src/portal/teacher/assessment/copy.ts`)
- `editForm.ts` ← `portal/src/portal/teacher/assessment/checks.test.tsx` · `portal/src/portal/teacher/assessment/editForm.test.ts`
- `failure.ts` ← `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` · `portal/src/portal/teacher/assessment/fde.r5.test.tsx`
- `linkPicks.ts` ← `portal/src/portal/teacher/assessment/linkPicks.test.ts`
- `model.ts` ← `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` · `portal/src/portal/teacher/assessment/fde.early.test.tsx` · `portal/src/portal/teacher/assessment/fde.model.test.ts` · `portal/src/portal/teacher/assessment/fde.pages.test.tsx` · `portal/src/portal/teacher/assessment/fde.r5.edit.test.tsx` · `portal/src/portal/teacher/assessment/fde.r5.test.tsx` (+11: `python3 kg/kg.py who-reads portal/src/portal/teacher/assessment/model.ts`)
- `paperCache.ts` ← `portal/src/portal/teacher/assessment/allPapersMore.test.tsx` · `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` · `portal/src/portal/teacher/assessment/fde.early.test.tsx` · `portal/src/portal/teacher/assessment/fde.pages.test.tsx` · `portal/src/portal/teacher/assessment/fde.r5.edit.test.tsx` · `portal/src/portal/teacher/assessment/fde.r5.test.tsx` (+7: `python3 kg/kg.py who-reads portal/src/portal/teacher/assessment/paperCache.ts`)
- `paths.ts` ← `portal/src/portal/teacher/assessment/allPapersMore.test.tsx` · `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` · `portal/src/portal/teacher/assessment/checks.test.tsx` · `portal/src/portal/teacher/assessment/classStep.report.test.tsx` · `portal/src/portal/teacher/assessment/classStep.test.tsx` · `portal/src/portal/teacher/assessment/classStep.topics.test.tsx` (+15: `python3 kg/kg.py who-reads portal/src/portal/teacher/assessment/paths.ts`)
- `routes.tsx` ← `portal/src/portal/teacher/assessment/checks.test.tsx` · `portal/src/portal/teacher/assessment/homeRecent.test.tsx` · `portal/src/portal/teacher/assessment/questionsFlow.test.tsx` · `portal/src/portal/teacher/assessment/topicsStep.test.tsx` · `portal/src/portal/teacher/assessment/versions.test.tsx`
- `store.ts` ← `portal/src/portal/teacher/assessment/assessment.ur.test.tsx` · `portal/src/portal/teacher/assessment/classStep.report.test.tsx` · `portal/src/portal/teacher/assessment/classStep.test.tsx` · `portal/src/portal/teacher/assessment/classStep.topics.test.tsx` · `portal/src/portal/teacher/assessment/fde.early.test.tsx` · `portal/src/portal/teacher/assessment/fde.pages.test.tsx` (+8: `python3 kg/kg.py who-reads portal/src/portal/teacher/assessment/store.ts`)
- `topics.ts` ← `portal/src/portal/teacher/assessment/topics.test.ts`
- `ui.tsx` ← `portal/src/portal/components/loadingStates.test.tsx` · `portal/src/portal/teacher/assessment/checks.test.tsx` · `portal/src/portal/teacher/assessment/fde.r8.banner.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/notices/CLAUDE.md`?
