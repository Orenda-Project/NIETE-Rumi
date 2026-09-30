/**
 * /observe2 — how a coach's live form and the moments they confirm become a level on each of
 * the 17 FICO ICT indicators. Every threshold is read off the level 3 / level 4 descriptors in the
 * impact team's workbook. Where the rubric leaves a count without a level (exactly one instance on
 * C1, C6, D1, D3, D4; D2's "spread"), the rule gives 2 and marks it as a hole for the team to close.
 *
 * Executes the real module; nothing is mocked (it is pure).
 */
const {
  addUp, validate, heardLevels, seenLevels, SEEN_CODES, HEARD_CODES, PICK_CODES,
} = require('../../bot/shared/services/observe/observe2/rules');
const { CODES, MOMENTS, PLAIN, ROW, PRIORITY, CORE } = require('../../bot/shared/services/observe/observe2/fico17');

const lv = (form, code, confirmed = [], counts = {}) => addUp({ form, confirmed, heardCounts: counts })[code];
const moments = (...types) => types.map((type) => ({ type }));

describe('the rubric data', () => {
  test('17 indicators, each in exactly one of the four moments', () => {
    const all = MOMENTS.flatMap((m) => m.codes).sort();
    expect(all).toEqual([...CODES].sort());
    expect(new Set(all).size).toBe(17);
  });
  test('every level phrase and priority fits a WhatsApp option title (30 code points)', () => {
    for (const code of CODES) {
      expect(PLAIN[code]).toHaveLength(4);
      for (const p of PLAIN[code]) expect([...p].length).toBeLessThanOrEqual(30);
      expect([...PRIORITY[code]].length).toBeLessThanOrEqual(30);
      expect(ROW[code]).toBeTruthy();
    }
  });
  test('the core five are C1, C2, C6, D1, D2', () => expect(CORE).toEqual(['C1', 'C2', 'C6', 'D1', 'D2']));
  test('seen, heard and pick rows partition the 17', () => {
    expect([...SEEN_CODES, ...HEARD_CODES, ...PICK_CODES].sort()).toEqual([...CODES].sort());
  });
});

describe('rows the coach sees: combined across the two parts', () => {
  test('D2: 8 children across both parts, 3 new in Part 2 -> 4', () => expect(lv({ p1_spoke: '5', p2_spoke: '7', p2_new: '3' }, 'D2').level).toBe(4));
  test('D2: 6 across both parts, 1 new in Part 2 -> 3', () => expect(lv({ p1_spoke: '5', p2_spoke: '4', p2_new: '1' }, 'D2').level).toBe(3));
  test('D2: 7 children but none in Part 1 is not spread -> 2, a hole', () => {
    const r = lv({ p1_spoke: '0', p2_spoke: '7', p2_new: '7' }, 'D2');
    expect(r.level).toBe(2); expect(r.hole).toBe(true);
  });
  test('D2: 2 children in all -> 1; 4 -> 2', () => {
    expect(lv({ p1_spoke: '2', p2_spoke: '1', p2_new: '0' }, 'D2').level).toBe(1);
    expect(lv({ p1_spoke: '3', p2_spoke: '2', p2_new: '1' }, 'D2').level).toBe(2);
  });
  test('D2: numbers that do not add up give no level', () => {
    const r = lv({ present: '32', p1_spoke: '40' }, 'D2');
    expect(r.level).toBeNull(); expect(r.check).toBe(true);
  });
  test('C3: the higher part counts', () => expect(lv({ p1_picked: 'hands', p2_picked: 'often' }, 'C3').level).toBe(3));
  test('C7: no group work, then groups combining work -> 3', () => expect(lv({ p1_groups: 'none', p2_groups: 'combine' }, 'C7').level).toBe(3));
  test('C7: a room that cannot seat groups -> N/A, even if one part says none', () => {
    expect(lv({ p1_groups: 'cannot', p2_groups: 'cannot' }, 'C7').level).toBe('NA');
    expect(lv({ p1_groups: 'none', p2_groups: 'cannot' }, 'C7').level).toBe('NA');
  });
  test('C8: teacher only, then children used them -> 3; nothing suits the topic -> N/A', () => {
    expect(lv({ p1_materials: 'teacher', p2_materials: 'children' }, 'C8').level).toBe(3);
    expect(lv({ p1_materials: 'nofit', p2_materials: 'nofit' }, 'C8').level).toBe('NA');
  });
  test('D3: the highest tick counts; a single exchange is a hole', () => {
    expect(lv({ p2_groups: 'combine', p2_listen: ['turns', 'often'] }, 'D3').level).toBe(3);
    const r = lv({ p2_groups: 'alone', p2_listen: ['once'] }, 'D3');
    expect(r.level).toBe(2); expect(r.hole).toBe(true);
  });
  test('D3: no group work anywhere -> judged from what Rumi heard, the coach picks', () => {
    const r = lv({ p1_groups: 'none', p2_groups: 'none' }, 'D3');
    expect(r.level).toBeNull(); expect(r.source).toBe('heard');
  });
  test('C5: only parts with a switch count; the weaker switch decides; none -> N/A', () => {
    expect(lv({ p1_change: 'yes', p1_change_how: 'slow', p2_change: 'yes', p2_change_how: 'clear' }, 'C5').level).toBe(2);
    expect(lv({ p1_change: 'no', p2_change: 'no' }, 'C5').level).toBe('NA');
    expect(lv({ p1_change: 'no', p2_change: 'yes', p2_change_how: 'ahead' }, 'C5').level).toBe(4);
  });
  test('seenLevels leaves unanswered rows out', () => expect(seenLevels({})).toEqual({}));
});

