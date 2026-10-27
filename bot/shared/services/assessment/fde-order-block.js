'use strict';
/**
 * A Put-in-Order question's step numbers (bd-5jmnfj.4.46). The model numbers the steps and keys
 * the order, and in v21 it keyed all three items ۳، ۲، ۱: a child who saw the pattern needed to
 * read nothing. Each item is re-numbered here, never already in order and, while the paper has
 * numberings left, never the same as another item; its key follows.
 * Pure: exam JSON in, exam JSON out. An item it cannot read is left as it is.
 */

const URDU = '۰۱۲۳۴۵۶۷۸۹';
const toInt = (d) => Number(URDU.includes(d) ? URDU.indexOf(d) : d);

/** "stem: 1) a 2) b 3) c" with key "3، 2، 1" → { stem, steps, order, urdu }; null when unreadable. */
function parseOrder(q) {
  const text = String(q.question ?? '');
  const marks = [...text.matchAll(/([0-9۰-۹])\)\s*/g)];
  if (marks.length < 2) return null;
  const steps = marks.map((m, i) => text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : text.length).trim());
  if (marks.some((m, i) => toInt(m[1]) !== i + 1) || steps.some((s) => !s)) return null;
  const order = (String(q.answer ?? '').match(/[0-9۰-۹]/g) || []).map(toInt);
  const sorted = [...order].sort((a, b) => a - b);
  if (order.length !== steps.length || sorted.some((n, i) => n !== i + 1)) return null;
  return { stem: text.slice(0, marks[0].index), steps, order, urdu: URDU.includes(marks[0][1]) };
}

function permutations(n) {
  if (n === 1) return [[0]];
  return permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, at) => [...p.slice(0, at), n - 1, ...p.slice(at)]));
}

/** Print the steps in `printed` order (indexes into the true order) and key them. */
function dealt(q, p, printed) {
  const num = (n) => (p.urdu ? [...String(n)].map((d) => URDU[d]).join('') : String(n));
  const truth = p.order.map((n) => p.steps[n - 1]);
  const question = `${p.stem}${printed.map((t, i) => `${num(i + 1)}) ${truth[t]}`).join(' ')}`;
  const answer = truth.map((_, t) => num(printed.indexOf(t) + 1)).join('، ');
  const scheme = q.scheme && typeof q.scheme === 'object' ? { ...q.scheme, accept: [answer] } : q.scheme;
  return { ...q, question, answer, scheme };
}

function dealItems(items) {
  const used = new Set();
  return items.map((q, k) => {
    const p = parseOrder(q);
    if (!p || p.steps.length > 6) return q;
    const n = p.steps.length;
    const ok = permutations(n).filter((perm) => perm.some((t, i) => t !== i));
    // Start each item at its own place in the list, so the paper does not open every item the same way.
    const start = (k * 7 + n) % ok.length;
    const turn = [...ok.slice(start), ...ok.slice(0, start)];
    const pick = turn.find((perm) => !used.has(perm.join())) || turn[0];
    used.add(pick.join());
    return dealt(q, p, pick);
  });
}

function dealOrders(examJson) {
  const slots = new Set(((examJson._layout && examJson._layout.sections) || [])
    .flatMap((s) => s.slots || []).filter((s) => s.type === 'Put in Order').map((s) => s.slot));
  if (!slots.size) return examJson;
  const unseen = Object.fromEntries(Object.entries(examJson.unseen || {}).map(([cat, byType]) => [cat,
    Object.fromEntries(Object.entries(byType).map(([type, list]) => {
      if (!Array.isArray(list) || !list.some((q) => slots.has(q.slot))) return [type, list];
      const mine = dealItems(list.filter((q) => slots.has(q.slot)));
      let i = 0;
      return [type, list.map((q) => (slots.has(q.slot) ? mine[i++] : q))];
    }))]));
  return { ...examJson, unseen };
}

module.exports = { dealOrders, parseOrder };
