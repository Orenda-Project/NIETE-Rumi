/**
 * L25 (bd-s1oo0.46.1, CONTRACT §19, design §3.1, R1 §7.2–7.3): the coach's list message grouped by
 * classroom, one message per class teacher with only their own room's children, and the child's
 * label — name, class, teacher — with no roll anywhere. Pure functions: nothing is mocked.
 * All names are invented.
 */
const list = require('../../../bot/shared/services/child-test/conversation/list');
const identity = require('../../../bot/shared/services/child-test/conversation/identity');

const cps = (s) => [...String(s)].length;
const FSI = '⁨';
const PDI = '⁩';

const ROOMS = {
  A: { classId: 'c3a', grade: 3, section: 'A', shift: 'morning', classLabel: 'Grade 3 - A', classLabelUr: 'جماعت سوم - A', classShort: '3-A', teacherName: 'Saima Bibi', teacherUserId: 'u-saima' },
  B: { classId: 'c3b', grade: 3, section: 'B', shift: 'morning', classLabel: 'Grade 3 - B', classLabelUr: 'جماعت سوم - B', classShort: '3-B', teacherName: 'Tariq Mehmood', teacherUserId: 'u-tariq' },
  C: { classId: 'c3c', grade: 3, section: 'C', shift: 'morning', classLabel: 'Grade 3 - C', classLabelUr: 'جماعت سوم - C', classShort: '3-C', teacherName: null, teacherUserId: null },
  D: { classId: 'c3d', grade: 3, section: 'D', shift: 'morning', classLabel: 'Grade 3 - D', classLabelUr: 'جماعت سوم - D', classShort: '3-D', teacherName: 'Nadia Perveen', teacherUserId: 'u-nadia' },
  E: { classId: 'c3e', grade: 3, section: 'E', shift: 'morning', classLabel: 'Grade 3 - E', classLabelUr: 'جماعت سوم - E', classShort: '3-E', teacherName: 'Kamran Akmal', teacherUserId: 'u-kamran' },
  ONE: { classId: 'c3', grade: 3, section: null, shift: 'morning', classLabel: 'Grade 3', classLabelUr: 'جماعت سوم', classShort: '3', teacherName: 'Saima Bibi', teacherUserId: 'u-saima' },
  EVE: { classId: 'c3a-e', grade: 3, section: 'A', shift: 'evening', classLabel: 'Grade 3 - A (evening)', classLabelUr: 'جماعت سوم - A (شام)', classShort: '3-A', teacherName: 'Evening Teacher', teacherUserId: 'u-eve' },
};
let n = 0;
const kid = (room, name, extra = {}) => {
  n += 1;
  const r = ROOMS[room];
  return { drawId: `d${n}`, studentId: `s${n}`, ...r, displayName: name, displayNameUrdu: null, fatherName: null, namesakes: 1, fatherTellsApart: false, role: 'new', form: 'A', status: 'listed', childNo: null, rollNumber: 17, ...extra };
};
function makeList(children, alternates = []) {
  [...children, ...alternates].forEach((k, i) => { k.childNo = i + 1; });
  const ids = [...new Set([...children, ...alternates].map((k) => k.classId))];
  const classes = ids.map((id) => {
    const r = Object.values(ROOMS).find((x) => x.classId === id);
    return { ...r, drawIds: children.filter((k) => k.classId === id).map((k) => k.drawId), alternateDrawIds: alternates.filter((k) => k.classId === id).map((k) => k.drawId) };
  });
  return { ok: true, grade: 3, formPolicy: 'term', termSet: 'A', classes, children, alternates };
}
const designList = () => makeList([
  kid('A', 'Ayesha Khan'),
  kid('A', 'Bilal Ahmed', { fatherName: 'Ahmed Raza', namesakes: 2, fatherTellsApart: true }),
  kid('B', 'Hamza Ali'),
  kid('B', 'Zainab Noor'),
  kid('B', 'Fatima Riaz'),
], [kid('A', 'Usman Ghani'), kid('B', 'Sana Iqbal')]);

function expectNoRoll(text) {
  expect(text).not.toMatch(/\broll\b/i);
  expect(text).not.toMatch(/رول/);
  expect(text).not.toMatch(/17|۱۷/);
}

