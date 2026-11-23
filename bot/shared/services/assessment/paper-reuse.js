/**
 * Re-serving a board-pattern paper (bd-2oi189).
 *
 * A board paper costs a Sonnet run (~$0.30-0.60, up to ~220 s) and about three in four requests ask
 * for inputs another teacher already had a paper written for. Every pattern paper is stamped with a
 * hash of its exact generator inputs (`exam_json._reuse.key`); with the `assessment_paper_reuse`
 * setting on, the next request on the same key is handed a finished paper's exam_json instead of
 * calling the writer. Rendering, school name and the answer key still run per teacher.
 *
 * A teacher who asks again gets a paper she has not had (Amena, 6 Nov): her own papers on the key,
 * and the donors they were copied from, are skipped. Only ready, unedited originals from the last
 * 30 days are donors, so an engine fix reaches teachers within a month. Every read fails open.
 */
const crypto = require('crypto');

const MAX_AGE_DAYS = 30;
const MAX_DONORS = 10;

function _canonical(v) {
  if (Array.isArray(v)) return v.map(_canonical);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = _canonical(v[k]); return o; }, {});
  }
  return v ?? null;
}

/** sha256 of the generator inputs that decide what gets written; a missing input counts as null. */
function reuseKey({ grade, subject, pattern, scope, pageRanges, chapterNumber, readerPass, splitRetry, stemCheck }) {
  const inputs = { grade, subject, pattern, scope, pageRanges, chapterNumber, readerPass, splitRetry, stemCheck };
  return crypto.createHash('sha256').update(JSON.stringify(_canonical(inputs))).digest('hex');
}

/** A copy of the paper carrying `_reuse`; `from` only on a re-served copy. */
function stamp(examJson, { key, from, pageReference }) {
  const reuse = { key, ...(from ? { from } : {}), page_reference: pageReference ?? null };
  return { ...examJson, _reuse: reuse };
}

/** The donor's exam_json without its own stamp or the page counts its own render wrote. */
function _clean(examJson) {
  const { _reuse, ...paper } = examJson; // eslint-disable-line no-unused-vars
  if (!paper._layout) return paper;
  const { pages, frame_pages, ...layout } = paper._layout; // eslint-disable-line no-unused-vars, camelcase
  return { ...paper, _layout: layout };
}

/** The newest original on this key she has not had, as {id, examJson, questionCount, model, pageReference}; null otherwise. */
async function findDonor({ db, key, userId, now = new Date() }) {
  if (!key) return null;
  try {
    const { data: own, error: ownErr } = await db.from('assessment_papers')
      .select('id, _reuse:exam_json->_reuse, assessment_requests!inner(user_id)')
      .eq('exam_json->_reuse->>key', key)
      .eq('assessment_requests.user_id', userId);
    if (ownErr) return null;
    const had = new Set();
    for (const r of own || []) { had.add(r.id); if (r._reuse?.from) had.add(r._reuse.from); }

    const since = new Date(now.getTime() - MAX_AGE_DAYS * 864e5).toISOString();
    const { data: rows, error } = await db.from('assessment_papers')
      .select('id, exam_json, question_count, model')
      .eq('exam_json->_reuse->>key', key)
      .is('exam_json->_reuse->>from', null)
      .eq('status', 'ready')
      .is('edited_from', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_DONORS);
    if (error) return null;
    const pick = (rows || []).find((r) => !had.has(r.id) && r.exam_json);
    if (!pick) return null;
    return {
      id: pick.id,
      examJson: _clean(pick.exam_json),
      questionCount: pick.question_count,
      model: pick.model,
      pageReference: pick.exam_json._reuse?.page_reference ?? null,
    };
  } catch {
    return null;
  }
}

module.exports = { reuseKey, stamp, findDonor, MAX_AGE_DAYS };
