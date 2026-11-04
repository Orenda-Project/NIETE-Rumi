'use strict';
/**
 * `/menu` is the front door for every live feature, shaped by role.
 *
 * It offered five rows out of fourteen live features. The nine it left out were
 * reachable only by typing a command nobody had been told about — and the
 * seven-day usage says teachers found them anyway, and in what proportion:
 * attendance 1,771, classes 843, roster 814, assessment 294, quiz 121,
 * videos 100. That is a lower bound on demand for each of them, and it is what
 * the row order is built from.
 *
 * Two properties this suite exists to hold, because each has already failed in
 * production on this deployment:
 *
 *  1. A ROW THAT APPEARS CAN BE STARTED. Reading assessment sat on the menu for
 *     twenty days after it stopped being able to run: 57 attempts, 57 failures.
 *     So every row is gated by the same predicate that decides whether its
 *     feature can start, and the gate is checked again where the tap LANDS —
 *     WhatsApp keeps a list row tappable forever.
 *  2. EVERY ID REACHES A HANDLER. An id with no case lands in `default` and
 *     answers "I didn't recognise that option", which is how a menu row becomes
 *     a dead end. So each new id is driven through the REAL reply router with
 *     its door spied, and asserted to arrive there WITH her language.
 *
 * The payload assertions drive the REAL sender with `global.fetch` mocked at the
 * network boundary and nothing else, because the last three defects on this
 * surface all lived between the resolved language and the bytes on the wire.
 */

const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { featureMenuRows, layoutFor, MAX_MENU_ROWS } = require('../../bot/shared/config/role-features');
const { envMenuGates } = require('../../bot/shared/config/menu-gates');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const CAPS = { header: 60, body: 1024, footer: 60, button: 20, rowTitle: 24, rowDesc: 72, sectionTitle: 24 };
const cp = (s) => [...s].length;
const URDU = /[؀-ۿ]/;

const FROM = '923330000123';
const USER = (role) => ({ id: `u-${role}`, role, preferred_language: 'ur' });

/** Every gate open — the shape production actually runs in. */
const ALL_ON = {
  TEACHER_TRAINING_FLOW_ID: 'f-train',
  PAKISTAN_LP_FLOW_ID: 'f-lp',
  OBSERVE_MEWAKA_FLOW_ID: 'f-obs',
  ROSTER_FLOW_ID: 'f-roster',
  CLASS_MANAGER_FLOW_ID: 'f-class',
  STUDENT_VIDEOS_FLOW_ID: 'f-vid',
  TRANSCRIPT_QUIZ_ENABLED: 'true',
  TRANSCRIPT_QUIZ_FLOW_ID: 'f-quiz',
  ASSESSMENT_GEN_FLOW_ID: 'f-assess',
};

