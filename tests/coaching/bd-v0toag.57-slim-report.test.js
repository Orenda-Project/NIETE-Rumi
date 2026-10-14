/**
 * v10 coaching test (bd-v0toag.57): groups C and D get a slim report image.
 *
 * The full report lives on the /cr page (one tap away, the .19 button), so the image C and D get on WhatsApp keeps
 * only the score band, the one thing to try and a line pointing at the button. The thing to try is the .20 pick
 * (the same text the next plan's caption shows), else the commitment action. The full image is still rendered and
 * stored (coaches, shares and the dashboard read it); only the WhatsApp send changes. A, B, an undrawn school, the
 * switch off, no link or any error: the full image, as today. Never throws.
 */
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/report-link-token', () => ({ reportLinkUrl: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/thing-to-try-pick', () => ({ pickThingToTry: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { groupFor } = require('../../bot/shared/services/coaching/ab-v10-arms');
const { reportLinkUrl } = require('../../bot/shared/services/coaching/report-link-token');
const { pickThingToTry } = require('../../bot/shared/services/coaching/thing-to-try-pick');
const { slimReportFor } = require('../../bot/shared/services/coaching/slim-report');
const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');

const SID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const LPF = { status: 'ok', lesson_id: 'L1', moves: [] };
const arm = (group, report) => ({ group, plan: 'v9', report });
const call = (commitmentAction = 'Ask three children to explain') =>
  slimReportFor({ userId: UID, sessionId: SID, lpFidelity: LPF, commitmentAction });

beforeEach(() => {
  jest.clearAllMocks();
  reportLinkUrl.mockReturnValue('https://portal.example/cr/tok');
  pickThingToTry.mockReturnValue({ move_id: 'm2', lesson_id: 'L1', text: 'Children read the word aloud together', tag: 'choral' });
});

describe('slimReportFor', () => {
  test.each(['C', 'D'])('group %s gets the slim image with the .20 pick as the thing to try', async (g) => {
    groupFor.mockResolvedValue(arm(g, 'new'));
    expect(await call()).toEqual({ tryNext: 'Children read the word aloud together' });
    expect(groupFor).toHaveBeenCalledWith(UID);
    expect(reportLinkUrl).toHaveBeenCalledWith({ sessionId: SID, userId: UID });
    expect(pickThingToTry).toHaveBeenCalledWith(LPF);
  });

  test('no pick: the commitment action', async () => {
    groupFor.mockResolvedValue(arm('C', 'new'));
    pickThingToTry.mockReturnValue(null);
    expect(await call()).toEqual({ tryNext: 'Ask three children to explain' });
  });

  test.each([
    ['group A', arm('A', 'today')],
    ['group B', arm('B', 'today')],
    ['school not drawn or switch off', null],
  ])('%s: the full image', async (_, g) => {
    groupFor.mockResolvedValue(g);
    expect(await call()).toBeNull();
  });

  test('no link (the image must not point at a button that never comes): the full image', async () => {
    groupFor.mockResolvedValue(arm('C', 'new'));
    reportLinkUrl.mockReturnValue(null);
    expect(await call()).toBeNull();
  });

  test('a failed lookup is the full image, never thrown', async () => {
    groupFor.mockRejectedValue(new Error('db down'));
    expect(await call()).toBeNull();
    groupFor.mockResolvedValue(arm('D', 'new'));
    reportLinkUrl.mockImplementation(() => { throw new Error('no key'); });
    expect(await call()).toBeNull();
  });
});

function vm(extra = {}) {
  return {
    language: 'en', teacherName: 'Sana', topic: 'Fractions', date: '2026-10-19',
    score: { overall: 72, marks: 36, max: 50 },
    groups: [{ name: 'Clarity', score: 8, max: 10, pct: 80 }],
    tryNext: 'Children read the word aloud together',
    trend: [{ date: '2026-10-01', pct: 60 }, { date: '2026-10-08', pct: 66 }],
    classroomPhotos: [{ src: 'data:image/jpeg;base64,AAAA', caption: 'From your photo: the board' }],
    narrative: {
      affirmation: 'You made fractions feel easy', identity: 'A teacher who waits',
      moments: [{ quote: 'Tell your partner why', why: 'Every child spoke' }],
      strength_name: 'Wait time', strength_note: 'You waited.', horizon_title: 'Name one moment', horizon_note: 'Quote it.',
      journey_note: 'Up from last time',
    },
    ...extra,
  };
}

describe('the slim image', () => {
  const full = buildHeroReportHtml(vm());
  const slim = buildHeroReportHtml(vm({ slim: true }));

  test('keeps the score band, the thing to try and the brand foot', () => {
    for (const s of ['A celebration of your teaching', 'You made fractions feel easy', '72%', 'Sana', 'Fractions',
      'One thing to try next class', 'Children read the word aloud together', 'class="foot"']) {
      expect(slim).toContain(s);
    }
  });

  test('says the full report is one tap below', () => {
    expect(slim).toContain('Your full report is one tap below');
    expect(full).not.toContain('Your full report is one tap below');
  });

  test('drops the identity line, scorecard, moments, strength, horizon, photos and journey', () => {
    for (const s of ['A teacher who waits', 'Your scores', 'Tell your partner why', 'Your strength', 'Your next horizon',
      'class="photos"', 'Your journey', 'Up from last time']) {
      expect(full).toContain(s);
      expect(slim).not.toContain(s);
    }
  });

  test('Urdu stays RTL with the English chrome', () => {
    const ur = buildHeroReportHtml(vm({ slim: true, language: 'ur', tryNext: 'بچوں سے لفظ مل کر پڑھوائیں' }));
    expect(ur).toContain('dir="rtl"');
    expect(ur).toContain('Your full report is one tap below');
    expect(ur).toContain('بچوں سے لفظ مل کر پڑھوائیں');
  });
});

describe('generateHeroReport renders the slim image beside the full one', () => {
  function load(htmlToImage) {
    jest.resetModules();
    jest.doMock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
      generateReportNarrative: jest.fn().mockResolvedValue({ affirmation: 'Well done', strength_name: 'Wait time' }),
      subjectUnconfirmedNote: () => '',
    }));
    jest.doMock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn().mockResolvedValue([]) }));
    jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    return require('../../bot/shared/services/coaching/report-v2/hero-report.service').generateHeroReport;
  }
  const session = { id: SID, user_id: UID, created_at: '2026-10-19T00:00:00Z', transcript_text: 't' };
  const analysis = { framework: 'fico', scores: { overall_percentage: 61, overall_marks: 30, max_marks: 49 }, domains: {} };
  const base = { teacherName: 'Sana', language: 'en', commitmentAction: 'Commitment action' };

  test('with slim: the full image as png (stored), the slim one as slimPng (sent)', async () => {
    const htmlToImage = jest.fn(async (html) => Buffer.from(html.includes('one tap below') ? 'SLIM' : 'FULL'));
    const out = await load(htmlToImage)(session, analysis, { ...base, slim: { tryNext: 'The .20 pick' } });
    expect(out.png.toString()).toBe('FULL');
    expect(out.slimPng.toString()).toBe('SLIM');
    expect(htmlToImage).toHaveBeenCalledTimes(2);
    expect(htmlToImage.mock.calls[0][0]).toContain('Commitment action');
    expect(htmlToImage.mock.calls[1][0]).toContain('The .20 pick');
    expect(out.narrative).toMatchObject({ affirmation: 'Well done' });
  });

  test('without slim: one render and no slimPng (today)', async () => {
    const htmlToImage = jest.fn(async () => Buffer.from('FULL'));
    const out = await load(htmlToImage)(session, analysis, base);
    expect(htmlToImage).toHaveBeenCalledTimes(1);
    expect(out.slimPng).toBeUndefined();
  });

  test('a failed slim render sends the full image, never fails the report', async () => {
    const htmlToImage = jest.fn(async (html) => {
      if (html.includes('one tap below')) throw new Error('chromium');
      return Buffer.from('FULL');
    });
    const out = await load(htmlToImage)(session, analysis, { ...base, slim: { tryNext: 'x' } });
    expect(out.png.toString()).toBe('FULL');
    expect(out.slimPng).toBeUndefined();
  });
});

describe('wiring', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../..', 'bot/shared/services/coaching/report-generator.service.js'), 'utf8');

  test('the slim lookup goes into the hero input', () => {
    expect(src).toMatch(/slimReportFor\(/);
    expect(src).toMatch(/_heroInput = \{[\s\S]{0,600}slim,/);
  });

  test('WhatsApp gets the slim image when there is one; R2 keeps the full one', () => {
    expect(src).toContain('reportResult.slimPng || reportResult.png');
    expect(src).toContain('uploadReportImage(reportResult.png,');
  });
});
