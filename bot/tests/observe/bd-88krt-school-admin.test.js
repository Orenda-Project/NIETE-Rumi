/**
 * bd-88krt — search by name/EMIS/phone, add & remove a school, and credit the
 * coach who actually runs the observation (TDD, red-first).
 *
 * Operator, 2026-08-17:
 *   · school search should match name OR EMIS; teacher search name OR phone,
 *     and the UI text should say so;
 *   · a coach should be able to add a school from the whole universe and
 *     inherit its teachers, with a success interstitial, and remove one;
 *   · "multiple coaches might have added the same school" — so an observation
 *     must be credited to whoever EXECUTES it.
 *
 * Live shape this is written against (queried, not assumed): `schools` holds
 * 465 rows (the universe), `leader_teachers` 7,149 rows over 412 schools is the
 * de-facto roster, 139 (school,teacher) pairs are ALREADY shared by two coaches
 * — so co-assignment is normal and must never be treated as an error.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const {
  matchSchool, matchTeacher, normalisePhoneTerm, addedSchoolAck,
} = require('../../shared/services/observe/observe-school-admin.service');

const SCHOOLS = [
  { school_ext_id: 'niete:273', school_name: 'IMS(I-V) No.2 G-10/2', emis: '273' },
  { school_ext_id: 'niete:916', school_name: 'IMCG, G-10/2', emis: '916' },
  { school_ext_id: 'niete:201', school_name: 'IMCG (VI-XII), G-6/1-4', emis: '201' },
];

const TEACHERS = [
  { teacher_name: 'Tahira Manzoor', teacher_phone_e164: '923001234567' },
  { teacher_name: 'Touseef Ahmed', teacher_phone_e164: '923009876543' },
  { teacher_name: null, teacher_phone_e164: '923005555555' },
];

describe('bd-88krt · school search matches a name OR an EMIS', () => {
  it('finds by part of the name, case-insensitively', () => {
    expect(SCHOOLS.filter((s) => matchSchool(s, 'imcg')).map((s) => s.emis)).toEqual(['916', '201']);
  });

  it('finds by EMIS — the code a coach actually has to hand', () => {
    expect(SCHOOLS.filter((s) => matchSchool(s, '273')).map((s) => s.school_name)).toEqual(['IMS(I-V) No.2 G-10/2']);
  });

  it('finds by the full ext id too, so a pasted value still works', () => {
    expect(SCHOOLS.filter((s) => matchSchool(s, 'niete:201'))).toHaveLength(1);
  });

  it('a blank term matches everything rather than nothing', () => {
    for (const t of ['', null, '   ']) expect(SCHOOLS.filter((s) => matchSchool(s, t))).toHaveLength(3);
  });

  it('never throws on a school with missing fields', () => {
    expect(() => matchSchool({}, 'x')).not.toThrow();
    expect(matchSchool({}, 'x')).toBe(false);
  });
});

describe('bd-88krt · teacher search matches a name OR a phone number', () => {
  it('finds by part of the name', () => {
    expect(TEACHERS.filter((t) => matchTeacher(t, 'tahira'))).toHaveLength(1);
  });

  it('finds by the tail of the phone — what a coach reads off her handset', () => {
    expect(TEACHERS.filter((t) => matchTeacher(t, '9876543'))).toHaveLength(1);
  });

  it('finds by a locally-typed 03xx number against an E.164 row', () => {
    // She types 03009876543; the row holds 923009876543. These are one number.
    expect(TEACHERS.filter((t) => matchTeacher(t, '03009876543'))).toHaveLength(1);
  });

  it('ignores spaces and dashes in a typed number', () => {
    expect(TEACHERS.filter((t) => matchTeacher(t, '0300 987-6543'))).toHaveLength(1);
  });

  it('never throws on a teacher with no name', () => {
    expect(() => matchTeacher({ teacher_phone_e164: '9230055' }, 'abc')).not.toThrow();
  });

  it('normalises a typed number to its comparable digits', () => {
    expect(normalisePhoneTerm('0300 987-6543')).toBe('3009876543');
    expect(normalisePhoneTerm('+92 300 9876543')).toBe('3009876543');
    expect(normalisePhoneTerm('tahira')).toBe('');
  });
});

describe('bd-88krt · the add-school interstitial', () => {
  it('says what was added and how many teachers came with it', () => {
    const msg = addedSchoolAck('en', { schoolName: 'IMCG, G-10/2', teachersMapped: 55 });
    expect(msg).toContain('IMCG, G-10/2');
    expect(msg).toContain('55');
  });

  it('is written per language, with real Urdu', () => {
    const ur = addedSchoolAck('ur', { schoolName: 'IMCG', teachersMapped: 5 });
    expect(/[؀-ۿ]/.test(ur)).toBe(true);
    expect(ur).not.toMatch(/\{school\}|\{count\}/);
  });

  it('is honest when a school arrives with no roster', () => {
    // 51 master schools have no teacher rows at all — say so rather than
    // handing her a silently empty school (that is R41's bug).
    const msg = addedSchoolAck('en', { schoolName: 'New School', teachersMapped: 0 });
    expect(msg).toMatch(/no teacher|none yet/i);
  });

  it('reads correctly for exactly one teacher', () => {
    expect(addedSchoolAck('en', { schoolName: 'X', teachersMapped: 1 })).toMatch(/1 teacher\b/);
  });
});

describe('bd-88krt · an observation is credited to whoever runs it', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../shared/services/observe/observe-capture.service.js'), 'utf8');

  it('stamps observer_user_id with the recording coach, not the school owner', () => {
    // Two coaches can hold the same school (139 shared pairs live), so credit
    // must follow the person who actually recorded.
    expect(src).toMatch(/observer_user_id:\s*user\.id/);
  });

  it('still owns the row by the observed TEACHER when one is bound', () => {
    expect(src).toMatch(/user_id:\s*ownerUserId/);
  });
});

describe('bd-88krt · the Flow wiring for search and roster admin', () => {
  const flow = require('../../../docs/flows/observe-visit-v2.json');
  const byId = Object.fromEntries(flow.screens.map((s) => [s.id, s]));

  it('teacher search now hangs off the TEACHERS screen, not the school screen', () => {
    const onTeacher = byId.SELECT_TEACHER.layout.children.find((c) => c.type === 'EmbeddedLink');
    expect(onTeacher['on-click-action'].next.name).toBe('SEARCH_TEACHER');
    expect(onTeacher.text).toMatch(/name or phone/i);
    const onSchool = byId.SELECT_SCHOOL.layout.children.find((c) => c.type === 'EmbeddedLink');
    expect(onSchool['on-click-action'].next.name).toBe('SEARCH_SCHOOL');
    expect(onSchool.text).toMatch(/name or EMIS/i);
  });

  it('the search screens say what you can search by', () => {
    const hint = (id) => byId[id].layout.children.find((c) => c.type === 'TextBody').text;
    expect(hint('SEARCH_SCHOOL')).toMatch(/EMIS/i);
    expect(hint('SEARCH_TEACHER')).toMatch(/phone/i);
    expect(hint('ADD_SEARCH')).toMatch(/EMIS/i);
  });

  it('every search result feeds a screen that can act on it', () => {
    expect(flow.routing_model.SEARCH_SCHOOL).toEqual(['SCHOOL_RESULTS']);
    expect(flow.routing_model.SEARCH_TEACHER).toEqual(['TEACHER_RESULTS']);
    // ADD_SEARCH now also carries the door to remove (17 Aug), so this is a
    // containment check rather than an exact list.
    expect(flow.routing_model.ADD_SEARCH).toContain('ADD_RESULTS');
    expect(flow.routing_model.ADD_RESULTS).toContain('ACTION_DONE');
  });

  it('routing stays forward-only — a cycle fails publish outright', () => {
    for (const [from, tos] of Object.entries(flow.routing_model)) {
      expect(tos).not.toContain(from);
      for (const to of tos) expect(flow.routing_model[to] || []).not.toContain(from);
    }
  });

  it('ACTION_DONE is data-driven, so its copy can be in the coach\'s language', () => {
    const texts = byId.ACTION_DONE.layout.children.map((c) => c.text);
    expect(texts).toEqual(['${data.heading}', '${data.body}']);
    expect(Object.keys(byId.ACTION_DONE.data)).toEqual(expect.arrayContaining(['heading', 'body']));
  });

  it('roster admin is the LAST menu item — daily actions come first', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../shared/handlers/observe-visit-flow.handler.js'), 'utf8');
    expect(src.indexOf("id: 'manage'")).toBeGreaterThan(src.indexOf("id: 'debriefs'"));
    expect(src.indexOf("id: 'manage'")).toBeGreaterThan(src.indexOf("payload: { step: 'schools' }"));
  });
});

/**
 * Live on staging, 2026-08-17 — three faults the operator hit in one pass:
 *   1. Added IMCB I-8/3 and was told "It has no teacher list yet, so no teachers
 *      were added". FALSE: 57 teachers WERE added. A second submission took the
 *      already-mine path, which returned teachersMapped:0, and the ack renders 0
 *      as the empty-roster sentence. The most alarming possible wrong message.
 *   2. The terminal screen had no way out — "Done" is the screen TITLE, not a
 *      button. A Flow ends via a Footer whose action is `complete`.
 *   3. No route to MANAGE_SCHOOLS, so removing a school was unreachable.
 */
