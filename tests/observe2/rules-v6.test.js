/**
 * /observe2 — the FICO17 v6 rule set (spec §8.3-8.6; CONTRACTS §4.2, §5).
 *
 * On a v6 visit the moments set ten rows (C1 C2 C4 C6 C8 D1 D5 F2 F3 F4) and F1; the coach sets the six
 * combined rows (C3 C5 C7 D2 D3 D4) in the room, so the rules give those `level: null` and only a hidden
 * `dc_result`: what the transcript alone supports. The form's own answers for C3/C5/C7/C8/D2/D3 are room
 * notes and never a level. The N/A links (C1 = 1 → C3, D4) are applied once at Submit by `applyNaLinks`.
 * A v5 visit is untouched (tests/observe2/v5-regression.test.js).
 *
 * The §10.1 table is rewritten for the type ids on this code (there is no `harsh`, `child_why` or
 * `child_link`): CONTRACTS §4.2. Executes the real module; nothing is mocked (it is pure).
 */
const rules = require('../../bot/shared/services/observe/observe2/rules');
const { CODES } = require('../../bot/shared/services/observe/observe2/fico17');

const {
  addUp, heardLevels, applyNaLinks,
  HEARD_CODES_V6, COMBINED_CODES_V6, PICK_CODES_V6, SEEN_CODES_V6, ADDS, ADDS_V6, HEARD_RULES, HEARD_RULES_V6,
} = rules;

const V6 = 'fico17_v6';
const moments = (...types) => types.map((type, i) => ({ id: `m${i + 1}`, type }));
const six = (form = {}, confirmed = [], heardCounts = {}, transcriptQuality = null) => addUp({
  form, confirmed, heardCounts, rubric: V6, transcriptQuality,
});
const lv = (code, confirmed = [], form = {}, counts = {}) => six(form, confirmed, counts)[code];

describe('the v6 code lists (spec §8.3)', () => {
  test('ten heard rows, F1 inside addUp, six combined, nothing picked, nothing from the form', () => {
    expect(HEARD_CODES_V6).toEqual(['C1', 'C2', 'C4', 'C6', 'C8', 'D1', 'D5', 'F2', 'F3', 'F4']);
    expect(COMBINED_CODES_V6).toEqual(['C3', 'C5', 'C7', 'D2', 'D3', 'D4']);
    expect(PICK_CODES_V6).toEqual([]);
    expect(SEEN_CODES_V6).toEqual([]);
    expect([...HEARD_CODES_V6, 'F1', ...COMBINED_CODES_V6].sort()).toEqual([...CODES].sort());
  });
  test('the §8.2 types and the F2/F4 types count on v6; v5 ADDS keeps its own entries only', () => {
    for (const t of ['resource_shown', 'resource_used', 'resource_explained', 'why_handed', 'child_builds_link',
      'term_not_explained', 'child_used_term', 'link_mentioned']) {
      expect(ADDS_V6[t]).toEqual([t]);
      expect(ADDS[t]).toBeUndefined();
    }
    for (const [t, keys] of Object.entries(ADDS)) expect(ADDS_V6[t]).toEqual(keys);
  });
  test('the v5 rule functions are reused for C1 C2 C4 C6 D1 D4 D5; C8 F2 F3 F4 are new', () => {
    for (const code of ['C1', 'C2', 'C4', 'C6', 'D1', 'D4', 'D5']) expect(HEARD_RULES_V6[code]).toBe(HEARD_RULES[code]);
    for (const code of ['C8', 'F2', 'F3', 'F4']) {
      expect(typeof HEARD_RULES_V6[code]).toBe('function');
      expect(HEARD_RULES[code]).toBeUndefined();
    }
  });
  test('all 17 codes always get a result, on an empty visit and on a full one', () => {
    expect(Object.keys(six()).sort()).toEqual([...CODES].sort());
    const full = six({ incident: 'tech' }, moments('open_q_one', 'resource_used'), { closed_q: 3 }, { status: 'broken' });
    expect(Object.keys(full).sort()).toEqual([...CODES].sort());
  });
});

