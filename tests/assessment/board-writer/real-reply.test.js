'use strict';
/**
 * bd-5jmnfj.38.30: the board writer read only a tree shape the board prompt never asked for, so every real
 * reply came back 0 per slot and every G9-12 paper failed PATTERN_SHORT_SLOT. These tests feed the writer the
 * model's real Section A reply (G9 Physics ch2, sandbox capture, names made generic). No network.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const { leavesOf } = require(`${A}board-6-12/tree`);
const { promptFor } = require(`${A}prompts-6-12`);
const ssc1 = require(`${A}patterns/board/fbise-ssc1`);
const { makeDeps, buildReply } = require('./helpers/fake-deps');
const CAPTURED = require('./fixtures/physics-section-a.reply.json').reply;

const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const P = ssc1.subjects.physics;
const variant = P.variants.find((v) => v.variant_id === '50pct');
const row = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
const copy = (x) => JSON.parse(JSON.stringify(x));
// The same items, keyed the way the board format asks: one list per slot id.
const BY_SLOT = { 'A.Q1-40': CAPTURED.objective.MCQ, 'A.Q41-60': CAPTURED.objective['Scenario MCQ'], notes: CAPTURED.notes };

// firstOnly: the captured reply answers the first Section A ask; a later ask (the repair round) gets the fake builder.
// skipN18: the real board checks, minus N18 key-leak (the one content check this real text trips at scale).
async function write(sectionA, { firstOnly = false, skipN18 = false, spy = null } = {}) {
  let served = false;
  const reply = (section) => {
    if (section.id !== 'A' || (firstOnly && served)) return undefined;
    served = true;
    return copy(sectionA);
  };
  const { d, calls } = makeDeps({ grade: 9, row, levels: variant.cognitive_split.levels, style: variant.scheme_style, reply });
  // As the service does: code writes the official SLO onto the tag.
  d.stampSlo = (g, s, item) => { if (item && item.tag) item.tag.official_slo = null; return item; };
  if (spy) { const real = d.checks; d.checks = { ...real, run: (ex, ctx) => { const r = real.run(ex, ctx); spy(r); return r; } }; }
  if (skipN18) {
    const real = d.checks;
    d.checks = { ...real, run: (ex, ctx) => {
      const r = real.run(ex, ctx);
      return { ...r, shortfall: r.shortfall.filter((x) => x.reason !== 'N18') };
    } };
  }
  const out = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'fbise_ssc1_2027', P, variant }, d).catch((e) => e);
  return { out, calls };
}

describe('board writer on the real Section A reply', () => {
  test('the first pass reads all 60 real items into their slots: no section top-up', async () => {
    const T = require(`${A}board-6-12/tree`);
    const tree = T.fromReply(copy(BY_SLOT), variant.sections.find((s) => s.id === 'A').slots);
    expect(T.shortfallOf(tree, variant.sections.find((s) => s.id === 'A').slots)).toEqual([]);
    expect(tree.unseen.objective.mcq).toHaveLength(40);
    expect(tree.unseen.objective.scenario).toHaveLength(5);
  });

  test('a reply keyed by slot id becomes a whole paper: 40 MCQs, 5 groups of 4 scenario items, the preset kept', async () => {
    // Real text, real checks minus N18. Its one D16 numeric mismatch is dropped and asked again in the repair
    // round (the writer's job), so the first ask is never topped up and the paper completes.
    const { out, calls } = await write(BY_SLOT, { firstOnly: true, skipN18: true });
    expect(out.code).toBeUndefined();
    const leaves = leavesOf(out.examJson);
    expect(leaves.filter((l) => l.type === 'mcq' && String(l.id).startsWith('A.Q1-40#'))).toHaveLength(40);
    const scen = leaves.filter((l) => String(l.id).startsWith('A.Q41-60#'));
    expect(scen).toHaveLength(20);
    scen.forEach((l) => expect(l.type).toBe('scenario'));
    const groups = [];
    JSON.stringify(out.examJson, (k, v) => { if (v && v.slot === 'A.Q41-60' && v.stimulus && Array.isArray(v.stimulus.items)) groups.push(v); return v; });
    expect(groups).toHaveLength(5);
    groups.forEach((g) => { expect(g.stimulus.text).toMatch(/\w{3,}/); expect(g.stimulus.items).toHaveLength(4); });
    expect(calls.filter((c) => c.section === 'A')[0].topUp).toBe(false);
    expect(out.examJson._layout.preset_id).toBe('fbise_ssc1_2027');
  });

  test('with every check on, the first pass of this real reply trips only N18 stem overlap: no D13, D16 or options-only N18', async () => {
    // Before bd-5jmnfj.38.30 part 2 the first pass also failed D13 (a run of 4 B keys, unsorted numeric options),
    // D16 (the ^2 in "4 m/s^2" read as the key number) and N18 on keys that sat only in another MCQ's options.
    // What is left is a key repeated in another item's stem, which the board ruling still counts as a leak.
    const runs = [];
    const { out } = await write(BY_SLOT, { firstOnly: true, spy: (r) => runs.push(r) });
    const first = runs[0].record.per_check;
    expect(first['mcq-shape'] || first.D13).toMatchObject({ hard: 0 });
    expect(first['numeric-resolve'] || first.D16).toMatchObject({ hard: 0 });
    expect((first['key-leak'] || first['N18/N19']).hard).toBeLessThanOrEqual(15);
    if (out.shortfall) out.shortfall.forEach((r) => expect(r.reason).toBe('N18'));
  });

  test('the old category/type shape is never guessed into slots: it is short and fails by name', async () => {
    const { out } = await write(CAPTURED);
    expect(out.code).toBe('PATTERN_SHORT_SLOT');
    expect(out.shortfall).toEqual([{ slot: 'A.Q1-40', have: 0, need: 40 }, { slot: 'A.Q41-60', have: 0, need: 20 }]);
  });
});

describe('the board format and the parser agree', () => {
  const format = promptFor('eg.format.secondary');
  test('the format asks for one list per slot id, not category/type keys', () => {
    expect(format).toContain('"<slot id>": [ <item>, ... ]');
    expect(format).not.toContain('"<category>"');
  });
  test('the format names the stimulus and OR shapes the parser reads', () => {
    expect(format).toContain('{"stimulus": "<text or plain-text table printed once>", "items": [');
    expect(format).toContain('{"or": [<item>, <item>]}');
  });
  test('the scheme is the shape D14 reads: points with marks, or contiguous bands', () => {
    expect(format).toContain('"scheme": {"points": [{"text": "<marking point>", "marks": <number>}');
    expect(format).toContain('{"bands": [{"hi": <number>, "lo": <number>, "descriptor": "<text>"}');
    expect(format).not.toContain('a list of marking points');
  });
  test('the tag code is copied from CURRICULUM CODES; no G9-12 prompt sends the model to an undefined book form', () => {
    expect(format).toContain('"code": "<the CODE copied exactly from CURRICULUM CODES>"');
    const all = require('../../../bot/shared/services/assessment/ict-prompts.json');
    const g912 = Object.keys(all).filter((k) => /^eg\.ict\..+\.(9_10|11_12)\.system$/.test(k));
    expect(g912).toHaveLength(20);
    g912.forEach((k) => expect([k, /book outcome/.test(all[k])]).toEqual([k, false]));
  });
});

// Live a1 (sandbox, G9 Physics ch2): Section B (6 srq, each with an internal OR) came back 5/6, the top-up's sixth OR
// question was dropped by the G1-2 text-keyed top-up, and the paper failed PATTERN_SHORT_SLOT on B.Q1-6.
describe('an internal-OR section topped up', () => {
  test('the top-up OR question is kept and the paper completes, without the G1-2 top-up', async () => {
    const ctx = { grade: 9, row, levels: variant.cognitive_split.levels, style: variant.scheme_style };
    const orOf = (q) => ({ or: [q, { ...q, question: `${q.question} Explain in another way.` }] });
    const reply = (section, n, topUp, state) => {
      if (section.id !== 'B') return undefined;
      const full = buildReply(section.slots, ctx, state);
      const list = full['B.Q1-6'].map(orOf);
      return { ...full, 'B.Q1-6': topUp ? list.slice(0, 1) : list.slice(0, 5) }; // round 4: the top-up is asked for 2, writes 1
    };
    const { d, calls } = makeDeps({ ...ctx, reply });
    d.topUp = () => { throw new Error('the board writer must not use the G1-2 top-up'); };
    const out = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'fbise_ssc1_2027', P, variant }, d).catch((e) => e);
    expect(out.message).toBeUndefined();
    expect(calls.filter((c) => c.section === 'B').map((c) => c.topUp)).toEqual([false, true]);
    const ors = [];
    JSON.stringify(out.examJson.unseen, (k, v) => { if (v && v.slot === 'B.Q1-6' && Array.isArray(v.or)) ors.push(v); return v; });
    expect(ors).toHaveLength(6);
  });
});