describe('bd-88krt · the add-school ack tells the truth about what happened', () => {
  const { addedSchoolAck } = require('../../shared/services/observe/observe-school-admin.service');

  it('a school already in the list reports its REAL count, not zero', () => {
    const msg = addedSchoolAck('en', { schoolName: 'IMCB, I-8/3', teachersMapped: 0, alreadyMine: true, teacherCount: 57 });
    expect(msg).toMatch(/already/i);
    expect(msg).toContain('57');
    expect(msg).not.toMatch(/no teacher list/i);      // the false sentence
  });

  it('still says "no teacher list" only when the school genuinely has none', () => {
    const msg = addedSchoolAck('en', { schoolName: 'Empty School', teachersMapped: 0, alreadyMine: false, teacherCount: 0 });
    expect(msg).toMatch(/no teacher list/i);
  });

  it('a fresh add reports what it just mapped', () => {
    const msg = addedSchoolAck('en', { schoolName: 'IMCG, F-10/2', teachersMapped: 101, teacherCount: 101 });
    expect(msg).toContain('101');
    expect(msg).not.toMatch(/already/i);
  });

  it('is per-language for the already-mine case too', () => {
    const ur = addedSchoolAck('ur', { schoolName: 'X', teachersMapped: 0, alreadyMine: true, teacherCount: 9 });
    expect(/[؀-ۿ]/.test(ur)).toBe(true);
    expect(ur).toContain('9');
  });
});

