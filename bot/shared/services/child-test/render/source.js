/**
 * Child-test stimulus — where the card's words come from (bd-s1oo0.2).
 *
 * One source of truth: the item bank (L1). The committed bank is read through its accessor
 * (`../item-bank` → getForm); a caller (a test, the proof script, a back-fill) may inject a
 * contract-shaped bank object instead. Never a hard-coded passage.
 */

function resolveForm({ grade, form, itemBank }) {
  const g = String(grade);
  const f = String(form || '');
  if (itemBank) {
    const grades = itemBank.grades || {};
    if (!grades[g]) throw new Error(`child-test render: the item bank has no grade ${g}`);
    const data = (grades[g].forms || {})[f];
    if (!data) throw new Error(`child-test render: grade ${g} has no form ${f}`);
    return { data, version: itemBank.version || null };
  }
  let accessor;
  try {
    accessor = require('../item-bank');
  } catch (err) {
    throw new Error(`child-test render: item bank accessor not available (${err.message})`);
  }
  if (!['3', '5'].includes(g)) throw new Error(`child-test render: the item bank has no grade ${g}`);
  let data;
  try { data = accessor.getForm(Number(g), f); } catch (err) { data = null; }
  if (!data) throw new Error(`child-test render: grade ${g} has no form ${f}`);
  return { data, version: accessor.version || null };
}

module.exports = { resolveForm };
