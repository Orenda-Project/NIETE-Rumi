/**
 * Child test item bank accessor (bd-s1oo0.1, CONTRACT §2).
 *
 * Pure, read-only access to bot/shared/data/child-test/item-bank.v1.json: the stories, questions
 * (with answer keys), first sounds, made-up words, fallback rows and maths items for Grades 3 and 5,
 * Forms A (new children) and B (returning children). The bank is loaded once and deep-frozen, so a
 * caller that mutates what it gets back throws instead of corrupting the bank for the next caller.
 *
 * v2 (child-test-items-v2, bd-s1oo0.46.3, CONTRACT §19), additive: `<block>.script` (the coach's words to
 * the child), `maths.oral` (May EGMA set: compare A–D, sums 1–4, two word problems read aloud; Form A =
 * Set A, Form B = Set B) and a third English question. In the v2 design a form letter is the term's card
 * set, not new-vs-returning.
 */
const BANK = require('../../data/child-test/item-bank.v1.json');

const GRADES = ['3', '5'];
const FORMS = ['A', 'B'];
const BLOCKS = ['urdu', 'english', 'maths'];
const ORAL_KINDS = ['compare', 'sums', 'word_problems'];

function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.values(x).forEach(deepFreeze);
    Object.freeze(x);
  }
  return x;
}
deepFreeze(BANK);

// id -> { grade, form, block, kind, item }. Built once; every id in the bank is unique (validator-enforced).
const INDEX = new Map();
for (const grade of GRADES) {
  for (const form of FORMS) {
    for (const block of BLOCKS) {
      for (const [kind, v] of Object.entries(BANK.grades[grade].forms[form][block])) {
        const list = Array.isArray(v) ? v : [v];
        for (const item of list) {
          if (item && typeof item === 'object' && typeof item.id === 'string') {
            INDEX.set(item.id, Object.freeze({ grade, form, block, kind, item }));
          }
        }
      }
    }
    // v2 oral maths: maths.oral.{compare,sums,word_problems} → kind 'oral.compare' etc.
    const oral = BANK.grades[grade].forms[form].maths.oral || {};
    for (const kind of ORAL_KINDS) {
      for (const item of oral[kind] || []) INDEX.set(item.id, Object.freeze({ grade, form, block: 'maths', kind: `oral.${kind}`, item }));
    }
  }
}

function normGrade(grade) {
  const g = String(grade);
  if (!GRADES.includes(g)) throw new Error(`child-test item bank: unknown grade "${grade}" (expected 3 or 5)`);
  return g;
}

function normForm(form) {
  const f = String(form || '').toUpperCase();
  if (!FORMS.includes(f)) throw new Error(`child-test item bank: unknown form "${form}" (expected A or B)`);
  return f;
}

/** The whole form: { urdu, english, maths }. */
function getForm(grade, form) {
  return BANK.grades[normGrade(grade)].forms[normForm(form)];
}

/** One block of a form: 'urdu' | 'english' | 'maths'. */
function getBlock(grade, form, block) {
  if (!BLOCKS.includes(block)) throw new Error(`child-test item bank: unknown block "${block}" (expected urdu, english or maths)`);
  return getForm(grade, form)[block];
}

/** v2: the oral maths set of a form: { compare[4], sums[4], word_problems[2], script, equated, … }. */
function getOral(grade, form) {
  return getBlock(grade, form, 'maths').oral || null;
}

/** v2: the exact words the coach says to the child in one block (maths: the oral set's script). */
function getScript(grade, form, block) {
  const b = getBlock(grade, form, block);
  return (block === 'maths' ? b.oral && b.oral.script : b.script) || null;
}

// ------------------------------------------------------------------ the v2 switches (CONTRACT §19)
// v2 is the default; v1 is reached only by setting the switch to exactly its v1 value.
/** CHILD_TEST_BATTERY: 'v2' (story + questions + fallback) unless set to 'v1' (adds first sounds, made-up words). */
function batteryVersion(env = process.env) {
  return String(env.CHILD_TEST_BATTERY || '').trim().toLowerCase() === 'v1' ? 'v1' : 'v2';
}

/** CHILD_TEST_MATHS_MODE: 'oral' (May set, one voice note) unless set to 'strip' (v1: numbers, quick sums, photo). */
function mathsMode(env = process.env) {
  return String(env.CHILD_TEST_MATHS_MODE || '').trim().toLowerCase() === 'strip' ? 'strip' : 'oral';
}

