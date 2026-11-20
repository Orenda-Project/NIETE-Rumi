'use strict';
/**
 * bd-e5n2jf — per-type counts for Seen (book) questions, the way Unseen has them.
 *
 * A job carries `seenTypes: [{ id, count, category }]` only when the teacher set them (new Flow,
 * portal). Every job without it — old Flow, queued jobs — keeps the single Seen total, so
 * `clean` returns null there and callers take the old path.
 *
 * Amena's ruling (20 Nov): when the pages hold fewer of a type than asked, other exercise
 * content from those same pages is reshaped into that type, so the counts are exact.
 */

function clean(seenTypes) {
  if (!Array.isArray(seenTypes) || !seenTypes.length) return null;
  const out = [];
  for (const t of seenTypes) {
    const id = t && typeof t.id === 'string' ? t.id.trim() : '';
    const count = parseInt(t && t.count, 10);
    if (!id || !Number.isInteger(count) || count < 1) return null;
    const label = typeof t.label === 'string' && t.label.trim() ? t.label.trim() : null;
    out.push({ id, ...(label ? { label } : {}), count, category: t.category === 'objective' ? 'objective' : 'subjective' });
  }
  return out;
}

function total(seenTypes) {
  return (seenTypes || []).reduce((s, t) => s + t.count, 0);
}

const RESHAPE = 'Use the book\'s own exercise questions of each type first. Where these pages have fewer '
  + 'of a type than asked, turn other exercise content from these same pages into that type (a book '
  + 'statement becomes a True/False, a book question becomes an MCQ with options, a key sentence becomes '
  + 'a fill in the blank), so every count above is met exactly. Every Seen question stays on these pages\' content';

/** The Seen lines of the prompt: objective and subjective listed apart, like Unseen, then the rule. */
function promptItems(seenTypes) {
  const describe = (list) => list.map((t) => `${t.count} ${t.label || t.id}`).join(', ');
  const objective = seenTypes.filter((t) => t.category === 'objective');
  const subjective = seenTypes.filter((t) => t.category !== 'objective');
  const items = [];
  if (objective.length) items.push(`Seen Objective questions — ${describe(objective)}`);
  if (subjective.length) items.push(`Seen Subjective questions — ${describe(subjective)}`);
  items.push(`Seen questions come from the textbook's own exercises on these pages. ${RESHAPE}`);
  return items;
}

/** 'True / False', 'true-false', 'MCQs' → 'truefalse', 'truefalse', 'mcq': the model names types loosely. */
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '').replace(/s$/, '');

/**
 * Cap each Seen type at her count. Keys are matched loosely by id or label in whichever category
 * the model put them (grades 6-12 ask by id `mcq` and the model may write "Multiple Choice
 * Questions"). A key matching no asked type is never wiped outright: it only fills what the
 * matched types left short of her Seen total. Returns how many questions were removed.
 */
function trim(examJson, seenTypes) {
  const branch = examJson?.seen;
  if (!branch || typeof branch !== 'object') return 0;
  const left = new Map();
  const typeOf = new Map();
  seenTypes.forEach((t, i) => {
    left.set(i, t.count);
    [t.id, t.label].filter(Boolean).forEach((n) => typeOf.set(key(n), i));
  });
  let room = total(seenTypes);
  let removed = 0;
  const cap = (entry, limit, set) => {
    let n = limit;
    const take = (list) => { const keep = list.slice(0, Math.max(0, n)); n -= keep.length; removed += list.length - keep.length; return keep; };
    if (Array.isArray(entry)) set(take(entry));
    else if (entry && typeof entry === 'object') {
      for (const [sub, list] of Object.entries(entry)) if (Array.isArray(list)) entry[sub] = take(list);
    }
    return limit - n;
  };
  const categories = Object.values(branch).filter((c) => c && typeof c === 'object');
  const unmatched = [];
  for (const category of categories) {
    for (const [type, entry] of Object.entries(category)) {
      const i = typeOf.get(key(type));
      if (i === undefined) { unmatched.push([category, type]); continue; }
      const kept = cap(entry, left.get(i), (v) => { category[type] = v; });
      left.set(i, left.get(i) - kept);
      room -= kept;
    }
  }
  for (const [category, type] of unmatched) {
    room -= cap(category[type], Math.max(0, room), (v) => { category[type] = v; });
  }
  return removed;
}

module.exports = { clean, total, promptItems, trim };
