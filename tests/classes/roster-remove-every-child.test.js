/**
 * /class ROSTER: a teacher must be able to remove ANY child, not just the first 20.
 * (bd-a6mhn)
 *
 * Field report, 29 Sep 2026, from a coach's video: a teacher wants to strike off
 * "number 33" from her class and the remove checklist stops at 20 names. She is not
 * scrolling past a boundary — child 33 is not on the screen at all.
 *
 * Cause: `buildRosterScreen()` did `students.slice(0, 20)` into ONE CheckboxGroup.
 * Meta really does cap a single CheckboxGroup at 20 options, so the slice was legal —
 * but it is always the first 20 BY ROLL, so the only way to reach child 33 is to
 * delete the twenty children in front of her first. The comment in the file used to
 * defend the cap as costing "a second pass"; there is no second pass to take.
 *
 * Scale, measured read-only against ICT production on 2026-09-29: 2,303 active
 * classes, 1,769 of them over 20 children, 32,352 children sitting past roll 20, and
 * the biggest class in the deployment at 88. Nothing is over 100.
 *
 * The fix is consecutive CheckboxGroups of 20 on the SAME screen — remove1..remove5,
 * 100 options, each visibility-gated so an empty group never renders (an empty
 * `data-source` is what made this screen fail to draw at all in bd-2731).
 *
 * These tests drive the REAL endpoint through the real data path (fake Supabase at
 * the network boundary), so they execute buildRosterScreen() and the ROSTER submit
 * branch rather than a helper standing in for them.
 *
 * Names here are invented. The class in the video is real and its children are not
 * ours to copy into a fixture.
 */

const fs = require('fs');
const path = require('path');
const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const TEACHER = 'teacher-uuid-1';
const SCHOOL = 'school-uuid-1';
const CLASS_ID = 'class-uuid-1';

// Meta's documented caps, in CODE POINTS.
// https://developers.facebook.com/docs/whatsapp/flows/reference/components
const GROUP_LABEL_CAP = 30;   // CheckboxGroup `label`
const ITEM_TITLE_CAP = 30;    // a data-source item `title`
const CAPTION_CAP = 409;      // TextCaption `text` — the hint sits in one

const GROUPS = 5;
const PER_GROUP = 20;
const TOTAL = GROUPS * PER_GROUP;

const cp = (s) => [...String(s)].length;

const REF = {
  grade_levels: [{ code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4'], sort_order: 4, is_active: true }],
  subjects: [{ code: 'maths', parent_code: null, aliases: ['maths'], is_active: true }],
  academic_sessions: [
    { code: '2026-2027', kind: 'annual', starts_on: '2026-08-01', ends_on: '2027-07-31', is_active: true },
  ],
  sections: [{ code: 'A', sort_order: 1, is_active: true }],
  shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
};

let ep;
function boot({ students = [], enrollments = [], language = 'en' } = {}) {
  jest.resetModules();
  mockDb = createFakeSupabase({
    users: [{ id: TEACHER, school_id: SCHOOL, preferred_language: language }],
    ...REF,
    classes: [{
      id: CLASS_ID, school_id: SCHOOL, grade_code: 'grade_4', section: 'A',
      shift_code: 'morning', session_code: '2026-2027', is_active: true,
    }],
    class_teachers: [{
      id: 'ct1', class_id: CLASS_ID, teacher_user_id: TEACHER,
      is_class_teacher: true, is_active: true, ended_on: null,
    }],
    class_teacher_subjects: [],
    class_enrollments: enrollments,
    student_lists: [],
    students,
  });
  ep = require('../../bot/shared/routes/class-manager-endpoint');
}

/** A class of `n` children with contiguous roll numbers 1..n. */
function classOf(n, nameFor) {
  const students = [];
  const enrollments = [];
  for (let i = 1; i <= n; i += 1) {
    students.push({ id: `s${i}`, student_name: nameFor(i), roll_number: i, is_active: true });
    enrollments.push({ id: `e${i}`, class_id: CLASS_ID, student_id: `s${i}`, roll_number: i, is_active: true });
  }
  return { students, enrollments };
}

const openRoster = () => ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });

