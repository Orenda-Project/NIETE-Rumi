'use strict';
/**
 * v37 round 7 maths panel findings (bd-5jmnfj.4.58), applied to G1 Maths word problems and every G5 Maths item.
 *
 * - One no-working rule. A scheme that pays working (a method mark, "worked out", or a stem saying "Show your working")
 *   says in `accept` that a correct answer with no working still earns the answer mark(s) and the working mark is only
 *   for steps shown. Rule picked: the answer mark never depends on the working being shown.
 * - Method restrictions the paper never states. "Unitary method only", "by the vertical method", "regrouping", "the
 *   long division steps" in a key line become "any correct method" unless the stem itself names that method.
 * - Mixed number or improper fraction key where the stem asks for no form: the equal other form and the simplified forms
 *   join `accept`, and an A line that demands the written form is softened.
 *
 * Pure: one item in, the item (or a changed copy) out; notes are strings pushed on `notes`. Never throws.
 */

const NO_WORKING_M = 'A correct answer with no working still earns the answer mark(s); the working mark is only for steps shown.';
const NO_WORKING_A = 'A correct answer with no working still earns the mark.';
const NO_WORKING_SEEN = /no working still earns/i;

const eligible = (q) => !!q && typeof q === 'object' && /^(?:g1\.)?maths\./.test(String(q.slot || '')) && !!q.scheme && typeof q.scheme === 'object';
const points = (q) => (Array.isArray(q.scheme.points) ? q.scheme.points : []);
const accepts = (q) => (Array.isArray(q.scheme.accept) ? q.scheme.accept : []);
const stemOf = (q) => `${q.main_question || ''} ${q.question || ''}`;
const withScheme = (q, patch) => ({ ...q, scheme: { ...q.scheme, ...patch } });

function noWorking(q, notes) {
  const pts = points(q);
  const hasM = pts.some((p) => p && p.kind === 'M');
  const mentions = pts.some((p) => p && /working|worked out/i.test(String(p.text || ''))) || accepts(q).some((a) => /working|worked out/i.test(String(a)));
  if (accepts(q).some((a) => NO_WORKING_SEEN.test(String(a)))) return q;
  if (!hasM && !mentions && !/show your working/i.test(stemOf(q))) return q;
  notes.push(`${q.slot}: the key says a correct answer with no working still earns the answer mark(s)`);
  return withScheme(q, { accept: accepts(q).concat(hasM ? NO_WORKING_M : NO_WORKING_A) });
}

// A named method and the stem words that mean the stem names it.
const TERMS = [
  { re: 'long division', stem: /long division/i },
  { re: 'long multiplication', stem: /long multiplication/i },
  { re: 'vertical(?: method)?', stem: /vertical/i },
  { re: 'column method', stem: /column/i },
  { re: 'regrouping', stem: /regroup|borrow|carry/i },
  { re: 'unitary(?: method)?', stem: /unitary/i },
  { re: 'division method', stem: /division method/i },
  { re: 'prime factori[sz]ation(?: method)?', stem: /prime factor/i },
];
const ANY = 'any correct method';

function widen(text, stem) {
  let out = String(text);
  for (const t of TERMS) {
    if (t.stem.test(stem)) continue;
    out = out.replace(new RegExp(`\\b(?:the\\s+)?${t.re}\\s+steps\\b`, 'i'), `the steps of ${ANY}`);
    out = out.replace(new RegExp(`\\b(?:(by|using|with|through)\\s+)?(?:the\\s+)?${t.re}(?:\\s+only)?\\b`, 'i'), (m, prep) => (prep ? `${prep} ${ANY}` : ANY));
  }
  return out === text ? text : out.charAt(0).toUpperCase() + out.slice(1);
}

function methodNames(q, notes) {
  const stem = stemOf(q);
  let changed = false;
  const fixed = points(q).map((p) => {
    if (!p || typeof p.text !== 'string') return p;
    const text = widen(p.text, stem);
    if (text === p.text) return p;
    changed = true;
    return { ...p, text };
  });
  let accept = accepts(q);
  const restricted = accept.map((a) => (/\bonly\b/i.test(String(a)) && widen(a, stem) !== String(a) ? 'Any correct method' : a));
  if (restricted.some((a, i) => a !== accept[i])) {
    accept = restricted.filter((a, i) => restricted.indexOf(a) === i);
    changed = true;
  }
  if (!changed) return q;
  notes.push(`${q.slot}: a method the stem never names is no longer required by the key (any correct method)`);
  return withScheme(q, { points: fixed, accept });
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const FORM_ASKED = /mixed number|improper|simplest|lowest terms|simplif|proper fraction|whole number/i;
const SOFT = '(the equal improper fraction or mixed number is also accepted)';
const DEMAND = /^(?:writes|states|gives|expresses|records)\s+(?:the\s+)?(?:final\s+)?answer\s+(?:as|in)\s+(?:the\s+)?(?:a\s+)?(?:mixed number|improper fraction|simplest form)?\s*(.+)$/i;

function formsOf(answer) {
  const text = String(answer || '');
  const mixed = [...text.matchAll(/(?<![\d/])(\d+)\s+(\d+)\/(\d+)(?![\d/])/g)].pop();
  const improper = mixed ? null : [...text.matchAll(/(?<![\d/])(\d+)\/(\d+)(?![\d/])/g)].filter((m) => Number(m[1]) > Number(m[2]) && Number(m[2]) > 0).pop();
  const m = mixed || improper;
  if (!m) return null;
  const [w, n, d] = mixed ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Math.floor(m[1] / m[2]), m[1] % m[2], Number(m[2])];
  if (!d || (mixed && n >= d)) return null;
  const top = mixed ? w * d + n : Number(m[1]);
  const g = gcd(top, d);
  const gr = gcd(n, d) || 1;
  const forms = mixed ? [`${top}/${d}`] : [n ? `${w} ${n}/${d}` : String(w)];
  if (g > 1) forms.push(`${top / g}/${d / g}`);
  if (n && gr > 1) forms.push(`${w} ${n / gr}/${d / gr}`.replace(/^0 /, ''));
  const unit = /^\s*([a-zA-Z]+)\b/.exec(text.slice(m.index + m[0].length));
  return { forms, unit: unit ? ` ${unit[1]}` : '' };
}

function mixedForms(q, notes) {
  if (FORM_ASKED.test(stemOf(q))) return q;
  const got = formsOf(q.answer);
  if (!got) return q;
  const have = new Set(accepts(q).map((a) => String(a).trim().toLowerCase()));
  const add = got.forms.map((f) => `${f}${got.unit}`).filter((f) => !have.has(f.toLowerCase()) && f.toLowerCase() !== String(q.answer || '').trim().toLowerCase());
  let soft = false;
  const fixed = points(q).map((p) => {
    const d = p && typeof p.text === 'string' ? DEMAND.exec(p.text) : null;
    if (!d) return p;
    soft = true;
    return { ...p, text: `Correct answer ${d[1].replace(/[.\s]+$/, '')} ${SOFT}` };
  });
  if (!add.length && !soft) return q;
  notes.push(`${q.slot}: the key's mixed number / improper fraction is accepted in its equal forms (${add.join(', ')})`);
  return withScheme(q, { points: fixed, accept: accepts(q).concat(add) });
}

function mathsMarking(q, notes) {
  if (!eligible(q)) return q;
  const log = Array.isArray(notes) ? notes : [];
  return noWorking(mixedForms(methodNames(q, log), log), log);
}

module.exports = { mathsMarking };
