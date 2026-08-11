/**
 * Video-quiz roster gate must FAIL CLOSED now that attendance is torn out.
 *
 * The attendance teardown (FEAT-110 / bd-2530) deleted the Flow endpoints that
 * served ATTENDANCE_SETUP_FLOW_ID and EDIT_CLASS_FLOW_ID. But video-quiz reuses
 * those exact Flows for its own roster gate: a teacher who asks for a quiz with
 * no class set up gets routed into "add class", and one with no parent phones
 * gets routed into "edit class".
 *
 * The Flow IDs are still published on the WABA, so sendFlow would still OPEN a
 * screen — whose data-exchange endpoint no longer exists. The teacher would tap
 * through into a dead form. That is worse than being told we cannot do it yet.
 *
 * So: while attendance is being rebuilt, the roster gate must send a plain
 * explanatory message and NEVER call sendFlow with a torn-out Flow.
 */

const mockWhatsApp = { sendMessage: jest.fn(), sendFlow: jest.fn() };
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWhatsApp);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

describe('bd-2530 — quiz roster gate fails closed while attendance is rebuilt', () => {
  const ROUTER = '../../bot/shared/services/quiz/quiz-intent-router.service';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('does not open the torn-out attendance setup Flow, even when its id is set', async () => {
    process.env.ATTENDANCE_SETUP_FLOW_ID = '1051631050648525'; // real staging id
    const router = require(ROUTER);
    const open = router.__testOpenAddClassFlow;
    expect(typeof open).toBe('function');

    await open({ id: 'u1' }, '923000000000');

    expect(mockWhatsApp.sendFlow).not.toHaveBeenCalled();
    expect(mockWhatsApp.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not open the torn-out edit-class Flow, even when its id is set', async () => {
    process.env.EDIT_CLASS_FLOW_ID = '1358247112482635'; // real staging id
    const router = require(ROUTER);
    const open = router.__testOpenEditClassFlow;
    expect(typeof open).toBe('function');

    await open({ id: 'u1' }, '923000000000', { id: 'c1', class_name: 'Grade 5' }, 'ADD_STUDENTS');

    expect(mockWhatsApp.sendFlow).not.toHaveBeenCalled();
    expect(mockWhatsApp.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('tells the teacher class setup is temporarily unavailable, not that it failed', async () => {
    process.env.ATTENDANCE_SETUP_FLOW_ID = '1051631050648525';
    const router = require(ROUTER);
    await router.__testOpenAddClassFlow({ id: 'u1' }, '923000000000');

    const [, text] = mockWhatsApp.sendMessage.mock.calls[0];
    // No blame, no dead end: say it is coming back.
    expect(text.toLowerCase()).toMatch(/rebuild|soon|shortly|not available yet|temporarily/);
  });
});