describe('rows Rumi hears: counted from the moments the coach confirmed', () => {
  test('C1: two open questions each answered by one child -> 3; one -> a hole; only closed -> 2; none -> 1', () => {
    expect(lv({}, 'C1', moments('open_q_one', 'open_q_one')).level).toBe(3);
    const hole = lv({}, 'C1', moments('open_q_one'));
    expect(hole.level).toBe(2); expect(hole.hole).toBe(true);
    expect(lv({}, 'C1', [], { closed_q: 11 }).level).toBe(2);
    expect(lv({}, 'C1', [], {}).level).toBe(1);
  });
  test('C1 level 4 needs a confirmed probe', () => expect(lv({}, 'C1', moments('open_q_one', 'open_q_one', 'probe')).level).toBe(4));
  test('C2: two reasoned corrections -> 3; a strategy change plus a child fixing it -> 4', () => {
    expect(lv({}, 'C2', moments('wrong_reason', 'wrong_reason')).level).toBe(3);
    expect(lv({}, 'C2', moments('wrong_reason', 'wrong_reason', 'strategy', 'wrong_fixed')).level).toBe(4);
  });
  test('C2: wrong answers left without a reason -> 1; no wrong answers at all -> the coach picks', () => {
    expect(lv({}, 'C2', moments('wrong_ignored')).level).toBe(1);
    expect(lv({}, 'C2', []).level).toBeNull();
  });
  test('C6: two pieces of praise for effort -> 3; one -> a hole; generic only -> 2; ridicule forces 1', () => {
    expect(lv({}, 'C6', moments('praise_effort', 'praise_effort')).level).toBe(3);
    expect(lv({}, 'C6', moments('praise_effort')).hole).toBe(true);
    expect(lv({}, 'C6', [], { praise_generic: 4 }).level).toBe(2);
    expect(lv({ incident: 'ridicule' }, 'C6', moments('praise_effort', 'praise_effort')).level).toBe(1);
  });
  test('D1: two children explaining why -> 3; one -> a hole; a longer answer only -> 2; nothing longer than a phrase -> 1', () => {
    expect(lv({}, 'D1', moments('reasoning', 'reasoning')).level).toBe(3);
    expect(lv({}, 'D1', moments('reasoning')).hole).toBe(true);
    expect(lv({}, 'D1', moments('long_answer')).level).toBe(2);
    expect(lv({}, 'D1', []).level).toBe(1);
  });
  test('D4: two unsure attempts -> 3; one -> a hole; none -> the coach picks', () => {
    expect(lv({}, 'D4', moments('hedged', 'hedged')).level).toBe(3);
    expect(lv({}, 'D4', moments('hedged')).hole).toBe(true);
    expect(lv({}, 'D4', []).level).toBeNull();
  });
  test('D5: one content question -> 3; two with one beyond the lesson -> 4; procedural only -> 2; none -> 1', () => {
    expect(lv({}, 'D5', moments('content_q')).level).toBe(3);
    expect(lv({}, 'D5', moments('content_q', 'content_q', 'beyond_q')).level).toBe(4);
    expect(lv({}, 'D5', moments('proc_q')).level).toBe(2);
    expect(lv({}, 'D5', []).level).toBe(1);
  });
  test('C4: a real choice acted on -> 3; nothing confirmed -> the coach picks', () => {
    expect(lv({}, 'C4', moments('choice')).level).toBe(3);
    expect(lv({}, 'C4', []).level).toBeNull();
  });
  test('a failed recording makes every heard row IE, never 1', () => {
    const out = addUp({ form: { incident: 'tech' }, confirmed: [], heardCounts: {} });
    for (const code of HEARD_CODES) expect(out[code].level).toBe('IE');
  });
  test('heardLevels gives all seven heard rows', () => expect(Object.keys(heardLevels([], {})).sort()).toEqual([...HEARD_CODES].sort()));
});

