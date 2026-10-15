'use strict';
/**
 * The Challenge content registry: bank v4 (item-bank.v4.json), its loader section in item-bank.js, the passage
 * files directory and the generated registry seed (bot/database/migrations/web_quiz_challenge_registry_seed.sql).
 *
 * Goldens first: the v3 bank bytes, the v3 missing-number items and every pre-existing export of item-bank.js
 * stay as they are. Then the anchor block A1 (the frozen ten, byte-identical to the v3 Set A positions on both
 * forms), the A2 draft that is never served before its period, the disjoint check and practice spaces, the
 * params hash, the seed SQL on disk vs its generator, and a Set A pointer passage resolved from v3.
 * Pure data: no database, no network, no environment.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const Bank = require('../../../shared/services/child-test/item-bank');
// Required where used, so the goldens above the new code run on their own.
const seed = () => require('../../../scripts/challenge-registry-seed');

const DATA = path.join(__dirname, '../../../shared/data/child-test');
const V3 = JSON.parse(fs.readFileSync(path.join(DATA, 'item-bank.v3.json'), 'utf8'));
const SEED_FILE = path.join(__dirname, '../../../database/migrations/web_quiz_challenge_registry_seed.sql');

// The literal v3 Set A missing-number items (ITEMS §3.1); positions 0-5 are the same on both forms.
const MISSING_G3 = [
  { seq: [5, 6, 7, null], answer: 8 },
  { seq: [14, 15, null, 17], answer: 16 },
  { seq: [20, null, 40, 50], answer: 30 },
  { seq: [null, 300, 400, 500], answer: 200 },
  { seq: [2, 4, 6, null], answer: 8 },
  { seq: [348, 349, null, 351], answer: 350 },
  { seq: [28, null, 24, 22], answer: 26 },
  { seq: [30, 35, null, 45], answer: 40 },
  { seq: [550, 540, 530, null], answer: 520 },
  { seq: [3, 8, null, 18], answer: 13 },
];
const MISSING_G5 = [
  ...MISSING_G3.slice(0, 6),
  { seq: [222, null, 226, 228], answer: 224, source: 'rti_rwanda2011:p.C-4' },
  { seq: [245, 250, 255, null], answer: 260, source: 'rti_rwanda2011:p.C-4' },
  { seq: [null, 400, 500, 600], answer: 300, source: 'rti_rwanda2011:p.C-4' },
  { seq: [null, 900, 910, 920], answer: 890, source: 'rti_rwanda2011:p.C-4' },
];

describe('goldens: the v3 bank and the existing loader are unchanged', () => {
  test('item-bank.v3.json bytes are the sandbox bytes', () => {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(DATA, 'item-bank.v3.json'))).digest('hex');
    expect(sha).toBe('0b7618009b9c53633d76020fb4d3cd74fd6361ee47f33c9cc0959193e7e8b867');
    expect(Bank.versionV3).toBe('child-test-items-v3');
  });

  test('the v3 missing-number items are the literal ten per form', () => {
    expect(JSON.parse(JSON.stringify(Bank.getTaskSpec({ grade: 3, task: 'ma.missing' }).items))).toEqual(MISSING_G3);
    expect(JSON.parse(JSON.stringify(Bank.getTaskSpec({ grade: 5, task: 'ma.missing' }).items))).toEqual(MISSING_G5);
  });

  test('every pre-existing export keeps its name and type', () => {
    const before = {
      version: 'string', cue: 'object', GRADES: 'array', FORMS: 'array', BLOCKS: 'array',
      getForm: 'function', getBlock: 'function', getItem: 'function', getOral: 'function', getScript: 'function',
      batteryVersion: 'function', mathsMode: 'function', quickSumsSeconds: 'function',
      sandboxQuickSumsOverride: 'function', isSandbox: 'function', versionV3: 'string', bankV3: 'function',
      tasksFor: 'function', getTaskSpec: 'function',
    };
    for (const [name, type] of Object.entries(before)) {
      const v = Bank[name];
      expect([name, Array.isArray(v) ? 'array' : typeof v]).toEqual([name, type]);
    }
    expect(Bank.version).toBe('child-test-items-v2');
    expect(Bank.GRADES).toEqual(['3', '5']);
  });
});

describe('bank v4: version, periods, weights', () => {
  test('version and the two launch periods', () => {
    expect(Bank.versionV4).toBe('child-test-items-v4');
    expect(Bank.bankV4().version).toBe('child-test-items-v4');
    expect(Object.isFrozen(Bank.bankV4())).toBe(true);
    expect(Bank.periodsV4().map((p) => [p.period_id, p.starts_at, p.ends_at, p.anchor_block_version, p.weights_v])).toEqual([
      ['2026-11', '2026-10-31T19:00:00Z', '2026-11-30T19:00:00Z', 'A1', 'w1'],
      ['2026-12', '2026-11-30T19:00:00Z', '2026-12-31T19:00:00Z', 'A1', 'w1'],
    ]);
  });

  test('weights w1, and an unknown version throws', () => {
    expect(Bank.weightsV4()).toEqual({ reference: 0.35, provisional_each: 0.15, provisional_max: 2, calibrated_rest: 'equal share' });
    expect(Bank.weightsV4('w1')).toBe(Bank.weightsV4());
    expect(() => Bank.weightsV4('w9')).toThrow(/unknown weights/);
  });

  test('the bank carries no G1A block and no passage text', () => {
    const b = Bank.bankV4();
    expect(Object.keys(b.anchor_blocks).sort()).toEqual(['A1', 'A2']);
    expect(b.passages).toBeUndefined();
  });
});

describe('anchor block A1: byte-identical on both forms, fixed order, never new', () => {
  let a1;
  beforeAll(() => { a1 = Bank.anchorBlock('A1'); });

  test('ten items in fixed order 1..10 with ids anchor.A1.01-10', () => {
    expect(a1.map((i) => i.anchor_pos)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(a1.map((i) => i.item_id)).toEqual(Array.from({ length: 10 }, (_, k) => `anchor.A1.${String(k + 1).padStart(2, '0')}`));
    expect(a1.every((i) => i.task === 'missing')).toBe(true);
  });

  test('slots 1-6 equal v3 G3 and G5 positions 0-5; slots 7-10 equal v3 G5 positions 6-9', () => {
    const g3 = V3.sets.A.maths['3'].missing.items;
    const g5 = V3.sets.A.maths['5'].missing.items;
    a1.forEach((item, k) => {
      const v3 = g5[k];
      expect([item.item_id, item.seq, item.answer]).toEqual([item.item_id, v3.seq, v3.answer]);
      if (k < 6) expect([item.seq, item.answer]).toEqual([g3[k].seq, g3[k].answer]);
    });
  });

  test('bands follow the bank; no item carries a new tag', () => {
    expect(a1.map((i) => i.band)).toEqual([1, 1, 2, 3, 1, 3, 3, 3, 3, 3]);
    const raw = JSON.stringify(Bank.bankV4().anchor_blocks.A1);
    for (const key of ['"new"', '"tagged_new"', '"is_new"']) expect(raw.includes(key)).toBe(false);
    for (const i of a1) for (const key of ['new', 'tagged_new', 'is_new']) expect(Object.prototype.hasOwnProperty.call(i, key)).toBe(false);
  });

  test('every A1 item reads back as operational, shared, in the check pool', () => {
    for (const { item_id } of a1) {
      const it = Bank.getItemV4(item_id);
      expect([it.form, it.pool, it.status, it.anchor, it.anchor_block]).toEqual(['shared', 'check', 'operational', true, 'A1']);
    }
  });

  test('an unknown block throws', () => {
    expect(() => Bank.anchorBlock('A9')).toThrow(/unknown anchor block/);
    expect(() => Bank.anchorBlock('G1A')).toThrow(/unknown anchor block/);
  });
});

describe('anchor block A2: loads, provisional, never served before 2027-04', () => {
  test('four bigger pairs in order, provisional', () => {
    const a2 = Bank.anchorBlock('A2');
    expect(a2.map((i) => i.item_id)).toEqual(['anchor.A2.01', 'anchor.A2.02', 'anchor.A2.03', 'anchor.A2.04']);
    expect(a2.map((i) => [i.a, i.b, i.answer])).toEqual([[0.7, 0.65, 0.7], [2087, 2078, 2087], [498, 501, 501], [1.25, 1.3, 1.3]]);
    // the bigger scorer compares the picked number with the answer: the answer is the bigger value
    for (const i of [...a2, ...Bank.itemSet('bigger.G3.A'), ...Bank.itemSet('bigger.G5.A')]) expect([i.item_id, i.answer]).toEqual([i.item_id, Math.max(i.a, i.b)]);
    expect(Bank.bankV4().anchor_blocks.A2.status).toBe('provisional');
    expect(Bank.bankV4().anchor_blocks.A2.serve_from_period).toBe('2027-04');
    for (const { item_id } of a2) {
      const it = Bank.getItemV4(item_id);
      expect([it.status, it.anchor, it.anchor_block, it.anchor_block_candidate]).toEqual(['provisional', false, null, 'A2']);
    }
  });

  test('anchorBlocksFor gates A2 on its period', () => {
    expect(Bank.anchorBlocksFor('2026-11')).toEqual(['A1']);
    expect(Bank.anchorBlocksFor('2027-03')).toEqual(['A1']);
    expect(Bank.anchorBlocksFor('2027-04')).toEqual(['A1', 'A2']);
    expect(Bank.anchorBlocksFor('2027-11')).toEqual(['A1', 'A2']);
    expect(() => Bank.anchorBlocksFor('2027-4')).toThrow(/period/);
  });
});

describe('item sets and the G3 rotating items', () => {
  test('bigger.G3.A and bigger.G5.A equal the v3 discrimination items by position', () => {
    for (const g of ['3', '5']) {
      const set = Bank.itemSet(`bigger.G${g}.A`);
      const v3 = V3.sets.A.maths[g].discrimination.items;
      expect(set.map((i) => [i.item_id, i.a, i.b, i.answer])).toEqual(
        v3.map((x, k) => [`bigger.G${g}.A.${String(k + 1).padStart(2, '0')}`, x.a, x.b, x.answer]),
      );
      for (const { item_id } of set) {
        const it = Bank.getItemV4(item_id);
        expect([it.task, it.form, it.pool, it.status]).toEqual(['bigger', `G${g}`, 'check', 'operational']);
      }
    }
    expect(() => Bank.itemSet('bigger.G4.A')).toThrow(/unknown item set/);
  });

  test('the loose items carry their Numbers band (ITEMS §1.2)', () => {
    const band = (id) => Bank.getItemV4(id).band;
    for (const g of ['3', '5']) for (const nn of ['01', '02', '03', '04', '05', '06']) expect([`bigger.G${g}.A.${nn}`, band(`bigger.G${g}.A.${nn}`)]).toEqual([`bigger.G${g}.A.${nn}`, 1]);
    expect(['07', '08', '09', '10'].map((nn) => band(`bigger.G3.A.${nn}`))).toEqual([2, 2, 2, 2]);
    expect(['07', '08', '09', '10'].map((nn) => band(`bigger.G5.A.${nn}`))).toEqual([3, 3, 2, 3]);
    expect(['07', '08', '09', '10'].map((nn) => band(`missing.G3.A.${nn}`))).toEqual([1, 2, 3, 2]);
    expect(seed().itemRows().every((r) => [1, 2, 3].includes(r.band))).toBe(true);
  });

  test('missing.G3.A.07-10 are G3 positions 6-9, operational, not anchors', () => {
    const v3 = V3.sets.A.maths['3'].missing.items.slice(6);
    ['07', '08', '09', '10'].forEach((nn, k) => {
      const it = Bank.getItemV4(`missing.G3.A.${nn}`);
      expect([it.task, it.form, it.pool, it.status, it.anchor]).toEqual(['missing', 'G3', 'check', 'operational', false]);
      expect(it.params).toEqual({ seq: v3[k].seq, ans: v3[k].answer });
    });
    expect(Bank.getItemV4('missing.G3.A.11')).toBeNull();
  });
});

describe('pools are disjoint and params hashes are stable', () => {
  let t;
  beforeAll(() => { t = Bank.templatesV4(); });
  const overlap = (r1, r2) => r1.some(([a, b]) => r2.some(([c, d]) => a <= d && c <= b));

  test('missing: no check step or start range meets a practice one', () => {
    const c = t.check['missing.seq.check'];
    const p = t.practice['missing.seq.practice'];
    expect([c.pool, p.pool]).toEqual(['check', 'practice']);
    expect(c.steps.filter((s) => p.steps.includes(s))).toEqual([]);
    expect(overlap(c.start_ranges, p.start_ranges)).toBe(false);
  });

  test('paramsHash: 16 hex, key order does not matter, values do', () => {
    const h = Bank.paramsHash({ seq: [5, 6, 7, null], ans: 8 });
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(Bank.paramsHash({ ans: 8, seq: [5, 6, 7, null] })).toBe(h);
    expect(Bank.paramsHash({ seq: [5, 6, 7, null], ans: 9 })).not.toBe(h);
    const canon = '{"ans":8,"seq":[5,6,7,null]}';
    expect(h).toBe(crypto.createHash('sha256').update(canon).digest('hex').slice(0, 16));
  });

  test('every seeded item has a unique (params_hash, form); a shared pair repeats only across G3 and G5', () => {
    const rows = seed().itemRows();
    expect(rows).toHaveLength(10 + 4 + 10 + 10 + 4);
    const keys = rows.map((r) => `${r.params_hash}|${r.form}`);
    expect(new Set(keys).size).toBe(keys.length);
    const byHash = new Map();
    for (const r of rows) byHash.set(r.params_hash, [...(byHash.get(r.params_hash) || []), r.item_id]);
    const repeated = [...byHash.values()].filter((ids) => ids.length > 1);
    expect(repeated).toEqual(['01', '02', '03', '04', '05', '06'].map((nn) => [`bigger.G3.A.${nn}`, `bigger.G5.A.${nn}`]));
    for (const r of rows) expect(r.params_hash).toBe(Bank.paramsHash(r.params));
  });
});

describe('the registry seed', () => {
  test('the committed seed SQL equals the generator output', () => {
    expect(fs.readFileSync(SEED_FILE, 'utf8')).toBe(seed().buildSeedSql());
  });

  test('Set A passage rows: hashes and tokens from v3, Urdu titles empty', () => {
    const rows = seed().passageRows();
    expect(rows.map((r) => r.passage_id)).toEqual(['en.read.2.setA', 'ur.read.2.setA', 'en.listen.2.setA', 'ur.listen.2.setA']);
    const text = (l, k) => V3.sets.A.reading[l][k].story.text;
    const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
    expect(rows.map((r) => r.text_hash)).toEqual([h(text('en', 'story')), h(text('ur', 'story')), h(text('en', 'listening')), h(text('ur', 'listening'))]);
    for (const r of rows) {
      expect([r.band, r.pool, r.status, r.is_reference, r.tokens, r.title_ur, r.signed_by]).toEqual([2, 'check', 'calibrated', true, 60, null, null]);
    }
  });

  test('the SQL is idempotent by construction', () => {
    const sql = seed().buildSeedSql();
    const inserts = sql.match(/INSERT INTO/g) || [];
    const guards = sql.match(/ON CONFLICT \([a-z_]+\) DO NOTHING;/g) || [];
    expect(inserts.length).toBe(3);
    expect(guards.length).toBe(3);
  });
});

describe('passages: one file per id, Set A pointers resolve from v3', () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenge-passages-'));
    fs.writeFileSync(path.join(dir, 'en.read.2.setA.json'), JSON.stringify({
      passage_id: 'en.read.2.setA', lang: 'en', kind: 'read', band: 2, pool: 'check', is_reference: true,
      v3_ref: { lang: 'en', kind: 'story' },
      questions_extra: [{ id: 'en.story.q7', prompt: 'Fixture question Testwala?', type: 'literal', needs_line: 2, tap_ok: true, right: 'yes', wrong: ['no', 'maybe'], accept: ['yes'], reject: ['no'] }],
      bank_version: 'child-test-items-v3',
    }));
    fs.writeFileSync(path.join(dir, 'ur.listen.2.setA.json'), JSON.stringify({
      passage_id: 'ur.listen.2.setA', lang: 'ur', kind: 'listen', band: 2, pool: 'check', is_reference: true,
      v3_ref: { lang: 'ur', kind: 'listening' }, questions_extra: [], bank_version: 'child-test-items-v3',
    }));
    fs.writeFileSync(path.join(dir, 'notes.md'), 'not a passage');
  });
  afterAll(() => {
    Bank._loadPassagesFrom();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the shipped stock: one file per unique id, every passage loads frozen, Set A pointers resolve from v3', () => {
    Bank._loadPassagesFrom(); // the shipped directory
    const ids = Bank.listPassages().map((p) => p.passage_id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    // Lower-case slugs, plus the four Set A pointers named after the v3 set ("setA").
    for (const id of ids) expect(id).toMatch(/^(en|ur)\.(read|listen)\.[1-3]\.([a-z0-9]+|setA)$/);

    const shipped = path.join(DATA, 'passages');
    const files = fs.readdirSync(shipped).filter((f) => f.endsWith('.json')).sort();
    expect(files.length).toBe(ids.length);
    for (const f of files) {
      const row = JSON.parse(fs.readFileSync(path.join(shipped, f), 'utf8'));
      expect(`${row.passage_id}.json`).toBe(f);
      const p = Bank.getPassage(row.passage_id);
      expect(p).not.toBeNull();
      expect(Object.isFrozen(p)).toBe(true);
      expect(typeof p.text).toBe('string');
      expect(p.text.length).toBeGreaterThan(0);
      if (row.v3_ref) {
        // A pointer carries what v3 carries: the listening stories have no token count there.
        const v3 = V3.sets.A.reading[row.v3_ref.lang][row.v3_ref.kind === 'story' ? 'story' : 'listening'].story;
        expect(p.tokens).toEqual(v3.tokens == null ? null : v3.tokens);
      } else {
        expect(Number.isInteger(p.tokens) && p.tokens > 0).toBe(true);
      }
    }

    // The Set A pointers: the English ones ship here, the Urdu ones with the Urdu stock; each one present is v3's text.
    const v3Text = { read: (l) => V3.sets.A.reading[l].story.story.text, listen: (l) => V3.sets.A.reading[l].listening.story.text };
    for (const id of ['en.read.2.setA', 'ur.read.2.setA', 'en.listen.2.setA', 'ur.listen.2.setA']) {
      const [lang, kind] = id.split('.');
      const p = Bank.getPassage(id);
      if (lang === 'en') expect(p).not.toBeNull();
      if (p === null) continue;
      expect(Buffer.from(p.text, 'utf8').equals(Buffer.from(v3Text[kind](lang), 'utf8'))).toBe(true);
      expect(p.is_reference).toBe(true);
    }
    // The Urdu Set A listening title: either absent, or a non-empty string of at most 24 code points.
    const t = (Bank.getPassage('ur.listen.2.setA') || {}).title_ur;
    if (t != null) {
      expect(typeof t).toBe('string');
      expect([...t].length).toBeGreaterThan(0);
      expect([...t].length).toBeLessThanOrEqual(24);
    }
  });

  test('a read pointer takes text, tokens, lines and questions from v3 and appends the extra questions', () => {
    Bank._loadPassagesFrom(dir);
    const p = Bank.getPassage('en.read.2.setA');
    const spec = V3.sets.A.reading.en.story;
    expect(p.text).toBe(spec.story.text);
    expect(p.tokens).toEqual(spec.story.tokens);
    expect(p.lines).toEqual(spec.story.lines);
    expect(p.direction).toBe('ltr');
    expect(p.questions.map((q) => q.id)).toEqual([...spec.questions.map((q) => q.id), 'en.story.q7']);
    expect(p.questions.slice(0, 6).map((q) => q.tap_ok)).toEqual([false, false, false, false, false, false]);
    expect(p.questions[0].needs_line).toBe(spec.questions[0].needs_line);
    const extra = p.questions[6];
    expect([extra.needs_line, extra.tap_ok, extra.type]).toEqual([2, true, 'literal']);
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.questions[6])).toBe(true);
  });

  test('a listening pointer resolves; listPassages filters', () => {
    Bank._loadPassagesFrom(dir);
    const p = Bank.getPassage('ur.listen.2.setA');
    expect(p.text).toBe(V3.sets.A.reading.ur.listening.story.text);
    expect(p.direction).toBe('rtl');
    expect(p.questions).toHaveLength(6);
    expect(Bank.listPassages().map((x) => x.passage_id)).toEqual(['en.read.2.setA', 'ur.listen.2.setA']);
    expect(Bank.listPassages({ lang: 'ur' }).map((x) => x.passage_id)).toEqual(['ur.listen.2.setA']);
    expect(Bank.listPassages({ kind: 'read', band: 2, pool: 'check' }).map((x) => x.passage_id)).toEqual(['en.read.2.setA']);
    expect(Bank.listPassages({ band: 1 })).toEqual([]);
  });

  test('a duplicate id across files, or a file named after another id, throws at load', () => {
    const dup = fs.mkdtempSync(path.join(os.tmpdir(), 'challenge-passages-dup-'));
    try {
      const row = { passage_id: 'en.read.1.fixture', lang: 'en', kind: 'read', band: 1, pool: 'check', is_reference: false, text: 'A fixture.', questions: [], bank_version: 'child-test-items-v4' };
      fs.writeFileSync(path.join(dup, 'en.read.1.fixture.json'), JSON.stringify(row));
      fs.writeFileSync(path.join(dup, 'en.read.1.other.json'), JSON.stringify(row));
      expect(() => Bank._loadPassagesFrom(dup)).toThrow(/en\.read\.1\.fixture/);
    } finally {
      fs.rmSync(dup, { recursive: true, force: true });
    }
  });
});