let sent;
let savedEnv;
beforeEach(() => {
  jest.clearAllMocks();
  sent = [];
  savedEnv = {};
  for (const [k, v] of Object.entries(ALL_ON)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
  global.fetch = jest.fn(async (url, opts) => {
    sent.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.x' }] }) };
  });
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const gatesOn = () => ({ ...envMenuGates(), assessmentEnabled: true });
const send = async (role, language) => {
  await WhatsAppService.sendFeatureMenuListFallback(FROM, USER(role), language, gatesOn());
  return sent[0].interactive;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('the layout each role gets', () => {
  test('a teacher gets the ten highest-demand rows she can start, in demand order', () => {
    expect(featureMenuRows(USER('teacher'), gatesOn()).map((r) => r.id)).toEqual([
      'menu_lesson_plan', 'menu_coaching', 'menu_training', 'menu_attendance',
      'menu_classes', 'menu_quiz', 'menu_assessment', 'menu_videos',
      'menu_language', 'menu_other',
    ]);
  });

  test('a principal leads with the thing only she can do, and gets the roster', () => {
    expect(featureMenuRows(USER('principal'), gatesOn()).map((r) => r.id)).toEqual([
      'menu_observe', 'menu_lesson_plan', 'menu_coaching', 'menu_training',
      'menu_roster', 'menu_attendance', 'menu_assessment', 'menu_language',
      'menu_other',
    ]);
  });

  test('a coach gets no coaching row — she does not self-coach', () => {
    const ids = featureMenuRows(USER('coach'), gatesOn()).map((r) => r.id);
    expect(ids).toEqual([
      'menu_observe', 'menu_roster', 'menu_lesson_plan', 'menu_training',
      'menu_assessment', 'menu_language', 'menu_other',
    ]);
    expect(ids).not.toContain('menu_coaching');
  });

  test('an unknown or absent role takes the teacher shape, never the leader one', () => {
    for (const user of [USER('unregistered'), null, { id: 'x' }, { id: 'y', role: 42 }]) {
      expect(layoutFor(user)).toBe('teacher');
      const ids = featureMenuRows(user, gatesOn()).map((r) => r.id);
      expect(ids).toContain('menu_coaching');
      expect(ids).not.toContain('menu_observe');
      expect(ids).not.toContain('menu_roster');
    }
  });

  test('no layout exceeds the WhatsApp row cap', () => {
    expect(MAX_MENU_ROWS).toBe(10);
    for (const role of ['teacher', 'principal', 'coach', 'unregistered']) {
      expect(featureMenuRows(USER(role), gatesOn()).length).toBeLessThanOrEqual(MAX_MENU_ROWS);
    }
  });

  test('the row ids are unique inside a layout', () => {
    for (const role of ['teacher', 'principal', 'coach']) {
      const ids = featureMenuRows(USER(role), gatesOn()).map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('two features must never get a row', () => {
  // Reading assessment cannot run here at all; /settings has no Flow id, so the
  // surface answers "not available yet". Both keep their HANDLERS, because a
  // scrollback tap has to land somewhere honest.
  test.each(['teacher', 'principal', 'coach', 'unregistered'])(
    'no reading and no settings row for %s, with every gate open', (role) => {
      const ids = featureMenuRows(USER(role), gatesOn()).map((r) => r.id);
      expect(ids).not.toContain('menu_reading');
      expect(ids).not.toContain('menu_settings');
    });

  test('the payload names neither, in either language, for every role', async () => {
    for (const role of ['teacher', 'principal', 'coach']) {
      for (const language of LANGUAGE_OFFER) {
        sent = [];
        const json = JSON.stringify(await send(role, language));
        expect(json).not.toMatch(/reading/i);
        expect(json).not.toMatch(/ریڈنگ/);
        expect(json).not.toMatch(/settings/i);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('presence gating — a row that appears can be started', () => {
  test.each([
    ['ROSTER_FLOW_ID', 'menu_roster', 'principal'],
    ['CLASS_MANAGER_FLOW_ID', 'menu_classes', 'teacher'],
    ['STUDENT_VIDEOS_FLOW_ID', 'menu_videos', 'teacher'],
    ['TRANSCRIPT_QUIZ_FLOW_ID', 'menu_quiz', 'teacher'],
    ['OBSERVE_MEWAKA_FLOW_ID', 'menu_observe', 'principal'],
    ['TEACHER_TRAINING_FLOW_ID', 'menu_training', 'teacher'],
  ])('unset %s removes %s', (envKey, rowId, role) => {
    expect(featureMenuRows(USER(role), gatesOn()).map((r) => r.id)).toContain(rowId);
    delete process.env[envKey];
    expect(featureMenuRows(USER(role), gatesOn()).map((r) => r.id)).not.toContain(rowId);
  });

  test('the quiz row needs the flag AND the Flow, not either', () => {
    process.env.TRANSCRIPT_QUIZ_ENABLED = 'false';
    expect(featureMenuRows(USER('teacher'), gatesOn()).map((r) => r.id)).not.toContain('menu_quiz');
  });

  test('the assessment row follows its DATABASE switch, not just its Flow id', () => {
    const closed = { ...envMenuGates(), assessmentEnabled: false };
    expect(featureMenuRows(USER('teacher'), closed).map((r) => r.id)).not.toContain('menu_assessment');
  });

  test('lesson plans are NOT gated on their Flow id — that door works without it', () => {
    // `_handleLessonPlanningChoice` falls back to asking for a topic in chat and
    // still produces a plan, so a gate here would hide a row that works. The
    // test for a gate is "cannot start without it", not "has an env var".
    delete process.env.PAKISTAN_LP_FLOW_ID;
    expect(featureMenuRows(USER('teacher'), gatesOn()).map((r) => r.id))
      .toContain('menu_lesson_plan');
    expect(envMenuGates()).not.toHaveProperty('lessonPlanEnabled');
  });

  test('every gate shut still leaves a usable menu, never an empty list', () => {
    for (const role of ['teacher', 'principal', 'coach']) {
      const rows = featureMenuRows(USER(role), {});
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((r) => r.id)).toContain('menu_other');
      // And the ungated doors survive: lesson plans, language, ask anything —
      // plus coaching and attendance for the roles that have them.
      expect(rows.map((r) => r.id)).toContain('menu_lesson_plan');
      expect(rows.map((r) => r.id)).toContain('menu_language');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the payload, in both languages, for every role', () => {
  test.each(['teacher', 'principal', 'coach'])('%s: every row is bilingual and within cap', async (role) => {
    for (const language of LANGUAGE_OFFER) {
      sent = [];
      const interactive = await send(role, language);
      const section = interactive.action.sections[0];

      expect(section.rows.length).toBeLessThanOrEqual(MAX_MENU_ROWS);
      expect(cp(interactive.header.text)).toBeLessThanOrEqual(CAPS.header);
      expect(cp(interactive.footer.text)).toBeLessThanOrEqual(CAPS.footer);
      expect(cp(interactive.action.button)).toBeLessThanOrEqual(CAPS.button);
      expect(cp(section.title)).toBeLessThanOrEqual(CAPS.sectionTitle);
      expect(cp(interactive.body.text)).toBeLessThanOrEqual(CAPS.body);

      for (const row of section.rows) {
        expect(cp(row.title)).toBeLessThanOrEqual(CAPS.rowTitle);
        expect(cp(row.description)).toBeLessThanOrEqual(CAPS.rowDesc);
        expect(row.id).toMatch(/^menu_[a-z_]+$/);
        if (language === 'ur') {
          expect(URDU.test(row.title)).toBe(true);
          expect(URDU.test(row.description)).toBe(true);
        }
      }
    }
  });

  test("a principal's attendance row says STAFF attendance, hers says her class", async () => {
    sent = [];
    const leader = await send('principal', 'en');
    const leaderRow = leader.action.sections[0].rows.find((r) => r.id === 'menu_attendance');
    expect(leaderRow.title).toBe(resolveUx('menuRowStaffAttendanceTitle', { language: 'en' }));
    expect(leaderRow.description).toMatch(/teacher/i);

    sent = [];
    const teacher = await send('teacher', 'en');
    const teacherRow = teacher.action.sections[0].rows.find((r) => r.id === 'menu_attendance');
    expect(teacherRow.title).toBe(resolveUx('menuRowAttendanceTitle', { language: 'en' }));
    expect(teacherRow.description).toMatch(/class/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('every id reaches its handler, with her language', () => {
  // The REAL reply router, each target door spied. An id with no case lands in
  // `default` and answers "I didn't recognise that option" — a menu row that is
  // a dead end, which is what this asserts cannot happen.
  const load = () => {
    jest.resetModules();
    const spies = {};
    const record = (name) => jest.fn(async (...args) => { (spies[name] = spies[name] || []).push(args); return true; });

    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage: record('sendMessage'),
      sendFlow: record('sendFlow'),
      sendInteractiveMessage: record('sendInteractiveMessage'),
      sendInteractiveButtons: record('sendInteractiveButtons'),
      sendFeatureMenuCarousel: record('sendFeatureMenuCarousel'),
      sendLanguageSelectionList: record('sendLanguageSelectionList'),
    }));
    jest.doMock('../../bot/shared/services/attendance-entry.service', () => ({
      openAttendance: record('openAttendance'), respondToDecision: jest.fn(),
    }));
    jest.doMock('../../bot/shared/services/classes/class-entry.service', () => ({
      openClassManagerFlow: record('openClassManagerFlow'),
    }));
    jest.doMock('../../bot/shared/services/assessment-entry.service', () => ({
      openAssessmentFlow: record('openAssessmentFlow'),
    }));
    jest.doMock('../../bot/shared/services/student-videos-entry.service', () => ({
      openStudentVideosFlow: jest.fn(async (...args) => {
        (spies.openStudentVideosFlow = spies.openStudentVideosFlow || []).push(args);
        return true;
      }),
    }));
    jest.doMock('../../bot/shared/services/roster-entry.service', () => ({
      openRosterFlow: jest.fn(async (...args) => {
        (spies.openRosterFlow = spies.openRosterFlow || []).push(args);
        return 'sent';
      }),
    }));
    jest.doMock('../../bot/shared/services/quiz/transcript-quiz-list.service', () => ({
      showList: record('showList'),
    }));
    jest.doMock('../../bot/shared/services/quiz/transcript-quiz-offer.service', () => ({
      enabled: () => true,
    }));
    jest.doMock('../../bot/shared/services/training/training-entry.service', () => ({
      openTrainingFlow: record('openTrainingFlow'),
    }));
    jest.doMock('../../bot/shared/handlers/observe-command.handler', () => ({
      handleObserveCommand: record('handleObserveCommand'),
    }));
    jest.doMock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({}) }));
    jest.doMock('../../bot/shared/services/lesson-planning.service', () => ({}));
    jest.doMock('../../bot/shared/database/bot-helpers', () => ({
      storeConversation: jest.fn(), getOrCreateSession: jest.fn(async () => 's-1'),
    }));
    jest.doMock('../../bot/shared/services/conversation-state.service', () => ({
      setState: jest.fn(), clearState: jest.fn(), getState: jest.fn(async () => null),
    }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      get: jest.fn(async () => null), set: jest.fn(), delete: jest.fn(), redis: null,
    }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

    const MenuService = require('../../bot/shared/services/menu.service');
    return { MenuService, spies };
  };

  const CASES = [
    ['menu_attendance', 'openAttendance', 'teacher'],
    ['menu_classes', 'openClassManagerFlow', 'teacher'],
    ['menu_assessment', 'openAssessmentFlow', 'teacher'],
    ['menu_videos', 'openStudentVideosFlow', 'teacher'],
    ['menu_roster', 'openRosterFlow', 'principal'],
    ['menu_quiz', 'showList', 'teacher'],
    ['menu_language', 'sendLanguageSelectionList', 'teacher'],
  ];

  test.each(CASES)('%s reaches %s', async (buttonId, doorName, role) => {
    const { MenuService, spies } = load();
    await MenuService.handleMenuButtonResponse(USER(role), FROM, buttonId, 'ur');

    expect(spies[doorName]).toBeDefined();
    expect(spies[doorName]).toHaveLength(1);
    // And it arrived in HER language, not the floor.
    expect(JSON.stringify(spies[doorName][0])).toContain('ur');
    // Never the unknown-option dead end.
    const said = (spies.sendMessage || []).map((c) => c[1]).join(' ');
    expect(said).not.toContain(resolveUx('menuUnknownOption', { language: 'ur' }));
  });

  test('the rows a role is actually shown all have a case — none falls to default', async () => {
    for (const role of ['teacher', 'principal', 'coach']) {
      for (const row of featureMenuRows(USER(role), gatesOn())) {
        const { MenuService, spies } = load();
        await MenuService.handleMenuButtonResponse(USER(role), FROM, row.id, 'ur');
        const said = (spies.sendMessage || []).map((c) => c[1]).join(' ');
        expect(said).not.toContain(resolveUx('menuUnknownOption', { language: 'ur' }));
      }
    }
  });

  test('a leader-only row tapped from scrollback by a teacher is refused, not opened', async () => {
    // The row-122 class of defect, in the other direction: a row a role never
    // sees today is still tappable from a message sent yesterday. The roster
    // door owns the leader gate, so the tap cannot bypass it — and the refusal
    // is in her language.
    jest.resetModules();
    // The earlier tests in this describe registered a STUB for the roster door
    // via jest.doMock, and doMock registrations survive resetModules — only the
    // module registry is cleared. Without this the "real door" below would be
    // that stub, and the assertion would pass while testing nothing.
    jest.dontMock('../../bot/shared/services/roster-entry.service');
    const calls = [];
    let said = [];
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, text) => { said.push(text); return true; }),
      sendFlow: jest.fn(async (...a) => { calls.push(a); return true; }),
      sendInteractiveMessage: jest.fn(), sendInteractiveButtons: jest.fn(),
      sendFeatureMenuCarousel: jest.fn(), sendLanguageSelectionList: jest.fn(),
    }));
    jest.doMock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({}) }));
    jest.doMock('../../bot/shared/services/lesson-planning.service', () => ({}));
    jest.doMock('../../bot/shared/database/bot-helpers', () => ({
      storeConversation: jest.fn(), getOrCreateSession: jest.fn(async () => 's-1'),
    }));
    jest.doMock('../../bot/shared/services/conversation-state.service', () => ({
      setState: jest.fn(), clearState: jest.fn(), getState: jest.fn(async () => null),
    }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      get: jest.fn(async () => null), set: jest.fn(), delete: jest.fn(), redis: null,
    }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    // The REAL roster door and the REAL leader gate — only the network is mocked.
    const MenuService = require('../../bot/shared/services/menu.service');
    const { resolveUx: rx } = require('../../bot/shared/config/ux-strings');

    await MenuService.handleMenuButtonResponse(USER('teacher'), FROM, 'menu_roster', 'ur');

    expect(calls).toHaveLength(0);
    expect(said).toContain(rx('rosterRoleRefusal', { language: 'ur' }));
    expect(said).not.toContain(rx('menuUnknownOption', { language: 'ur' }));

    // And a principal, same tap, does get it.
    said = [];
    await MenuService.handleMenuButtonResponse(USER('principal'), FROM, 'menu_roster', 'ur');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].flowToken).toBe('u-principal');
  });

  test('a shut gate answers honestly instead of opening a Flow with no id', async () => {
    process.env.TRANSCRIPT_QUIZ_ENABLED = 'false';
    const { MenuService, spies } = load();
    await MenuService.handleMenuButtonResponse(USER('teacher'), FROM, 'menu_quiz', 'ur');
    expect(spies.showList).toBeUndefined();
    expect((spies.sendMessage || []).map((c) => c[1]))
      .toContain(resolveUx('featureNotAvailableHere', { language: 'ur' }));
  });
});