/** Every option the screen offers, in screen order, across all five groups. */
function offered(data) {
  const out = [];
  for (let g = 1; g <= GROUPS; g += 1) {
    if (!data[`has_group${g}`]) continue;
    for (const o of data[`remove_options${g}`] || []) out.push(o);
  }
  return out;
}

/** The groups that actually render. */
function shownGroups(data) {
  const out = [];
  for (let g = 1; g <= GROUPS; g += 1) if (data[`has_group${g}`]) out.push(g);
  return out;
}

// ---------------------------------------------------------------------------

describe('the class in the video — 36 children, and she wants number 33', () => {
  // Invented names. Roll 33 is the one the teacher asked about.
  const nameFor = (i) => `Student ${i} Invented`;

  beforeEach(() => boot(classOf(36, nameFor)));

  it('offers ALL 36 children to remove, across consecutive groups of 20', async () => {
    const res = await openRoster();
    expect(res.screen).toBe('ROSTER');

    const all = offered(res.data);
    expect(all).toHaveLength(36);
    expect(all.map((o) => o.id)).toEqual(
      Array.from({ length: 36 }, (_, i) => `s${i + 1}`),
    );
    // Consecutive chunks of 20: 20 then 16, and nothing after.
    expect(shownGroups(res.data)).toEqual([1, 2]);
    expect(res.data.remove_options1).toHaveLength(20);
    expect(res.data.remove_options2).toHaveLength(16);
  });

  it('numbers the checkbox exactly as the roster text numbers her', async () => {
    const res = await openRoster();

    // "33. Student 33 Invented" appears in the TextBody...
    expect(res.data.roster.split('\n')[32]).toBe(`33. ${nameFor(33)}`);
    // ...and the checkbox for the same child carries the same "33.".
    const item = offered(res.data).find((o) => o.id === 's33');
    expect(item).toBeTruthy();
    expect(item.title).toBe(`33. ${nameFor(33)}`);
  });

  it('removes roll 33 when she ticks it — the whole point of the report', async () => {
    const res = await openRoster();
    const item = offered(res.data).find((o) => o.title.startsWith('33. '));
    expect(item).toBeTruthy();

    // It lives in the SECOND group, so the submit must read remove2.
    expect(res.data.remove_options2.map((o) => o.id)).toContain(item.id);

    const saved = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', {
      remove2: [item.id], add: '',
    });
    expect(saved.screen).toBe('SAVED');
    expect(saved.data.detail).toContain('1 removed from Grade 4 - A.');

    const closed = mockDb._tables.class_enrollments.find((e) => e.student_id === item.id);
    expect(closed.is_active).toBe(false);
    expect(closed.outcome).toBe('roster_correction');

    // And nobody else was touched.
    const stillOn = mockDb._tables.class_enrollments.filter((e) => e.is_active).length;
    expect(stillOn).toBe(35);
  });

  it('removes children picked from two different groups in one submit', async () => {
    const res = await openRoster();
    const saved = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', {
      remove1: ['s4'], remove2: ['s33', 's36'], add: '',
    });
    expect(saved.data.detail).toContain('3 removed from Grade 4 - A.');
    for (const id of ['s4', 's33', 's36']) {
      expect(mockDb._tables.class_enrollments.find((e) => e.student_id === id).is_active).toBe(false);
    }
    expect(res.data.hint).not.toMatch(/first 20/i);
  });

  it('says nothing about a cap, because nothing is capped at 36', async () => {
    const res = await openRoster();
    expect(res.data.hint).toMatch(/Every teacher on this class/i);
    expect(res.data.hint).not.toMatch(/\bfirst\b/i);
  });
});

