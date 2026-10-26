/**
 * v10 coaching test (bd-v0toag.100.8): a thing to try belongs to one subject and grade.
 *
 * Quratulain's week-1 review found a G2 English ask checked on a G5 lesson. An ask now carries to the plans
 * and recordings of its own subject and grade only, and stays until a recording shows she did it; then a
 * done marker (thing_to_try with text null) closes it. Pure.
 */

const { parseCorpusLessonId } = require('./subject-resolution');

/** '<grade>:<subject>' for a corpus lesson id, else null. */
function scopeOf(lessonId) {
  const parsed = parseCorpusLessonId(lessonId);
  return parsed ? `${parsed.grade}:${parsed.subject}` : null;
}

/**
 * The live ask for a scope in a teacher's sessions (newest first): { sessionId, thing, lpFidelity } of the
 * newest session whose thing_to_try has that scope, or null when there is none or it is a done marker.
 */
function activeThing(rows, scope) {
  if (!scope || !Array.isArray(rows)) return null;
  for (const r of rows) {
    const t = r && r.prioritized_action && r.prioritized_action.thing_to_try;
    if (!t || typeof t !== 'object' || scopeOf(t.lesson_id) !== scope) continue;
    if (typeof t.text !== 'string' || !t.text.trim()) return null;
    return { sessionId: r.id, thing: t, lpFidelity: r.lp_fidelity };
  }
  return null;
}

module.exports = { scopeOf, activeThing };