describe('the §10.1 v6 rules table, rewritten for the real ids (CONTRACTS §4.2)', () => {
  test('2 open_q_one + probe -> C1 4', () => expect(lv('C1', moments('open_q_one', 'open_q_one', 'probe')).level).toBe(4));
  test('2 open_q_one, no probe -> C1 3', () => expect(lv('C1', moments('open_q_one', 'open_q_one')).level).toBe(3));
  test('1 open_q_one -> C1 2, a hole', () => {
    const r = lv('C1', moments('open_q_one'));
    expect(r.level).toBe(2); expect(r.hole).toBe(true);
  });
  test('choice -> C4 3', () => expect(lv('C4', moments('choice')).level).toBe(3));
  test('resource_shown only -> C8 2', () => {
    const r = lv('C8', moments('resource_shown'));
    expect(r).toEqual({ level: 2, because: 'resources were only shown by the teacher', source: 'heard' });
  });
  test('resource_used x1 -> C8 3', () => {
    expect(lv('C8', moments('resource_used'))).toEqual({
      level: 3, because: 'children used a resource and it was linked to the idea', source: 'heard',
    });
  });
  test('resource_used + resource_explained -> C8 4, the reasons joined as up() does', () => {
    expect(lv('C8', moments('resource_used', 'resource_explained'))).toEqual({
      level: 4,
      because: 'children used a resource and it was linked to the idea, and a child explained with it and the teacher built on it',
      source: 'heard',
    });
  });
  test('nothing -> C8 1', () => expect(lv('C8').level).toBe(1));
  test('2 reasoning -> D1 3', () => expect(lv('D1', moments('reasoning', 'reasoning')).level).toBe(3));
  test('long_answer only -> D1 2', () => expect(lv('D1', moments('long_answer')).level).toBe(2));
  test('2 why_explained + why_handed -> F3 4', () => expect(lv('F3', moments('why_explained', 'why_explained', 'why_handed')).level).toBe(4));
  test('2 why_explained, no why_handed -> F3 3', () => expect(lv('F3', moments('why_explained', 'why_explained')).level).toBe(3));
  test('1 why_explained -> F3 2; none -> F3 1', () => {
    expect(lv('F3', moments('why_explained')).level).toBe(2);
    expect(lv('F3').level).toBe(1);
  });
  test('2 term_defined + child_used_term -> F2 4', () => expect(lv('F2', moments('term_defined', 'term_defined', 'child_used_term')).level).toBe(4));
  test('2 term_defined -> F2 3', () => expect(lv('F2', moments('term_defined', 'term_defined')).level).toBe(3));
  test('1 term_defined, or term_not_explained only -> F2 2; none -> F2 1', () => {
    expect(lv('F2', moments('term_defined')).level).toBe(2);
    expect(lv('F2', moments('term_not_explained')).level).toBe(2);
    expect(lv('F2').level).toBe(1);
  });
  test('life_link + child_builds_link -> F4 4', () => expect(lv('F4', moments('life_link', 'child_builds_link')).level).toBe(4));
  test('life_link + beyond -> F4 3, and D1 counts the beyond (4 once D1 is at 3)', () => {
    const out = six({}, moments('life_link', 'beyond', 'reasoning', 'reasoning'));
    expect(out.F4.level).toBe(3);
    expect(out.D1.level).toBe(4);
    expect(lv('D1', moments('life_link', 'beyond')).level).toBe(1);
  });
  test('link_mentioned only -> F4 2; none -> F4 1', () => {
    expect(lv('F4', moments('link_mentioned'))).toEqual({ level: 2, because: 'a link was mentioned, not explained', source: 'heard' });
    expect(lv('F4').level).toBe(1);
  });
  test("3 praise_effort + incident 'ridicule' -> C6 1", () => {
    expect(lv('C6', moments('praise_effort', 'praise_effort', 'praise_effort'), { incident: 'ridicule' }).level).toBe(1);
    expect(lv('C6', moments('praise_effort', 'praise_effort', 'praise_effort')).level).toBe(3);
  });
  test('C1 = 1, coach set C3 = 2 -> C3 stays 2, na_link_conflict', () => {
    const out = applyNaLinks({ C1: { level: 1 }, C3: { level: 2, because: 'named two children', source: 'coach' } }, new Set(['C3']));
    expect(out.C3).toEqual({ level: 2, because: 'named two children', source: 'coach', na_link_conflict: true });
  });
  test('C1 = 1, D4 not coach-set -> D4 NA', () => {
    const out = applyNaLinks({ C1: { level: 1 }, D4: { level: null, because: 'x', source: 'coach' } });
    expect(out.D4).toEqual({ level: 'NA', because: 'no questions, so nobody could be chosen or try', source: 'pipeline' });
  });
});

