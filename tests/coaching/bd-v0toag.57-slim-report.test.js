/**
 * v10 coaching test (bd-v0toag.57): groups C and D get a slim report image.
 *
 * The full report lives on the /cr page (one tap away, the .19 button), so the image C and D get on WhatsApp is
 * the page's card, as on Amena's ICT-3 template: the header, what she did well, the one thing to try in its step,
 * and a line pointing at the button. The thing to try is the .20 pick (the same text the next plan's caption
 * shows), else the commitment action. The full image is still rendered and
 * stored (coaches, shares and the dashboard read it); only the WhatsApp send changes. A, B, an undrawn school, the
 * switch off, no link or any error: the full image, as today. Never throws.
 */
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/report-link-token', () => ({ reportLinkUrl: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/thing-to-try-pick', () => ({ resolveThing: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { groupFor } = require('../../bot/shared/services/coaching/ab-v10-arms');
const { reportLinkUrl } = require('../../bot/shared/services/coaching/report-link-token');
const { resolveThing } = require('../../bot/shared/services/coaching/thing-to-try-pick');
const { slimReportFor } = require('../../bot/shared/services/coaching/slim-report');
const { buildSlimCardHtml } = require('../../bot/shared/services/coaching/report-v2/slim-card.template');

const SID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const LPF = { status: 'ok', lesson_id: 'L1', moves: [{ move_id: 'm1', phase: 'warm_up' }, { move_id: 'm2', phase: 'guided' }] };
const arm = (group, report) => ({ group, plan: 'v9', report });
const call = (commitmentAction = 'Ask three children to explain') =>
  slimReportFor({ userId: UID, sessionId: SID, lpFidelity: LPF, commitmentAction });

beforeEach(() => {
  jest.clearAllMocks();
  reportLinkUrl.mockReturnValue('https://portal.example/cr/tok');
  // bd-v0toag.100.8: the thing the stored card gets (carried or new), with the step it was set in.
  resolveThing.mockResolvedValue({ thing: {
    move_id: 'm2', lesson_id: 'L1', text: 'Children read the word aloud together', tag: 'C4', step: { name: 'We Do', index: 3 },
  } });
});

describe('slimReportFor', () => {
  test.each(['C', 'D'])('group %s gets the slim image with the resolved thing to try', async (g) => {
    groupFor.mockResolvedValue(arm(g, 'new'));
    expect(await call()).toEqual({ tryNext: 'Children read the word aloud together', step: { name: 'We Do', index: 3 }, tag: 'C4' });
    expect(groupFor).toHaveBeenCalledWith(UID);
    expect(reportLinkUrl).toHaveBeenCalledWith({ sessionId: SID, userId: UID });
    expect(resolveThing).toHaveBeenCalledWith({ userId: UID, coachingSessionId: SID, lpFidelity: LPF });
  });

  test.each([
    ['no thing', { thing: null }],
    ['a done marker (no text)', { thing: { move_id: null, lesson_id: 'L1', text: null, tag: null, step: null } }],
  ])('%s: the commitment action', async (_l, resolved) => {
    groupFor.mockResolvedValue(arm('C', 'new'));
    resolveThing.mockResolvedValue(resolved);
    expect(await call()).toEqual({ tryNext: 'Ask three children to explain', step: null, tag: null });
  });

  test('a carried thing keeps the step it was set in, not a move of today\'s plan with the same id', async () => {
    groupFor.mockResolvedValue(arm('D', 'new'));
    resolveThing.mockResolvedValue({ thing: { move_id: 'm1', lesson_id: 'L0', text: 'Pair talk', tag: 'C9', step: { name: 'You Do', index: 4 } } });
    expect(await call()).toEqual({ tryNext: 'Pair talk', step: { name: 'You Do', index: 4 }, tag: 'C9' });
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

function card(extra = {}) {
  return {
    language: 'en',
    header: { name: 'Sana', meta: 'Grade 2 · Maths · Fractions', date: '19 Oct 2026', pct: 72 },
    wells: ['You waited for answers', 'Clear board work'],
    thing: { text: 'Children read the word aloud together', step: { name: 'We Do', index: 3 }, why: 'Every child says it.' },
    ...extra,
  };
}

describe('the slim image is the ICT-3 card', () => {
  const html = buildSlimCardHtml(card());

  test('header: name, grade · subject · topic · date, and the score', () => {
    for (const s of ['Sana', 'Grade 2 · Maths · Fractions · 19 Oct 2026', '72%', 'class="hd"']) expect(html).toContain(s);
  });

  test('what you did well, each with a green tick', () => {
    expect(html).toContain('What you did well');
    expect(html).toContain('<li><span class="tick">✓</span><span>You waited for answers</span></li>');
    expect(html).toContain('Clear board work');
  });

  test('try one thing tomorrow, in its step chip, why, and the next-recording check', () => {
    for (const s of ['★ Try one thing tomorrow', 'class="chip s3">We Do<', 'Children read the word aloud together',
      'Every child says it.', 'We’ll look for this in your next recording.']) expect(html).toContain(s);
  });

  test('ends with the line pointing at the button; no scorecard, moments or journey', () => {
    expect(html).toContain('Your full report is one tap below');
    for (const s of ['Your scores', 'Moments worth remembering', 'Your journey']) expect(html).not.toContain(s);
  });

  test('no strengths: no did-well panel; no step: no chip; no why: no why line', () => {
    const bare = buildSlimCardHtml(card({ wells: [], thing: { text: 'Ask two children', step: null, why: null } }));
    expect(bare).not.toContain('What you did well');
    expect(bare).not.toContain('class="chip');
    expect(bare).not.toContain('class="why"');
    expect(bare).toContain('Ask two children');
  });

  test('Urdu: RTL with the template\'s Urdu labels', () => {
    const ur = buildSlimCardHtml(card({ language: 'ur', wells: ['آپ نے انتظار کیا'], thing: { text: 'بچوں سے لفظ مل کر پڑھوائیں', step: { name: 'We Do', index: 3 }, why: null } }));
    for (const s of ['dir="rtl"', 'آپ نے یہ اچھا کیا', '★ کل ایک کام آزمائیں', 'اگلی ریکارڈنگ میں ہم یہی دیکھیں گے۔', 'بچوں سے لفظ مل کر پڑھوائیں', 'آپ نے انتظار کیا']) {
      expect(ur).toContain(s);
    }
  });

  test('text is escaped', () => {
    expect(buildSlimCardHtml(card({ wells: ['<b>x</b>'] }))).toContain('&lt;b&gt;x&lt;/b&gt;');
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
  const analysis = { framework: 'fico', grade: 3, subject: 'English', topic: 'Nouns', scores: { overall_percentage: 61, overall_marks: 30, max_marks: 49 }, domains: {}, strengths: ['Clear board work'] };
  const base = { teacherName: 'Sana', language: 'en', commitmentAction: 'Commitment action' };

  test('with slim: the full image as png (stored), the slim one as slimPng (sent)', async () => {
    const htmlToImage = jest.fn(async (html) => Buffer.from(html.includes('one tap below') ? 'SLIM' : 'FULL'));
    const out = await load(htmlToImage)(session, analysis, { ...base, slim: { tryNext: 'The .20 pick', step: { name: 'You Do', index: 4 }, tag: 'C9' } });
    expect(out.png.toString()).toBe('FULL');
    expect(out.slimPng.toString()).toBe('SLIM');
    expect(htmlToImage).toHaveBeenCalledTimes(2);
    expect(htmlToImage.mock.calls[0][0]).toContain('Commitment action');
    const slim = htmlToImage.mock.calls[1][0];
    for (const s of ['The .20 pick', 'class="chip s4">You Do<', 'Clear board work', 'Grade 3 · English · Nouns', 'Sana', '61%', 'partner']) {
      expect(slim).toContain(s);
    }
    expect(out.narrative).toMatchObject({ affirmation: 'Well done' });
  });

  test('no strengths stored: the narrative strength fills what she did well', async () => {
    const htmlToImage = jest.fn(async (html) => Buffer.from(html.includes('one tap below') ? 'SLIM' : 'FULL'));
    await load(htmlToImage)(session, { ...analysis, strengths: [] }, { ...base, slim: { tryNext: 'x', step: null, tag: null } });
    expect(htmlToImage.mock.calls[1][0]).toContain('Wait time');
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
