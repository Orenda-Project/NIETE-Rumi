'use strict';
/**
 * Which class is this hand-out for?
 *
 * A teacher's share code was minted with no class, so a child opening it could
 * not be matched against the right roster and the teacher's report could not
 * say who has not played. Now:
 *   known     → the code is minted bound to the class, nothing new is sent;
 *   ambiguous → the hand-out goes out exactly as before (unbound), THEN one
 *               question; a tap binds that code late, "All / not sure" clears;
 *   none      → exactly as before.
 * The hand-out never waits on the question.
 *
 * Mocks only the network boundary (supabase, redis, whatsapp.service, logs) and
 * the class resolver (web-quiz-identity), a separate module with its own tests;
 * handout-class-real-resolver.test.js drives the real one.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/web-quiz-identity', () => ({ resolveQuizClass: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const Identity = require('../../shared/services/quiz/web-quiz-identity');
const share = require('../../shared/services/quiz/video-quiz-share.service');
const HandoutClass = require('../../shared/services/quiz/handout-class.service');
const render = require('../../shared/services/quiz/video-quiz-render.service');
const { UX_STRINGS, resolveUx } = require('../../shared/config/ux-strings');

const PHONE = '923000000111';
const TEACHER = '00000000-0000-4000-8000-0000000000aa';
const QUIZ = '00000000-0000-4000-8000-0000000000bb';
const C4A = { id: '00000000-0000-4000-8000-00000000004a', label: '4-A', listId: null };
const C4B = { id: '00000000-0000-4000-8000-00000000004b', label: '4-B', listId: null };
const C5A = { id: '00000000-0000-4000-8000-00000000005a', label: '5-A', listId: null };
const CTX = { quizId: QUIZ, videoId: null, userId: TEACHER, language: 'en' };
const cp = (s) => [...String(s)].length;
const codeId = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;

// ── a tiny in-memory supabase + redis ────────────────────────────────────────
let db;
function fakeFrom(table) {
  const q = { table, op: 'select', payload: null, filters: [] };
  const run = async () => {
    if (q.op === 'insert') {
      db.inserts.push({ table, payload: q.payload });
      if (table === 'quiz_share_codes' && 'class_id' in q.payload && db.classFkMiss) {
        return { data: null, error: { code: '23503', message: 'insert or update on table "quiz_share_codes" violates foreign key constraint "quiz_share_codes_class_id_fkey"' } };
      }
      if (table === 'quiz_share_codes' && 'class_id' in q.payload && db.classColumnMissing) {
        return { data: null, error: { code: db.classColumnMissing, message: "column \"class_id\" of relation \"quiz_share_codes\" does not exist" } };
      }
      return { data: { id: codeId(db.inserts.length), code: q.payload.code }, error: null };
    }
    if (q.op === 'update') {
      db.updates.push({ table, payload: q.payload, filters: q.filters });
      if (table === 'quiz_share_codes' && db.bindError) return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
      return { data: null, error: null };
    }
    const id = (q.filters.find((f) => f[1] === 'id') || [])[2];
    if (table === 'users') return { data: { name: 'Teacher Testwala', preferred_language: db.userLang || null }, error: null };
    if (table === 'quizzes') return { data: { topic: 'Fractions', ...db.quiz }, error: null };
    if (table === 'classes') return { data: db.classes[id] || null, error: null };
    if (table === 'app_settings') return { data: [], error: null };
    return { data: null, error: null };
  };
  const api = {
    select() { return api; },
    insert(p) { q.op = 'insert'; q.payload = p; return api; },
    update(p) { q.op = 'update'; q.payload = p; return api; },
    eq(c, v) { q.filters.push(['eq', c, v]); return api; },
    is(c, v) { q.filters.push(['is', c, v]); return api; },
    in(c, v) { q.filters.push(['in', c, v]); return api; },
    maybeSingle: run,
    single: run,
    then(res, rej) { return run().then(res, rej); },
  };
  return api;
}
let store;

beforeEach(() => {
  jest.clearAllMocks();
  db = {
    inserts: [], updates: [], classColumnMissing: null,
    quiz: { grade: null, quiz_source: 'transcript', teacher_id: TEACHER },
    classes: { [C4A.id]: { grade_code: 'grade_4' }, [C4B.id]: { grade_code: 'grade_4' }, [C5A.id]: { grade_code: 'grade_5' } },
  };
  supabase.from.mockImplementation(fakeFrom);
  store = new Map();
  redis.get.mockImplementation(async (k) => (store.has(k) ? store.get(k) : null));
  redis.set.mockImplementation(async (k, v) => { store.set(k, v); return true; });
  redis.delete.mockImplementation(async (k) => { store.delete(k); return true; });
  redis.setNX.mockImplementation(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; });
  HandoutClass._resetForTests();
});

const shareInserts = () => db.inserts.filter((i) => i.table === 'quiz_share_codes');
const sentTexts = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);

describe('deliverClassLink — the class is known', () => {
  test('mints the code bound to the class and sends the two class messages, nothing else', async () => {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'known', class: C4A, classes: [C4A] });

    await share.deliverClassLink(CTX, PHONE);

    expect(Identity.resolveQuizClass).toHaveBeenCalledWith(expect.objectContaining({ teacherUserId: TEACHER, quizId: QUIZ }));
    expect(shareInserts()).toHaveLength(1);
    expect(shareInserts()[0].payload.class_id).toBe(C4A.id);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
  });

  test('no class (none) is today exactly: unbound, no question', async () => {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'none', class: null, classes: [] });
    await share.deliverClassLink(CTX, PHONE);
    expect(shareInserts()).toHaveLength(1);
    expect(shareInserts()[0].payload.class_id).toBeUndefined();
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
  });

  test('a resolver that throws fails open to today: unbound link, logged', async () => {
    Identity.resolveQuizClass.mockRejectedValue(new Error('db down'));
    await share.deliverClassLink(CTX, PHONE);
    expect(shareInserts()[0].payload.class_id).toBeUndefined();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.class_resolve_failed', expect.objectContaining({ quizId: QUIZ }));
  });
});

describe('deliverClassLink — the class is ambiguous: hand-out first, question second', () => {
  test('two classes: the two class messages go out unbound, THEN ONE button question about that code', async () => {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'ambiguous', class: null, classes: [C4B, C4A] });

    await share.deliverClassLink(CTX, PHONE);

    expect(shareInserts()).toHaveLength(1);
    expect(shareInserts()[0].payload.class_id).toBeUndefined();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const lastText = Math.max(...WhatsAppService.sendMessage.mock.invocationCallOrder);
    expect(WhatsAppService.sendInteractiveButtons.mock.invocationCallOrder[0]).toBeGreaterThan(lastText);
    const [to, body] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(body.body).toBe('Which class is this quiz for?');
    expect(body.buttons.map((b) => b.title)).toEqual(['4-A', '4-B', 'All / not sure']);
    const code = codeId(1);
    expect(body.buttons.map((b) => b.id)).toEqual([`vq_wc_${code}_${C4A.id}`, `vq_wc_${code}_${C4B.id}`, `vq_wc_${code}_any`]);
    expect(store.get(HandoutClass.ASK_KEY(code))).toEqual(expect.objectContaining({ quizId: QUIZ, userId: TEACHER, phone: PHONE }));
  });

  test('one class outside the quiz grade: asks "4-A / All / not sure" after the unbound hand-out', async () => {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'ambiguous', class: null, classes: [C4A] });
    await share.deliverClassLink(CTX, PHONE);
    const [, body] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(body.buttons.map((b) => b.title)).toEqual(['4-A', 'All / not sure']);
    expect(shareInserts()).toHaveLength(1);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
  });

  test('three or more classes: a list (Meta caps buttons at 3), rows within 24 code points, "All / not sure" last', async () => {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'ambiguous', class: null, classes: [C5A, C4A, C4B] });

    await share.deliverClassLink({ ...CTX, language: 'ur' }, PHONE);

    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
    const [, list] = WhatsAppService.sendInteractiveMessage.mock.calls[0];
    expect(list.body.text).toBe(resolveUx('vqWhichClass', { language: 'ur' }));
    const rows = list.action.sections.flatMap((s) => s.rows);
    const code = codeId(1);
    expect(rows.map((r) => r.id)).toEqual([`vq_wc_${code}_${C4A.id}`, `vq_wc_${code}_${C4B.id}`, `vq_wc_${code}_${C5A.id}`, `vq_wc_${code}_any`]);
    expect(rows[3].title).toBe(resolveUx('vqWhichClassAny', { language: 'ur' }));
    rows.forEach((r) => expect(cp(r.title)).toBeLessThanOrEqual(24));
    expect(cp(list.action.button)).toBeLessThanOrEqual(20);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
  });

  test('more than 9 classes: 9 class rows + "All / not sure" (the 10-row cap)', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, label: `${i + 1}-A`, listId: null }));
    Identity.resolveQuizClass.mockResolvedValue({ state: 'ambiguous', class: null, classes: many });
    await share.deliverClassLink(CTX, PHONE);
    const rows = WhatsAppService.sendInteractiveMessage.mock.calls[0][1].action.sections.flatMap((s) => s.rows);
    expect(rows).toHaveLength(10);
    expect(rows[9].id).toBe(`vq_wc_${codeId(1)}_any`);
  });

  test('legacy lists standing in for classes (no class id) are never offered; with none left, no question', async () => {
    const legacy = { id: null, listId: 'list-1', legacy: true, label: '4' };
    Identity.resolveQuizClass.mockResolvedValue({ state: 'ambiguous', class: null, classes: [legacy, C4A] });
    await share.deliverClassLink(CTX, PHONE);
    const [, body] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(body.buttons.map((b) => b.title)).toEqual(['4-A', 'All / not sure']);

    jest.clearAllMocks();
    Identity.resolveQuizClass.mockResolvedValue({ state: 'ambiguous', class: null, classes: [legacy, { ...legacy, listId: 'list-2' }] });
    await share.deliverClassLink(CTX, PHONE);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
  });

  test('a question that cannot be delivered leaves the hand-out as it is (already out) and keeps nothing', async () => {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'ambiguous', class: null, classes: [C4A, C4B] });
    WhatsAppService.sendInteractiveButtons.mockResolvedValueOnce(false);
    await expect(share.deliverClassLink(CTX, PHONE)).resolves.toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
    expect(store.has(HandoutClass.ASK_KEY(codeId(1)))).toBe(false);
  });

  test('a failed mint asks nothing', async () => {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'ambiguous', class: null, classes: [C4A, C4B] });
    supabase.from.mockImplementation((t) => {
      const api = fakeFrom(t);
      if (t !== 'quiz_share_codes') return api;
      const bad = { ...api, insert() { return bad; }, select() { return bad; }, single: async () => ({ data: null, error: { code: '500', message: 'down' } }) };
      return bad;
    });
    await share.deliverClassLink(CTX, PHONE);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });
});

describe('the teacher answers — the code is bound late', () => {
  async function asked(classes = [C4A, C4B], ctx = CTX) {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'ambiguous', class: null, classes });
    await share.deliverClassLink(ctx, PHONE);
    const code = codeId(db.inserts.length);
    jest.clearAllMocks();
    return code;
  }
  const binds = () => db.updates.filter((u) => u.table === 'quiz_share_codes');

  test('tapping 4-B binds THAT code to 4-B (only while unbound) and confirms; no second code', async () => {
    const code = await asked();
    expect(await HandoutClass.handleTap(`vq_wc_${code}_${C4B.id}`, PHONE)).toBe(true);
    expect(shareInserts()).toHaveLength(1);
    expect(binds()).toHaveLength(1);
    expect(binds()[0].payload).toEqual({ class_id: C4B.id });
    expect(binds()[0].filters).toEqual(expect.arrayContaining([['eq', 'id', code], ['is', 'class_id', null]]));
    expect(sentTexts()).toEqual([resolveUx('vqWhichClassBound', { language: 'en', params: { cls: '4-B' } })]);
    expect(store.has(HandoutClass.ASK_KEY(code))).toBe(false);
  });

  test('"All / not sure" leaves the code unbound, clears the question, and answers the tap in one line', async () => {
    const code = await asked();
    expect(await HandoutClass.handleTap(`vq_wc_${code}_any`, PHONE)).toBe(true);
    expect(binds()).toHaveLength(0);
    expect(sentTexts()).toEqual([resolveUx('vqWhichClassAnyDone', { language: 'en' })]);
    expect(store.has(HandoutClass.ASK_KEY(code))).toBe(false);
  });

  test('a tap after the question closed is answered (in the teacher\'s language), never silence', async () => {
    db.userLang = 'ur';
    expect(await HandoutClass.handleTap(`vq_wc_${codeId(9)}_${C4A.id}`, PHONE)).toBe(true);
    expect(binds()).toHaveLength(0);
    expect(sentTexts()).toEqual([resolveUx('vqWhichClassClosed', { language: 'ur' })]);
  });

  test('a bind that fails says so, never "Got it"', async () => {
    const code = await asked();
    db.bindError = true;
    expect(await HandoutClass.handleTap(`vq_wc_${code}_${C4B.id}`, PHONE)).toBe(true);
    expect(sentTexts()).toEqual([resolveUx('vqWhichClassNotSaved', { language: 'en' })]);
  });

  test('a second tap after the answer binds nothing more', async () => {
    const code = await asked();
    await HandoutClass.handleTap(`vq_wc_${code}_${C4A.id}`, PHONE);
    await HandoutClass.handleTap(`vq_wc_${code}_${C4B.id}`, PHONE);
    expect(binds()).toHaveLength(1);
    expect(binds()[0].payload).toEqual({ class_id: C4A.id });
  });

  test('two hand-outs in a row: a tap on the FIRST question binds the first code, not the second', async () => {
    const first = await asked();
    await share.deliverClassLink({ ...CTX, quizId: '00000000-0000-4000-8000-0000000000cc' }, PHONE);
    const second = codeId(db.inserts.length);
    expect(second).not.toBe(first);
    await HandoutClass.handleTap(`vq_wc_${first}_${C4A.id}`, PHONE);
    expect(binds()).toHaveLength(1);
    expect(binds()[0].filters).toEqual(expect.arrayContaining([['eq', 'id', first]]));
    expect(store.has(HandoutClass.ASK_KEY(second))).toBe(true);
  });

  test('a tap with nothing kept (a week later), a class not offered, or from another phone binds nothing', async () => {
    expect(await HandoutClass.handleTap(`vq_wc_${codeId(9)}_${C4A.id}`, PHONE)).toBe(true);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.class_ask_expired', expect.objectContaining({ shareCodeId: codeId(9) }));
    const code = await asked();
    expect(await HandoutClass.handleTap(`vq_wc_${code}_${C5A.id}`, PHONE)).toBe(true);
    expect(await HandoutClass.handleTap(`vq_wc_${code}_${C4A.id}`, '923000000999')).toBe(true);
    expect(binds()).toHaveLength(0);
    expect(store.has(HandoutClass.ASK_KEY(code))).toBe(true);
  });

  test('a malformed vq_wc_ id is claimed and does nothing; ids from other features are not claimed', async () => {
    expect(await HandoutClass.handleTap('vq_wc_nonsense', PHONE)).toBe(true);
    expect(await HandoutClass.handleTap('vq_share_yes', PHONE)).toBe(false);
    expect(await HandoutClass.handleTap('vq_q1_2', PHONE)).toBe(false);
    expect(binds()).toHaveLength(0);
  });

  test('the new ids can never be read as a quiz answer (handleAnswer is the catch-all)', () => {
    expect(render.parseAnswer(`vq_wc_${codeId(1)}_${C4A.id}`)).toBeNull();
    expect(render.parseAnswer(`vq_wc_${codeId(1)}_any`)).toBeNull();
  });

  test('the bind fills a NULL grade of a coaching quiz', async () => {
    const code = await asked();
    await HandoutClass.handleTap(`vq_wc_${code}_${C4A.id}`, PHONE);
    const fill = db.updates.find((u) => u.table === 'quizzes');
    expect(fill.payload).toEqual({ grade: '4' });
  });
});

describe('mintCode — an environment without the class_id column', () => {
  test.each(['42703', 'PGRST204'])('%s: retries without class_id, mints, logs once', async (code) => {
    db.classColumnMissing = code;
    const a = await share.mintCode({ ...CTX, classId: C4A.id });
    const b = await share.mintCode({ ...CTX, classId: C4B.id });
    expect(a && a.code).toBeTruthy();
    expect(b && b.code).toBeTruthy();
    const unavailable = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.class_bind_unavailable');
    expect(unavailable).toHaveLength(1);
  });

  test('a class id that is not a classes row (a legacy list standing in) mints unbound, the hand-out still goes out', async () => {
    db.classFkMiss = true;
    const a = await share.mintCode({ ...CTX, classId: C4A.id });
    expect(a && a.code).toBeTruthy();
    expect(shareInserts()).toHaveLength(2);
    expect('class_id' in shareInserts()[1].payload).toBe(false);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.class_bind_refused', expect.objectContaining({ quizId: QUIZ }));
    db.classFkMiss = false;
    await share.mintCode({ ...CTX, classId: C4B.id });
    expect(shareInserts()[2].payload.class_id).toBe(C4B.id);   // not a sticky switch-off
  });

  test('without a classId the insert never names the column', async () => {
    db.classColumnMissing = '42703';
    await share.mintCode(CTX);
    expect(shareInserts()).toHaveLength(1);
    expect('class_id' in shareInserts()[0].payload).toBe(false);
  });
});

describe('coaching-born quizzes get the class grade', () => {
  const gradeWrites = () => db.updates.filter((u) => u.table === 'quizzes');

  test('known class + quiz grade NULL → quizzes.grade = "4", only while still NULL', async () => {
    await share.mintCode({ ...CTX, classId: C4A.id });
    expect(gradeWrites()).toHaveLength(1);
    expect(gradeWrites()[0].payload).toEqual({ grade: '4' });
    expect(gradeWrites()[0].filters).toEqual(expect.arrayContaining([['eq', 'id', QUIZ], ['is', 'grade', null]]));
  });

  test('a quiz that already has a grade is never overwritten', async () => {
    db.quiz.grade = '3-5';
    await share.mintCode({ ...CTX, classId: C4A.id });
    expect(gradeWrites()).toHaveLength(0);
  });

  test('a shared video quiz is never written (one row serves every teacher)', async () => {
    db.quiz.quiz_source = 'video';
    await share.mintCode({ ...CTX, classId: C4A.id });
    expect(gradeWrites()).toHaveLength(0);
  });

  test("another teacher's quiz, an early-years class, or an unbound code: no write", async () => {
    db.quiz.teacher_id = 'someone-else';
    await share.mintCode({ ...CTX, classId: C4A.id });
    db.quiz.teacher_id = TEACHER;
    db.classes[C4A.id] = { grade_code: 'early_years' };
    await share.mintCode({ ...CTX, classId: C4A.id });
    await share.mintCode(CTX);
    expect(gradeWrites()).toHaveLength(0);
  });
});

describe('the strings', () => {
  const KEYS = ['vqWhichClass', 'vqWhichClassAny', 'vqWhichClassPick', 'vqWhichClassBound'];

  test('every key exists in English and Urdu', () => {
    KEYS.forEach((k) => {
      expect(UX_STRINGS[k] && UX_STRINGS[k].en).toBeTruthy();
      expect(UX_STRINGS[k].ur).toMatch(/[؀-ۿ]/);
    });
  });

  test('field caps in CODE POINTS: buttons and the list button 20, list body under 1024', () => {
    ['en', 'ur'].forEach((language) => {
      expect(cp(resolveUx('vqWhichClassAny', { language }))).toBeLessThanOrEqual(20);
      expect(cp(resolveUx('vqWhichClassPick', { language }))).toBeLessThanOrEqual(20);
      expect(cp(resolveUx('vqWhichClass', { language }))).toBeLessThanOrEqual(1024);
      expect(cp(resolveUx('vqWhichClassBound', { language, params: { cls: '10-A (evening)' } }))).toBeLessThanOrEqual(1024);
    });
  });

  test('a class label in the Urdu line is isolated, so "4-A" cannot reverse', () => {
    expect(resolveUx('vqWhichClassBound', { language: 'ur', params: { cls: '4-A' } })).toContain('⁨4-A⁩');
  });

  test('a long class label is clamped to the button cap', async () => {
    const long = { id: C4A.id, label: 'Class 4 Science Morning Blue', listId: null };
    Identity.resolveQuizClass.mockResolvedValue({ state: 'ambiguous', class: null, classes: [long] });
    await share.deliverClassLink(CTX, PHONE);
    WhatsAppService.sendInteractiveButtons.mock.calls[0][1].buttons.forEach((b) => expect(cp(b.title)).toBeLessThanOrEqual(20));
  });
});

describe('whatsapp-bot.js routes the new ids (both branches) ahead of the answer catch-all', () => {
  const fs = require('fs');
  const path = require('path');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const SRC = strip(fs.readFileSync(path.join(__dirname, '../../whatsapp-bot.js'), 'utf8'));

  test('button_reply: handleTap sits in the vq_ chain before handleAnswer', () => {
    const tap = SRC.indexOf('HandoutClass.handleTap(buttonId, from)');
    const answer = SRC.indexOf('VideoQuizService.handleAnswer(from, buttonId');
    expect(tap).toBeGreaterThan(-1);
    expect(answer).toBeGreaterThan(-1);
    expect(tap).toBeLessThan(answer);
  });

  test('list_reply: vq_wc_ rows reach handleTap before the vq_ answer branch', () => {
    const tap = SRC.indexOf('HandoutClass.handleTap(listId, from)');
    const answer = SRC.indexOf('VideoQuizService.handleAnswer(from, listId');
    expect(tap).toBeGreaterThan(-1);
    expect(answer).toBeGreaterThan(-1);
    expect(tap).toBeLessThan(answer);
  });

  test('no per-message hook: an ordinary inbound costs no extra read', () => {
    expect(SRC).not.toMatch(/settlePending/);
  });
});