describe('a 20-child class — exactly one group, and no empty one', () => {
  const nameFor = (i) => `Child ${i}`;
  beforeEach(() => boot(classOf(20, nameFor)));

  it('renders group 1 only', async () => {
    const res = await openRoster();
    expect(shownGroups(res.data)).toEqual([1]);
    expect(res.data.remove_options1).toHaveLength(20);
    expect(res.data.has_group2).toBe(false);
    expect(res.data.has_group3).toBe(false);
    expect(res.data.has_group4).toBe(false);
    expect(res.data.has_group5).toBe(false);
  });

  it('still gives every hidden group a NON-EMPTY data-source (bd-2731)', async () => {
    const res = await openRoster();
    for (let g = 2; g <= GROUPS; g += 1) {
      const opts = res.data[`remove_options${g}`];
      expect(Array.isArray(opts)).toBe(true);
      // An empty array is not renderable: the client shows "Something went wrong"
      // and the screen never draws, hidden or not.
      expect(opts.length).toBeGreaterThan(0);
      opts.forEach((o) => expect(o.id).toBe(ep.NO_STUDENTS_OPTION.id));
    }
  });

  it('labels the single group without a range — there is no slice to explain', async () => {
    const res = await openRoster();
    expect(res.data.remove_label1).toBe('Remove from this class');
  });
});

describe('an empty class — the screen must still draw', () => {
  beforeEach(() => boot({ students: [], enrollments: [] }));

  it('hides every group and keeps every data-source well-formed', async () => {
    const res = await openRoster();
    expect(shownGroups(res.data)).toEqual([]);
    for (let g = 1; g <= GROUPS; g += 1) {
      expect(res.data[`has_group${g}`]).toBe(false);
      expect(res.data[`remove_options${g}`].length).toBeGreaterThan(0);
    }
  });

  it('never tries to remove the placeholder if a stale handset posts it back', async () => {
    await openRoster();
    const saved = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', {
      remove1: [ep.NO_STUDENTS_OPTION.id], remove3: ep.NO_STUDENTS_OPTION.id, add: '',
    });
    expect(saved.screen).toBe('SAVED');
    expect(saved.data.detail).toMatch(/nothing changed/i);
  });
});

describe('the biggest class in ICT production — 88 children', () => {
  const nameFor = (i) => `طالب علم نمبر ${i}`;

  it('offers all 88, because 5 groups of 20 is 100', async () => {
    boot({ ...classOf(88, nameFor), language: 'ur' });
    const res = await openRoster();
    const all = offered(res.data);
    expect(all).toHaveLength(88);
    expect(all[87].id).toBe('s88');
    expect(shownGroups(res.data)).toEqual([1, 2, 3, 4, 5]);
    expect(res.data.remove_options5).toHaveLength(8);
  });
});

describe('a class past 100 — the one shape still capped', () => {
  const nameFor = (i) => `Child ${i}`;

  it('offers the first 100 and says so honestly, with what to do next', async () => {
    boot({ ...classOf(120, nameFor), language: 'en' });
    const res = await openRoster();

    expect(offered(res.data)).toHaveLength(TOTAL);
    expect(shownGroups(res.data)).toEqual([1, 2, 3, 4, 5]);
    // The honest sentence: 100, not 20, and it names the way through.
    expect(res.data.hint).toContain('100');
    expect(res.data.hint).not.toMatch(/first 20\b/);
    expect(res.data.hint).toMatch(/again/i);
    // And this is a DIFFERENT truncation from the roster text's own overflow
    // sentence — a coach has to be able to tell which children are missing.
    expect(res.data.hint).not.toMatch(/too long/i);
  });

  it('(ur) says it in Urdu too', async () => {
    boot({ ...classOf(120, nameFor), language: 'ur' });
    const res = await openRoster();
    expect(res.data.hint).toContain('100');
    expect(res.data.hint).toMatch(/[؀-ۿ]/);
    expect(res.data.hint).not.toMatch(/Showing the first/);
  });
});

