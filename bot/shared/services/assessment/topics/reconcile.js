'use strict';
/**
 * reconcile(existing, incoming) -> {upsert: Topic[], retire: string[]}. Pure: no I/O.
 *
 * existing = stored topics (camelCase, with isCurrent), incoming = a fresh groupAll() of the matrix.
 * Scope is the (grade, subject) pairs present in `incoming`: importing English never retires Maths.
 *  - upsert: incoming topics that are new, changed in content, or stored as retired (made current again).
 *  - retire: ids of current stored topics in scope that the matrix no longer produces. Never deleted.
 * English/Urdu ids come from cell text, so a typo fix is retire-old + upsert-new (no rename detection).
 * sloDescriptions is a set, not paired with sloCodes; arrays compare as stored, in order.
 */
const SCALARS = ['grade', 'subject', 'chapterNumber', 'chapterTitle', 'name', 'heading', 'headingOrder', 'sortOrder'];
const ARRAYS = ['pages', 'sloCodes', 'sloDescriptions', 'days'];

const scopeKey = (t) => `${t.grade}/${t.subject}`;
const orNull = (v) => (v === undefined ? null : v);
const list = (v) => v || [];

function sameArray(a, b) {
  const x = list(a);
  const y = list(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function sameContent(a, b) {
  return SCALARS.every((k) => orNull(a[k]) === orNull(b[k])) && ARRAYS.every((k) => sameArray(a[k], b[k]));
}

function reconcile(existing, incoming) {
  const scope = new Set(incoming.map(scopeKey));
  const incomingIds = new Set();
  for (const t of incoming) {
    if (incomingIds.has(t.topicId)) throw new Error(`duplicate topic id "${t.topicId}"`);
    incomingIds.add(t.topicId);
  }
  const stored = new Map(existing.map((e) => [e.topicId, e]));
  const upsert = incoming.filter((t) => {
    const e = stored.get(t.topicId);
    return !e || e.isCurrent === false || !sameContent(e, t);
  });
  const retire = existing
    .filter((e) => e.isCurrent !== false && scope.has(scopeKey(e)) && !incomingIds.has(e.topicId))
    .map((e) => e.topicId);
  return { upsert, retire };
}

/** Topic -> assessment_topics row (V1.6.18 columns). */
function toRow(t, matrixVersion, updatedAt) {
  return {
    topic_id: t.topicId, grade: t.grade, subject: t.subject, chapter_number: t.chapterNumber,
    chapter_title: t.chapterTitle, name: t.name, heading: orNull(t.heading), heading_order: orNull(t.headingOrder),
    sort_order: t.sortOrder, pages: t.pages, slo_codes: t.sloCodes, slo_descriptions: t.sloDescriptions, days: t.days,
    is_current: true, matrix_version: matrixVersion, updated_at: updatedAt,
  };
}

/** assessment_topics row -> stored Topic (with isCurrent). */
function fromRow(r) {
  return {
    topicId: r.topic_id, grade: r.grade, subject: r.subject, chapterNumber: r.chapter_number,
    chapterTitle: r.chapter_title, name: r.name, heading: r.heading, headingOrder: r.heading_order,
    sortOrder: r.sort_order, pages: r.pages, sloCodes: r.slo_codes, sloDescriptions: r.slo_descriptions,
    days: r.days, isCurrent: r.is_current,
  };
}

module.exports = { reconcile, sameContent, toRow, fromRow };
