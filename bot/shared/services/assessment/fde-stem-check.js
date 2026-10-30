/**
 * FDE stem check (bd-5jmnfj.22): one read of the whole question paper, every printed question
 * beside its own answer and marking, to catch a question that does not make sense on its own —
 * «Why can the student see the torch light but the torch is luminous while the mug is not?» reached
 * a staging Science paper. A flagged question is reworded so it asks what its answer answers; when
 * the answer line or a marking point is the wrong half, that is corrected instead or as well
 * (bd-5jmnfj.24: «how many bags» keyed as «14 bags», 14 being the fruits in each bag). An accept
 * line about a different question is dropped. Everything changed is recorded with what it was; a
 * flag with no usable fix is recorded only and the paper still prints.
 *
 * Pure: no model client, no I/O. The engine passes the model call in (`ask`).
 */

// English-medium papers only: the check reads and rewrites English.
const STEM_CHECK_SUBJECTS = Object.freeze(['english', 'maths', 'science']);

const strip = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
// A rewording that carries its own (a) / ii. / 3) — the paper letters and numbers questions itself.
const NUMBERED = /^\s*\(?(?:[a-z]|[ivx]{1,4}|\d{1,2})\s*[).]\s/i;
const MAX_LEN = 400;
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

function itemsOf(examJson, slotId) {
  const out = [];
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((examJson && examJson[branch]) || {})) {
      for (const list of Object.values(types || {})) {
        if (Array.isArray(list)) out.push(...list.filter((q) => q && typeof q === 'object' && q.slot === slotId));
      }
    }
  }
  return out;
}

// A slot prints an item's `topics` only when its prompt rule names the field — the renderer's own
// rule (English Q8).
const printsTopics = (slot) => {
  const rule = typeof slot.prompt_rule === 'string' ? slot.prompt_rule : '';
  return rule.includes('`topics`') && !rule.includes('no `topics`');
};

// A passage's groups whose sub-questions print, as [group label, sub-questions], in the slot's
// `parts_spec` order — the renderer's own (English Q2: i. questions, ii. do as directed). A pick
// group prints blanks and an antonyms group word pairs, not their questions (bd-5jmnfj.29).
function partsOf(q, slot) {
  if (!Array.isArray(q.parts) || !Array.isArray(slot.parts_spec)) return [];
  return slot.parts_spec.flatMap((spec, k) => {
    if (spec.pick || spec.key === 'antonyms') return [];
    const part = q.parts.find((p) => p && p.key === spec.key);
    if (!part || !Array.isArray(part.questions)) return [];
    return [[String(spec.label || '').replace(/[.:\s]/g, '') || ROMAN[k], part.questions]];
  });
}

// label → the object whose `question` prints, in paper order: Q2b.1 is the second slot's first
// item, Q2b.1.c its third sub-question. `withTopics` holds the items whose topics print.
function targetsOf(examJson, P) {
  const targets = new Map();
  const withTopics = new Set();
  for (const section of P.sections || []) {
    for (const slot of section.slots || []) {
      const head = String(slot.slot).split('.').pop();
      itemsOf(examJson, slot.slot).forEach((q, i) => {
        const label = `${head}.${i + 1}`;
        targets.set(label, q);
        if (printsTopics(slot)) withTopics.add(q);
        (Array.isArray(q.questions) ? q.questions : []).forEach((s, j) => {
          if (s && typeof s === 'object') targets.set(`${label}.${LETTERS[j] || j + 1}`, s);
        });
        partsOf(q, slot).forEach(([group, subs]) => subs.forEach((s, j) => {
          if (s && typeof s === 'object') targets.set(`${label}.${group}.${LETTERS[j] || j + 1}`, s);
        }));
      });
    }
  }
  targets.withTopics = withTopics;
  return targets;
}

const pointText = (p) => strip(p && typeof p === 'object' ? p.text || p.point || '' : p);