describe('subject knowledge and overrides', () => {
  test('F1-F4 have no rule yet: the coach picks', () => {
    for (const code of ['F1', 'F2', 'F3', 'F4']) expect(lv({}, code).level).toBeNull();
  });
  test('a wrong fact left standing forces F1 = 1', () => expect(lv({ incident: 'error' }, 'F1').level).toBe(1));
  test('all 17 always get a result', () => expect(Object.keys(addUp({ form: {}, confirmed: [], heardCounts: {} })).sort()).toEqual([...CODES].sort()));
});

describe('the checks the server runs when a part is saved', () => {
  const P1 = { present: '32', p1_spoke: '5', p1_picked: 'once', p1_groups: 'none', p1_materials: 'teacher', p1_change: 'no' };
  const P2 = { ...P1, p2_spoke: '7', p2_new: '3', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['often'], p2_materials: 'teacher', p2_change: 'yes', p2_change_how: 'clear' };
  test('complete parts pass', () => {
    expect(validate('PART_ONE', P1)).toEqual({});
    expect(validate('PART_TWO', P2)).toEqual({});
  });
  test('children present is required and sane', () => {
    expect(validate('PART_ONE', { ...P1, present: '' }).present).toBeTruthy();
    expect(validate('PART_ONE', { ...P1, present: '0' }).present).toBeTruthy();
  });
  test('more children spoke than are present fails, naming the number present', () => expect(validate('PART_ONE', { ...P1, p1_spoke: '40' }).p1_spoke).toMatch(/32/));
  test('group work needs a tick or a note', () => {
    expect(validate('PART_ONE', { ...P1, p1_groups: 'combine', p1_listen: [] }).p1_listen).toBeTruthy();
    expect(validate('PART_ONE', { ...P1, p1_groups: 'combine', p1_listen: [], p1_listen_other: 'Drew it together' })).toEqual({});
  });
  test('a switch of activity needs how it went', () => expect(validate('PART_ONE', { ...P1, p1_change: 'yes' }).p1_change_how).toBeTruthy());
  test('new voices cannot exceed Part 2 speakers, or the children still quiet after Part 1', () => {
    expect(validate('PART_TWO', { ...P2, p2_new: '8' }).p2_new).toBeTruthy();
    expect(validate('PART_TWO', { ...P2, present: '10', p1_spoke: '8', p2_spoke: '5', p2_new: '4' }).p2_new).toMatch(/2/);
  });
  test('sealing needs a priority and the seal ticked; an incident needs what happened', () => {
    const e = validate('AFTER', { incident: 'none', lp: 'used' });
    expect(e.priority).toBeTruthy(); expect(e.seal_ok).toBeTruthy();
    expect(validate('AFTER', { incident: 'ridicule', lp: 'used', priority: 'C6', seal_ok: true }).detail).toBeTruthy();
  });
});
