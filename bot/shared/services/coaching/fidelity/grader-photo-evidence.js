'use strict';
/**
 * Photo evidence for the fidelity grader (bd-b3pop.15, decision D34 — operator, 15 Sep 2026: "use the existing one on
 * prod and make it describe it better (so produce stuff for fidelity as well)" and "teachers add other photos too, make
 * sure they are credited").
 *
 * The EXISTING vision pass (classroom-photo/photo-analysis.service.js, gpt-4.1-mini) reads each lesson photo once; its
 * fidelity fields (kind, visible_text, drawings, students, learning_materials, student_work) arrive here. The rules go on
 * the grader brief and the reading goes after the transcript. Any kind of photo can credit a move whose action leaves a
 * visible trace; a photo only ever ADDS credit (Eval 9 found a photo-driven downgrade), and a photo the vision pass calls
 * not_a_classroom_photo (Eval 9: a screenshot of an earlier coaching report) never reaches the grader.
 *
 * The rules text is the Eval 10 artefact eval/out/eval10_photo_evidence/prompts/photo_evidence_section.txt;
 * tests/coaching/fidelity/grader-photo-evidence.test.js byte-checks the two when FIDELITY_PHOTO_SECTION_MIRROR is set.
 * The Eval 10 harness mirrors normalisePhotoEvidence and buildPhotoEvidenceBlock in eval10_photo_evidence/scripts/photo_evidence.py.
 */
const PHOTO_EVIDENCE_SECTION = `

## CLASSROOM PHOTO EVIDENCE
The teacher or the observing coach took photos during this lesson. A vision pass has already read each photo, and what it saw is appended to the user message under CLASSROOM PHOTO EVIDENCE: one block per photo, numbered as the photos were submitted ([photo N]), with the kind of photo, the writing and drawings legible in it, what the students are visibly doing, the learning materials in view, and any student work.

Photo evidence can CREDIT a move whose action leaves a visible trace, from ANY kind of photo, not only the board:
- writing on a board, chart or card (new words, a worked example, questions, an objective, homework) → the move that prescribes writing or presenting that content;
- students' notebooks, worksheets or slates showing the prescribed task being done → the practice or written-work move;
- students seated in pairs or groups working on the prescribed material → the pair- or group-work move;
- the prescribed material in use (the textbook page, flashcards, manipulatives, a chart) → the move that uses it;
- something made during the lesson (a chart the class filled in, a labelled drawing) → the move that produces it.

Rules for photo evidence:
1. A photo only ADDS credit. Never lower a verdict because of a photo, and never treat something missing from a photo as evidence that it did not happen: a photo is one moment of the lesson.
2. Credit only what the photo shows. Matching writing shows the content was presented. A seating arrangement alone shows the setup, not that the activity was run: that is \`partial\` unless the transcript or visible student work shows the task being done.
3. The content must belong to THIS lesson's plan: the same words, numbers, examples or task. The vision pass can misread handwriting, so most of the prescribed items appearing is a match. Content from a different lesson is not evidence.
4. When a photo is part of your evidence, begin \`evidence\` with \`[photo N]\` and say what the photo shows; add the transcript quote after it when there is one.
5. The transcript stays the primary evidence. A photo does not overrule a transcript that shows the move done differently or deliberately skipped.`;

const KINDS = new Set(['board', 'student_work', 'group_or_pair_work', 'learning_materials', 'wall_display', 'whole_class', 'not_a_classroom_photo']);
const CAPS = { visible_text: 1200, drawings: 400, students: 400, student_work: 400 };
const MATERIALS_MAX = 8;
const MATERIAL_CAP = 80;

/** Trim each line, drop blank lines and any line that repeats the one before it (the vision model's repetition loop). */
function cleanText(value) {
  const lines = String(value == null ? '' : value).replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const out = [];
  for (const l of lines) if (l && out[out.length - 1] !== l) out.push(l);
  return out.join('\n');
}

function capText(s, n) {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

/**
 * The per-photo readings the grader may see: every field present, text cleaned and capped, not-a-classroom photos and
 * readings with nothing in them dropped. Idempotent.
 * @param {Array<object>} items [{ n, kind, visible_text, drawings, students, learning_materials, student_work }]
 * @returns {Array<object>}
 */
function normalisePhotoEvidence(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    const kind = KINDS.has(it.kind) ? it.kind : null;
    if (kind === 'not_a_classroom_photo') continue;
    const e = {
      n: Number.isInteger(it.n) ? it.n : null,
      kind,
      visible_text: capText(cleanText(it.visible_text), CAPS.visible_text),
      drawings: capText(cleanText(it.drawings), CAPS.drawings),
      students: capText(cleanText(it.students), CAPS.students),
      learning_materials: (Array.isArray(it.learning_materials) ? it.learning_materials : [])
        .map((m) => capText(cleanText(m).replace(/\n/g, ' '), MATERIAL_CAP))
        .filter(Boolean)
        .slice(0, MATERIALS_MAX),
      student_work: capText(cleanText(it.student_work), CAPS.student_work),
    };
    if (!e.visible_text && !e.drawings && !e.students && !e.learning_materials.length && !e.student_work) continue;
    out.push(e);
  }
  return out;
}

function oneLine(s) {
  return s.split('\n').join(' / ');
}

/**
 * The block appended after the transcript: one paragraph per photo, numbered by the photo's ORIGINAL position (the same
 * N the report captions use), empty fields left out. '' when there is nothing to show.
 * @param {Array<object>} items
 * @returns {string}
 */
function buildPhotoEvidenceBlock(items) {
  const list = normalisePhotoEvidence(items);
  if (!list.length) return '';
  const blocks = list.map((e) => {
    const lines = [`[photo ${e.n != null ? e.n : '?'}] kind: ${e.kind || 'unknown'}`];
    if (e.visible_text) lines.push(`writing: ${oneLine(e.visible_text)}`);
    if (e.drawings) lines.push(`drawings: ${oneLine(e.drawings)}`);
    if (e.students) lines.push(`students: ${oneLine(e.students)}`);
    if (e.learning_materials.length) lines.push(`learning materials: ${e.learning_materials.join('; ')}`);
    if (e.student_work) lines.push(`student work: ${oneLine(e.student_work)}`);
    return lines.join('\n');
  });
  return `\n\nCLASSROOM PHOTO EVIDENCE (read from the lesson photos by the vision pass; ${list.length} photo${list.length === 1 ? '' : 's'}):\n${blocks.join('\n\n')}`;
}

/** How many scored rows cite a photo as their evidence ("[photo N] …"). */
function countPhotoCited(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && /^\s*\[photo\s*\d+\]/i.test(String(r.evidence || ''))).length;
}

module.exports = { PHOTO_EVIDENCE_SECTION, KINDS, normalisePhotoEvidence, buildPhotoEvidenceBlock, countPhotoCited };