function entryOf(label, q, topics) {
  const lines = [`${label} ${strip(q.question)}`];
  const add = (name, t) => { const s = strip(t); if (s) lines.push(`   ${name}: ${s}`); };
  if (typeof q.passage === 'string') add('passage', q.passage);
  // Plain-text parts print as i), ii)… under the question (bd-5jmnfj.24: unseen, the angles list was
  // flagged as missing and then printed twice).
  const parts = (Array.isArray(q.questions) ? q.questions : []).filter((s) => typeof s === 'string');
  if (parts.length) add('parts', parts.map((s, j) => `${ROMAN[j] || j + 1}) ${strip(s)}`).join(' | '));
  // A table prints under its question (bd-5jmnfj.25: unseen, a printed table was flagged as missing
  // and its numbers were written into the question as well).
  if (q.table && typeof q.table === 'object') {
    const rows = [q.table.headers, ...(Array.isArray(q.table.rows) ? q.table.rows : [])].filter(Array.isArray);
    add('table', rows.map((r) => r.map(strip).join(' | ')).join(' / '));
  }
  // Topics print under their question as (a) (b) (c) (bd-5jmnfj.28: English Q8 was reworded to list
  // them, and printed them twice).
  if (topics && Array.isArray(q.topics)) add('topics', q.topics.filter((t) => typeof t === 'string').map((t, j) => `(${LETTERS[j]}) ${strip(t)}`).join(' | '));
  if (Array.isArray(q.options)) add('options', q.options.filter((o) => typeof o === 'string').join(' | '));
  if (Array.isArray(q.words)) add('words', q.words.filter((w) => typeof w === 'string').join(', '));
  if (typeof q.answer === 'string') add('answer', q.answer);
  const scheme = q.scheme && typeof q.scheme === 'object' ? q.scheme : {};
  if (Array.isArray(scheme.points)) add('points', scheme.points.map(pointText).filter(Boolean).join(' | '));
  if (Array.isArray(scheme.accept)) add('accept', scheme.accept.filter((a) => typeof a === 'string').join(' | '));
  return lines.join('\n');
}

function buildStemCheckPrompt(examJson, P, opts = {}) {
  const grade = opts.grade || 5;
  const targets = targetsOf(examJson, P);
  const body = [...targets].map(([label, q]) => entryOf(label, q, targets.withTopics.has(q))).join('\n\n');
  const prompt = `STEM CHECK: Grade ${grade} board question paper.
Below is every printed question, each with the answer and marking the teacher holds. A label like Q2b.1 is an item; Q2b.1.c is its sub-question (c), which is read with the item's situation above it. Q2.1.ii.a is sub-question (a) of group ii. under item Q2.1, read with that item's passage above it. "parts:" are printed under their question as i), ii)…, so a question that says "the following" has its list there. "table:" is printed under its question (rows split by /), so a question that says "the table shows" has its data there. "topics:" are printed under their question as (a), (b), (c) for the child to choose from, so a question that says "any one topic" has its topics there.

Flag a question ONLY when one of these is true:
1. Its wording contradicts itself or is garbled, so a child cannot tell what is being asked (two questions run together, a "but" that joins things that do not clash, a half sentence).
2. It asks about something its own situation or passage does not contain.
3. Its answer, points or accept line are about a different question (other objects, another situation).
4. Its answer, points or accept line contradict its own passage or situation (a True/False keyed against what the passage says, who does what reversed, a fill-in whose word the passage does not use).

Do NOT flag style, difficulty, level, length, spelling, or a question you would merely phrase differently. Most papers have no flags.

For each flag give:
- "label": the label exactly as printed;
- "problem": one short sentence;
- "question": the question reworded with the smallest change so it asks what its own answer answers; where the answer is right it must keep the same answer. No letter or number in front. Leave it out if the question is fine;
- "answer": the answer line corrected, only if it is wrong for the question as it will print; leave it out otherwise;
- "points": marking points to correct, each {"was": the point text copied exactly, "now": the corrected text}; leave it out if none;
- "drop_accept": accept lines that belong to a different question, copied exactly; leave it out if none.
Fix whichever part is wrong with the smallest change, so that the question, the answer and the points agree after the fix.

Reply with JSON only: {"flags":[{"label":"…","problem":"…","question":"…","answer":"…","points":[{"was":"…","now":"…"}],"drop_accept":["…"]}]}. No flags: {"flags":[]}.

=== THE PAPER ===
${body}`;
  return { prompt, targets };
}

