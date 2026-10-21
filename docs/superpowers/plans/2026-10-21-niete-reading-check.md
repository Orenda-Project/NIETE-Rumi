# NIETE Reading Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Rumi's WhatsApp reading check on in NIETE. Port the passage library, roster mode and ASER level from the main bot. Let a teacher start the check from a printed paper's passage, with each child's result linked back to that paper as evidence.

**Architecture:** NIETE keeps its own reading fork (`bot/shared/services/reading-assessment.service.js` plus `reading/`). We port the newer main-bot modules beside it rather than replacing it.
- The paper entry is a `/reading paper <paperId>` command. A `wa.me` link on the teacher page pre-fills it.
- The command reads the passage out of `assessment_papers.exam_json.oral.readingPassage`, which is the passage printed on the student paper. It then runs the roster loop with that passage fixed.
- Each result row carries `assessment_paper_id`.
- A read-only route lists those rows, and the portal shows them beside the paper. They are never written into marks.

**Tech Stack:** Node/Express bot, Jest, Supabase Postgres, WhatsApp Flows (Meta Graph API), Soniox STT, Azure Speech, React portal (`portal/`).

**Spec:** `docs/superpowers/specs/2026-10-20-assessment-topic-skill-papers-oral.md` §2–§5. It lives in worktree `bd-6clakk`, and this plan argues from it. The design spec `…-design.md` §3 and §12 set the engine-file rules.

## Global Constraints

- **Evidence only (Amena, 20 Oct):** "Rumi's reading score is evidence only, and never the mark." No code path writes reading results into any paper mark, total or rubric field.
- **Sandbox first.** Every task lands on `sandbox` (+92 302 5502255, "Digital Coach Updates", Supabase `olvritwoqujtjvwfulbh`) and is verified there.
  - Staging and production are Task 10 only, and each needs Amena's "go".
- **Class S rule.** Every env var goes on BOTH `bot` and `sqs-worker` for an environment. A feature is not live until one real event has been seen in Axiom `niete-logs`.
- **Flow ownership.** Before trusting any `*_FLOW_ID`, run `GET /{WABA_ID}/flows` on that environment's WABA.
  - Write `endpoint_uri` BEFORE `POST /{flow_id}/publish`. Writing it to a published Flow silently unpublishes it.
  - Meta probes the endpoint at publish time, so the route must be deployed first (error 139002 / 4233014 otherwise).
- **Sandbox DB writes and env sets run by Amena via `!`.** The plan gives the literal command, with no `<placeholders>`.
- **Haroon's engine files** (`assessment-orchestrator`, `assessment-generation.service`, `fde-layout`, `marking-scheme`, `question-types.js`, the pattern registry, `assessment-paper.renderer.js`, `internal-api.routes.js`) get no edits beyond the one named in Task 8, which needs Amena's yes.
- **TDD with proof:** for every task, run `bash .claude/scripts/bd-proof.sh red <child-bead> -- <test cmd>` and then `… green …`. Acceptance criteria go on the child bead first.
- **Languages:** NIETE is flat en/ur (`LANGUAGE_OFFER`). Port the `en` and `ur` passages only, never `sw`, and no region keying.
- **Port from `origin/main`** of `hyasin270/whatsapp-ai-bot` (8015c72a, 21 Oct), not the local clone (5cd56072, which is 63 lines behind in the reading files).
- **300-line file limit.** `sequential-reading.service.js` (380 lines) is split on port (Task 5).

## Review Focus

