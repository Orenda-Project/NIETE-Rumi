'use strict';
/**
 * quiz_report_fold_by_child's rule, in ONE place for every reader that counts children off the class list: the web
 * report (teacher-report.data quizReport + classReport, so the teacher home's count) and the 12 h WhatsApp quiz report
 * (video-quiz-report). Two off-list records are one child when the system already says so (`merged_into ?? id`), or
 * when they typed the same name and share a phone (child_phone_bindings.phone_tomb) or one side has no binding; the
 * same typed name on two different phones is two children.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { inChunks } = require('./web-quiz-in-chunks');

/**
 * quiz_report_fold_by_child: for off-list records, who each one is (`merged_into ?? id`) and the phones it is bound
 * to (child_phone_bindings.phone_tomb, revoked or not: a phone the child used) — its own and its merged-into record's.
 * → Map id → { who, phones }, or null when either read fails (the caller then folds by typed name, as today).
 * `merged_into` is followed ONE step (A → B); a chain A → B → C is not resolved further (the merge path writes the
 * surviving record directly, so a chain is not expected).
 */
async function childFacts(ids, quizId) {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  const out = new Map();
  if (!uniq.length) return out;
  try {
    const kids = await inChunks(() => supabase.from('students').select('id, merged_into'), 'id', uniq);
    const whoOf = new Map(uniq.map((id) => [id, id]));
    kids.forEach((k) => { if (whoOf.has(String(k.id)) && k.merged_into) whoOf.set(String(k.id), String(k.merged_into)); });
    const lookup = [...new Set([...uniq, ...whoOf.values()])];
    const binds = await inChunks(() => supabase.from('child_phone_bindings').select('canonical_id, phone_tomb'), 'canonical_id', lookup);
    const phonesOf = new Map();
    binds.forEach((b) => {
      if (!b.phone_tomb) return;
      const k = String(b.canonical_id);
      if (!phonesOf.has(k)) phonesOf.set(k, new Set());
      phonesOf.get(k).add(String(b.phone_tomb));
    });
    uniq.forEach((id) => {
      const who = whoOf.get(id);
      out.set(id, { who, phones: new Set([...(phonesOf.get(id) || []), ...(phonesOf.get(who) || [])]) });
    });
    return out;
  } catch (err) {
    logToFile('⚠️ teacher report: child facts unreadable — same-name rows fold as before', { quizId, error: err.message });
    return null;
  }
}

/**
 * Off-list records (earliest finish first) → one cluster per child: { first, n }. A record joins the first cluster
 * that is the same child (`who`), or has its typed name and shares a phone with it, or where either side has no
 * binding (a fresh browser cannot be told apart). The same typed name on two different phones starts a new cluster.
 */
function foldByChild(records, { idOf, nameOf, facts }) {
  const clusters = [];
  records.forEach((r) => {
    const id = idOf(r) ? String(idOf(r)) : null;
    const f = (id && facts.get(id)) || { who: id, phones: new Set() };
    const name = typedKey(nameOf(r));
    const sharesPhone = (c) => f.phones.size === 0 || c.phones.size === 0 || [...f.phones].some((ph) => c.phones.has(ph));
    const c = clusters.find((x) => (f.who && x.whos.has(f.who)) || (name && x.name === name && sharesPhone(x)));
    if (c) {
      c.n += 1;
      if (f.who) c.whos.add(f.who);
      f.phones.forEach((ph) => c.phones.add(ph));
    } else {
      clusters.push({ first: r, n: 1, name, whos: new Set(f.who ? [f.who] : []), phones: new Set(f.phones) });
    }
  });
  return clusters;
}

/** A typed name's grouping key: identity v2's canonical form (case, spaces, script folded). */
function typedKey(name) {
  try { return require('./web-quiz-identity').canon(name || '') || ''; } catch { return String(name || '').trim().toLowerCase(); }
}

module.exports = { childFacts, foldByChild, typedKey };
