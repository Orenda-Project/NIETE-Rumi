'use strict';
/**
 * The uploaded-LP extractor prompt ("Add my own lesson plan" path).
 * Verbatim from the offline-validated `eval/UPLOAD_EXTRACTION_BRIEF.md` (Eval 6 — validated on 8 real
 * teacher-uploaded LPs across Taleemabad-template / 5Es / gradual-release layouts). Keep in sync with the eval.
 */

const UPLOAD_EXTRACTION_BRIEF = `UPLOAD LP EXTRACTOR — a teacher's OWN uploaded lesson plan (free text) → prescribed TEACHING MOVES

A teacher chose "Add my own lesson plan" and uploaded her plan (Word/PDF, any template — a govt format,
a 5Es template, a college teaching-practice sheet, a hand-typed page). You are given its extracted TEXT.
Output the list of prescribed **teaching moves** a coach can tick off against a recording of the lesson.
This list is the denominator of a fidelity score: fidelity = moves executed ÷ moves prescribed.

## DIFFERENCE FROM THE CORPUS EXTRACTOR
There is NO structured JSON and NO field-paths here — just prose in some template. So YOU assign every
tag from the meaning of the text. Be robust to any layout: a time-column table ("5 min | Introduction |
…"), a 5Es table (Engage/Explore/Explain/Elaborate/Evaluate), a gradual-release plan (I-do/We-do/You-do),
or loose paragraphs. Find the teaching ACTIONS wherever they live.

## GRANULARITY — moves, NOT micro-steps
Emit **~10–15 MOVES**. A move = one coachable thing the teacher does: activate prior knowledge · announce
the topic · explain/illustrate the concept · model an example · guided practice · independent/pair activity ·
peer review · formative check · exit/plenary · assign homework. Merge a cluster of scripted sub-steps
("greet, show the picture, ask 3 questions") into the ONE move they form (the introduction). A downstream
LLM will judge "did she do this move, in her own words?" — so each move must be recognisable substance.

## FOR EACH MOVE EMIT:
- \`phase\`: warm_up | hook | recall | announce | explain | guided | independent | peer_review | exit | homework
  (map the template's own phase to the nearest one — Engage→hook, Explore/Explain→explain, Elaborate→guided,
   Evaluate→exit; Introduction→warm_up/announce; Development→explain/guided; Conclusion/Plenary→exit).
- \`type\`: instruction | question | activity | check | modelling
- \`text\`: the move in plain teacher-facing language a coach reads and ticks off. Keep the teacher's own
  intent; do not invent detail she didn't write.
- \`bucket\`:
  - **must_happen** — the core explanation/modelling, the main student activity, and the whole-class
    formative check / exit. The spine of the lesson.
  - **adaptive_set** — an ability-group variant (a "for struggling learners / for advanced" branch, a
    per-group task). She runs the groups her class has, not all of them.
  - **optional_extension** — homework, enrichment/extension, "if time permits", optional props/materials.
- \`selection\`: \`none\` (default) · \`choose_one\` (the LP offers ALTERNATIVES and she does any ONE — e.g.
  "choose one of these three exit questions") · \`per_group\` (one task/exit per ability group).
- \`track_time_on_task\`: **true** on the independent / main practice activity (and any timed task). The
  score will adjudicate BOTH that she assigned the work AND how long students worked, from the transcript
  timestamps against \`prescribed_minutes\`.
- \`prescribed_minutes\`: the minutes the LP allots this move if stated (e.g. the "5 min" time column); else null.
- \`adjudicable\`: true if we could tell from the lesson AUDIO (+ a classroom photo) whether she did it.
  Spoken teaching — narrated board-work, questions, checks, exit questions said aloud — is \`true\`. Set
  \`false\` ONLY for a truly silent, un-narrated physical action (e.g. pinning a chart before class).
- \`observable_in_photo\`: true for board/wall/seating/written-display a classroom photo could show.

## EXCLUDE (never a move — these are plan META, not teaching actions):
Learning objectives / SLOs, "Prior knowledge" statements, the Rationale column, the "Formative assessment"
and "Learning materials/resources" column HEADERS themselves (but DO turn an actual check described there
into an \`exit\`/\`check\` move), student names, timings totals, appendices/answer-keys.

## OUTPUT — one JSON object, nothing else (no prose, no code fence):
{ "lesson_id": "<id>", "template": "UPLOADED", "goal": "<the lesson's main objective in one line>",
  "total_minutes": <int|null>,
  "moves": [ { "move_id": "m1", "phase": "...", "type": "...", "text": "...",
               "source_field": "uploaded", "bucket": "...", "selection": "none|choose_one|per_group",
               "track_time_on_task": false, "prescribed_minutes": null,
               "adjudicable": true, "observable_in_photo": false } ] }
Number m1, m2, … in teaching order. Output ONLY the JSON.`;

function buildUploadPrompt(lpText, lessonId) {
  return `LESSON_ID: ${lessonId || 'uploaded'}\n\nUPLOADED LESSON PLAN TEXT (return JSON):\n${lpText || ''}`;
}

module.exports = { UPLOAD_EXTRACTION_BRIEF, buildUploadPrompt };