describe('legacy published assets must not regress', () => {
  const nameFor = (i) => `Child ${i}`;
  beforeEach(() => boot(classOf(36, nameFor)));

  it('still posts back under the old `remove` key and still removes', async () => {
    const res = await openRoster();
    // The asset published on staging/prod binds `remove_options` and posts `remove`.
    expect(res.data.remove_options.map((o) => o.id))
      .toEqual(res.data.remove_options1.map((o) => o.id));
    expect(res.data.has_students).toBe(true);
    expect(res.data.remove_label).toBeTruthy();

    const id = res.data.remove_options[3].id;
    const saved = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', {
      remove: [id], add: '',
    });
    expect(saved.data.detail).toContain('1 removed');
    expect(mockDb._tables.class_enrollments.find((e) => e.student_id === id).is_active).toBe(false);
  });

  it('counts a child once when a mixed asset posts her under both keys', async () => {
    await openRoster();
    const saved = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', {
      remove: ['s2'], remove1: ['s2'], add: '',
    });
    expect(saved.data.detail).toContain('1 removed');
  });

  it('still reads the retired REMOVE_STUDENTS screen', async () => {
    await openRoster();
    const saved = await ep.handleClassManagerDataExchange(TEACHER, 'REMOVE_STUDENTS', {
      remove: JSON.stringify(['s5']),
    });
    expect(saved.screen).toBe('SAVED');
    expect(saved.data.detail).toContain('1 removed');
  });
});