/** Any item by id (e.g. 'u3A-q1', 'e5B-story', 'm3A-qs12') → { grade, form, block, kind, item } or null. */
function getItem(id) {
  return INDEX.get(id) || null;
}

// ------------------------------------------------------------------ quick sums: one setting
// `maths.quick_sums_seconds` in the bank governs the copy, the coach sheet and the scorer's timed
// window. CHILD_TEST_QUICK_SUMS_SECONDS (30 or 60) overrides it on SANDBOX only, so a pilot can time
// both settings without a bank change. Everything that needs the number reads quickSumsSeconds().
const QS_ALLOWED = new Set([30, 60]);
const QS_DEFAULT = 60;

function isSandbox(env = process.env) {
  const names = [env.CHILD_TEST_R2_ENV, env.RAILWAY_ENVIRONMENT, env.RAILWAY_ENVIRONMENT_NAME].map((x) => String(x || '').toLowerCase());
  return names.includes('sandbox') || /-sandbox$/i.test(String(env.DEFAULT_REGION || ''));
}

function sandboxQuickSumsOverride(env = process.env) {
  const raw = env.CHILD_TEST_QUICK_SUMS_SECONDS;
  if (raw == null || raw === '' || !isSandbox(env)) return null;
  const n = Number(raw);
  if (!QS_ALLOWED.has(n)) {
    // logger is required lazily: this module is otherwise pure data access.
    require('../../utils/logger').logError('child_test.quick_sums_override_invalid', { value: String(raw) });
    return null;
  }
  return n;
}

/** Seconds of quick sums for a form (default Grade 3 Form A): sandbox override, else the bank, else 60. */
function quickSumsSeconds(grade = 3, form = 'A') {
  const o = sandboxQuickSumsOverride();
  if (o != null) return o;
  const v = Number(getBlock(grade, form, 'maths').quick_sums_seconds);
  return Number.isFinite(v) && v > 0 ? v : QS_DEFAULT;
}

// ------------------------------------------------------------------ battery v3 (CONTRACT §21.3)
// item-bank.v3.json: the full EGRA/EGMA battery, one task spec per task id (tasks.js TASKS_V3).
// Reading is ONE form for Grades 3 and 5 (as RWP); maths has a form per grade. Every item cites a key
// in `sources`; a slot with no official or RWP source is `{ gap: true, reason }` and is never filled.
const BANK_V3 = deepFreeze(require('../../data/child-test/item-bank.v3.json'));
const { TASKS_V3, isTask, blockOf, kindOf } = require('./tasks');

const V3_LANG = { urdu: 'ur', english: 'en' };

/** The whole v3 bank (deep-frozen). */
function bankV3() {
  return BANK_V3;
}

/** The 18 task ids in visit order. The battery is the same for both grades; only the maths items differ. */
function tasksFor({ grade } = {}) {
  normGrade(grade);
  return [...TASKS_V3];
}

/** One task's spec: { task, title, timed_s, items, practice, stop, script, source, quality, … } or { gap, reason }. */
function getTaskSpec({ grade, set = 'A', task } = {}) {
  const g = normGrade(grade);
  if (!isTask(task)) throw new Error(`child-test item bank v3: unknown task "${task}"`);
  const s = BANK_V3.sets[String(set || '').toUpperCase()];
  if (!s) throw new Error(`child-test item bank v3: unknown set "${set}"`);
  const block = blockOf(task);
  return block === 'maths' ? s.maths[g][kindOf(task)] : s.reading[V3_LANG[block]][kindOf(task)];
}

module.exports = {
  version: BANK.version,
  cue: BANK.cue,
  GRADES,
  FORMS,
  BLOCKS,
  getForm,
  getBlock,
  getItem,
  getOral,
  getScript,
  batteryVersion,
  mathsMode,
  quickSumsSeconds,
  sandboxQuickSumsOverride,
  isSandbox,
  versionV3: BANK_V3.version,
  bankV3,
  tasksFor,
  getTaskSpec,
};

// ------------------------------------------------------------------ battery v4 (content registry)
// item-bank.v4.json: ids over the v3 Set A maths content (the anchor blocks A1 and A2, the bigger item sets, the
// G3 rotating missing items), the periods, the draw weights and the clone templates; passages live one file per
// id under data/child-test/passages/ (immutable per id: a fix is a new id). The registry tables
// (web_quiz_challenge_registry.sql) hold status, release and sign-off; the text lives here.
// Pure and deep-frozen: no database, no environment. Nothing in the serve path calls this section yet; the draw
// reads it only under web_quiz_challenge_pool (parent web_quiz_challenge_v2), in a later change.
// The code above this section is untouched; these exports are added to the object above.
const fsV4 = require('fs');
const pathV4 = require('path');
const cryptoV4 = require('crypto');

