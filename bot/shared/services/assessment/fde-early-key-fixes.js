'use strict';
/**
 * v27 Grade 1-2 keys that marked what the paper never asked (bd-5jmnfj.4.58.3):
 *   - G1 English Q5 «tr_e» keyed the whole word «tree» behind "fill in the missing letter"; Q11 «m _ _ n»
 *     the same. The key becomes the missing letters; the word goes to `accept`; the point says so.
 *   - G1 Maths Q5/Q6 and G2 Maths Q7/Q9/Q11 paid the answer mark for "the sum with the unit" or "with the
 *     word books" behind a bare "Solve.". The clause leaves the point and the common error; the worded
 *     answer is accepted, not required.
 *   - G1 English Q6 keyed one rhyme where any real rhyme is right: the point says so.
 *   - G1 English Q12 keyed «This is a egg.»: a/an follows the object's first letter.
 *
 * Runs after layout in fde-early-writer, so the writer's wording never reaches the teacher.
 * Pure: {examJson, notes}; notes are strings for the log; a slot outside these types is untouched.
 */

const LETTERS = new Set(['Missing Letters', 'Complete the Words']);
const RHYMES = 'Rhyming Pairs';
const THIS_IS = 'This Is A';
const WORD_PROBLEM = /\bWord Problems?$/;
const EARLY = /^g[12]\./;

