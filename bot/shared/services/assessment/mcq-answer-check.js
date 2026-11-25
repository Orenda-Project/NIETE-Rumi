/**
 * An option question's answer must be one of its options (bd-rzjnjp.1.1).
 *
 * Round 3 of the model eval found papers whose key named two options, no
 * option, or an option followed by an explanation, and unseen MSQs nobody
 * asked for. A key that prints a wrong answer is worse than a missing
 * question, so an item whose answer cannot be placed on one option is dropped.
 *
 *   * Unseen MSQs, when she asked for none, are dropped whole. Seen MSQs come
 *     from the book and stay.
 *   * A kept MSQ answer must split into options, each one found; it is then
 *     written as those exact options, comma-separated.
 *   * Any other item with options: the answer is set to the one option it
 *     names. An option followed by an explanation is cut back to the option.
 *     Anything else is dropped.
 *
 * Items with no answer (key off), object answers, composite items and
 * fill-ins with more than one blank are left alone.
 */
// Moved from assessment-generation.service.js so the check carries its own resolver.
// An option's label and the text after it: "b) 4", "(b) 4", "B. 4", "ج) اسلام آباد".
const OPTION_LABEL = /^\s*\(?\s*([A-Za-z]|[؀-ۿ]{1,3})\s*[).:\-]\s*(.*)$/s;

function _norm(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function _splitOption(option) {
  const m = String(option ?? '').match(OPTION_LABEL);
  return m ? { label: _norm(m[1]), text: _norm(m[2]) } : { label: null, text: _norm(option) };
}

/**
 * The option an MCQ answer names, or null when it names none unambiguously.
 * Tried in order: the option itself, its label alone ("b", "(b)", "ج"), and the
 * text after the label ("4" for "b) 4"). Only a single match counts — a guess
 * would print a wrong answer on a teacher's key, which is worse than a gap.
 */
function _resolveOption(options, answer) {
  const want = _norm(answer);
  if (!want) return null;
  const exact = options.filter((o) => _norm(o) === want);
  if (exact.length === 1) return exact[0];
  const bareLabel = want.replace(/^\(\s*/, '').replace(/\s*[).:\-]?\s*\)?$/, '');
  const byLabel = options.filter((o) => _splitOption(o).label === bareLabel);
  if (byLabel.length === 1) return byLabel[0];
  const asOption = _splitOption(answer);
  const byText = options.filter((o) => {
    const t = _splitOption(o).text;
    return t && (t === want || (asOption.label && t === asOption.text));
  });
  return byText.length === 1 ? byText[0] : null;
}

const MSQ = /^msqs?\b|multiple select|select all/i;
const PARTS = /\s*(?:[,;،؛&]|\band\b|\bاور\b)\s*/i;

const norm = (t) => String(t ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const hasText = (v) => typeof v === 'string' && v.trim() !== '';

// "b) 4 — because …" → "b) 4": exactly one option is a prefix, ended at a word boundary.
function _prefixOption(options, answer) {
  const want = norm(answer);
  const hits = options.filter((o) => {
    const t = norm(o);
    return t && want.length > t.length && want.startsWith(t) && /^[\s,.;:\-–—(]/.test(want.slice(t.length));
  });
  if (hits.length !== 1) return null;
  // "b) 4, c) 6" names a second option: that is two answers, not an explanation.
  const rest = want.slice(norm(hits[0]).length);
  return options.some((o) => o !== hits[0] && norm(o) && rest.includes(norm(o))) ? null : hits[0];
}

function _msqAnswer(options, answer, resolve) {
  const whole = resolve(options, answer);
  if (whole != null) return whole;
  const parts = String(answer).split(PARTS).filter((p) => p.trim());
  if (parts.length < 2) return null;
  const hits = parts.map((p) => resolve(options, p));
  if (hits.some((h) => h == null) || new Set(hits).size !== hits.length) return null;
  return hits.join(', ');
}

function _checkable(q) {
  return q && typeof q === 'object' && Array.isArray(q.options) && q.options.length
    && hasText(q.answer) && !(Array.isArray(q.questions) && q.questions.length)
    && (String(q.question ?? '').match(/_{2,}/g) || []).length < 2;
}

function checkMcqAnswers(examJson, { askedTypes = [], resolve } = {}) {
  resolve = resolve || _resolveOption;
  const out = { droppedUnrequestedMsq: 0, droppedMismatch: 0, stripped: 0, msqFixed: 0 };
  const msqAsked = askedTypes.some((t) => MSQ.test(String(t?.id ?? '')));

  const fixList = (list, isMsq) => list.filter((q) => {
    if (!_checkable(q)) return true;
    if (isMsq) {
      const fixed = _msqAnswer(q.options, q.answer, resolve);
      if (fixed == null) { out.droppedMismatch += 1; return false; }
      if (fixed !== q.answer) out.msqFixed += 1;
      q.answer = fixed;
      return true;
    }
    const hit = resolve(q.options, q.answer);
    if (hit != null) { q.answer = hit; return true; }
    const cut = _prefixOption(q.options, q.answer);
    if (cut != null) { q.answer = cut; out.stripped += 1; return true; }
    out.droppedMismatch += 1;
    return false;
  });

  for (const section of ['seen', 'unseen']) {
    const branch = examJson?.[section];
    if (!branch || typeof branch !== 'object') continue;
    for (const category of Object.values(branch)) {
      if (!category || typeof category !== 'object') continue;
      for (const [key, entry] of Object.entries(category)) {
        const isMsq = MSQ.test(key);
        if (isMsq && section === 'unseen' && !msqAsked) {
          const lists = Array.isArray(entry) ? [entry] : Object.values(entry || {}).filter(Array.isArray);
          out.droppedUnrequestedMsq += lists.reduce((s, l) => s + l.length, 0);
          delete category[key];
        } else if (Array.isArray(entry)) {
          category[key] = fixList(entry, isMsq);
        } else if (entry && typeof entry === 'object') {
          for (const [sub, list] of Object.entries(entry)) {
            if (Array.isArray(list)) entry[sub] = fixList(list, isMsq || MSQ.test(sub));
          }
        }
      }
    }
  }
  return out;
}

module.exports = { checkMcqAnswers, MSQ, OPTION_LABEL, _norm, _splitOption, _resolveOption };
