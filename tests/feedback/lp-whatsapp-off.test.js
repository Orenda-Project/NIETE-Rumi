'use strict';
/**
 * The per-programme WhatsApp switches for lesson plans: `lp_whatsapp_pdf_off` and `lp_whatsapp_survey_off`.
 * Each is a JSON list of programme names from {"ict","gb"}: a programme on the list no longer gets that WhatsApp
 * message (the plan is in the app). Absent = today (nobody). Anything else (true, a string, an object, a list with an
 * unknown name, bad JSON) = off = today. A failed settings read or a failed programme read = today.
 */
process.env.APP_SETTINGS_FLAG_TTL_MS = '60000';

let mockSettings;
let mockSettingsFails;
let mockReads;
let mockGb;
let mockGbFails;

jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const chain = {
      key: null,
      select: () => chain,
      eq: (_c, v) => { chain.key = v; return chain; },
      maybeSingle: async () => {
        mockReads.push(`${table}:${chain.key}`);
        if (mockSettingsFails) throw new Error('db down');
        return { data: Object.prototype.hasOwnProperty.call(mockSettings, chain.key) ? { value: mockSettings[chain.key] } : null, error: null };
      },
    };
    return chain;
  },
}));
jest.mock('../../bot/shared/services/lp-own-gb', () => ({
  isGbTeacher: jest.fn(async (_client, userId) => {
    if (mockGbFails) throw new Error('users read failed');
    return mockGb.has(userId);
  }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const P = require('../../bot/shared/config/lp-whatsapp-programmes');
let Off;

beforeEach(() => {
  jest.isolateModules(() => { Off = require('../../bot/shared/services/lp-whatsapp-off'); });
  mockSettings = {};
  mockSettingsFails = false;
  mockReads = [];
  mockGb = new Set(['gb-teacher']);
  mockGbFails = false;
});

describe('parseProgrammeList (pure, shared with the portal)', () => {
  test('keys and programmes', () => {
    expect(P.LP_WHATSAPP_PDF_OFF_KEY).toBe('lp_whatsapp_pdf_off');
    expect(P.LP_WHATSAPP_SURVEY_OFF_KEY).toBe('lp_whatsapp_survey_off');
    expect(P.PROGRAMMES).toEqual(['ict', 'gb']);
  });
  test('a list of known programmes, as jsonb or as a JSON string, deduped and lower-cased', () => {
    expect(P.parseProgrammeList(['gb'])).toEqual(['gb']);
    expect(P.parseProgrammeList(['ict', 'gb', 'ICT '])).toEqual(['ict', 'gb']);
    expect(P.parseProgrammeList('["ict"]')).toEqual(['ict']);
    expect(P.parseProgrammeList([])).toEqual([]);
  });
  test('absent or anything else is the empty list (today)', () => {
    for (const v of [undefined, null, true, 'true', 'gb', 'teachers', 1, { gb: true }, ['gb', 'xyz'], ['gb', 2], '[bad', '"gb"']) {
      expect(P.parseProgrammeList(v)).toEqual([]);
    }
  });
});

describe('the bot readers', () => {
  test('missing row → today: nobody is off, and no programme read is made', async () => {
    expect(await Off.isLpWhatsappPdfOffFor('ict-teacher')).toBe(false);
    expect(await Off.isLpWhatsappSurveyOffFor('gb-teacher')).toBe(false);
    expect(mockReads.filter((r) => r.startsWith('users'))).toEqual([]);
  });

  test('["gb"] → a GB teacher is off, an ICT teacher is not', async () => {
    mockSettings.lp_whatsapp_pdf_off = ['gb'];
    expect(await Off.isLpWhatsappPdfOffFor('gb-teacher')).toBe(true);
    expect(await Off.isLpWhatsappPdfOffFor('ict-teacher')).toBe(false);
    expect(await Off.isLpWhatsappSurveyOffFor('gb-teacher')).toBe(false);
  });

  test('["ict","gb"] → both programmes off; each switch is its own key', async () => {
    mockSettings.lp_whatsapp_survey_off = ['ict', 'gb'];
    expect(await Off.isLpWhatsappSurveyOffFor('gb-teacher')).toBe(true);
    expect(await Off.isLpWhatsappSurveyOffFor('ict-teacher')).toBe(true);
    expect(await Off.isLpWhatsappPdfOffFor('ict-teacher')).toBe(false);
  });

  test('malformed values → today', async () => {
    for (const v of [true, 'true', ['gb', 'nope'], { ict: true }, '[oops']) {
      jest.isolateModules(() => { Off = require('../../bot/shared/services/lp-whatsapp-off'); });
      mockSettings.lp_whatsapp_pdf_off = v;
      // eslint-disable-next-line no-await-in-loop
      expect(await Off.isLpWhatsappPdfOffFor('gb-teacher')).toBe(false);
    }
  });

  test('a failed settings read → today', async () => {
    mockSettingsFails = true;
    expect(await Off.lpWhatsappOffProgrammes(P.LP_WHATSAPP_PDF_OFF_KEY)).toEqual([]);
    expect(await Off.isLpWhatsappPdfOffFor('gb-teacher')).toBe(false);
  });

  test('a failed programme read → today', async () => {
    mockSettings.lp_whatsapp_pdf_off = ['ict', 'gb'];
    mockGbFails = true;
    expect(await Off.isLpWhatsappPdfOffFor('gb-teacher')).toBe(false);
  });

  test('no user id → today', async () => {
    mockSettings.lp_whatsapp_pdf_off = ['ict', 'gb'];
    expect(await Off.isLpWhatsappPdfOffFor(null)).toBe(false);
    expect(await Off.isLpWhatsappPdfOffFor('')).toBe(false);
  });

  test('the list is cached: two asks, one settings read', async () => {
    mockSettings.lp_whatsapp_pdf_off = ['gb'];
    await Off.lpWhatsappOffProgrammes(P.LP_WHATSAPP_PDF_OFF_KEY);
    await Off.lpWhatsappOffProgrammes(P.LP_WHATSAPP_PDF_OFF_KEY);
    expect(mockReads.filter((r) => r === 'app_settings:lp_whatsapp_pdf_off')).toHaveLength(1);
  });

  test('programmeOf: gb or ict, null on a failed read', async () => {
    expect(await Off.programmeOf('gb-teacher')).toBe('gb');
    expect(await Off.programmeOf('ict-teacher')).toBe('ict');
    mockGbFails = true;
    expect(await Off.programmeOf('gb-teacher')).toBe(null);
  });
});
