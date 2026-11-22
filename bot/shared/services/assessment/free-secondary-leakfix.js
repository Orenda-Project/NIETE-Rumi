'use strict';
/**
 * bd-5jmnfj.38.35 — a cross-item answer leak that survives the targeted rewrite and the pool swap
 * (G8 Urdu a8b: Q1 was rewritten and its key still printed Q11's answer). Only when a leak is left:
 *   1. one follow-up, limited to the leaking items, quoting the leaked phrase and both item numbers;
 *   2. then, in code, the leaking item is dropped and the shortfall recorded, so no leak ships.
 * A clean paper costs nothing (no call). No I/O: the service passes the call in as `ask`.
 */

const { items, answerText } = require('./free-secondary-checks');
const Rewrite = require('./free-secondary-rewrite');

const leakList = (issues) => (issues || []).filter((i) => i && i.n > 0 && i.check === 'cross-leak');

/** The follow-up request: the rewrite prompt for the leaking items, plus the phrase each one prints. */
function followUp(examJson, list) {
  const all = items(examJson);
  const quotes = list.map((i) => (i.avoid || []).map((m) => all[m - 1]).filter(Boolean)
    .map((o) => `Q${i.n} still gives away Q${o.n}: the answer of Q${o.n} is "${answerText(o)}" and Q${i.n} prints it (in its stem, key or options). Q${i.n} must not contain that phrase, nor its key words.`))
    .flat();
  return `${Rewrite.prompt(examJson, list)}\n\n${quotes.join('\n')}`;
}

/** Removes `item` from whichever list of the paper holds it. */
function removeItem(node, item) {
  if (Array.isArray(node)) {
    const at = node.indexOf(item);
    if (at >= 0) { node.splice(at, 1); return true; }
    return node.some((x) => removeItem(x, item));
  }
  return !!node && typeof node === 'object' && Object.values(node).some((v) => removeItem(v, item));
}

/** Drops each leaking item (one at a time, re-checking: numbers shift). Returns what was dropped. */
function dropLeaks(exam, check) {
  const dropped = [];
  for (let list = leakList(check(exam)); list.length; list = leakList(check(exam))) {
    const { n, avoid = [] } = list[0];
    const entry = items(exam)[n - 1];
    if (!entry || !removeItem(exam, entry.item)) break;
    dropped.push({ n, avoid, question: entry.item.question });
  }
  return dropped;
}

async function resolveLeaks({ examJson, check, ask, tidy = () => {}, onError = () => {} }) {
  let exam = examJson;
  const list = leakList(check(exam));
  if (!list.length) return { exam, issues: check(exam), dropped: [], reasked: false };
  try {
    const merged = Rewrite.merge(exam, await ask(followUp(exam, list)), list.map((i) => i.n));
    tidy(merged.exam);
    if (leakList(check(merged.exam)).length < list.length) exam = merged.exam;
  } catch (err) {
    onError(err);
  }
  if (exam === examJson) exam = JSON.parse(JSON.stringify(examJson));
  const dropped = dropLeaks(exam, check);
  return { exam, issues: check(exam), dropped, reasked: true };
}

module.exports = { resolveLeaks, followUp, leakList };