describe('the combined rows: no level from the rules, only the hidden dc_result (spec §8.4, Q1)', () => {
  test('every combined row has level null; D2 has no dc_result', () => {
    const out = six({}, moments('hedged', 'hedged', 'unprompted'));
    for (const code of COMBINED_CODES_V6) expect(out[code].level).toBeNull();
    expect(out.D2).not.toHaveProperty('dc_result');
  });
  test('D4 dc_result from hedged / unprompted, as the v5 D4 rule counts them', () => {
    expect(lv('D4', moments('hedged', 'hedged', 'unprompted')).dc_result).toBe(4);
    expect(lv('D4', moments('hedged', 'hedged')).dc_result).toBe(3);
    expect(lv('D4', moments('hedged')).dc_result).toBe(2);
    expect(lv('D4').dc_result).toBeNull();
  });
  test('C3, C5, C7, D3: dc_result null (no counting rule on the transcript)', () => {
    const out = six({}, moments('open_q_one', 'open_q_one', 'hedged'));
    for (const code of ['C3', 'C5', 'C7', 'D3']) {
      expect(out[code]).toHaveProperty('dc_result');
      expect(out[code].dc_result).toBeNull();
    }
  });
  test("the form's room answers never set a combined row or C8 on v6", () => {
    const form = {
      fv: '6', present: '30', p1_spoke: '6', p2_spoke: '8', p2_new: '3', p1_picked: 'varied', p1_groups: 'roles',
      p1_listen: ['agreed'], p1_materials: 'explain', p1_used: ['book'], p1_change: 'yes', p1_change_how: 'ahead',
      p2_task: 'all', p2_stuck: 'kept', p2_teacher: ['cfu'],
    };
    const out = six(form);
    for (const code of COMBINED_CODES_V6) expect(out[code].level).toBeNull();
    expect(out.C8).toEqual({ level: 1, because: 'no book, board, chart or object was mentioned', source: 'heard' });
    expect(out.D4.dc_result).toBeNull();
  });
  test('the board counts as a resource: one resource_shown moment is C8 2 whatever the form said', () => {
    expect(lv('C8', moments('resource_shown'), { p1_materials: 'none' }).level).toBe(2);
    expect(lv('C8', moments('resource_shown'), { p1_materials: 'nofit' }).level).toBe(2);
  });
});

