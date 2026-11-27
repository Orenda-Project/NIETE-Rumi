/**
 * A fixed, checked set of whole-book papers per subject for a board pattern. A full-book request is
 * served a set paper she has not had; once she has had them all, null, so she gets a fresh paper. Set
 * papers are the rows stamped `exam_json._reuse.set = '<pattern set>/<subject>'`; a copy served to a
 * teacher points back at its set paper through `_reuse.from`. Every read fails open (null), so the
 * caller falls back to today's path.
 */
const { clean } = require('./paper-reuse');

/** Patterns with a fixed set, and the set's version. A new version means a new set of rows. */
const SETS = { fde_g5_2027: 'fde_g5_2027-v1' };

/** The set for this request, or null: only a full-book (FDE syllabus) request has one. */
function setFor({ pattern, scope, subject }) {
  if (scope?.kind !== 'fde' || !subject || !SETS[pattern]) return null;
  return `${SETS[pattern]}/${subject}`;
}

/** A set paper for her, as {id, examJson, questionCount, model, pageReference}; null otherwise. */
async function findSetPaper({ db, set, subject, userId }) {
  if (!set) return null;
  try {
    const [setRes, ownRes] = await Promise.all([
      db.from('assessment_papers')
        .select('id, exam_json, question_count, model')
        .eq('exam_json->_reuse->>set', set)
        .eq('status', 'ready')
        .is('edited_from', null)
        .is('edited_at', null)
        .order('created_at', { ascending: true }),
      db.from('assessment_papers')
        .select('id, created_at, _reuse:exam_json->_reuse, assessment_requests!inner(user_id, subject_code)')
        .eq('assessment_requests.user_id', userId)
        .eq('assessment_requests.subject_code', subject),
    ]);
    if (setRes.error || ownRes.error) return null;
    const papers = (setRes.data || []).filter((r) => r.exam_json);
    if (!papers.length) return null;

    // When she last had each set paper: the set row itself, or a copy of it.
    const lastHad = new Map();
    for (const r of ownRes.data || []) {
      for (const id of [r.id, r._reuse?.from]) {
        if (id && !(lastHad.get(id) >= r.created_at)) lastHad.set(id, r.created_at);
      }
    }
    const pick = papers.find((p) => !lastHad.has(p.id));
    if (!pick) return null;
    return {
      id: pick.id,
      examJson: clean(pick.exam_json),
      questionCount: pick.question_count,
      model: pick.model,
      pageReference: pick.exam_json._reuse?.page_reference ?? null,
    };
  } catch {
    return null;
  }
}

module.exports = { setFor, findSetPaper, SETS };
