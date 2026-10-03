/**
 * Child test check Flow (bd-s1oo0.6) — opening the check in the chat, recognising its completion, and
 * the sandbox-only registration guard.
 *
 *   sendCheck(sessionId)          the Flow message L4 calls: header, the child's three headline numbers,
 *                                 «جانچ کریں»; data_exchange mode (a flow token, no screen) so Meta
 *                                 calls our INIT.
 *   detectFlowType                a completion is `child_test_check`, never the loose attendance
 *                                 fallback its colon-bearing token would otherwise hit.
 *   handleCheckCompletion         the endpoint saved everything; the completion only confirms, and
 *                                 tells the coach when the session did NOT get checked.
 *
 * Real: sendCheck, store, detector, completion handler, guard. Mocked: the database client, the
 * WhatsApp send (network), the log sinks.
 */
const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');


let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendMessage: jest.fn(() => Promise.resolve(true)),
}));

const WhatsAppService = require('../../../bot/shared/services/whatsapp.service');
const Logger = require('../../../bot/shared/utils/logger');
const { sendCheck, handleCheckCompletion } = require('../../../bot/shared/services/child-test/check-flow');
const { detectFlowType } = require('../../../bot/shared/utils/flow-type-detector');
const { checkSandboxTarget } = require('../../../bot/scripts/setup/register-child-test-check-flow');
const F = require('./fixtures/ai-marks');

function seed({ lang = 'ur', checked = false, blocks } = {}) {
  const b = blocks || { urdu: F.urduConfident(), english: F.englishConfident(), maths: F.mathsConfident() };
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', preferred_language: lang }],
    child_test_sessions: [{ id: 'sess-1', coach_user_id: 'coach-1', grade: 3, form: 'A', draw_id: 'draw-1', status: 'in_progress' }],
    child_test_draws: [{ id: 'draw-1', roll_number: '14' }],
    students: [],
    child_test_blocks: Object.entries(b).map(([block, ai]) => ({ session_id: 'sess-1', block, ai_marks: ai, ai_status: ai ? 'scored' : 'failed', checked_at: checked ? '2026-10-02T10:00:00.000Z' : null })),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.CHILD_TEST_CHECK_FLOW_ID = 'flow-123';
  seed();
});

describe('sendCheck', () => {
  test('sends the Flow in data_exchange mode with the coach\'s token, the three numbers and «جانچ کریں»', async () => {
    const r = await sendCheck('sess-1');
    expect(r).toEqual({ ok: true });
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    const [to, msg] = WhatsAppService.sendFlow.mock.calls[0];
    expect(to).toBe('923000000001');
    expect(msg).toMatchObject({ flowId: 'flow-123', flowToken: 'coach-1:child-test-check:sess-1', buttonText: 'جانچ کریں' });
    expect(msg.screen).toBeUndefined();
    // a child with no name on the roster: the roll alone, in Urdu digits (CONTRACT §18, bd-s1oo0.27)
    expect(msg.header).toContain('۱۴');
    // Real bars (scoring/thresholds.js): the Urdu story count and quick sums are NEVER pre-filled, so the
    // message states only English 17 and tells the coach to fill the other two (bd-s1oo0.27).
    expect(msg.body).toContain('انگریزی ۱۷ الفاظ');
    expect(msg.body).not.toContain('۴۱');
    expect(msg.body).not.toContain('حساب ۱۲');
    expect(msg.body).toMatch(/آپ خود بھریں: اردو: کہانی کی گنتی/);
    expect(msg.body).toMatch(/فوری سوالوں کی گنتی/);
    expect(msg.body).toMatch(/تقریباً دو منٹ/);
    expect([...msg.header].length).toBeLessThanOrEqual(60);
    expect([...msg.body].length).toBeLessThanOrEqual(1024);
  });

  test('the child\'s roster name leads the header (bd-s1oo0.27); English for an English coach', async () => {
    seed({ lang: 'en' });
    mockFake.__tables.child_test_sessions[0].student_id = 'stu-1';
    mockFake.__tables.students.push({ id: 'stu-1', student_name: 'Child A' });
    await sendCheck('sess-1');
    const [, msg] = WhatsAppService.sendFlow.mock.calls[0];
    expect(msg.header).toBe('Check: Child A · roll 14');
    expect(msg.buttonText).toBe('Check marks');
  });

  test('a block not yet marked: no number for it, and the coach is told to mark all of it (bd-s1oo0.27)', async () => {
    seed({ blocks: { urdu: F.urduConfident(), english: F.englishConfident(), maths: null } });
    await sendCheck('sess-1');
    const { body } = WhatsAppService.sendFlow.mock.calls[0][1];
    expect(body).not.toMatch(/فوری سوال۔|حساب ۱۲/);
    expect(body).toMatch(/حساب: سب کچھ/);
  });

  test('no Flow id configured: nothing sent, error logged, a reason returned', async () => {
    delete process.env.CHILD_TEST_CHECK_FLOW_ID;
    const r = await sendCheck('sess-1');
    expect(r).toEqual({ ok: false, reason: 'flow_not_configured' });
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(Logger.logError).toHaveBeenCalled();
  });

  test('inert when CHILD_TEST_ENABLED is off', async () => {
    process.env.CHILD_TEST_ENABLED = 'false';
    expect(await sendCheck('sess-1')).toEqual({ ok: false, reason: 'disabled' });
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
  });

  test('a send WhatsApp refuses is reported, not swallowed', async () => {
    WhatsAppService.sendFlow.mockResolvedValueOnce(false);
    expect(await sendCheck('sess-1')).toEqual({ ok: false, reason: 'send_failed' });
    expect(Logger.logError).toHaveBeenCalled();
  });

  test('safe to call twice (L4 re-sends from the list): the same Flow and token again, nothing written', async () => {
    const before = JSON.stringify(mockFake.__tables);
    expect(await sendCheck('sess-1')).toEqual({ ok: true });
    expect(await sendCheck('sess-1')).toEqual({ ok: true });
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(2);
    expect(WhatsAppService.sendFlow.mock.calls[1][1]).toEqual(WhatsAppService.sendFlow.mock.calls[0][1]);
    expect(JSON.stringify(mockFake.__tables)).toBe(before);
  });

  test('an unknown session', async () => {
    expect(await sendCheck('nope')).toEqual({ ok: false, reason: 'no_session' });
  });
});