const UNIT_POINT = /\s+with the unit\b[^.,;]*/i;
const WORD_POINT = /\s+with the word\s+["«]?([^\s"».,;]+)["»]?/i;
const UNIT_ERROR = /,?\s*(?:or\s+)?(?:leaving out|forgetting|omitting|missing) the (?:unit|word)\b[^.]*/i;
const NUMBER = /\b\d[\d,]*\b/;

function withPoints(q, points, extra = {}) {
  return { ...q, scheme: { ...(q.scheme || {}), points, ...extra } };
}

function accepting(scheme, word) {
  const accept = Array.isArray(scheme && scheme.accept) ? scheme.accept : [];
  return accept.includes(word) ? accept : accept.concat(word);
}

// «m _ _ n» against «moon» → «oo»; null when the blanks and the word do not line up.
function missingLetters(question, word) {
  const shape = String(question || '').replace(/\s+/g, '');
  const w = String(word || '').trim();
  if (!shape.includes('_') || !w || [...shape].length !== [...w].length) return null;
  const letters = [];
  for (const [i, ch] of [...shape].entries()) {
    const have = [...w][i];
    if (ch === '_') letters.push(have);
    else if (ch.toLowerCase() !== have.toLowerCase()) return null;
  }
  return letters.join('');
}

function fixLetters(q, notes) {
  const letters = missingLetters(q.question, q.answer);
  if (!letters || letters === String(q.answer).trim()) return q;
  const word = String(q.answer).trim();
  const points = Array.isArray(q.scheme && q.scheme.points) && q.scheme.points.length
    ? [{ ...q.scheme.points[0], text: `The missing letter${[...letters].length > 1 ? 's' : ''} ${letters} (the word is ${word})` }, ...q.scheme.points.slice(1)]
    : (q.scheme && q.scheme.points) || [];
  notes.push(`${q.slot}: «${q.question}» keyed the word ${word}; the key is now the missing letter${[...letters].length > 1 ? 's' : ''} ${letters}, the word accepted`);
  return withPoints({ ...q, answer: letters }, points, { accept: accepting(q.scheme, word) });
}

function fixUnit(q, notes) {
  const scheme = q.scheme || {};
  const points = Array.isArray(scheme.points) ? scheme.points : [];
  let accept = Array.isArray(scheme.accept) ? scheme.accept : [];
  let changed = false;
  const fixed = points.map((p) => {
    if (!p || typeof p.text !== 'string') return p;
    let text = p.text;
    const wordMatch = WORD_POINT.exec(text);
    if (wordMatch) {
      const n = NUMBER.exec(text) || NUMBER.exec(String(q.answer || '').replace(/^.*=\s*/, ''));
      if (n) accept = accept.includes(`${n[0]} ${wordMatch[1]}`) ? accept : accept.concat(`${n[0]} ${wordMatch[1]}`);
      text = text.replace(WORD_POINT, '');
    }
    text = text.replace(UNIT_POINT, '').replace(/\s+$/, '');
    if (text === p.text) return p;
    changed = true;
    return { ...p, text };
  });
  const error = typeof scheme.common_error === 'string' && UNIT_ERROR.test(scheme.common_error)
    ? scheme.common_error.replace(UNIT_ERROR, '') : scheme.common_error;
  if (!changed && error === scheme.common_error) return q;
  notes.push(`${q.slot}: the key no longer pays for the unit word behind "Solve."${accept.length > (scheme.accept || []).length ? ` (accepts «${accept[accept.length - 1]}»)` : ''}`);
  const extra = { ...(accept.length ? { accept } : {}), ...(error !== scheme.common_error ? { common_error: error } : {}) };
  return withPoints(q, fixed, extra);
}

function fixRhyme(q, notes) {
  const answer = String(q.answer || '').trim();
  const given = String(q.question || '').trim();
  const points = Array.isArray(q.scheme && q.scheme.points) ? q.scheme.points : [];
  if (!answer || !given || !points.length) return q;
  let changed = false;
  const fixed = points.map((p) => {
    if (!p || typeof p.text !== 'string' || p.text.trim().toLowerCase() !== answer.toLowerCase()) return p;
    changed = true;
    return { ...p, text: `${answer} (or any other real word that rhymes with ${given})` };
  });
  if (!changed) return q;
  notes.push(`${q.slot}: «${given}» accepts any real rhyme, not only ${answer}`);
  return withPoints(q, fixed);
}

const VOWEL = /^[aeiou]/i;

function fixArticle(q, notes) {
  const m = /^(\s*This is )(an?)( )(\S+)/i.exec(String(q.answer || ''));
  if (!m) return q;
  const noun = m[4].replace(/[.!?]+$/, '');
  const article = VOWEL.test(noun) ? 'an' : 'a';
  if (m[2].toLowerCase() === article) return q;
  const answer = String(q.answer).replace(/^(\s*This is )(an?)( )/i, `$1${article}$3`);
  notes.push(`${q.slot}: «${q.answer}» → «${answer}»`);
  return { ...q, answer };
}

function fixerFor(type) {
  if (LETTERS.has(type)) return fixLetters;
  if (type === RHYMES) return fixRhyme;
  if (type === THIS_IS) return fixArticle;
  if (WORD_PROBLEM.test(String(type || ''))) return fixUnit;
  return null;
}

/** The early key fixes above applied to every item of a matching slot. */
function earlyKeyFixes(examJson) {
  const notes = [];
  if (!examJson || typeof examJson !== 'object') return { examJson, notes };
  const types = new Map();
  ((examJson._layout && examJson._layout.sections) || []).forEach((s) => (s.slots || []).forEach((sl) => types.set(sl.slot, sl.type)));
  const fix = (q) => {
    if (!q || typeof q !== 'object' || !EARLY.test(String(q.slot || ''))) return q;
    const fixer = fixerFor(types.get(q.slot));
    return fixer ? fixer(q, notes) : q;
  };
  const out = { ...examJson };
  for (const branch of ['seen', 'unseen']) {
    const cats = examJson[branch];
    if (!cats || typeof cats !== 'object') continue;
    out[branch] = Object.fromEntries(Object.entries(cats).map(([cat, byType]) => [cat, !byType || typeof byType !== 'object' ? byType
      : Object.fromEntries(Object.entries(byType).map(([type, list]) => [type, Array.isArray(list) ? list.map(fix) : list]))]));
  }
  return { examJson: out, notes };
}

module.exports = { earlyKeyFixes, missingLetters };
