'use strict';
/**
 * Every live feature has ONE callable starting point.
 *
 * Four of them did not. The assessment generator, the student-video library,
 * the class manager and attendance all started inside `if` blocks in
 * `text-message.handler.js` — a 3,300-line module whose own comment says it
 * cannot be instantiated in a test. That has two costs, and the second is the
 * one that bites:
 *
 *  1. Nothing can call them. A menu row that wants to open the assessment
 *     generator has to re-implement the send, which is two implementations of
 *     one rule — the drift that `lp-browse-entry` and `training-entry` were
 *     written to stop ("one door, one copy", the bd-72dth lesson).
 *  2. Nothing can test them. The copy, the presence gate and the honest
 *     fallback of four live features were unreachable from any suite.
 *
 * So each one becomes a named exported function, called by the command it
 * already had and callable by anything else. The command's behaviour is pinned
 * here first.
 *
 * Also `/videos`. `isVideoCommand` matched `/video`, `/video <topic>` and a bare
 * `video`, and nothing else — so the plural, which is what people type and what
 * the feature is called, fell through to the chat LLM. Exactly the `/class` vs
 * `/classes` gap that `classes/class-command.js` exists to fix, and the same fix.
 */

const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn().mockResolvedValue(true),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));

/**
 * `jest.resetModules()` below gives every re-required module a FRESH copy of the
 * mocked whatsapp service, so a reference captured at file load is NOT the
 * object the service under test calls. Always fetch it after the service.
 */
const wa = () => require('../../bot/shared/services/whatsapp.service');