describe('bd-88krt · a coach can always finish, and can reach remove', () => {
  const flow = require('../../../docs/flows/observe-visit-v2.json');
  const byId = Object.fromEntries(flow.screens.map((s) => [s.id, s]));
  const footerOf = (id) => {
    const out = [];
    (function walk(ch) { for (const c of ch || []) { out.push(c); walk(c.children); } })(byId[id].layout.children);
    return out.find((c) => c.type === 'Footer');
  };

  it('every terminal screen has a Footer that COMPLETES the flow', () => {
    for (const id of ['ACTION_DONE', 'SUCCESS']) {
      const f = footerOf(id);
      expect(f).toBeTruthy();                                   // "Done" in the header is a title
      expect(f['on-click-action'].name).toBe('complete');
    }
  });

  it('MANAGE_SCHOOLS is reachable — otherwise remove is dead code', () => {
    const reachable = new Set(Object.values(flow.routing_model).flat());
    expect(reachable.has('MANAGE_SCHOOLS')).toBe(true);
  });

  it('and something actually opens it', () => {
    // It cannot be a `navigate` link: MANAGE_SCHOOLS declares `options`, which
    // only the endpoint can supply. So the door is a data_exchange step, and
    // the contract is link-step -> handler-returns-that-screen.
    const steps = [];
    for (const s of flow.screens) {
      (function walk(ch) {
        for (const c of ch || []) {
          const a = c['on-click-action'] || {};
          if (a.name === 'data_exchange' && (a.payload || {}).step) steps.push(a.payload.step);
          walk(c.children);
        }
      })(s.layout.children);
    }
    expect(steps).toContain('manage');

    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../shared/handlers/observe-visit-flow.handler.js'), 'utf8');
    const at = src.indexOf("step === 'manage'");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 400)).toMatch(/screen: 'MANAGE_SCHOOLS'/);
  });
});
