'use strict';
/**
 * The portal's switches for the lesson plan in the app and the activity Home (dashboard/lib/lp-app-switches.js).
 *
 *   portal_lp_feedback_bar        the survey bar at the end of the plan          true | list of users.id | "teachers"
 *   portal_teacher_home_activity  the "Last 30 days" block on Home                true | list of users.id | "teachers"
 *   portal_teacher_journey        My journey, and the team view in Analytics      true | list of users.id | "teachers"
 *   lp_whatsapp_pdf_off           programmes with no WhatsApp PDF                 list from {"ict","gb"}
 *   lp_whatsapp_survey_off        programmes with no WhatsApp survey              list from {"ict","gb"}
 *
 * Fail closed: no row, a malformed value, a failed read, no user → off (today).
 */
process.env.FLAG_CACHE_TTL_MS = '0';

let mockGb;
jest.mock('../../bot/shared/services/lp-own-gb', () => ({
  isGbTeacher: jest.fn(async (_c, id) => {
    if (mockGb === 'throw') throw new Error('users read failed');
    return mockGb.has(id);
  }),
}));

const S = require('../../dashboard/lib/lp-app-switches');

function client(settings, { fail = false, roles = {} } = {}) {
  return {
    from: (table) => {
      let key = null;
      const chain = {
        select: () => chain,
        eq: (_c, v) => { key = v; return chain; },
        maybeSingle: async () => {
          if (fail) return { data: null, error: { message: 'down' } };
          if (table === 'users') return { data: roles[key] ? { role: roles[key] } : null, error: null };
          return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
        },
      };
      return chain;
    },
  };
}

beforeEach(() => { mockGb = new Set(['gb-1']); });

const PER_USER = [
  ['PORTAL_LP_FEEDBACK_BAR_KEY', 'portal_lp_feedback_bar', 'isLpFeedbackBarOn'],
  ['PORTAL_TEACHER_HOME_ACTIVITY_KEY', 'portal_teacher_home_activity', 'isTeacherHomeActivityOn'],
  ['PORTAL_TEACHER_JOURNEY_KEY', 'portal_teacher_journey', 'isTeacherJourneyOn'],
];

describe.each(PER_USER)('%s', (constName, key, reader) => {
  test('the key', () => { expect(S[constName]).toBe(key); });

  test('on: true, "true", a list naming her, "teachers" for a teacher', async () => {
    expect(await S[reader](client({ [key]: true }), 't-1')).toBe(true);
    expect(await S[reader](client({ [key]: 'true' }), 't-1')).toBe(true);
    expect(await S[reader](client({ [key]: ['t-1'] }), 't-1')).toBe(true);
    expect(await S[reader](client({ [key]: '["t-1"]' }), 't-1')).toBe(true);
    expect(await S[reader](client({ [key]: 'teachers' }, { roles: { 't-1': 'teacher' } }), 't-1')).toBe(true);
  });

  test('off: false, a list without her, "teachers" for a coach', async () => {
    expect(await S[reader](client({ [key]: false }), 't-1')).toBe(false);
    expect(await S[reader](client({ [key]: ['t-2'] }), 't-1')).toBe(false);
    expect(await S[reader](client({ [key]: 'teachers' }, { roles: { 't-1': 'coach' } }), 't-1')).toBe(false);
  });

  test('missing row, malformed value, failed read, no user → off', async () => {
    expect(await S[reader](client({}), 't-1')).toBe(false);
    for (const v of ['yes', 1, { on: true }, [], '[bad', null]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await S[reader](client({ [key]: v }), 't-1')).toBe(false);
    }
    expect(await S[reader](client({ [key]: true }, { fail: true }), 't-1')).toBe(false);
    expect(await S[reader](client({ [key]: true }), null)).toBe(false);
  });
});

describe('the programme switches', () => {
  test('the keys are the bot\'s keys', () => {
    expect(S.LP_WHATSAPP_PDF_OFF_KEY).toBe('lp_whatsapp_pdf_off');
    expect(S.LP_WHATSAPP_SURVEY_OFF_KEY).toBe('lp_whatsapp_survey_off');
  });

  test('lpWhatsappOffProgrammes: the list, or [] for missing / malformed / failed read', async () => {
    const k = S.LP_WHATSAPP_PDF_OFF_KEY;
    expect(await S.lpWhatsappOffProgrammes(client({ [k]: ['gb'] }), k)).toEqual(['gb']);
    expect(await S.lpWhatsappOffProgrammes(client({ [k]: '["ict","gb"]' }), k)).toEqual(['ict', 'gb']);
    expect(await S.lpWhatsappOffProgrammes(client({}), k)).toEqual([]);
    for (const v of [true, 'gb', { gb: 1 }, ['gb', 'xx'], '[bad']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await S.lpWhatsappOffProgrammes(client({ [k]: v }), k)).toEqual([]);
    }
    expect(await S.lpWhatsappOffProgrammes(client({ [k]: ['gb'] }, { fail: true }), k)).toEqual([]);
  });

  test('per teacher: her programme on the list → off; else, or a failed programme read → today', async () => {
    const c = client({ lp_whatsapp_pdf_off: ['gb'], lp_whatsapp_survey_off: ['ict'] });
    expect(await S.isLpWhatsappPdfOffFor(c, 'gb-1')).toBe(true);
    expect(await S.isLpWhatsappPdfOffFor(c, 'ict-1')).toBe(false);
    expect(await S.isLpWhatsappSurveyOffFor(c, 'ict-1')).toBe(true);
    expect(await S.isLpWhatsappSurveyOffFor(c, 'gb-1')).toBe(false);
    expect(await S.isLpWhatsappPdfOffFor(c, null)).toBe(false);
    mockGb = 'throw';
    expect(await S.isLpWhatsappPdfOffFor(c, 'gb-1')).toBe(false);
  });
});
