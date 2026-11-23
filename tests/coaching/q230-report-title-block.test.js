'use strict';
/**
 * Queue #230 — the Teacher Observation Report opens with a title block, not a sentence (the operator, 23 Nov ~16:05:
 * "on the Teacher Observation Report, the header looks plain shit. Its a urdu sentence ... replace the report's
 * sentence header with a proper title block").
 *
 *   hero   the rubric chip · the title (Urdu report: its Urdu title, in the Nastaliq stack) · the teacher · the school
 *          · grade + subject + date · observed by <name> · Coach|Principal; the score stays where it was
 *   below  v6: the affirmation sentence is the lead line under the hero (kept, never the header);
 *          FICO 6-12 / FDE: no affirmation at all (it repeated the score and band)
 *   none   a fact not on file is left out with its line; nothing is invented
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const USERS = {
  't-1': { id: 't-1', name: 'Ayesha Bibi', role: 'teacher', school_name: 'IMCG F-7/2' },
  'o-1': { id: 'o-1', name: 'Rifat Yasmeen', role: 'coach', school_name: null },
  'p-1': { id: 'p-1', name: 'Nadia Khan', role: 'principal', school_name: 'IMCG F-7/2' },
  'o-2': { id: 'o-2', name: 'Sana Riaz', role: 'coach', school_name: null },
};
// The HITL v6/v7 switch names o-1 (a coach: the coach app, the full app and the flow switch); o-2 is not on it.
const SETTINGS = { portal_coach_flow_v2: '["o-1"]', portal_coach_v2: '["o-1","o-2"]', portal_coach_full_app: '["o-1","o-2"]' };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => ({
    select: () => ({
      in: async (_c, keys) => ({
        data: table === 'app_settings'
          ? keys.filter((k) => k in SETTINGS).map((k) => ({ key: k, value: SETTINGS[k] }))
          : keys.map((id) => USERS[id]).filter(Boolean),
        error: null,
      }),
    }),
  })),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const Title = require('../../bot/shared/services/coaching/report-v2/report-title');
const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');

// The hero alone: from its div to the first block under it (the lead/identity line, else the columns).
const hero = (html) => {
  const start = html.indexOf('<div class="hero">');
  const ends = ['<div class="pad"', '<div class="cols">'].map((m) => html.indexOf(m, start)).filter((i) => i > start);
  return html.slice(start, Math.min(...ends));
};
const AFFIRM_UR = 'آپ کا سبق، کوچ نے ایف ڈی ای کے ٹول پر جانچا';

function vm(over = {}) {
  return {
    language: 'en', brand: 'niete', teacherName: 'Ayesha Bibi', topic: 'Fractions', date: '2026-11-23',
    score: { overall: 72, marks: 36, max: 50 }, groups: [], trend: [], classroomPhotos: [], photoB64: '',
    narrative: { affirmation: 'Your class came alive when you asked why.', identity: 'A patient questioner.' },
    ...over,
  };
}

describe('queue #230 · buildReportTitle', () => {
  it('English: the title, then each fact on file', () => {
    const t = Title.buildReportTitle({
      teacher: 'Ayesha Bibi', school: 'IMCG F-7/2', grade: 7, subject: 'English', at: '2026-11-23T10:17:02Z',
      observer: 'Rifat Yasmeen', observerRole: 'coach', rubric: 'FICO 6-12',
    }, 'en');
    expect(t).toEqual({
      text: 'Teacher Observation Report', teacher: 'Ayesha Bibi', school: 'IMCG F-7/2',
      line: 'Grade 7 · English · 23 Nov 2026', observer: 'Observed by Rifat Yasmeen · Coach', rubric: 'FICO 6-12',
    });
  });

  it('Urdu: the Urdu title and labels, Urdu digits and month; a principal is named a principal', () => {
    const t = Title.buildReportTitle({ teacher: 'Ayesha Bibi', grade: '7', subject: 'انگریزی', at: '2026-11-23T10:17:02Z', observer: 'Nadia Khan', observerRole: 'principal' }, 'ur');
    expect(t.text).toBe('استاد کی مشاہداتی رپورٹ');
    expect(t.line).toBe('جماعت ۷ · انگریزی · ۲۳ نومبر ۲۰۲۶');
    expect(t.observer).toBe('مشاہدہ: Nadia Khan · پرنسپل');
  });

  it('a fact not on file is left out, never made up', () => {
    const t = Title.buildReportTitle({ at: null }, 'en');
    expect(t).toEqual({ text: 'Teacher Observation Report', teacher: null, school: null, line: null, observer: null, rubric: null });
  });

  it('the rubric chip comes from the stamp', () => {
    expect(Title.rubricChip({ framework: 'fico_s_v1_2' })).toBe('FICO 6-12');
    expect(Title.rubricChip({ framework: 'obs612-enur-v1' })).toBe('FDE');
    expect(Title.rubricChip({ framework: 'oecd' })).toBeNull();
  });

  it('loadTitleFacts reads the teacher, the observer and whether the HITL switch names the observer; a failed read is off', async () => {
    await expect(Title.loadTitleFacts({ user_id: 't-1', observer_user_id: 'o-1' }))
      .resolves.toEqual({ teacherName: 'Ayesha Bibi', school: 'IMCG F-7/2', observer: 'Rifat Yasmeen', observerRole: 'coach', hitl: true });
    await expect(Title.loadTitleFacts({ user_id: 't-1', observer_user_id: 'o-2' })).resolves.toMatchObject({ observer: 'Sana Riaz', hitl: false });
    const broken = { from: () => { throw new Error('db down'); } };
    await expect(Title.loadTitleFacts({ user_id: 't-1', observer_user_id: 'o-1' }, { supabase: broken }))
      .resolves.toEqual({ teacherName: null, school: null, observer: null, observerRole: null, hitl: false });
  });
});

describe('queue #230 · the hero renders the title block', () => {
  const title = (lang, over = {}) => ({
    ...Title.buildReportTitle({ teacher: 'Ayesha Bibi', school: 'IMCG F-7/2', grade: 7, subject: lang === 'ur' ? 'انگریزی' : 'English', at: '2026-11-23T10:17:02Z', observer: 'Rifat Yasmeen', observerRole: 'coach', rubric: 'FICO17 v6' }, lang),
    ...over,
  });

  it('English: the title is the h1, the facts follow, the score stays; the affirmation is the lead below, not the header', () => {
    const html = buildHeroReportHtml(vm({ title: title('en') }));
    const h = hero(html);
    expect(h).toMatch(/<h1 class="tt">Teacher Observation Report<\/h1>/);
    for (const s of ['Ayesha Bibi', 'IMCG F-7/2', 'Grade 7 · English · 23 Nov 2026', 'Observed by Rifat Yasmeen · Coach', 'FICO17 v6', '72%']) expect(h).toContain(s);
    expect(h).not.toContain('Your class came alive');
    expect(html).toMatch(/class="identity lead">Your class came alive when you asked why\./);
    expect(html).toContain('A patient questioner.');
  });

  it('Urdu: the Urdu title in the Nastaliq stack, RTL page, no English title; the chip is isolated LTR', () => {
    const html = buildHeroReportHtml(vm({ language: 'ur', title: title('ur', { noLead: true }), narrative: { affirmation: AFFIRM_UR } }));
    expect(html).toMatch(/<html[^>]*dir="rtl"/);
    expect(hero(html)).toContain('<h1 class="tt">استاد کی مشاہداتی رپورٹ</h1>');
    expect(html).not.toContain('Teacher Observation Report');
    expect(html).toMatch(/\.hero h1\.tt\{font-family:'NastaliqUrdu'/);
    expect(html).toMatch(/\.rchip\{[^}]*direction:ltr;unicode-bidi:isolate/);
    expect(html).toMatch(/\.tn,\.tm\{unicode-bidi:plaintext;text-align:right\}/); // a Latin name keeps its own order
    expect(html).toMatch(/@font-face\{font-family:'NastaliqUrdu';font-weight:400;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/]{100,}/);
    expect(html).not.toContain(AFFIRM_UR); // noLead: the FDE / FICO 6-12 sentence is not drawn at all
  });

  async function renderV6(observerId) {
    jest.resetModules();
    jest.doMock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
      ...jest.requireActual('../../bot/shared/services/coaching/report-v2/narrative.service'),
      generateReportNarrative: async () => ({ affirmation: 'You asked why, and they told you.', strength_name: 'S', strength_note: 'N', horizon_title: 'H', horizon_note: 'Q', moments: [] }),
    }));
    jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: async (html) => Buffer.from(String(html)) }));
    jest.doMock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: async () => [] }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    const { reviewedV6, TRANSCRIPT } = require('../fixtures/fico17-v6-reviewed');
    const { generateHeroReport } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    const out = await generateHeroReport({ id: 'cs', user_id: 't-1', observer_user_id: observerId, created_at: '2026-11-23T10:17:02Z', transcript_text: TRANSCRIPT },
      reviewedV6(), { language: 'en', brand: 'niete', teacherName: 'Ayesha Bibi' });
    return out.png.toString();
  }

  it('the real path, an observer off the HITL switch: today\'s header, unchanged', async () => {
    const h = hero(await renderV6('o-2'));
    expect(h).toContain('<h1>You asked why, and they told you.</h1>');
    expect(h).not.toContain('Teacher Observation Report');
  });

  it('the real path: generateHeroReport on a reviewed v6 visit draws the title block with the read facts', async () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
      ...jest.requireActual('../../bot/shared/services/coaching/report-v2/narrative.service'),
      generateReportNarrative: async () => ({ affirmation: 'You asked why, and they told you.', strength_name: 'S', strength_note: 'N', horizon_title: 'H', horizon_note: 'Q', moments: [] }),
    }));
    jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: async (html) => Buffer.from(String(html)) }));
    jest.doMock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: async () => [] }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    const { reviewedV6, TRANSCRIPT } = require('../fixtures/fico17-v6-reviewed');
    const { generateHeroReport } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    const out = await generateHeroReport({ id: 'cs', user_id: 't-1', observer_user_id: 'o-1', created_at: '2026-11-23T10:17:02Z', transcript_text: TRANSCRIPT },
      reviewedV6(), { language: 'en', brand: 'niete', teacherName: 'Ayesha Bibi' });
    const h = hero(out.png.toString());
    expect(h).toContain('<h1 class="tt">Teacher Observation Report</h1>');
    for (const s of ['Ayesha Bibi', 'IMCG F-7/2', '23 Nov 2026', 'Observed by Rifat Yasmeen · Coach', 'FICO17 v6']) expect(h).toContain(s);
    expect(h).not.toContain('You asked why, and they told you.');
    expect(out.png.toString()).toContain('class="identity lead">You asked why, and they told you.');
  });

  it('no title: the hero is exactly as before (every other caller)', () => {
    const h = hero(buildHeroReportHtml(vm()));
    expect(h).toContain('<h1>Your class came alive when you asked why.</h1>');
    expect(h).not.toContain('class="tt"');
  });
});