1. **Paper with no reading passage.** A topic paper with no "Reading aloud" pick, or a maths paper, should get a plain reply ("This paper has no reading passage"). It must not fall back to a generated passage. Covered by a test in Task 6.
2. **Someone else's paper ID.** A teacher who forwards or edits the link should be refused. The paper's request `user_id` must equal the sender's id. Covered by a test in Task 6.
3. **No roster for the class.** With no active `student_lists` row, the check falls back to one typed-name child, so the paper link still works. Covered by a test in Task 6.
4. **Same child read twice against one paper.** Both rows are kept; the results route shows the latest per child, with an attempt count. Covered by a test in Task 7.
5. **Urdu paper, English-preferring teacher.** The passage language comes from the paper's subject, not from `preferred_language`. Prompts use the teacher's language; the passage stays Urdu. Covered by a test in Task 6.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `bot/shared/config/feature-availability.js` | modify :108 | reading gate needs the Flow id AND `SONIOX_API_KEY` |
| `bot/database/migrations/bd-6clakk.1_reading_roster_paper_link.sql` (+ `_rollback.sql`) | create | 5 columns, all nullable (Task 2) |
| `bot/shared/data/reading-passages/{en,ur}/g{1..5}/*.json` | create | 12 approved passages copied verbatim |
| `bot/shared/services/reading/passage-library.service.js` | port | static passage lookup, never throws |
| `bot/shared/services/reading/{grade-normalisation,reading-benchmarks,comprehension-benchmarks,aser-level}.js` | port | ASER level and benchmarks |
| `bot/shared/services/reading/student-selection.service.js` | port | roster with history, next present student |
| `bot/shared/services/reading/sequential-reading.service.js` → split into `sequential-reading.service.js` + `sequential-reading-session.js` | port | the roster loop, plus the Redis day-session helpers |
| `bot/shared/services/reading/reading-flow-selector.js` | port | chooses v2 or v3 Flow by env |
| `bot/shared/services/reading/reading-v3-payload.service.js`, `bot/shared/routes/reading-assessment-endpoint.js`, `docs/flows/reading-assessment-flow-v3.json` | port | the roster Flow endpoint |
| `bot/shared/services/reading/paper-passage.js` | create (pure) | `exam_json` → fixed passage |
| `bot/shared/services/reading/paper-reading.service.js` | create | `/reading paper` start, ownership check |
| `bot/shared/routes/paper-reading-results.routes.js` | create | GET results per paper (read-only) |
| `bot/shared/services/assessment/oral-teacher-page.renderer.js` | modify (bd-6clakk's new file, not engine) | "Check reading on Rumi" link |
| `portal/src/components/…/ReadingEvidence.tsx` | create | results beside the paper |

Tests for ported modules are ported from main `tests/unit/<name>.test.js` to `bot/tests/reading/<name>.test.js`.

---

### Task 0: Beads

- [ ] Create these children of `bd-6clakk.1`, one per task: `.1a` gate+Flow, `.1b` schema, `.1c` passages, `.1d` ASER, `.1e` roster, `.1f` paper entry, `.1g` results, `.1h` link, `.1i` sandbox E2E, `.1j` promote.
  - Use `bd create … --parent bd-6clakk.1` and write `--acceptance` from each task's tests.
- [ ] Claim each child as you start it.

### Task 1: Reading gate + Flow live on sandbox

**Files:** Modify `bot/shared/config/feature-availability.js:108`. Test: `bot/tests/reading/feature-gate-reading.test.js`.

**Interfaces — Produces:** `isFeatureAvailable('reading', env)` is true only when both `READING_ASSESSMENT_FLOW_ID` and `SONIOX_API_KEY` are non-empty.

- [ ] **Step 1: Failing test.** With `{READING_ASSESSMENT_FLOW_ID:'123'}` alone, expect `false`. With `SONIOX_API_KEY:'k'` added, expect `true`. With an empty string, expect `false`.
- [ ] **Step 2: Red.** `cd bot && npx jest tests/reading/feature-gate-reading.test.js` → the first case fails (it returns true today).
- [ ] **Step 3:** Set `reading: ['READING_ASSESSMENT_FLOW_ID', 'SONIOX_API_KEY']`. Azure is not gated: Urdu pronunciation uses GPT-4o audio, and English degrades without Azure.
- [ ] **Step 4: Green.** Run the test above plus `npx jest tests/menu/issue-56-reading-assessment.test.js tests/child-test`.
- [ ] **Step 5: Ownership check (read-only).**
  - Run `GET https://graph.facebook.com/v21.0/$WABA_ID/flows` with the sandbox token from `keys/niete-sandbox.env`.
  - Record whether a reading Flow already exists on the sandbox WABA.
- [ ] **Step 6: Upload and publish the v2 (navigate) Flow on sandbox.** v2 is static and has no `endpoint_uri`, so the publish trap does not apply.
  - Run `set -a; source keys/niete-sandbox.env; set +a; node bot/scripts/assets/upload-flow.js docs/flows/reading-assessment-flow-v2.json`, then `POST /{flow_id}/publish`.
  - Save the id to the bead notes.
- [ ] **Step 7: Amena sets env on sandbox `bot` AND `sqs-worker`** (`NIETE-Rumi Staging` project, env `sandbox`). The plan writes the literal `railway variables --set` commands once the Flow id and key sources are known:
  - `READING_ASSESSMENT_FLOW_ID`
  - `SONIOX_API_KEY`
  - `AZURE_SPEECH_KEY`
  - `AZURE_SPEECH_REGION`
- [ ] **Step 8: Live check.**
  - Merge the branch to `sandbox` and confirm the deploy contains the commit.
  - From a test phone, send `/reading test` to +92 302 5502255 and read one passage.
  - Pass when Axiom `niete-logs` (env sandbox) shows the Flow send and the `handleAudioReceipt` route, and one `reading_assessments` row reaches `status='completed'` with `wcpm` set.
- [ ] **Step 9: Commit.** `git commit -m "feat(reading): gate needs Soniox key; reading Flow on sandbox (bd-6clakk.1a)"`

### Task 2: Schema — roster and paper link columns

**Schema-first defence** (live sandbox schema, read 21 Oct):
- `reading_assessments` has `student_identifier` (free text) but no FK to `students`, and nothing that links to a paper.
- `students`, `student_lists`, `attendance_sessions` and `attendance_records` already exist, so no new tables are needed.
- No existing column can hold a uuid FK to `assessment_papers`. `session_id` is the Redis session and `passage_type` is an enum-like label.
- A view cannot hold it either: the link is set at creation time.

These columns mirror main-bot migrations `030`, `bd-2203` and `bd-2720`, so ported code runs unchanged. The only new one is `assessment_paper_id`.

**Files:** Create `bot/database/migrations/bd-6clakk.1_reading_roster_paper_link.sql` and `…_rollback.sql`. Test: `bot/tests/reading/migration-reading-roster.test.js`. The test parses the SQL and asserts each column is `ADD COLUMN IF NOT EXISTS` and nullable, and that the rollback drops each one.

**Columns:**

| Table | Column | Notes |
|---|---|---|
| `reading_assessments` | `student_id uuid REFERENCES students(id) ON DELETE SET NULL` | |
| `reading_assessments` | `child_grade integer` | |
| `reading_assessments` | `aser_ladder_node text` | |
| `reading_assessments` | `assessment_paper_id uuid REFERENCES assessment_papers(id) ON DELETE SET NULL` | |
| `student_lists` | `grade smallint` | |

Indexes:
- `(student_id, created_at DESC)`
- `(assessment_paper_id) WHERE assessment_paper_id IS NOT NULL`
- `(user_id, is_active, grade)` on `student_lists`

- [ ] Red → write SQL → green → commit.
- [ ] **Amena runs on sandbox:** `! cd "NIETE-Rumi" && set -a && source keys/niete-sandbox.env && set +a && [[ "$SUPABASE_URL" == *olvritwoqujtjvwfulbh* ]] && psql "$DATABASE_URL" -f bot/database/migrations/bd-6clakk.1_reading_roster_paper_link.sql`
- [ ] **Verify:** re-read the REST OpenAPI definitions. All 5 columns should be present.

### Task 3: Passage library

**Files:**
- Copy the 12 `en` and `ur` passages listed below verbatim from main `shared/data/reading-passages/`, plus `banned-words.json`.
- Port `passage-library.service.js`.
- Modify NIETE `reading/passage-generation.service.js` where the passage is chosen: call the static passage first, and fall back to the LLM on `null`. Main's wire-up is at `passage-generation.service.js:434` as the pattern.
- Tests: port `passage-library.test.js`; add `passage-generation-static.test.js`.

The 12 passages: `en-g1-{LT,P,W}-001`, `en-g{2..5}-P-001`, `ur-g{1..4}-P-001`, `ur-g5-{P,S}-001`.

**Interfaces — Produces:** `PassageLibraryService.getStaticPassage(grade:number, level:string, language:'en'|'ur', rotationIndex=0) → {id, language, grade, level, title, text, word_count} | null`. It never throws. `getById(id:string) → passage | null` is new here, for Task 6 tests and for future library-backed papers.

- [ ] Port the tests and run them red (the module is missing). Add `getById` tests: a known id returns the passage; an unknown id or `../x` returns `null`.
- [ ] Port the module and add `getById`. Wire it into generation.
- [ ] Green, then run the NIETE reading suite `npx jest tests/child-test tests/menu`.
- [ ] Commit.

### Task 4: ASER level and benchmarks

**Files:**
- Port `grade-normalisation.js`, `reading-benchmarks.js`, `comprehension-benchmarks.js` and `aser-level.service.js`, with their four main tests.
- Modify NIETE `reading/analysis.service.js` at the point it saves results: write `aser_ladder_node` and `child_grade`.
- NIETE's own `reading/benchmark.service.js` stays. It sets `on_track` and the grade benchmark columns. `aser-level` adds the ASER node only.

**Interfaces — Produces:** `computeAserLevel({language, wordsCorrect, totalWords, passageLevel, comprehensionScore}) → {level:0|1|2|3|4, node:string}`. Use main's exact signature from `aser-level.service.js`, and copy it into the bead notes on port.

- [ ] Ported tests red → port → green.
- [ ] Add `analysis-aser-writeup.test.js`: a completed analysis upserts `aser_ladder_node` (Supabase mocked at the client boundary only).
- [ ] Commit.

### Task 5: Roster mode (v3 Flow)

**Files:**
- Port `student-selection.service.js`, `reading-flow-selector.js`, `reading-v3-payload.service.js`, `routes/reading-assessment-endpoint.js` (391 lines; split its screen handlers into `reading-assessment-endpoint.screens.js` if it is still over 300 after the port), and `docs/flows/reading-assessment-flow-v3.json`.
- Port `sequential-reading.service.js`, split as follows:
  - `sequential-reading-session.js`: `todayStr`, `saveDaySession`, `readDaySession`, `clearDaySession`.
  - `sequential-reading.service.js`: the rest.
- Mount the endpoint in `flow-endpoint.routes.js`.
- Route `menu.service.js:259,280` and `text-message.handler.js:1141-1216` through `getReadingFlowTarget()`.
- Wire `analysis.service.js` to call `SequentialReadingService.promptNextOrEnd` on completion (main does this at `analysis.service.js:482,1792`).
- Tests: port `student-selection`, `sequential-reading`, `reading-flow-selector` and `reading-v3-payload`. Add `menu-reading-flow-target.test.js`, which asserts the Flow id and start screen never drift.

**Interfaces — Produces:**
- `getReadingFlowTarget(env) → {flowId, screen:'BASIC_INFO'|'START', version:2|3, isV3}`
- `startAssessmentForStudent({userId, phoneNumber, student, language, comprehensionRequired, childGrade, fixedPassage?, assessmentPaperId?})`. The last two arguments are NEW, for Task 6. When `fixedPassage` is given, skip generation and write `passage_text`, `passage_title`, `passage_word_count`, `passage_type='paper'` and `assessment_paper_id`.
- `promptNextOrEnd(assessment, phoneNumber, lang)`. It carries `fixedPassage` and `assessmentPaperId` forward through the Redis day session, so every child in the loop reads the same paper passage.

**Steps:**
- [ ] Ported tests red → port → green.
- [ ] New test: with `fixedPassage`, `PassageGenerationService` is never called, and the second child gets the same text and paper id.
- [ ] **v3 Flow on sandbox**, in this exact order:
  1. Merge to `sandbox` and confirm the endpoint is deployed (curl it; expect the encrypted-request 4xx, not a 404).
  2. Upload the v3 JSON.
  3. Set `endpoint_uri` to the sandbox bot URL `/api/flows/reading-assessment`.
  4. `POST /publish`.
- [ ] **Amena sets** `READING_ASSESSMENT_FLOW_V3_ID` on sandbox `bot` and `sqs-worker`.
- [ ] **Live check:**
  - A test teacher with a 3-student `student_lists` row runs `/reading`.
  - The v3 START screen appears; pick roster; read 2 children.
  - Pass when two rows have `student_id` set and the third child is offered next.
- [ ] Commit.

### Task 6: "Start with this passage" — `/reading paper <paperId>`

**Files:**
- Create `bot/shared/services/reading/paper-passage.js` (pure) and `bot/shared/services/reading/paper-reading.service.js`.
- Modify `text-message.handler.js` next to the `/reading` branch (:1141). Match the `/reading paper ` prefix before the generic `/reading`.
- Tests: `bot/tests/reading/paper-passage.test.js` and `bot/tests/reading/paper-reading.service.test.js`.

**Interfaces — Produces:**
- `passageFromPaper(examJson:object, subject:string, grade:number) → {title, text, language:'en'|'ur', grade, wordCount} | null`.
  - It reads `examJson.oral.readingPassage`; the shape is set by bd-6clakk Task 11.
  - `language` comes from `subject`: `'urdu'` → `'ur'`, else `'en'`.
  - It returns `null` when the passage is missing or blank, or the subject is not English or Urdu.
- `startPaperReading({user, phoneNumber, paperId}) → {status:'started'|'no_passage'|'not_found'|'not_owner'|'disabled'}`. It:
  - loads `assessment_papers` joined to `assessment_requests`, for `user_id`, subject and grade;
  - checks ownership;
  - picks the class roster (`student_lists`, user active, matching grade). With a roster it calls Task 5's loop with `fixedPassage` and `assessmentPaperId`. With none, it runs the single-child typed-name path with the same fixed passage.

**Copy (teacher language, en/ur):** `no_passage` → "This paper has no reading passage. Add Reading aloud when you make the paper." The other statuses get one line each, in `ux-strings.js`, under 1024 code points.

- [ ] **Step 1: Failing tests.**
  - `passageFromPaper`: English passage, Urdu passage, missing `oral`, blank text, a Maths subject.
  - Service:
    - `not_owner` when the request `user_id` differs;
    - `no_passage` with no generation call;
    - no roster → single-child path;
    - an Urdu paper with an `en` teacher gives a `ur` passage and `en` prompts;
    - `disabled` when the reading gate is off;
    - a uuid-shaped check on `paperId`, so garbage → `not_found` with no query.
- [ ] **Step 2: Red.** `npx jest tests/reading/paper-passage.test.js tests/reading/paper-reading.service.test.js`
- [ ] **Steps 3–4:** Implement, then green, plus `tests/menu`.
- [ ] **Step 5: Live check on sandbox.**
  - Make an English topic paper with Reading aloud ticked (needs bd-6clakk Task 11 on sandbox).
  - Send `/reading paper` with its id. Read 2 children.
  - Pass when both rows have `assessment_paper_id` = that id and `passage_text` equals the printed passage.
- [ ] Commit.

### Task 7: Results beside the paper (read-only)

**Files:**
- Create `bot/shared/routes/paper-reading-results.routes.js`. Mount it beside the existing portal API in `whatsapp-bot.js` — NOT in `internal-api.routes.js`, which is engine.
- Create `portal/src/components/assessment/ReadingEvidence.tsx`.
- Tests: `bot/tests/reading/paper-reading-results.routes.test.js` and `portal/src/components/assessment/ReadingEvidence.test.tsx`.

**Interfaces — Produces:** `GET /api/portal/assessment-papers/:id/reading-results`. Use the same auth middleware as the existing portal paper routes; the paper must belong to the logged-in teacher. Response: `{children: [{studentId, name, wcpm, accuracy, aserLevel, completedAt, attempts}]}`.
- One entry per child (latest completed row), with `attempts` = the row count.
- Unrostered rows are keyed by `student_identifier`.

**Tests:**
- Two rows for one child → one entry with `attempts:2` and the later `wcpm`.
- Another teacher → 403.
- The response has no `marks` or `score` field, and the route issues no writes (spy on the client: zero `insert`/`update`/`upsert`).
- The component renders the heading "Reading on Rumi — evidence, not the mark". It renders nothing when `children` is empty, and never renders an input.

- [ ] Red → implement → green → commit.

### Task 8: "Check reading on Rumi" link on the teacher page

**Depends on:** bd-6clakk Task 11 merged to `sandbox` (`oral-teacher-page.renderer.js` exists).

**Files:**
- Modify `bot/shared/services/assessment/oral-teacher-page.renderer.js`. This is bd-6clakk's new module, not engine.
- **Engine edit needing Amena's yes:** `assessment-paper.renderer.js` `renderAnswerKey` must pass `paperId` into the teacher-page call-out. bd-6clakk §12 approved the call-out itself; passing one more argument is beyond that list.
- Test: extend `oral-teacher-page.test.js`.

**Interfaces — Consumes:** `renderOralTeacherPage({..., paperId, readingEnabled, botNumber})`. `botNumber` comes from the existing env var for the bot's own WhatsApp number; confirm its name with `rg -n "WHATSAPP_PHONE_NUMBER|BOT_PHONE" bot/shared/config`. The link is `https://wa.me/${botNumber}?text=${encodeURIComponent('/reading paper ' + paperId)}`.

**Tests:**
- The link appears only when reading aloud was picked AND `readingEnabled`.
- The text says the teacher can also mark on paper.
- No link without `paperId`.
- The snapshot of a no-oral chapter test is unchanged.

- [ ] Get Amena's yes on the one engine edit (see the report), then red → implement → green → commit.

### Task 9: Sandbox end-to-end

- [ ] On the sandbox number, as a test teacher with a 3-child roster:
  1. Make an Urdu topic paper with Reading aloud.
  2. Open the teacher-page PDF and tap the link.
  3. WhatsApp opens pre-filled; send.
  4. Read all 3 children.
  5. Open the portal paper view.
- [ ] **Pass when:**
  - 3 children are listed under "Reading on Rumi — evidence, not the mark";
  - the paper's marks and totals are unchanged (`assessment_papers.total_marks` before = after);
  - Axiom `niete-logs` shows the events from both the `bot` and `sqs-worker` services, with no errors.
- [ ] Record the evidence in the bead and close `.1a`–`.1i`.

### Task 10: Promote — **needs Amena's go, each step separately**

Breaks anything? **No** for existing teachers:
- The reading gate is off until the env vars are set.
- The migration only adds nullable columns.
- The `/reading paper` command is new.

**Yes, cost exposure:** Soniox and Azure bills start the moment the keys are set on production.

1. **Staging.**
   - `git cherry-pick -x` the commits onto `staging`. (`-x` is needed, or the gate fails.)
   - Run the migration on the staging DB (Amena runs it via `!`).
   - Upload and publish the v2 and v3 Flows on the staging WABA, v3 in Task 5's order.
   - Set the 5 vars on staging `bot` AND `sqs-worker`.
   - Repeat the Task 9 run on +92 322 2482222.
2. **Production.**
   - Merge `staging` → `main`.
   - Run the migration on `ihzciabopbttygxxgrkm`.
   - Upload and publish the Flows on the production WABA.
   - Set the vars on production `bot` AND `sqs-worker`.
   - See one real `/reading` event in `niete-logs` before calling it live.