const BANK_V4 = deepFreeze(require('../../data/child-test/item-bank.v4.json'));
const PASSAGES_DIR = pathV4.join(__dirname, '../../data/child-test/passages');
const V3_KINDS = { story: 'story', listening: 'listening' };

/** The whole v4 bank (deep-frozen). */
function bankV4() {
  return BANK_V4;
}

/** The periods in the bank: [{ period_id, starts_at, ends_at, anchor_block_version, weights_v }]. */
function periodsV4() {
  return BANK_V4.periods;
}

/** The draw weights of one version (default w1). */
function weightsV4(version = 'w1') {
  const w = Object.prototype.hasOwnProperty.call(BANK_V4.weights, version) ? BANK_V4.weights[version] : null;
  if (!w) throw new Error(`child-test item bank v4: unknown weights version "${version}"`);
  return w;
}

/** The clone templates: { check: {...}, practice: {...} } with disjoint parameter spaces. */
function templatesV4() {
  return BANK_V4.templates;
}

function canonicalJson(x) {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`;
  if (x && typeof x === 'object') {
    return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(x[k])}`).join(',')}}`;
  }
  return JSON.stringify(x === undefined ? null : x);
}

/** First 16 hex of sha256 over the canonical JSON (sorted keys) of an item's params. */
function paramsHash(params) {
  return cryptoV4.createHash('sha256').update(canonicalJson(params)).digest('hex').slice(0, 16);
}

// item_id -> the item with its registry fields. Built once; a duplicate id is a broken bank and throws.
const ITEMS_V4 = new Map();
function addItemV4(item) {
  if (ITEMS_V4.has(item.item_id)) throw new Error(`child-test item bank v4: duplicate item id "${item.item_id}"`);
  ITEMS_V4.set(item.item_id, deepFreeze(item));
}
for (const [block, def] of Object.entries(BANK_V4.anchor_blocks)) {
  for (const it of def.items) {
    const isAnchor = def.status === 'operational';
    addItemV4({
      item_id: it.item_id, task: it.task, form: it.form, band: it.band == null ? null : it.band, pool: def.pool,
      status: isAnchor ? 'operational' : def.status, params: it.params, anchor: isAnchor,
      anchor_block: isAnchor ? block : null, anchor_pos: isAnchor ? it.anchor_pos : null,
      anchor_block_candidate: it.anchor_block_candidate || null, block_pos: it.anchor_pos,
    });
  }
}
for (const def of Object.values(BANK_V4.item_sets)) {
  for (const it of def.items) {
    addItemV4({
      item_id: it.item_id, task: def.task, form: def.form, band: it.band == null ? null : it.band, pool: def.pool,
      status: def.status, params: it.params, anchor: false, anchor_block: null, anchor_pos: null, anchor_block_candidate: null,
    });
  }
}
for (const it of BANK_V4.items) {
  addItemV4({
    item_id: it.item_id, task: it.task, form: it.form, band: it.band == null ? null : it.band, pool: it.pool,
    status: it.status, params: it.params, anchor: false, anchor_block: null, anchor_pos: null, anchor_block_candidate: null,
  });
}

/** Any v4 item by id → { item_id, task, form, band, pool, status, params, anchor, anchor_block, anchor_pos, … } or null. */
function getItemV4(itemId) {
  return ITEMS_V4.get(itemId) || null;
}

/** Every v4 item in bank order (A1, A2, the item sets, the loose items). */
function listItemsV4() {
  return [...ITEMS_V4.values()];
}

function shownV4(task, params) {
  return task === 'missing' ? { seq: params.seq } : { a: params.a, b: params.b };
}

/** One anchor block in its fixed order: [{ item_id, task, anchor_pos, seq | a,b, answer, band }]. */
function anchorBlock(block) {
  const def = Object.prototype.hasOwnProperty.call(BANK_V4.anchor_blocks, block) ? BANK_V4.anchor_blocks[block] : null;
  if (!def) throw new Error(`child-test item bank v4: unknown anchor block "${block}"`);
  return deepFreeze([...def.items]
    .sort((x, y) => x.anchor_pos - y.anchor_pos)
    .map((it) => ({ item_id: it.item_id, task: it.task, anchor_pos: it.anchor_pos, ...shownV4(it.task, it.params), answer: it.params.ans, band: it.band })));
}

/** The anchor blocks a period serves: ['A1'] before A2's first period, ['A1', 'A2'] from it ('YYYY-MM' compare). */
function anchorBlocksFor(periodId) {
  const p = String(periodId || '');
  if (!/^\d{4}-\d{2}$/.test(p)) throw new Error(`child-test item bank v4: bad period id "${periodId}" (expected YYYY-MM)`);
  return p >= BANK_V4.anchor_blocks.A2.serve_from_period ? ['A1', 'A2'] : ['A1'];
}

/** One maths item set in bank order: [{ item_id, a, b, answer }]. */
function itemSet(id) {
  const def = Object.prototype.hasOwnProperty.call(BANK_V4.item_sets, id) ? BANK_V4.item_sets[id] : null;
  if (!def) throw new Error(`child-test item bank v4: unknown item set "${id}"`);
  return deepFreeze(def.items.map((it) => ({ item_id: it.item_id, a: it.params.a, b: it.params.b, answer: it.params.ans })));
}

// ---- passages: bank.passages (none today) + one file per id in passages/*.json, read once, sorted by file name.
function withTapOk(q) {
  return { ...q, tap_ok: q.tap_ok === true };
}

function resolvePassage(row) {
  if (!row.v3_ref) return { ...row, questions: (row.questions || []).map(withTapOk) };
  const lang = row.v3_ref.lang;
  const kind = V3_KINDS[row.v3_ref.kind];
  const set = BANK_V3.sets[String(row.v3_ref.set || 'A').toUpperCase()];
  const spec = set && set.reading[lang] && kind ? set.reading[lang][kind] : null;
  if (!spec || !spec.story) throw new Error(`child-test item bank v4: passage "${row.passage_id}" points at a missing v3 spec`);
  return {
    ...row,
    text: spec.story.text,
    tokens: spec.story.tokens == null ? null : spec.story.tokens,
    lines: spec.story.lines == null ? null : spec.story.lines,
    direction: spec.direction || (lang === 'ur' ? 'rtl' : 'ltr'),
    questions: [...spec.questions, ...(row.questions_extra || [])].map(withTapOk),
  };
}

function loadPassages(dir) {
  const byId = new Map();
  const add = (row, where) => {
    if (!row || typeof row.passage_id !== 'string') throw new Error(`child-test item bank v4: ${where} has no passage_id`);
    if (byId.has(row.passage_id)) throw new Error(`child-test item bank v4: duplicate passage id "${row.passage_id}" (${where})`);
    byId.set(row.passage_id, deepFreeze(resolvePassage(row)));
  };
  for (const row of BANK_V4.passages || []) add(row, 'item-bank.v4.json');
  const files = fsV4.existsSync(dir) ? fsV4.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const f of files) {
    const row = JSON.parse(fsV4.readFileSync(pathV4.join(dir, f), 'utf8'));
    if (row && row.passage_id && `${row.passage_id}.json` !== f) {
      throw new Error(`child-test item bank v4: file ${f} carries passage id "${row.passage_id}" (one file per id, named after it)`);
    }
    add(row, f);
  }
  return byId;
}

let PASSAGES_V4 = loadPassages(PASSAGES_DIR);

/** Tests only: reload the passages from another directory (no argument = the shipped directory). */
function _loadPassagesFrom(dir = PASSAGES_DIR) {
  PASSAGES_V4 = loadPassages(dir);
  return PASSAGES_V4.size;
}

/** One passage by id (a Set A pointer resolved from v3) or null. */
function getPassage(passageId) {
  return PASSAGES_V4.get(passageId) || null;
}

/** Passages matching every given filter, in file order. */
function listPassages({ lang, kind, band, pool } = {}) {
  return [...PASSAGES_V4.values()].filter((p) => (lang == null || p.lang === lang)
    && (kind == null || p.kind === kind)
    && (band == null || p.band === band)
    && (pool == null || p.pool === pool));
}

Object.assign(module.exports, {
  versionV4: BANK_V4.version,
  bankV4,
  periodsV4,
  weightsV4,
  templatesV4,
  paramsHash,
  anchorBlock,
  anchorBlocksFor,
  itemSet,
  getItemV4,
  listItemsV4,
  getPassage,
  listPassages,
  _loadPassagesFrom,
});