describe('moments from the coach and from the form', () => {
  test("a coach-added moment (source 'coach', confirmed) counts like a found one", () => {
    const confirmed = [{ id: 'm1', type: 'resource_used' }, { id: 'missed_1', type: 'resource_explained', source: 'coach', confirmed: true }];
    expect(lv('C8', confirmed).level).toBe(4);
  });
  test("the form's think ticks still count on v6 (R13): why/new toward D1, ownq toward D5, apply is D1's level 4", () => {
    expect(lv('D1', moments('reasoning'), { p2_think: ['why'] }).level).toBe(3);
    expect(lv('D1', moments('reasoning'), { p2_think: ['why', 'apply'] }).level).toBe(4);
    expect(lv('D5', [], { p2_think: ['ownq'] }).level).toBe(3);
  });
  test('the think ticks are named on D1, D5, F3 and F4', () => {
    const out = six({ p2_think: ['why', 'ownq', 'apply'] });
    for (const code of ['D1', 'D5', 'F3', 'F4']) expect(out[code].because).toMatch(/you saw in Part 2, children/);
  });
});

describe('F1 on v6: no pick, the coach\'s incident answer and the content_error moment govern it', () => {
  test("incident 'error' -> F1 1", () => expect(lv('F1', [], { incident: 'error' }).level).toBe(1));
  test('a confirmed content_error -> F1 1; nothing wrong confirmed -> F1 3 (Appendix B: "Neither -> 3")', () => {
    expect(lv('F1', moments('content_error'))).toMatchObject({ level: 1, source: 'heard' });
    expect(lv('F1')).toMatchObject({ level: 3, source: 'heard' });
  });
  test('no row is ever source pick on v6', () => {
    for (const r of Object.values(six())) expect(r.source).not.toBe('pick');
  });
});

describe("a recording that can't be used: transcript broken, or the coach said it failed (spec §6.3, §8.4)", () => {
  const momentRows = () => [...(HEARD_CODES_V6 || []), 'F1'];
  const lots = moments('open_q_one', 'open_q_one', 'probe', 'resource_used', 'why_explained', 'why_explained',
    'term_defined', 'life_link', 'praise_effort', 'praise_effort', 'reasoning', 'reasoning', 'content_q', 'choice', 'hedged', 'hedged');
  test.each([
    ['broken transcript', {}, { status: 'broken', coverage: 0.2, issues: [{ type: 'loop', from: '12:00', to: '40:00' }] }],
    ["incident 'tech'", { incident: 'tech' }, null],
  ])('%s: every moment row is IE, never 1', (name, form, q) => {
    const out = six(form, lots, { closed_q: 9 }, q);
    for (const code of momentRows()) expect(out[code]).toEqual({ level: 'IE', because: expect.any(String), source: 'heard' });
  });
  test('combined rows stay for the coach: level null, dc_result IE (D2: none)', () => {
    const out = six({}, lots, {}, { status: 'broken', issues: [] });
    for (const code of COMBINED_CODES_V6) expect(out[code].level).toBeNull();
    for (const code of ['C3', 'C5', 'C7', 'D3', 'D4']) expect(out[code].dc_result).toBe('IE');
    expect(out.D2).not.toHaveProperty('dc_result');
  });
  test("exceptions: ridicule -> C6 1, error -> F1 1, on broken and on 'tech'", () => {
    expect(six({ incident: 'ridicule' }, lots, {}, { status: 'broken', issues: [] }).C6.level).toBe(1);
    expect(six({ incident: 'error' }, lots, {}, { status: 'broken', issues: [] }).F1.level).toBe(1);
    // incident is one answer: on 'tech' neither exception can be reported, and both rows are IE.
    const tech = six({ incident: 'tech' }, lots);
    expect(tech.C6.level).toBe('IE'); expect(tech.F1.level).toBe('IE');
  });
  test('the think ticks the coach saw still set D1/D5 when the recording failed, as on v5', () => {
    const out = six({ incident: 'tech', p2_think: ['why', 'ownq'] }, lots);
    expect(out.D1.level).toBe(2);
    expect(out.D5.level).toBe(3);
    expect(out.C1.level).toBe('IE');
  });
  test('a partial transcript scores normally', () => {
    const out = six({}, moments('resource_used'), {}, { status: 'partial', issues: [{ type: 'short', from: '24:00' }] });
    expect(out.C8.level).toBe(3);
    expect(out.D4.dc_result).toBeNull();
  });
});

