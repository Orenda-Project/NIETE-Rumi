/**
 * A teacher who asks again for pages she already has a paper on gets a different paper.
 *
 * The writer sees only the page text, so the same pages give the same paper: on 4-6 Nov 2026
 * one teacher got the same G3 General Knowledge chapter three times in five minutes. Before a
 * paper is written, this reads her recent papers on overlapping pages of the same book and hands
 * their questions to the writer to stay away from. Different teachers on the same pages are not
 * guarded (Amena, 6 Nov), and grades 1-2 are left as written.
 *
 * Every read fails open: a guard that cannot read returns nothing and the paper is written as before.
 */
const { appliesToGrade } = require('./bloom-ceiling');

const LOOKBACK_DAYS = 30;
const MAX_PAPERS = 3;
const MAX_LISTED = 40;
const MAX_CHARS = 160;

/** "1-84, 127-137" -> Set of page numbers; an unreadable part makes the whole thing empty. */
function _pages(ranges) {
  const out = new Set();
  for (const part of String(ranges ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return new Set();
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : lo;
    for (let p = lo; p <= hi; p += 1) out.add(p);
  }
  return out;
}

function pagesOverlap(a, b) {
  const pa = _pages(a);
  for (const p of _pages(b)) if (pa.has(p)) return true;
  return false;
}

/** Every question's text in a paper's seen and unseen sections, trimmed, each once, in order. */
function questionTexts(examJson) {
  const seen = new Set();
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    if (typeof x.question === 'string' && x.question.trim()) seen.add(x.question.trim());
    for (const [k, v] of Object.entries(x)) if (!k.startsWith('_') && k !== 'question') walk(v);
  };
  for (const section of ['seen', 'unseen']) walk(examJson?.[section]);
  return [...seen];
}

/** Appended to the writer's user prompt; empty when there is nothing to avoid. */
function avoidNote(texts) {
  const list = (texts || []).slice(0, MAX_LISTED).map((t) => `- ${String(t).slice(0, MAX_CHARS)}`);
  if (!list.length) return '';
  return [
    '',
    '',
    'This teacher already has a paper on these pages. Write a different paper: do not reuse any of the',
    'questions below, their numbers or their wording. Test the same content with new items.',
    ...list,
  ].join('\n');
}

/** Her questions from recent papers on overlapping pages of the same book; [] when none or on any error. */
async function previousQuestions({ db, requestId, grade: jobGrade, now = new Date() }) {
  // The job's own grade, when known, skips grades 1-2 before any read.
  if (jobGrade != null && !appliesToGrade(jobGrade)) return [];
  try {
    const { data: req } = await db.from('assessment_requests')
      .select('id, user_id, grade_code, textbook_id, page_ranges').eq('id', requestId).maybeSingle();
    const grade = String(req?.grade_code || '').match(/(\d+)/);
    if (!req || !req.page_ranges || !grade || !appliesToGrade(Number(grade[1]))) return [];

    const since = new Date(now.getTime() - LOOKBACK_DAYS * 864e5).toISOString();
    const { data: siblings } = await db.from('assessment_requests')
      .select('id, page_ranges').eq('user_id', req.user_id).eq('textbook_id', req.textbook_id)
      .neq('id', requestId).gte('created_at', since);
    const ids = (siblings || []).filter((s) => pagesOverlap(s.page_ranges, req.page_ranges)).map((s) => s.id);
    if (!ids.length) return [];

    const { data: papers } = await db.from('assessment_papers')
      .select('request_id, exam_json, created_at').in('request_id', ids).eq('status', 'ready')
      .order('created_at', { ascending: false }).limit(MAX_PAPERS);
    return [...new Set((papers || []).flatMap((p) => questionTexts(p.exam_json)))];
  } catch {
    return [];
  }
}

module.exports = { pagesOverlap, questionTexts, avoidNote, previousQuestions };