describe('identity: name · class · teacher, never a roll (CONTRACT §19, R1 §7.3)', () => {
  test('childLabel and childLine in English', () => {
    const c = kid('A', 'Ayesha Khan');
    expect(identity.childLabel('en', c)).toBe('Ayesha Khan · 3-A');
    expect(identity.childLine('en', c)).toBe('Ayesha Khan · Grade 3 - A · Teacher: Saima Bibi');
    expect(identity.childPlace('en', c)).toBe('Grade 3 - A · Teacher: Saima Bibi');
  });
  test('missing parts drop cleanly: no teacher, no class, no name', () => {
    expect(identity.childLine('en', kid('C', 'Hina Akbar'))).toBe('Hina Akbar · Grade 3 - C');
    expect(identity.childLabel('en', { displayName: 'Hina Akbar' })).toBe('Hina Akbar');
    expect(identity.childLine('en', { displayName: 'Hina Akbar' })).toBe('Hina Akbar');
    expect(identity.childLabel('en', kid('B', null))).toBe('(no name on the class list) · 3-B');
    for (const lang of ['en', 'ur']) {
      for (const c of [{}, null, kid('C', '  '), { rollNumber: 9 }]) {
        const s = identity.childLabel(lang, c) + identity.childLine(lang, c);
        expect(s).not.toMatch(/null|undefined|\{|NaN/);
        expect(s.length).toBeGreaterThan(0);
      }
    }
  });
  test('single unsectioned class and an evening class keep the roster words', () => {
    expect(identity.childLine('en', kid('ONE', 'Ali Raza'))).toBe('Ali Raza · Grade 3 · Teacher: Saima Bibi');
    expect(identity.childLabel('en', kid('ONE', 'Ali Raza'))).toBe('Ali Raza · 3');
    expect(identity.childLine('en', kid('EVE', 'Ali Raza'))).toBe('Ali Raza · Grade 3 - A (evening) · Teacher: Evening Teacher');
    expect(identity.childLine('ur', kid('EVE', 'Ali Raza'))).toContain('جماعت سوم - A (شام)');
  });
  test('namesakes: the father when it tells them apart, else the count in the class', () => {
    const withFather = kid('A', 'Ali Hassan', { fatherName: 'Hassan Raza', namesakes: 2, fatherTellsApart: true });
    const without = kid('A', 'Ali Hassan', { fatherName: null, namesakes: 2, fatherTellsApart: false });
    const sameFather = kid('A', 'Ali Hassan', { fatherName: 'Raza', namesakes: 3, fatherTellsApart: false });
    const unique = kid('A', 'Ali Hassan', { fatherName: 'Hassan Raza', namesakes: 1 });
    expect(identity.childLabel('en', withFather)).toBe('Ali Hassan (father: Hassan Raza) · 3-A');
    expect(identity.childLabel('en', without)).toBe('Ali Hassan (2 in this class) · 3-A');
    expect(identity.childLabel('en', sameFather)).toBe('Ali Hassan (3 in this class) · 3-A');
    expect(identity.childLabel('en', unique)).toBe('Ali Hassan · 3-A');
    expect(identity.childLabel('ur', withFather)).toContain('والد:');
    expect(identity.childLabel('ur', without)).toContain('اس جماعت میں ۲');
  });
  test('Urdu: names are wrapped in direction isolates; digits are Urdu', () => {
    const s = identity.childLine('ur', kid('A', 'Ayesha Khan'));
    expect(s).toContain(`${FSI}Ayesha Khan${PDI}`);
    expect(s).toContain(`${FSI}Saima Bibi${PDI}`);
    expect(s).toContain('جماعت سوم - A');
    expect(s).toContain('ٹیچر:');
    // L31: "۳-A" is isolated too, or an RTL line paints it "A-۳" (language-protocol §9.3)
    expect(identity.childLabel('ur', kid('A', 'Ayesha Khan'))).toBe(`${FSI}Ayesha Khan${PDI} · ${FSI}۳-A${PDI}`);
    expect(s).toContain(`${FSI}جماعت سوم - A${PDI}`);
  });
  test('rollOf no longer finds a roll; childRow never shows one and carries the class and teacher', () => {
    const c = kid('B', 'Hamza Ali');
    expect(identity.rollOf(c)).toBeNull();
    const row = identity.childRow('en', c, 'New');
    expect(row.title).toBe('Hamza Ali');
    expect(row.description).toBe('Grade 3 - B · Teacher: Tariq Mehmood · New');
    expectNoRoll(JSON.stringify(row));
    // A long teacher name is shortened to the first name, then dropped, to fit 72 code points.
    const long = { ...c, teacherName: 'Muhammad Abdul Rehman Khan Niazi Sahibzada' };
    const r2 = identity.childRow('en', long, 'Returning (Form B) · Tested · In progress');
    expect(cps(r2.description)).toBeLessThanOrEqual(72);
    expect(r2.description).toContain('Grade 3 - B');
  });
  test('childRow does not repeat a father hint the caller already put in the status', () => {
    const c = kid('A', 'Ali Hassan', { fatherName: 'Hassan Raza', namesakes: 2, fatherTellsApart: true });
    const row = identity.childRow('en', c, 'father: Hassan Raza · New');
    expect(row.description.match(/father: Hassan Raza/g)).toHaveLength(1);
  });
});

describe('the list message: grouped by classroom (design §3.1)', () => {
  test('two rooms, English: exactly the design body, alternates last, two buttons', () => {
    const m = list.buildListMessage('en', designList());
    expect(m.header).toBe('Grade 3 · 5 children');
    expect(m.body).toBe([
      'Today\'s children, by classroom. Ask each class teacher to send them *one at a time*.',
      '',
      '*Grade 3 - A* · Teacher: Saima Bibi',
      '1. Ayesha Khan',
      '2. Bilal Ahmed (father: Ahmed Raza)',
      '',
      '*Grade 3 - B* · Teacher: Tariq Mehmood',
      '3. Hamza Ali',
      '4. Zainab Noor',
      '5. Fatima Riaz',
      '',
      'Only if someone is absent: Usman Ghani (3-A), Sana Iqbal (3-B)',
    ].join('\n'));
    expect(m.buttons.map((b) => b.id)).toEqual(['ctst_start', 'ctst_send_teachers']);
    expect(m.buttons.map((b) => b.title)).toEqual(['Start', 'Send to the teachers']);
  });

  test('one room: one block, no other room heading', () => {
    const m = list.buildListMessage('en', makeList(['A', 'A', 'A', 'A', 'A'].map((r, i) => kid(r, `Child ${'VWXYZ'[i]}`))));
    expect(m.body.match(/^\*Grade 3/gm)).toHaveLength(1);
    expect(m.body).toContain('*Grade 3 - A* · Teacher: Saima Bibi\n1. Child V\n2. Child W');
  });

  test('five rooms: five blocks in collection order; the room with no teacher says to ask the head teacher', () => {
    const m = list.buildListMessage('en', makeList(['A', 'B', 'C', 'D', 'E'].map((r) => kid(r, `Kid ${r}`))));
    const heads = m.body.split('\n').filter((l) => l.startsWith('*Grade'));
    expect(heads).toEqual([
      '*Grade 3 - A* · Teacher: Saima Bibi',
      '*Grade 3 - B* · Teacher: Tariq Mehmood',
      '*Grade 3 - C* · ask the head teacher for this room',
      '*Grade 3 - D* · Teacher: Nadia Perveen',
      '*Grade 3 - E* · Teacher: Kamran Akmal',
    ]);
  });

  test('a single unsectioned class, and a morning A next to an evening A', () => {
    const one = list.buildListMessage('en', makeList([kid('ONE', 'Ali Raza'), kid('ONE', 'Sara Khan')]));
    expect(one.body).toContain('*Grade 3* · Teacher: Saima Bibi');
    expect(one.body).not.toMatch(/—|null/);
    const mixed = list.buildListMessage('en', makeList([kid('A', 'Ali Raza'), kid('EVE', 'Sara Khan')]));
    expect(mixed.body).toContain('*Grade 3 - A* · Teacher: Saima Bibi');
    expect(mixed.body).toContain('*Grade 3 - A (evening)* · Teacher: Evening Teacher');
  });

  test('a namesake with a father\'s name and one without', () => {
    const m = list.buildListMessage('en', makeList([
      kid('A', 'Ali Hassan', { fatherName: 'Hassan Raza', namesakes: 2, fatherTellsApart: true }),
      kid('A', 'Usman Tariq', { namesakes: 2, fatherTellsApart: false }),
    ]));
    expect(m.body).toContain('1. Ali Hassan (father: Hassan Raza)');
    expect(m.body).toContain('2. Usman Tariq (2 in this class)');
  });

  test('statuses on a re-sent list; no send button when no room has a teacher or nobody is waiting', () => {
    const l = makeList([kid('C', 'Kid One', { status: 'tested' }), kid('C', 'Kid Two', { status: 'absent' }), kid('C', 'Kid Three')]);
    const m = list.buildListMessage('en', l);
    expect(m.body).toContain('1. Kid One · done ✓');
    expect(m.body).toContain('2. Kid Two · absent');
    expect(m.buttons.map((b) => b.id)).toEqual(['ctst_start']);
    const done = makeList([kid('A', 'Kid One', { status: 'tested' })]);
    expect(list.buildListMessage('en', done).buttons.map((b) => b.id)).toEqual(['ctst_start']);
  });

  test('Urdu: same grouping, Urdu words, isolated names, Urdu digits', () => {
    const m = list.buildListMessage('ur', designList());
    expect(m.header).toBe('جماعت سوم · ۵ بچے');
    expect(m.body).toContain(`*جماعت سوم - A* · ٹیچر: ${FSI}Saima Bibi${PDI}`);
    expect(m.body).toContain(`۱. ${FSI}Ayesha Khan${PDI}`);
    expect(m.body).toContain(`۲. ${FSI}Bilal Ahmed${PDI} (والد: ${FSI}Ahmed Raza${PDI})`);
    expect(m.body).toContain('صرف اگر کوئی غیر حاضر ہو:');
    expect(m.buttons.map((b) => b.title)).toEqual(['شروع کریں', 'ٹیچرز کو بھیجیں']);
  });

  test('every field fits its WhatsApp cap in code points, even with the longest names, in both languages', () => {
    const huge = 'Muhammad Abdul Rehman Khan Niazi Sahibzada Gul Badshah';
    const kids = ['A', 'B', 'D', 'E', 'A'].map((r) => kid(r, huge, { fatherName: huge, namesakes: 2, fatherTellsApart: true }));
    const alts = [kid('B', huge), kid('D', huge)];
    for (const r of ['A', 'B', 'D', 'E']) ROOMS[r].teacherName = 'Muhammad Abdul Rehman Khan Niazi';
    const l = makeList(kids, alts);
    l.classes.forEach((c) => { c.teacherName = 'Muhammad Abdul Rehman Khan Niazi'; });
    for (const lang of ['en', 'ur']) {
      const m = list.buildListMessage(lang, l);
      expect(cps(m.header)).toBeLessThanOrEqual(60);
      expect(cps(m.body)).toBeLessThanOrEqual(1024);
      for (const b of m.buttons) expect(cps(b.title)).toBeLessThanOrEqual(20);
      expect(m.body).toContain('*Grade 3 - A*'.replace('Grade 3', lang === 'en' ? 'Grade 3' : 'جماعت سوم'));
    }
    ROOMS.A.teacherName = 'Saima Bibi'; ROOMS.B.teacherName = 'Tariq Mehmood'; ROOMS.D.teacherName = 'Nadia Perveen'; ROOMS.E.teacherName = 'Kamran Akmal';
  });

  test('no roll reaches the list, even for children who have one', () => {
    for (const lang of ['en', 'ur']) {
      const m = list.buildListMessage(lang, designList());
      expectNoRoll(JSON.stringify(m));
    }
  });
});

describe('teacher messages: each class teacher gets only their own room (fixes R1 §5)', () => {
  test('two rooms → two messages, each with only that room\'s waiting children, in list order', () => {
    const msgs = list.buildTeacherMessages('en', designList());
    expect(msgs.map((m) => m.teacherUserId)).toEqual(['u-saima', 'u-tariq']);
    expect(msgs[0]).toMatchObject({ classId: 'c3a' });
    expect(msgs[0].body).toBe('For today\'s reading and maths check, please send these children from Grade 3 - A to the coach one at a time, in this order:\n1. Ayesha Khan\n2. Bilal Ahmed (father: Ahmed Raza)\nWhen one comes back, send the next.');
    expect(msgs[1].body).toContain('from Grade 3 - B');
    expect(msgs[1].body).toContain('1. Hamza Ali\n2. Zainab Noor\n3. Fatima Riaz');
    expect(msgs[1].body).not.toMatch(/Ayesha|Bilal/);
    for (const m of msgs) expectNoRoll(m.body);
  });
  test('a room with no teacher gets no message; tested or absent children are not sent', () => {
    const l = makeList([kid('A', 'Kid One', { status: 'tested' }), kid('A', 'Kid Two'), kid('C', 'Kid Three'), kid('B', 'Kid Four', { status: 'absent' })]);
    const msgs = list.buildTeacherMessages('en', l);
    expect(msgs.map((m) => m.teacherUserId)).toEqual(['u-saima']);
    expect(msgs[0].body).toContain('1. Kid Two');
    expect(msgs[0].body).not.toContain('Kid One');
  });
  test('Urdu teacher message: isolated names, the room in Urdu', () => {
    const [m] = list.buildTeacherMessages('ur', designList());
    expect(m.body).toContain('جماعت سوم - A');
    expect(m.body).toContain(`۱. ${FSI}Ayesha Khan${PDI}`);
    expectNoRoll(m.body);
  });
});
