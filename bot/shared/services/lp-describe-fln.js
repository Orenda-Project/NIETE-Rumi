'use strict';
/**
 * Describe a Reading Hour / Numeracy (FLN) plan, for lp-describe.service.
 *
 * An FLN open is `fln:<id>` (the plan's id in the FLN source corpus). Its name comes from the sidecar
 * index (fln-index.service), never from the corpus. The answer has the same fields as a k5/g612
 * description, so every list that names opens keeps working, plus the FLN extras (level, minutes).
 * Names are in English like the k5 book names; the portal's FLN pages carry their own en/ur strings.
 *
 * `grade` is null ON PURPOSE: an FLN plan is level-banded (Level 1 = grade 1 … Level 3 = grades 4–5)
 * and is opened by teachers of every grade, so a grade 8 teacher reading a Level 1 plan must not
 * read as "teaches grade 1" to the grade-subjects history or "classes covered".
 *
 * Never throws. No index (not configured, not loaded): the plan is still found — it was opened, and
 * it can be opened again — under a generic title. In the index but not there (hidden since): found:false.
 */

const SUBJECTS = Object.freeze({
  'rh-en': 'Reading Hour · English',
  'rh-ur': 'Reading Hour · Urdu',
  num: 'Numeracy',
});
/** The FLN source corpus's subject ids, in case an index carries the id rather than the key. */
const SUBJECT_IDS = Object.freeze({ 12: 'rh-en', 10: 'rh-ur', 13: 'num' });

const LEVELS = Object.freeze({
  1: 'Level 1 · Grade 1',
  2: 'Level 2 · Grades 2–3',
  3: 'Level 3 · Grades 4–5',
});

const FALLBACK_TITLE = 'Reading Hour lesson';
const ID = /^\d{1,9}$/;

function subjectKeyOf(s) {
  if (typeof s === 'string' && SUBJECTS[s]) return s;
  return SUBJECT_IDS[Number(s)] || null;
}

const positive = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null);

/**
 * @param {{kind:'fln', ref:string, lang:string|null}} plan  parsed (lp-describe.parsePlans)
 * @param {object|null} idx  the loaded index, or null
 */
function describeFln(plan, idx) {
  const open = { lane: 'fln', planId: plan.ref };
  const base = {
    ...plan,
    grade: null,
    chapterNumber: null,
    dayLabel: null,
    pagesLabel: null,
    open,
  };
  if (!ID.test(plan.ref)) return { ...base, found: false, title: null, subject: null };
  if (!idx) {
    return { ...base, found: true, title: FALLBACK_TITLE, subject: null, chapterTitle: null };
  }
  const e = idx.plans && idx.plans[plan.ref];
  if (!e || typeof e !== 'object') return { ...base, found: false, title: null, subject: null };

  const key = subjectKeyOf(e.subject);
  const level = LEVELS[e.level] ? Number(e.level) : null;
  const pos = positive(e.pos);
  const count = positive(e.count);
  return {
    ...base,
    found: true,
    title: typeof e.title === 'string' && e.title.trim() ? e.title.trim() : FALLBACK_TITLE,
    subject: key ? SUBJECTS[key] : null,
    subjectKey: key,
    chapterTitle: level ? LEVELS[level] : null,
    gradeLabel: level ? LEVELS[level] : null,
    level,
    dayLabel: pos && count ? `Lesson ${pos}/${count}` : null,
    planLang: ['en', 'ur'].includes(e.lang) ? e.lang : null, // the plan's own language, not the UI's
    minutes: positive(e.minutes),
  };
}

/** The index for a batch, fetched only when the batch has an FLN plan. Never throws. */
async function indexFor(plans, deps = {}) {
  if (!plans.some((p) => p.kind === 'fln')) return null;
  try {
    return await (deps.flnIndex || require('./fln-index.service').index)();
  } catch (_) {
    return null;
  }
}

module.exports = { describeFln, indexFor, SUBJECTS, LEVELS, FALLBACK_TITLE };
