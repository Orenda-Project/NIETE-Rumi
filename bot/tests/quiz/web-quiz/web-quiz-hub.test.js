'use strict';
/**
 * The kid hub (web-quiz-hub.js) and the WhatsApp /quiz that links to it
 * (student-quiz.service open()). Supabase, Redis and WhatsApp are the boundaries
 * and are faked; every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
// Redis is a boundary: an in-memory SET NX / GET, so the hub's first-device binding runs for real.
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendCtaUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WhatsAppService = require('../../../shared/services/whatsapp.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const { resolveUx } = require('../../../shared/config/ux-strings');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const SQ = require('../../../shared/services/quiz/student-quiz.service');
const redis = require('../../../shared/services/cache/railway-redis.service');

const PHONE = '923001112223';
const PORTAL = 'https://portal.example.test';
const KID = '44444444-4444-4444-8444-000000000001';
const SIB = '44444444-4444-4444-8444-000000000002';
const OTHER = '44444444-4444-4444-8444-000000000009';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const V = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-0000000000${String(n).padStart(2, '0')}`;
const VQ = (n) => `bbbbbbbb-bbbb-4bbb-8bbb-0000000000${String(n).padStart(2, '0')}`;
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const future = new Date(Date.now() + 10 * 86400000).toISOString();

let fake;
let db;

function code(id, c, quizId, extra = {}) {
  return { id, code: c, quiz_id: quizId, active: true, expires_at: future, topic: `Topic ${c}`, language: 'en',
    teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(48), ...extra };
}
function sess(id, sc, quizId, status, c, t, at, extra = {}) {
  return { id, share_code_id: sc, quiz_id: quizId, student_id: KID, status, correct_answers: c, total_questions_answered: t,
    mastery_percentage: t ? Math.round((100 * c) / t) : 0, completed_at: status === 'completed' ? at : null, created_at: at, student_class: '3', ...extra };
}
function video(n, subject, chapter, title) {
  return { id: V(n), grade: '3', subject, clean_chapter: chapter, clean_title: title, migration_status: 'done', superseded_by: null, r2_url: null };
}

function seed(over = {}) {
  db = {
    app_settings: [{ key: 'web_quiz_hub', value: 'true' }],
    students: [
      { id: KID, student_name: 'Sana Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: PHONE, created_at: ago(500) },
      { id: SIB, student_name: 'Bilal Testwala', student_name_urdu: null, self_reported_class: '5', list_id: null, is_active: true, phone: PHONE, created_at: ago(400) },
      { id: OTHER, student_name: 'Other Testwala', self_reported_class: '3', list_id: LIST, is_active: true, phone: '923009999999', created_at: ago(300) },
    ],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [
      { id: 'q-maths', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: V(2), quiz_source: 'video', status: 'ready' },
      { id: 'q-eng', topic: 'Nouns', subject: 'english', language: 'en', grade: '3', video_id: null },
      { id: 'q-sci', topic: 'Plants', subject: 'science', language: 'en', grade: '3', video_id: null },
      { id: 'q-new', topic: 'Shapes', subject: 'maths', language: 'en', grade: '3', video_id: null },
      { id: 'q-g5', topic: 'Decimals', subject: 'maths', language: 'en', grade: '5', video_id: null },
      ...[1, 3, 4, 5, 6, 7, 8].map((n) => ({ id: VQ(n), video_id: V(n), quiz_source: 'video', status: 'ready', topic: `V${n}`, subject: 'x', grade: '3' })),
    ],
    quiz_share_codes: [
      code('sc-maths', 'MATH01', 'q-maths', { created_at: ago(30) }),
      code('sc-eng', 'ENGL01', 'q-eng', { created_at: ago(60) }),
      code('sc-sci', 'SCIE01', 'q-sci', { created_at: ago(90), active: false }),
      code('sc-new', 'NEWQ01', 'q-new', { created_at: ago(5) }),
      code('sc-g5', 'GRD501', 'q-g5', { created_at: ago(2) }),
      code('sc-old', 'OLDQ01', 'q-new', { created_at: ago(24 * 9) }),
    ],
    quiz_sessions: [
      sess('s1', 'sc-maths', 'q-maths', 'completed', 4, 10, ago(30)),
      sess('s2', 'sc-maths', 'q-maths', 'completed', 8, 10, ago(20)),
      sess('s3', 'sc-eng', 'q-eng', 'completed', 6, 8, ago(50)),
      sess('s4', 'sc-sci', 'q-sci', 'completed', 5, 5, ago(80)),
    ],
    student_videos: [
      video(1, 'Maths', 'Addition', 'Adding tens'),
      video(2, 'Maths', 'Fractions', 'Halves'),
      video(3, 'Maths', 'Fractions', 'Quarters'),
      video(4, 'Maths', 'Measurement', 'Length'),
      video(5, 'English', 'Nouns', 'Naming words'),
      video(6, 'English', 'Verbs', 'Doing words'),
      video(7, 'Science', 'Plants', 'Leaves'),
      video(8, 'Maths', 'Fractions', 'Thirds'),
    ],
    ...over,
  };
  fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = PORTAL;
  delete process.env.WEB_QUIZ_BASE_URL;
  delete process.env.STUDENT_QUIZ_FLOW_ID;
  Hub._resetCache();
  redis._store.clear();
  redis._up = true;
  seed();
});

// The phone the WhatsApp /quiz link was opened on first (the hub binds its token to it).
const DEV_A = 'AAAAAAAAAAAAAAAAAAAAAA';
const DEV_B = 'BBBBBBBBBBBBBBBBBBBBBB';
const A = { device: DEV_A };

const chipH = (id) => T.chipId('h', id);

describe('hub(): who the hub is for', () => {
  test('a forged or wrong-kind token is 401; the hub switch off is 503', async () => {
    await expect(Hub.hub('abc.def')).rejects.toMatchObject({ status: 401, body: { error: 'bad_token' } });
    const st = T.signSession({ sessionId: 's', deviceRef: 'd', shareCodeId: 'sc' });
    await expect(Hub.hub(st, A)).rejects.toMatchObject({ status: 401 });
    seed({ app_settings: [{ key: 'web_quiz_hub', value: 'false' }] });
    await expect(Hub.hub(T.signHub([KID]), A)).rejects.toMatchObject({ status: 503, body: { error: 'web_quiz_off' } });
  });

  test('0 children: the token names nobody still active -> an empty hub, no reads beyond the students', async () => {
    seed({ students: [] });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out).toMatchObject({ kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null });
  });

  test('1 child: chosen at once; the payload has no student id, no surname, no phone', async () => {
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.kids).toEqual([{ chip: chipH(KID), first: 'Sana', animal: T.animalFor(KID), grade: '3' }]);
    expect(out.kid).toBe(chipH(KID));
    const text = JSON.stringify(out);
    expect(text).not.toContain(KID);
    expect(text).not.toContain('Testwala');
    expect(text).not.toContain(PHONE);
  });

  test('2 children and no pick: ONLY the token\'s children, nothing else loaded; a pick chooses one', async () => {
    const token = T.signHub([KID, SIB]);
    const out = await Hub.hub(token, A);
    expect(out.kids.map((k) => k.first)).toEqual(['Sana', 'Bilal']);
    expect(out.kid).toBeNull();
    expect(out.teacher).toBeNull();
    expect(out.again).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('Other');
    const picked = await Hub.hub(token, { kid: chipH(SIB), ...A });
    expect(picked.kid).toBe(chipH(SIB));
    // A chip of a child the token does not name picks nobody.
    expect((await Hub.hub(token, { kid: chipH(OTHER), ...A })).kid).toBeNull();
    expect(Hub.kidOf(token, chipH(SIB))).toBe(SIB);
    expect(Hub.kidOf(token, chipH(OTHER))).toBeNull();
  });
});

describe('hub(): a FORWARDED link names nobody (bound to the first phone that opens it)', () => {
  const NAMES = /Sana|Bilal|Testwala/;

  test('device A opens first and sees its children; device B opening the same link gets NO first name, no history', async () => {
    const token = T.signHub([KID, SIB]);
    const a = await Hub.hub(token, { device: DEV_A });
    expect(a.kids.map((k) => k.first)).toEqual(['Sana', 'Bilal']);
    for (const opts of [{ device: DEV_B }, { device: DEV_B, kid: chipH(KID) }]) {
      const b = await Hub.hub(token, opts);
      expect(JSON.stringify(b)).not.toMatch(NAMES);
      expect(b).toMatchObject({ locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null });
      expect(b.lang).toBe('en');
    }
    const locked = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.hub_locked');
    expect(locked.length).toBe(2);
    expect(JSON.stringify(locked)).not.toMatch(/Sana|Bilal|Testwala|4444|AAAA|BBBB/);
  });

  test('the same device A again: unchanged (names, the chosen child\'s hub)', async () => {
    const token = T.signHub([KID]);
    const first = await Hub.hub(token, { device: DEV_A });
    await Hub.hub(token, { device: DEV_B });
    const again = await Hub.hub(token, { device: DEV_A });
    expect(again).toEqual(first);
    expect(again.kids[0].first).toBe('Sana');
    expect(again.locked).toBeUndefined();
  });

  test('no device (the server render): no names, and the link stays free for the first phone', async () => {
    const token = T.signHub([KID]);
    const none = await Hub.hub(token);
    expect(JSON.stringify(none)).not.toMatch(NAMES);
    expect(none.locked).toBe(true);
    expect((await Hub.hub(token, { device: DEV_B })).kids[0].first).toBe('Sana');
    expect((await Hub.hub(token, { device: DEV_A })).locked).toBe(true);
  });

  test('a device that already played as one of the children is trusted even after another phone took the link', async () => {
    const token = T.signHub([KID]);
    await Hub.hub(token, { device: DEV_A });
    db.quiz_sessions.push(sess('s-b', 'sc-eng', 'q-eng', 'completed', 1, 2, ago(70), { device_ref: DEV_B }));
    expect((await Hub.hub(token, { device: DEV_B })).kids[0].first).toBe('Sana');
  });

  test('Redis down: fail closed for a phone the children never played on; a known phone still works', async () => {
    redis._up = false;
    const token = T.signHub([KID]);
    expect((await Hub.hub(token, { device: DEV_A })).locked).toBe(true);
    db.quiz_sessions.push(sess('s-a', 'sc-eng', 'q-eng', 'completed', 1, 2, ago(70), { device_ref: DEV_A }));
    expect((await Hub.hub(token, { device: DEV_A })).kids[0].first).toBe('Sana');
  });

  test('a device_ref that is not one we could have minted is no device', async () => {
    const token = T.signHub([KID]);
    expect((await Hub.hub(token, { device: 'x' })).locked).toBe(true);
    expect((await Hub.hub(token, { device: DEV_A })).locked).toBeUndefined();
  });
});

describe('hub(): trust is per child (a shared phone that played as ONE sibling sees only that sibling)', () => {
  const DEV_C = 'CCCCCCCCCCCCCCCCCCCCCC';

  test('phone C played as Sana only: the family link (bound to A) shows C only Sana; Bilal\'s hub, library and challenge stay closed to C', async () => {
    const token = T.signHub([KID, SIB]);
    expect((await Hub.hub(token, A)).kids.map((k) => k.first)).toEqual(['Sana', 'Bilal']);
    db.quiz_sessions.push(sess('s-c', 'sc-eng', 'q-eng', 'completed', 1, 2, ago(70), { device_ref: DEV_C }));
    const onC = await Hub.hub(token, { device: DEV_C });
    expect(onC.kids.map((k) => k.first)).toEqual(['Sana']);
    expect(JSON.stringify(onC)).not.toMatch(/Bilal/);
    const asBilal = await Hub.hub(token, { device: DEV_C, kid: chipH(SIB) });
    expect(JSON.stringify(asBilal)).not.toMatch(/Bilal/);
    expect(asBilal.kid).not.toBe(chipH(SIB));
    expect(await Hub.kidFromHub(token, chipH(SIB), DEV_C)).toBeNull();
    expect(await Hub.kidFromHub(token, chipH(KID), DEV_C)).toMatchObject({ studentId: KID });
    // the bound family phone keeps both children
    expect((await Hub.hub(token, A)).kids).toHaveLength(2);
  });

  test('the first phone to open the link is trusted for the whole family, even if it played as one of them', async () => {
    db.quiz_sessions.push(sess('s-a', 'sc-eng', 'q-eng', 'completed', 1, 2, ago(70), { device_ref: DEV_A }));
    const token = T.signHub([KID, SIB]);
    expect((await Hub.hub(token, A)).kids).toHaveLength(2);
  });
});

describe('hub(): from your teacher', () => {
  test('(a) a teacher-sent code this child opened and has not finished comes first', async () => {
    db.quiz_sessions.push(sess('s5', 'sc-g5', 'q-g5', 'in_progress', 1, 1, ago(1)));
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.teacher).toMatchObject({ code: 'GRD501', src: 'opened', k: T.chipId('sc-g5', KID) });
  });

  test('(b) else the class teacher\'s open code from the last 7 days for the list\'s grade (not grade 5, not 9 days old)', async () => {
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.teacher).toMatchObject({ code: 'NEWQ01', topic: 'Shapes', src: 'teacher', k: T.chipId('sc-new', KID) });
  });

  test('(b) a LOOSE child (no class list, as every prod quiz child today): the teachers whose links they played', async () => {
    db.students[0].list_id = null;
    db.students[0].self_reported_class = '3B';
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.teacher).toMatchObject({ code: 'NEWQ01', src: 'teacher' });
  });

  test('(b) a quiz with no grade, or a band without the child\'s grade, is never the teacher card', async () => {
    db.quizzes.find((q) => q.id === 'q-new').grade = null;
    expect((await Hub.hub(T.signHub([KID]), A)).teacher).toBeNull();
    db.quizzes.find((q) => q.id === 'q-new').grade = '4-6';
    expect((await Hub.hub(T.signHub([KID]), A)).teacher).toBeNull();
    db.quizzes.find((q) => q.id === 'q-new').grade = '1-3';
    expect((await Hub.hub(T.signHub([KID]), A)).teacher).toMatchObject({ code: 'NEWQ01' });
  });

  test('(b) another teacher\'s code is never shown', async () => {
    db.quiz_share_codes.find((c) => c.id === 'sc-new').teacher_user_id = '11111111-1111-4111-8111-00000000000f';
    expect((await Hub.hub(T.signHub([KID]), A)).teacher).toBeNull();
  });

  test('none: no open, unfinished code for the grade -> null (the page shows the warm empty state)', async () => {
    db.quiz_share_codes.find((c) => c.id === 'sc-new').active = false;
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.teacher).toBeNull();
    // A child with no class list and nothing opened has no teacher card either.
    expect((await Hub.hub(T.signHub([SIB]), A)).teacher).toBeNull();
  });

  test('a code the child already finished is never the teacher card', async () => {
    db.quiz_sessions.push(sess('s6', 'sc-new', 'q-new', 'completed', 3, 5, ago(3)));
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.teacher).toBeNull();
  });
});

describe('hub(): from your teacher — the child\'s own class first (quiz_share_codes.class_id, resolveQuizClass)', () => {
  const CLASS_A = 'c1a55000-0000-4000-8000-00000000000a';
  const CLASS_B = 'c1a55000-0000-4000-8000-00000000000b';
  function twoHandouts() {
    db.class_enrollments = [{ id: 'e1', student_id: KID, class_id: CLASS_A, is_active: true }];
    db.classes = [{ id: CLASS_A, grade_code: '3', section: 'A', is_active: true }, { id: CLASS_B, grade_code: '3', section: 'B', is_active: true }];
    db.class_teachers = [{ class_id: CLASS_A, teacher_user_id: TEACHER, is_active: true }, { class_id: CLASS_B, teacher_user_id: TEACHER, is_active: true }];
    db.quizzes.push({ id: 'q-bound', topic: 'Bound to 3-A', subject: 'maths', language: 'en', grade: '3-5', video_id: null });
    db.quizzes.push({ id: 'q-loose', topic: 'Loose newer', subject: 'english', language: 'en', grade: '3-5', video_id: null });
    db.quiz_share_codes.push(code('sc-bound', 'BOUND1', 'q-bound', { created_at: ago(10), class_id: CLASS_A }));
    db.quiz_share_codes.push(code('sc-loose', 'LOOSE1', 'q-loose', { created_at: ago(1) }));
  }

  test('a code bound to the child\'s class comes before a newer unbound code of the same grade', async () => {
    twoHandouts();
    expect((await Hub.hub(T.signHub([KID]), A)).teacher).toMatchObject({ code: 'BOUND1', src: 'class' });
  });

  test('latency: with a code bound to the child\'s class, resolveQuizClass is never called; unbound codes resolve at most 5', async () => {
    twoHandouts();
    const Identity = require('../../../shared/services/quiz/web-quiz-identity');
    const spy = jest.spyOn(Identity, 'resolveQuizClass');
    try {
      expect((await Hub.hub(T.signHub([KID]), A)).teacher).toMatchObject({ code: 'BOUND1' });
      expect(spy).not.toHaveBeenCalled();
      db.quiz_share_codes.find((c) => c.id === 'sc-bound').active = false;
      for (let i = 0; i < 8; i += 1) db.quiz_share_codes.push(code(`sc-u${i}`, `UNB00${i}`, 'q-loose', { created_at: ago(2 + i) }));
      spy.mockClear();
      await Hub.hub(T.signHub([KID]), A);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(5);
    } finally { spy.mockRestore(); }
  });

  test('a code bound to ANOTHER class is never this child\'s teacher card (the unbound grade code is)', async () => {
    twoHandouts();
    db.quiz_share_codes.find((c) => c.id === 'sc-bound').class_id = CLASS_B;
    expect((await Hub.hub(T.signHub([KID]), A)).teacher).toMatchObject({ code: 'LOOSE1' });
  });

  test('an unbound code that resolveQuizClass places in another class (one-class teacher) is never shown', async () => {
    db.class_enrollments = [{ id: 'e1', student_id: KID, class_id: CLASS_A, is_active: true }];
    db.classes = [{ id: CLASS_B, grade_code: '3', section: 'B', is_active: true }, { id: CLASS_A, grade_code: '3', section: 'A', is_active: true }];
    db.class_teachers = [{ class_id: CLASS_B, teacher_user_id: TEACHER, is_active: true }];
    expect((await Hub.hub(T.signHub([KID]), A)).teacher).toBeNull();
  });

  test('the same lesson the child already finished in the other language is skipped (lesson_plan_id / coaching_session_id twin)', async () => {
    db.quizzes.find((q) => q.id === 'q-maths').coaching_session_id = 'cs-1';
    db.quizzes.push({ id: 'q-twin', topic: 'Kasr', subject: 'maths', language: 'ur', grade: '3', video_id: null, coaching_session_id: 'cs-1' });
    db.quiz_share_codes.push(code('sc-twin', 'TWIN01', 'q-twin', { created_at: ago(1) }));
    expect((await Hub.hub(T.signHub([KID]), A)).teacher).toMatchObject({ code: 'NEWQ01' });
  });

  test('between two codes of the class, the one in the child\'s language wins over a newer one in the other', async () => {
    db.quizzes.push({ id: 'q-ur', topic: 'Ashkal', subject: 'maths', language: 'ur', grade: '3', video_id: null });
    db.quiz_share_codes.push(code('sc-ur', 'URDU01', 'q-ur', { created_at: ago(1) }));
    expect((await Hub.hub(T.signHub([KID]), A)).teacher).toMatchObject({ code: 'NEWQ01' });
  });
});

describe('hub(): play again', () => {
  test('finished, still-open codes, newest first, with the BEST score, the tries and the code\'s own chip', async () => {
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.again.map((a) => a.code)).toEqual(['MATH01', 'ENGL01']); // SCIE01 is closed
    expect(out.again[0]).toMatchObject({ best: { c: 8, t: 10 }, tries: 2, k: T.chipId('sc-maths', KID) });
    expect(out.again[1]).toMatchObject({ best: { c: 6, t: 8 }, tries: 1 });
  });

  test('at most 6', async () => {
    for (let i = 0; i < 8; i += 1) {
      db.quiz_share_codes.push(code(`sc-x${i}`, `XQ00${i}`, 'q-eng', { created_at: ago(100 + i) }));
      db.quiz_sessions.push(sess(`sx${i}`, `sc-x${i}`, 'q-eng', 'completed', 1, 2, ago(100 + i)));
    }
    expect((await Hub.hub(T.signHub([KID]), A)).again).toHaveLength(6);
  });
});

describe('hub(): recommended for you', () => {
  test('the last finished quiz\'s chapter first, then the next chapters, then the rest; finished videos never', async () => {
    // Last finished = the Maths video quiz (V2, chapter Fractions). V2's quiz is finished.
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.recs.map((r) => r.vid)).toEqual([V(3), V(8), V(4)]); // Quarters, Thirds (same chapter), Measurement (next)
    expect(out.recs[0]).toMatchObject({ title: 'Quarters', chapter: 'Fractions', subject: 'Maths', grade: '3' });
  });

  test('fill to 3: earlier chapters of the subject, then the grade\'s other subjects in the Flow\'s order', async () => {
    db.quiz_sessions.push(sess('s7', 'sc-v3', VQ(3), 'completed', 2, 2, ago(19)));
    db.quiz_sessions.push(sess('s8', 'sc-v8', VQ(8), 'completed', 2, 2, ago(19)));
    db.quiz_sessions.push(sess('s9', 'sc-v4', VQ(4), 'completed', 2, 2, ago(19)));
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.recs.map((r) => r.vid)).toEqual([V(1), V(5), V(6)]); // Addition (rest of Maths), then English
  });

  test('no history: the first chapter of each subject of the child\'s grade', async () => {
    seed({ quiz_sessions: [] });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.recs.map((r) => r.vid)).toEqual([V(5), V(1), V(7)]); // English, Maths, Science
  });

  test('a lesson quiz (no video) points the recs at its subject and grade', async () => {
    db.quiz_sessions = [sess('s1', 'sc-eng', 'q-eng', 'completed', 6, 8, ago(5))];
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.recs[0].subject).toBe('English');
  });

  test('the hub_open event carries counts only', async () => {
    await Hub.hub(T.signHub([KID]), A);
    const call = logEvent.mock.calls.find((c) => c[0] === 'web_quiz.hub_open');
    expect(call[1]).toMatchObject({ kids: 1, has_teacher: true, again_n: 2, recs_n: 3 });
    expect(JSON.stringify(call[1])).not.toMatch(/Sana|Testwala|4444/);
  });
});

describe('kidFromHub (the library and challenge routes)', () => {
  test('the chip\'s child, their grade and their class root code; a foreign chip or forged token is null', async () => {
    const token = T.signHub([KID, SIB]);
    expect(await Hub.kidFromHub(token, chipH(KID), DEV_A)).toEqual({ studentId: KID, grade: '3', rootId: 'sc-maths' });
    expect(await Hub.kidFromHub(token, chipH(OTHER), DEV_A)).toBeNull();
    expect(await Hub.kidFromHub('abc.def', chipH(KID), DEV_A)).toBeNull();
    expect(await Hub.kidFromHub(token, chipH(SIB), DEV_A)).toEqual({ studentId: SIB, grade: '5', rootId: null });
  });

  test('a forwarded link opens no library as the child: another phone, or no device, is null', async () => {
    const token = T.signHub([KID]);
    expect(await Hub.kidFromHub(token, chipH(KID), DEV_A)).toMatchObject({ studentId: KID });
    expect(await Hub.kidFromHub(token, chipH(KID), DEV_B)).toBeNull();
    expect(await Hub.kidFromHub(token, chipH(KID))).toBeNull();
  });
});

describe('the library and the recommendations from a forwarded hub link (real kidFromHub)', () => {
  test('device B: the library from the hub and a recommended video start are 401; device A is not refused for who it is', async () => {
    db.app_settings.push({ key: 'web_quiz_library', value: 'true' }, { key: 'web_quiz_enabled', value: 'true' });
    Hub._resetCache();
    const Lib = require('../../../shared/services/quiz/web-quiz-library');
    const Videos = require('../../../shared/services/quiz/web-quiz-videos');
    const token = T.signHub([KID]);
    await Hub.hub(token, A); // the family phone opens it first
    await expect(Videos.start({ hub: token, kid: chipH(KID), vid: V(3), device: DEV_B })).rejects.toMatchObject({ status: 401, body: { error: 'bad_token' } });
    await expect(Lib.libHub(token, { kid: chipH(KID), device: DEV_B })).rejects.toMatchObject({ status: 401 });
    const whoA = await Videos.start({ hub: token, kid: chipH(KID), vid: V(3), device: DEV_A }).then(() => 200, (e) => e.status);
    expect(whoA).not.toBe(401);
    const libA = await Lib.libHub(token, { kid: chipH(KID), device: DEV_A }).then(() => 200, (e) => e.status);
    expect(libA).not.toBe(401);
  });
});

describe('hub(): subject and grade art (the library\'s pictures, WebQuizLibrary.subjectArt / gradeArt)', () => {
  test('play-again rows and recommendations carry their subject\'s picture; the library tile the child\'s grade picture', async () => {
    db.app_settings.push({ key: 'web_quiz_library', value: 'true' });
    Hub._resetCache();
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.again.find((a) => a.code === 'MATH01').art).toBe('/wq/art/subject-maths-1.webp');
    // a lesson quiz writes 'english' in lower case: the bank's subject name finds its picture
    expect(out.again.find((a) => a.code === 'ENGL01').art).toBe('/wq/art/subject-english-1.webp');
    expect(out.recs.length).toBeGreaterThan(0);
    out.recs.forEach((r) => expect(r.art).toBe(`/wq/art/subject-${r.subject.toLowerCase()}-1.webp`));
    expect(out.lib.art).toBe('/wq/art/grade-3-1.webp');
  });

  test('a subject with no picture has no art (the page keeps its emoji tile)', async () => {
    db.quizzes.find((q) => q.id === 'q-eng').subject = 'computer';
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.again.find((a) => a.code === 'ENGL01').art).toBeUndefined();
  });
});

describe('hub(): challenge and library', () => {
  test('challenge only with web_quiz_challenge on and grade 2-5; library to M4b\'s page when it is on', async () => {
    expect((await Hub.hub(T.signHub([KID]), A)).challenge).toBeNull();
    seed({ app_settings: [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_challenge', value: 'true' }, { key: 'web_quiz_library', value: 'true' }] });
    Hub._resetCache();
    const token = T.signHub([KID]);
    const out = await Hub.hub(token, A);
    expect(out.challenge).toMatchObject({ on: true });
    expect(out.lib.href).toBe(`/lib/${token}?kid=${chipH(KID)}&l=en`);
  });

  // The tile and the challenge page decide eligibility with ONE grade rule (the challenge's), so a tile is never a dead end.
  const CH_ON = [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_challenge', value: 'true' }];
  function bandOnly(extra = {}) {
    seed({ app_settings: CH_ON, ...extra });
    // A loose child: no class list, no class given, and only quizzes for a band of grades.
    Object.assign(db.students[0], { list_id: null, self_reported_class: null });
    db.quizzes.forEach((q) => { q.grade = '3-5'; });
    db.quiz_sessions.forEach((x) => { x.student_class = null; });
    Hub._resetCache();
  }

  test('a child known only by a band of grades (3-5) gets no challenge tile: the challenge itself refuses them', async () => {
    bandOnly();
    const token = T.signHub([KID]);
    const out = await Hub.hub(token, A);
    expect(out.kid).toBe(chipH(KID));
    expect(out.challenge).toBeNull();
    // The library and recommendations still use the band's first grade.
    expect(out.recs.length).toBeGreaterThan(0);
    // The same child at the challenge door: refused, so the hub showing no tile is the same answer.
    const Challenge = require('../../../shared/services/quiz/web-quiz-challenge');
    await expect(Challenge.menu(token, { kid: chipH(KID), device: DEV_A })).rejects.toMatchObject({ status: 403, body: { error: 'not_eligible' } });
  });

  test('a band-only child enrolled in a grade-3 class gets the tile, as the challenge reads the enrolment', async () => {
    bandOnly({ class_enrollments: [{ id: 'e1', class_id: 'c1', student_id: KID, is_active: true }], classes: [{ id: 'c1', grade_code: 'grade_3' }] });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.challenge).toMatchObject({ on: true });
  });

  test('the library link carries the child\'s language, so an Urdu child gets the Urdu library', async () => {
    seed({ app_settings: [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_library', value: 'true' }] });
    db.quiz_share_codes.forEach((c) => { c.language = 'ur'; });
    db.quizzes.forEach((q) => { q.language = 'ur'; });
    Hub._resetCache();
    const token = T.signHub([KID]);
    const out = await Hub.hub(token, A);
    expect(out.lang).toBe('ur');
    expect(out.lib.href).toBe(`/lib/${token}?kid=${chipH(KID)}&l=ur`);
  });

  test('library off: the child\'s newest open quiz, under that code\'s chip', async () => {
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.lib.href).toBe(`/q/MATH01?k=${T.chipId('sc-maths', KID)}`);
  });
});

describe('WhatsApp /quiz (student-quiz open)', () => {
  test('hub on: ONE cta_url message to <portal>/h/<token> naming this phone\'s own children; nothing else', async () => {
    expect(await SQ.open(PHONE)).toBe(true);
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
    const [to, msg] = WhatsAppService.sendCtaUrl.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(msg.body).toBe(resolveUx('sqHubBody', { language: 'en' }));
    expect(msg.buttonText).toBe(resolveUx('sqHubBtn', { language: 'en' }));
    expect([...msg.buttonText].length).toBeLessThanOrEqual(20);
    const m = /^https:\/\/portal\.example\.test\/h\/([^/?#]+)$/.exec(msg.url);
    expect(m).not.toBeNull();
    expect(T.verify(m[1], 'h').ids.sort()).toEqual([KID, SIB].sort());
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('hub on, Urdu quizzes: the Urdu copy, button within 20 code points', async () => {
    db.quizzes.forEach((q) => { q.language = 'ur'; });
    await SQ.open(PHONE);
    const [, msg] = WhatsAppService.sendCtaUrl.mock.calls[0];
    expect(msg.body).toBe(resolveUx('sqHubBody', { language: 'ur' }));
    expect([...msg.buttonText].length).toBeLessThanOrEqual(20);
  });

  test('hub off (row false, or no row): today\'s two buttons exactly, no link message', async () => {
    for (const settings of [[{ key: 'web_quiz_hub', value: 'false' }], []]) {
      jest.clearAllMocks();
      Hub._resetCache();
      seed({ app_settings: settings });
      await SQ.open(PHONE);
      expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
      const [, opts] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
      expect(opts.buttons.map((b) => b.id)).toEqual([SQ.RETRY_ID, SQ.CARD_ID]);
      expect(opts.body).toBe(resolveUx('sqFallbackBody', { language: 'en', params: { topic: 'Fractions quiz', score: '8/10' } }));
    }
  });

  test('hub off with the Flow configured: today\'s Flow exactly', async () => {
    seed({ app_settings: [] });
    process.env.STUDENT_QUIZ_FLOW_ID = 'flow-sq';
    await SQ.open(PHONE);
    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
  });

  test('hub on but the link send fails: falls back to today\'s message, never silence', async () => {
    WhatsAppService.sendCtaUrl.mockResolvedValueOnce(false);
    await SQ.open(PHONE);
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  });

  test('hub on but no portal URL: today\'s message', async () => {
    delete process.env.PORTAL_URL;
    await SQ.open(PHONE);
    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  });
});

describe('hub(): the child\'s language is their class\'s, not their last library lesson\'s', () => {
  // An Urdu lesson tapped from the English maths class: its code speaks Urdu (the lesson's language).
  const lessonPlayed = () => {
    db.quiz_share_codes.push(code('sc-lesson', 'LESN01', VQ(1), { language: 'ur', parent_share_code_id: 'sc-maths', created_at: ago(2) }));
    db.quiz_sessions.push(sess('s9', 'sc-lesson', VQ(1), 'completed', 3, 3, ago(1)));
  };

  test('the hub stays English after the child plays an Urdu lesson from the library', async () => {
    lessonPlayed();
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.lang).toBe('en');
    expect(out.kids[0].first).toBe('Sana');
    expect(out.lib && out.lib.href ? out.lib.href : '').not.toMatch(/l=ur/);
  });

  test('a forwarded (locked) hub stays English too', async () => {
    lessonPlayed();
    const token = T.signHub([KID]);
    await Hub.hub(token, { device: DEV_A });
    expect((await Hub.hub(token, { device: DEV_B })).lang).toBe('en');
  });
});

describe('hub(): the page-session telemetry switch rides the boot (rt)', () => {
  test('rt follows app_settings web_quiz_rich_telemetry, off by default', async () => {
    const Tel = require('../../../shared/services/quiz/web-quiz-telemetry');
    Tel._reset();
    expect((await Hub.hub(T.signHub([KID]), A)).rt).toBe(false);
    db.app_settings.push({ key: 'web_quiz_rich_telemetry', value: 'true' });
    Tel._reset();
    expect((await Hub.hub(T.signHub([KID]), A)).rt).toBe(true);
    Tel._reset();
  });
});