const FROM = '923330000077';
const USER = { id: 'u-1', role: 'teacher', preferred_language: 'ur' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('/videos — the plural reaches the library', () => {
  const { isVideoCommand } = require('../../bot/shared/handlers/video-command');

  test.each(['/video', '/videos', '/VIDEOS', '/videos maths', '/video gravity', 'video', 'videos'])(
    '%s is a video command', (input) => {
      expect(isVideoCommand(input)).toBe(true);
    });

  test.each([
    'videography club',                        // the word boundary holds
    '/videoconference',                        // ditto, with a slash
    'make me a video on photosynthesis',       // a sentence still means generation
    'send videos to my class tomorrow please', // prose, not a command
    '',
  ])('%s is NOT a video command', (input) => {
    expect(isVideoCommand(input)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the assessment generator has one door', () => {
  const load = () => require('../../bot/shared/services/assessment-entry.service');

  test('sends the Flow with catalog copy in her language when the feature is live', async () => {
    process.env.ASSESSMENT_GEN_FLOW_ID = 'flow-assess';
    jest.doMock('../../bot/shared/config/feature-flags', () => ({
      isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
    }));
    const { openAssessmentFlow } = load();

    const ok = await openAssessmentFlow({ from: FROM, userId: USER.id, language: 'ur' });

    expect(ok).toBe(true);
    const [to, opts] = wa().sendFlow.mock.calls[0];
    expect(to).toBe(FROM);
    expect(opts.flowId).toBe('flow-assess');
    expect(opts.body).toBe(resolveUx('assessmentFlowBody', { language: 'ur' }));
    expect(opts.buttonText).toBe(resolveUx('assessmentFlowButton', { language: 'ur' }));
    expect(opts.flowToken.startsWith(`${USER.id}:`)).toBe(true);
  });

  test('the DB switch is fail-closed, and the refusal is in her language', async () => {
    process.env.ASSESSMENT_GEN_FLOW_ID = 'flow-assess';
    jest.doMock('../../bot/shared/config/feature-flags', () => ({
      isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(false),
    }));
    const { openAssessmentFlow } = load();

    const ok = await openAssessmentFlow({ from: FROM, userId: USER.id, language: 'ur' });

    expect(ok).toBe(false);
    expect(wa().sendFlow).not.toHaveBeenCalled();
    expect(wa().sendMessage.mock.calls[0][1])
      .toBe(resolveUx('assessmentNotReady', { language: 'ur' }));
  });

  test('no flow id provisioned is the same honest answer, never a send with undefined', async () => {
    delete process.env.ASSESSMENT_GEN_FLOW_ID;
    jest.doMock('../../bot/shared/config/feature-flags', () => ({
      isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
    }));
    const { openAssessmentFlow } = load();

    expect(await openAssessmentFlow({ from: FROM, userId: USER.id, language: 'en' })).toBe(false);
    expect(wa().sendFlow).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the student-video library has one door', () => {
  const load = () => require('../../bot/shared/services/student-videos-entry.service');

  test('sends the Flow with catalog copy in her language', async () => {
    process.env.STUDENT_VIDEOS_FLOW_ID = 'flow-videos';
    const { openStudentVideosFlow } = load();

    const ok = await openStudentVideosFlow({ from: FROM, userId: USER.id, language: 'ur' });

    expect(ok).toBe(true);
    const [, opts] = wa().sendFlow.mock.calls[0];
    expect(opts.flowId).toBe('flow-videos');
    expect(opts.body).toBe(resolveUx('studentVideosBody', { language: 'ur' }));
    expect(opts.buttonText).toBe(resolveUx('studentVideosButton', { language: 'ur' }));
    expect(opts.flowToken.startsWith(`${USER.id}:`)).toBe(true);
  });

  test('unset flow id returns false so the caller can fall through to generation', async () => {
    delete process.env.STUDENT_VIDEOS_FLOW_ID;
    const { openStudentVideosFlow } = load();

    expect(await openStudentVideosFlow({ from: FROM, userId: USER.id, language: 'en' })).toBe(false);
    expect(wa().sendFlow).not.toHaveBeenCalled();
    // It must NOT send its own refusal: /video falls through to AI generation,
    // and two messages for one command is worse than none.
    expect(wa().sendMessage).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the class manager has one door', () => {
  const load = (schoolId) => {
    jest.doMock('../../bot/shared/config/supabase', () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: schoolId ? { school_id: schoolId } : null, error: null }),
      };
      return { from: jest.fn(() => chain) };
    });
    return require('../../bot/shared/services/classes/class-entry.service');
  };

  test('a teacher with a school on file gets the Flow, token = the bare user id', async () => {
    process.env.CLASS_MANAGER_FLOW_ID = 'flow-class';
    const { openClassManagerFlow } = load('school-1');

    expect(await openClassManagerFlow({ from: FROM, user: USER, language: 'ur' })).toBe(true);
    const [, opts] = wa().sendFlow.mock.calls[0];
    expect(opts.flowId).toBe('flow-class');
    // The endpoint reads flow_token AS the user id — never a composite here.
    expect(opts.flowToken).toBe(USER.id);
  });

  test('no school on file is answered in chat, not with a Flow that cannot succeed', async () => {
    process.env.CLASS_MANAGER_FLOW_ID = 'flow-class';
    const { openClassManagerFlow } = load(null);

    expect(await openClassManagerFlow({ from: FROM, user: USER, language: 'ur' })).toBe(false);
    expect(wa().sendFlow).not.toHaveBeenCalled();
    expect(wa().sendMessage.mock.calls[0][1])
      .toBe(resolveUx('classNoSchool', { language: 'ur' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('attendance has one door', () => {
  const load = (decision) => {
    jest.doMock('../../bot/shared/services/attendance-router.service', () => ({
      MAX_ROWS: 10,
      detect: jest.fn(() => ({ detected: true })),
      route: jest.fn().mockResolvedValue(decision),
      openMethodQuestion: jest.fn().mockResolvedValue(true),
      methodQuestionOpen: jest.fn().mockResolvedValue(false),
    }));
    jest.doMock('../../bot/shared/services/voice-attendance.service', () => ({
      arm: jest.fn().mockResolvedValue(true),
    }));
    return require('../../bot/shared/services/attendance-entry.service');
  };

  test('ASK_METHOD asks before anything opens', async () => {
    const { openAttendance } = load({
      action: 'ASK_METHOD', message: 'How?', buttons: [{ id: 'b', title: 'Tap' }],
    });
    expect(await openAttendance({ user: USER, from: FROM, language: 'ur' })).toBe(true);
    expect(wa().sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(wa().sendFlow).not.toHaveBeenCalled();
  });

  test('MARK_STUDENTS opens the marking Flow with the planner\'s own token', async () => {
    process.env.ATTENDANCE_MARKING_FLOW_ID = 'flow-att';
    const { openAttendance } = load({ action: 'MARK_STUDENTS', flowToken: 'u-1:list-9' });
    expect(await openAttendance({ user: USER, from: FROM, language: 'ur' })).toBe(true);
    const [, opts] = wa().sendFlow.mock.calls[0];
    expect(opts.flowId).toBe('flow-att');
    expect(opts.flowToken).toBe('u-1:list-9');
  });

  test('an unset marking flow id is said honestly, in her language', async () => {
    delete process.env.ATTENDANCE_MARKING_FLOW_ID;
    const { openAttendance } = load({ action: 'MARK_STUDENTS', flowToken: 'u-1:list-9' });
    expect(await openAttendance({ user: USER, from: FROM, language: 'ur' })).toBe(false);
    expect(wa().sendFlow).not.toHaveBeenCalled();
    expect(wa().sendMessage.mock.calls[0][1])
      .toBe(resolveUx('attendanceNotAvailable', { language: 'ur' }));
  });

  test('a planner error still answers her rather than going silent', async () => {
    const { openAttendance } = load({ action: 'ERROR', message: 'sorry' });
    expect(await openAttendance({ user: USER, from: FROM, language: 'ur' })).toBe(false);
    expect(wa().sendMessage).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the handler calls the doors rather than re-implementing them', () => {
  // Source-level, and comments are stripped first: a doc comment naming the
  // very symbol being asserted is how five guards in this programme passed
  // against code that still did the wrong thing.
  const fs = require('fs');
  const path = require('path');
  const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const SRC = strip(fs.readFileSync(
    path.join(__dirname, '../../bot/shared/handlers/text-message.handler.js'), 'utf8'));

  test.each([
    ['../services/assessment-entry.service', 'openAssessmentFlow'],
    ['../services/student-videos-entry.service', 'openStudentVideosFlow'],
    ['../services/classes/class-entry.service', 'openClassManagerFlow'],
    ['../services/attendance-entry.service', 'openAttendance'],
    ['./video-command', 'isVideoCommand'],
  ])('requires %s and calls %s', (modulePath, fn) => {
    expect(SRC).toContain(modulePath);
    expect(SRC).toContain(fn);
  });

  test('no inline Flow send survives for the extracted doors', () => {
    expect(SRC).not.toMatch(/flowId:\s*ASSESSMENT_GEN_FLOW_ID/);
    expect(SRC).not.toMatch(/flowId:\s*ATTENDANCE_MARKING_FLOW_ID/);
    expect(SRC).not.toMatch(/flowId:\s*CLASS_MANAGER_FLOW_ID/);
    expect(SRC).not.toMatch(/flowId:\s*EDIT_CLASS_FLOW_ID/);
    // The one remaining STUDENT_VIDEOS_FLOW_ID send in this file is
    // tryChildVideoMenu — a CHILD following a share link, a different door with
    // different copy and no teacher account, deliberately left where it is.
    expect(SRC.match(/flowId:\s*STUDENT_VIDEOS_FLOW_ID/g) || []).toHaveLength(1);
    expect(SRC).toContain('tryChildVideoMenu');
  });

  test('the two attendance paths share ONE decision switch', () => {
    // They were separate copies and had already drifted — the typed-answer path
    // handled five of the planner's ten actions.
    expect(SRC).toContain('respondToDecision');
    expect(SRC).toContain('openAttendance');
    // No second switch on decision.action survives here.
    expect(SRC).not.toMatch(/switch\s*\(\s*decision\.action\s*\)/);
  });

  test('every door string it moved is in the catalog, in every offered language', () => {
    expect(LANGUAGE_OFFER.length).toBeGreaterThan(1);
    const keys = ['assessmentFlowHeader', 'assessmentFlowBody', 'assessmentFlowButton',
      'assessmentNotReady', 'studentVideosHeader', 'studentVideosBody', 'studentVideosButton',
      'attendanceNotAvailable', 'attendanceChooseClass', 'attendanceYourClasses'];
    for (const key of keys) {
      for (const language of LANGUAGE_OFFER) {
        expect(typeof resolveUx(key, { language })).toBe('string');
      }
    }
  });
});