describe('every teacher-facing string fits its WhatsApp field cap, in code points', () => {
  // Long Nastaliq names with a big roll number: the worst case for both caps.
  const nameFor = (i) => `محمد عبد الرحمٰن بن عبد اللہ صدیقی ${i}`;

  for (const language of ['en', 'ur']) {
    it(`(${language}) group labels stay within ${GROUP_LABEL_CAP}`, async () => {
      boot({ ...classOf(100, nameFor), language });
      const res = await openRoster();
      for (let g = 1; g <= GROUPS; g += 1) {
        const label = res.data[`remove_label${g}`];
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
        expect(cp(label)).toBeLessThanOrEqual(GROUP_LABEL_CAP);
      }
    });

    it(`(${language}) item titles stay within ${ITEM_TITLE_CAP}`, async () => {
      boot({ ...classOf(100, nameFor), language });
      const res = await openRoster();
      for (const o of offered(res.data)) {
        expect(cp(o.title)).toBeLessThanOrEqual(ITEM_TITLE_CAP);
      }
    });

    it(`(${language}) the hint stays within the TextCaption cap`, async () => {
      boot({ ...classOf(120, nameFor), language });
      const res = await openRoster();
      expect(cp(res.data.hint)).toBeLessThanOrEqual(CAPTION_CAP);
    });
  }

  it('titles are cut by CODE POINT, not by UTF-16 unit', async () => {
    // A name whose last character is outside the BMP and straddles UTF-16 index 30.
    // `.slice(0, 30)` — what this used to be — cuts the surrogate pair in half and
    // emits a lone high surrogate, which is not a character at all.
    const astral = (i) => `${'a'.repeat(26)}\u{1F467}${i}`;
    boot({ ...classOf(3, astral), language: 'en' });
    let res = await openRoster();
    for (const o of offered(res.data)) {
      expect(cp(o.title)).toBeLessThanOrEqual(ITEM_TITLE_CAP);
      expect(o.title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(o.title).not.toMatch(/[\uDC00-\uDFFF]/);
    }

    boot({ ...classOf(3, nameFor), language: 'ur' });
    res = await openRoster();
    for (const o of offered(res.data)) {
      expect(cp(o.title)).toBeLessThanOrEqual(ITEM_TITLE_CAP);
    }
  });

  it('labels name the slice in BOTH languages once there is more than one group', async () => {
    boot({ ...classOf(45, (i) => `Child ${i}`), language: 'en' });
    let res = await openRoster();
    expect(res.data.remove_label1).toMatch(/1.*20/);
    expect(res.data.remove_label2).toMatch(/21.*40/);
    expect(res.data.remove_label3).toMatch(/41.*45/);

    boot({ ...classOf(45, (i) => `Child ${i}`), language: 'ur' });
    res = await openRoster();
    expect(res.data.remove_label2).toMatch(/[؀-ۿ]/);
    expect(res.data.remove_label2).toMatch(/21/);
    expect(res.data.remove_label2).toMatch(/40/);
  });

  it('labels follow the ROLL numbers when they are not 1..n', async () => {
    // A class whose rolls start at 101 — the label has to agree with the text.
    const students = [];
    const enrollments = [];
    for (let i = 0; i < 25; i += 1) {
      const roll = 101 + i;
      students.push({ id: `s${roll}`, student_name: `Child ${roll}`, roll_number: roll, is_active: true });
      enrollments.push({ id: `e${roll}`, class_id: CLASS_ID, student_id: `s${roll}`, roll_number: roll, is_active: true });
    }
    boot({ students, enrollments, language: 'en' });
    const res = await openRoster();
    expect(res.data.remove_label1).toMatch(/101.*120/);
    expect(res.data.remove_label2).toMatch(/121.*125/);
    expect(res.data.remove_options2[0].title).toBe('121. Child 121');
  });
});

describe('the ROSTER screen in the Flow asset can actually render all five groups', () => {
  const FLOW = path.join(__dirname, '..', '..', 'docs', 'flows', 'class-manager-flow.json');
  const flow = JSON.parse(fs.readFileSync(FLOW, 'utf8'));
  const roster = flow.screens.find((s) => s.id === 'ROSTER');

  const groupsIn = (screen) => {
    const found = [];
    const walk = (nodes) => {
      for (const n of nodes || []) {
        if (n && n.type === 'CheckboxGroup') found.push(n);
        if (n && n.children) walk(n.children);
      }
    };
    walk(screen.layout && screen.layout.children);
    return found;
  };

  it('has five CheckboxGroups, each with its own data-source and visible gate', () => {
    const groups = groupsIn(roster);
    expect(groups).toHaveLength(GROUPS);
    groups.forEach((g, i) => {
      const n = i + 1;
      expect(g.name).toBe(`remove${n}`);
      expect(g['data-source']).toBe(`\${data.remove_options${n}}`);
      expect(g.visible).toBe(`\${data.has_group${n}}`);
      expect(g.label).toBe(`\${data.remove_label${n}}`);
      expect(g.required).toBe(false);
    });
  });

  it('declares every key the endpoint sends for those groups', () => {
    for (let n = 1; n <= GROUPS; n += 1) {
      expect(roster.data[`remove_options${n}`]).toBeDefined();
      expect(roster.data[`remove_options${n}`].type).toBe('array');
      expect(roster.data[`has_group${n}`]).toBeDefined();
      expect(roster.data[`has_group${n}`].type).toBe('boolean');
      expect(roster.data[`remove_label${n}`]).toBeDefined();
      expect(roster.data[`remove_label${n}`].type).toBe('string');
    }
  });

  it('keeps the legacy keys declared so an older handset still finds them', () => {
    expect(roster.data.remove_options).toBeDefined();
    expect(roster.data.has_students).toBeDefined();
    expect(roster.data.remove_label).toBeDefined();
  });

  it('posts every group in the one footer action, and stays on ROSTER → SAVED', () => {
    const footer = (roster.layout.children[0].children || []).find((c) => c.type === 'Footer');
    const payload = footer['on-click-action'].payload;
    expect(footer['on-click-action'].name).toBe('data_exchange');
    expect(payload.screen).toBe('ROSTER');
    expect(payload.add).toBe('${form.add}');
    for (let n = 1; n <= GROUPS; n += 1) {
      expect(payload[`remove${n}`]).toBe(`\${form.remove${n}}`);
    }
    // One submit, no new screens.
    expect(flow.routing_model.ROSTER).toEqual(['SAVED']);
  });

  it('every example in the data model is a non-empty array where one is bound', () => {
    for (let n = 1; n <= GROUPS; n += 1) {
      const ex = roster.data[`remove_options${n}`].__example__;
      expect(Array.isArray(ex)).toBe(true);
      expect(ex.length).toBeGreaterThan(0);
    }
  });
});