describe('detectFlowType', () => {
  test('the completion\'s flat key, or its token alone, is child_test_check', () => {
    expect(detectFlowType({ child_test: 'checked', session_id: 'sess-1', flow_token: 'coach-1:child-test-check:sess-1' })).toBe('child_test_check');
    expect(detectFlowType({ flow_token: 'coach-1:child-test-check:sess-1' })).toBe('child_test_check');
  });
});

describe('handleCheckCompletion', () => {
  test('a checked session (every block has checked_at): confirms in one line and sends nothing else', async () => {
    seed({ checked: true });
    const r = await handleCheckCompletion({ child_test: 'checked', session_id: 'sess-1', flow_token: 'coach-1:child-test-check:sess-1' }, '923000000001', { id: 'coach-1', preferred_language: 'ur' });
    expect(r).toEqual({ ok: true, sessionId: 'sess-1', checked: true });
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toContain('۱۴');
  });

  test('a session that did not get checked: the coach is told to open it again, and it is logged as an error', async () => {
    const r = await handleCheckCompletion({ flow_token: 'coach-1:child-test-check:sess-1' }, '923000000001', { id: 'coach-1', preferred_language: 'en' });
    expect(r).toEqual({ ok: true, sessionId: 'sess-1', checked: false });
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/didn't save/);
    expect(Logger.logError).toHaveBeenCalled();
  });

  test('the completion stamps check.submitted on the session, once', async () => {
    seed({ checked: true });
    const done = { child_test: 'checked', session_id: 'sess-1', flow_token: 'coach-1:child-test-check:sess-1' };
    await handleCheckCompletion(done, '923000000001', { id: 'coach-1', preferred_language: 'ur' });
    const first = mockFake.__tables.child_test_sessions[0].timings['check.submitted'];
    expect(first).toEqual(expect.any(String));
    await new Promise((r) => setTimeout(r, 5));
    await handleCheckCompletion(done, '923000000001', { id: 'coach-1', preferred_language: 'ur' });
    expect(mockFake.__tables.child_test_sessions[0].timings['check.submitted']).toBe(first);
  });

  test('another coach\'s completion is ignored', async () => {
    const r = await handleCheckCompletion({ flow_token: 'coach-2:child-test-check:sess-1' }, '923000000002', { id: 'coach-2' });
    expect(r.ok).toBe(false);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });
});

describe('registration is for the sandbox WABA only', () => {
  const env = { WHATSAPP_BOT_NUMBER: '923025502255', SUPABASE_URL: 'https://olvritwoqujtjvwfulbh.supabase.co', APP_URL: 'https://bot-sandbox.up.railway.app' };
  test('the sandbox env file passes', () => {
    expect(checkSandboxTarget(env, '+92 302 5502255')).toEqual({ ok: true });
  });
  test('any other number, a production database, or a production URL is refused', () => {
    expect(checkSandboxTarget({ ...env, WHATSAPP_BOT_NUMBER: '923206281951' }, '+92 320 6281951').ok).toBe(false);
    expect(checkSandboxTarget(env, '+92 320 6281951').ok).toBe(false);
    expect(checkSandboxTarget({ ...env, SUPABASE_URL: 'https://ihzciabopbttygxxgrkm.supabase.co' }, '+92 302 5502255').ok).toBe(false);
    expect(checkSandboxTarget({ ...env, APP_URL: 'https://portal.niete.edu.pk' }, '+92 302 5502255').ok).toBe(false);
  });
});