function parseStemFlags(reply, targets) {
  if (!reply || !Array.isArray(reply.flags)) throw new Error('stem check: reply has no flags list');
  const seen = new Set();
  const out = [];
  for (const f of reply.flags) {
    const label = f && typeof f.label === 'string' ? f.label.trim() : '';
    if (!targets.has(label) || seen.has(label)) continue;
    seen.add(label);
    const flag = { label, problem: strip(f.problem) };
    if (typeof f.question === 'string') flag.question = f.question;
    if (typeof f.answer === 'string') flag.answer = f.answer;
    if (Array.isArray(f.points)) {
      const pts = f.points.filter((p) => p && typeof p.was === 'string' && typeof p.now === 'string').map((p) => ({ was: p.was, now: p.now }));
      if (pts.length) flag.points = pts;
    }
    if (Array.isArray(f.drop_accept)) flag.drop_accept = f.drop_accept.filter((a) => typeof a === 'string');
    out.push(flag);
  }
  return out;
}

// A rewording is used only if it is a real question the paper can print.
function usable(fix, was) {
  const t = strip(fix);
  return Boolean(t) && t !== strip(was) && t.length <= MAX_LEN && !NUMBERED.test(t);
}

// The answer line and the named marking points, corrected in place; true if anything changed.
function fixKey(q, f, refuses, entry) {
  let changed = false;
  if (typeof f.answer === 'string' && strip(f.answer) && strip(f.answer) !== strip(q.answer) && strip(f.answer).length <= MAX_LEN) {
    if (refuses(f.answer)) entry.answer_refused = strip(f.answer);
    else { entry.answer_was = q.answer; q.answer = strip(f.answer); changed = true; }
  }
  const points = q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : null;
  for (const fix of (points && f.points) || []) {
    const now = strip(fix.now);
    const i = points.findIndex((p) => pointText(p) === strip(fix.was));
    if (i < 0 || !now || now === strip(fix.was) || now.length > MAX_LEN || refuses(now)) continue;
    const p = points[i];
    if (p && typeof p === 'object') p[p.text != null ? 'text' : 'point'] = now;
    else points[i] = now;
    (entry.points_was = entry.points_was || []).push(strip(fix.was));
    changed = true;
  }
  return changed;
}

function applyStemFixes(examJson, P, flags, { refuses = () => false } = {}) {
  const exam = JSON.parse(JSON.stringify(examJson));
  const targets = targetsOf(exam, P);
  const record = [];
  for (const f of flags) {
    const q = targets.get(f.label);
    if (!q) continue;
    const entry = { label: f.label, problem: f.problem };
    let outcome = 'flagged_only';
    if (typeof f.question === 'string' && usable(f.question, q.question)) {
      if (refuses(f.question)) {
        outcome = 'refused';
        entry.fix = strip(f.question);
      } else {
        entry.was = q.question;
        q.question = strip(f.question);
        outcome = 'reworded';
      }
    } else if (typeof f.question === 'string' && strip(f.question)) {
      entry.fix = strip(f.question);
    }
    const keyed = fixKey(q, f, refuses, entry);
    if (keyed && outcome === 'flagged_only') outcome = 'answer_fixed';
    const accept = q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept : null;
    const dropped = accept && Array.isArray(f.drop_accept) ? accept.filter((a) => f.drop_accept.includes(a)) : [];
    if (dropped.length) {
      q.scheme.accept = accept.filter((a) => !dropped.includes(a));
      entry.dropped = dropped;
      if (outcome === 'flagged_only') outcome = 'accept_dropped';
    }
    record.push({ ...entry, outcome });
  }
  return { examJson: exam, record };
}

// One read and its fixes. `ask(prompt)` resolves to the model's parsed JSON reply.
async function runStemCheck({ examJson, P, ask, refuses, grade }) {
  const { prompt, targets } = buildStemCheckPrompt(examJson, P, { grade });
  const flags = parseStemFlags(await ask(prompt), targets);
  return applyStemFixes(examJson, P, flags, { refuses });
}

module.exports = { STEM_CHECK_SUBJECTS, buildStemCheckPrompt, parseStemFlags, applyStemFixes, runStemCheck };
