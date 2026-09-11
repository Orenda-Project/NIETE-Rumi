/**
 * bd-2wzpi — tapping "Take quiz" can leave a teacher with no reply at all.
 *
 * startTrainingQuiz has five exits that write a log line and send NOTHING:
 *
 *   invalid module id · module lookup failed · empty question bank ·
 *   no active program assignment · attempt insert failed
 *
 * and NEITHER caller checks what it returns:
 *
 *   content-delivery.js:449   await QuizDelivery.startTrainingQuiz(...)   result discarded
 *   whatsapp-bot.js:683       await QuizDelivery.startTrainingQuiz(...)   then `return`
 *
 * The content-delivery call sits inside a try/catch, but these are `return
 * false`, not `throw`, so the catch never runs. whatsapp-bot.js:683 is the
 * `training_quiz_retry_` button — so a teacher who hits the failure once, taps
 * *Retry*, and gets silence again.
 *
 * From her side the bot has simply stopped. 387 attempts sit at question 0 with
 * not one answer recorded, and 346 of those were already there when this was
 * first measured on 1 September.
 *
 * THE FIX IS ALREADY IN THIS FILE, one function over. The LEVEL EXAM path says
 * "You are not enrolled in a training program yet. Please contact your NIETE
 * coach." on exactly this condition. The module-quiz path never got the same
 * treatment. This pins that it does.
 *
 * Not changed here: the return values. Callers still ignore them, and that is
 * fine once the function speaks for itself — the teacher is told either way.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(),
  getCurrentCorrelationId: () => null,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
jest.mock('pdfkit', () => jest.fn(), { virtual: true });

const PHONE = '923001234567';
const USER = 'u-1';
const MODULE = 42;

/**
 * @param {object} f  which step should fail:
 *   moduleMissing · emptyBank · noAssignment · insertFails · (none = happy path)
 */
function makeSupabase(f = {}) {
  const build = (table) => {
    const st = { table, filters: {}, op: null, payload: null };
    const chain = {
      select() { return chain; },
      insert(p) { st.op = 'insert'; st.payload = p; return chain; },
      upsert(p) { st.op = 'upsert'; st.payload = p; return chain; },
      update(p) { st.op = 'update'; st.payload = p; return chain; },
      eq(c, v) { st.filters[c] = v; return chain; },
      in() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      then(res) { return res(settle()); },
      maybeSingle: async () => settle(true),
      single: async () => settle(true),
    };
    function settle(one = false) {
      if (st.table === 'training_modules') {
        if (f.moduleMissing) return { data: null, error: { message: 'not found' } };
        return { data: one ? { id: MODULE, course_id: 7, title: 'Phonics' } : [{ id: MODULE, course_id: 7, title: 'Phonics' }], error: null };
      }
      if (st.table === 'training_questions') {
        const bank = f.emptyBank ? [] : [1, 2, 3].map(i => ({
          id: `q-${i}`, question_text: `Q${i}`, options: ['a', 'b', 'c', 'd'],
          correct_option: '1', order_index: i, is_active: true,
        }));
        return { data: one ? bank[0] || null : bank, error: null };
      }
      if (st.table === 'teacher_training_assignments') {
        if (f.noAssignment) return { data: one ? null : [], error: null };
        return { data: one ? { program_id: 'p-1' } : [{ program_id: 'p-1' }], error: null };
      }
      if (st.table === 'training_assessment_attempts') {
        if (st.op === 'insert') {
          if (f.insertFails) return { data: null, error: { message: 'insert refused' } };
          return { data: { id: 'att-1' }, error: null };
        }
        return { data: one ? null : [], error: null };   // no attempt in progress
      }
      if (st.table === 'training_courses') {
        return { data: one ? { id: 7, level_id: 3 } : [{ id: 7, level_id: 3 }], error: null };
      }
      if (st.table === 'training_vendors') {
        return { data: one ? { module_passing_pct: 70 } : [{ module_passing_pct: 70 }], error: null };
      }
      if (st.table === 'training_levels') {
        return { data: one ? { id: 3, vendor_id: 'v-1' } : [{ id: 3, vendor_id: 'v-1' }], error: null };
      }
      return { data: one ? null : [], error: null };
    }
    return chain;
  };
  return { from: (t) => build(t), rpc: jest.fn() };
}

function load(failure) {
  jest.resetModules();
  const sent = [];
  jest.doMock('../../bot/shared/config/supabase', () => makeSupabase(failure));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn(async (_to, body) => { sent.push(String(body)); return true; }),
    sendInteractiveButtons: jest.fn(async (_to, p) => { sent.push(String(p && p.body)); return true; }),
    sendInteractiveMessage: jest.fn(async (_to, p) => { sent.push(String(p && p.body)); return true; }),
  }));
  const svc = require('../../bot/shared/services/training/quiz-delivery.service');
  return { svc, sent };
}

const said = (sent) => sent.join(' ⏎ ');

describe('bd-2wzpi — "Take quiz" must never answer with silence', () => {
  test('an invalid module id still gets a reply', async () => {
    const { svc, sent } = load({});
    await svc.startTrainingQuiz(USER, 'not-a-number', PHONE);
    expect(said(sent)).not.toBe('');
  });

  test('a module that cannot be looked up still gets a reply', async () => {
    const { svc, sent } = load({ moduleMissing: true });
    await svc.startTrainingQuiz(USER, MODULE, PHONE);
    expect(said(sent)).not.toBe('');
  });

  test('a module with no questions still gets a reply', async () => {
    const { svc, sent } = load({ emptyBank: true });
    await svc.startTrainingQuiz(USER, MODULE, PHONE);
    expect(said(sent)).not.toBe('');
  });

  test('a teacher with no active program is TOLD so, as the level exam already tells her', async () => {
    const { svc, sent } = load({ noAssignment: true });
    await svc.startTrainingQuiz(USER, MODULE, PHONE);
    expect(said(sent)).not.toBe('');
    expect(said(sent)).toMatch(/enrolled|programme|program|coach/i);
  });

  test('an attempt that cannot be written still gets a reply', async () => {
    const { svc, sent } = load({ insertFails: true });
    await svc.startTrainingQuiz(USER, MODULE, PHONE);
    expect(said(sent)).not.toBe('');
  });

  test('the happy path is untouched — the question goes out, no apology (regression guard)', async () => {
    const { svc, sent } = load({});
    await svc.startTrainingQuiz(USER, MODULE, PHONE);
    expect(said(sent)).toMatch(/Module check/i);
    expect(said(sent)).not.toMatch(/could not|sorry|contact NIETE support/i);
  });
});