describe('heardLevels on v6 (rumi_levels, spec §8.5)', () => {
  test('the ten heard rows + F1 from the moments, and dc_result for five combined rows (D2: none)', () => {
    const out = heardLevels(moments('resource_used', 'hedged', 'hedged'), {}, [], { rubric: V6 });
    expect(Object.keys(out).sort()).toEqual([...CODES].sort());
    expect(out.C8.level).toBe(3);
    expect(out.F1.level).toBe(3);
    expect(out.D4).toMatchObject({ level: null, dc_result: 3 });
    expect(out.D2.level).toBeNull();
    expect(out.D2).not.toHaveProperty('dc_result');
  });
  test('heardLevels equals the moment rows addUp gives on an empty form', () => {
    const confirmed = moments('open_q_one', 'open_q_one', 'resource_shown', 'why_explained', 'hedged');
    const heard = heardLevels(confirmed, { closed_q: 2 }, [], { rubric: V6 });
    const all = six({}, confirmed, { closed_q: 2 });
    for (const code of CODES) expect(heard[code]).toEqual(all[code]);
  });
  test('without a rubric it is the v5 seven, exactly as before', () => {
    expect(Object.keys(heardLevels([], {})).sort()).toEqual(['C1', 'C2', 'C4', 'C6', 'D1', 'D4', 'D5']);
  });
});

describe('applyNaLinks (spec §8.4 N/A links; Q7; CONTRACTS §5)', () => {
  const NA = { level: 'NA', because: 'no questions, so nobody could be chosen or try', source: 'pipeline' };
  test("C1 = 1 (number or '1'): C3 and D4 not coach-set -> NA", () => {
    for (const one of [1, '1']) {
      const out = applyNaLinks({ C1: { level: one }, C3: { level: 2 }, D4: { level: 3, dc_result: 3 } });
      expect(out.C3).toEqual(NA);
      expect(out.D4).toEqual({ ...NA, dc_result: 3 });
    }
  });
  test('C1 = 1 and a missing C3/D4 row: created as NA', () => {
    const out = applyNaLinks({ C1: { level: 1 } });
    expect(out.C3).toEqual(NA); expect(out.D4).toEqual(NA);
  });
  test('C1 = 1, both coach-set: both kept, both flagged na_link_conflict', () => {
    const levels = { C1: { level: 1 }, C3: { level: 3, source: 'coach' }, D4: { level: 'NA', source: 'coach' } };
    const out = applyNaLinks(levels, new Set(['C3', 'D4']));
    expect(out.C3).toEqual({ level: 3, source: 'coach', na_link_conflict: true });
    expect(out.D4).toEqual({ level: 'NA', source: 'coach', na_link_conflict: true });
  });
  test('C1 above 1, NA, IE or missing: nothing changes, the same row objects come back', () => {
    for (const c1 of [{ level: 2 }, { level: 'NA' }, { level: 'IE' }, { level: null }, undefined]) {
      const levels = { C1: c1, C3: { level: 2 }, D4: { level: 3 } };
      if (!c1) delete levels.C1;
      const out = applyNaLinks(levels, new Set(['C3']));
      expect(out).toEqual(levels);
      expect(out.C3).toBe(levels.C3); expect(out.D4).toBe(levels.D4);
      expect(out.C3).not.toHaveProperty('na_link_conflict');
    }
  });
  test('pure: the input map and its rows are never changed; coachSet may be an array', () => {
    const levels = { C1: { level: 1 }, C3: { level: 2 }, D4: { level: 2 } };
    const before = JSON.stringify(levels);
    const out = applyNaLinks(levels, ['C3']);
    expect(JSON.stringify(levels)).toBe(before);
    expect(out).not.toBe(levels);
    expect(out.C3.na_link_conflict).toBe(true);
    expect(out.D4.level).toBe('NA');
  });
});
