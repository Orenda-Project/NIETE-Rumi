/**
 * bd-r2uzg1.23.12 (queue #274, call 27A; ICT sheet HITL 44, 45): a teacher got her own DC report (62%) and her coach's
 * report (54%) for the same lesson, and nothing on either said whose it was. The operator, 27 Nov ~07:4x: "when report
 * is received it should be stating it's coming from where". So every report she receives says its source:
 *
 *   her own recording   "DC observation · from your own recording"      ڈیجیٹل کوچنگ مشاہدہ · آپ کی اپنی ریکارڈنگ سے
 *   a coach's visit     "Observation by your coach Ayesha Khan"         آپ کے کوچ Ayesha Khan کا مشاہدہ
 *   a principal's       "Observation by your principal Imran Ali"       آپ کے پرنسپل Imran Ali کا مشاہدہ
 *
 * on the report image (hero and slim card) and in the DC report's caption; a coach's report caption names the coach
 * as coach or principal, in English and Urdu (the Urdu caption named nobody).
 */
const { reportSource, observerLabel } = require('../../bot/shared/services/coaching/report-v2/report-title');
const { buildHeroReportHtml, buildReportCaption } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');
const { buildSlimCardHtml } = require('../../bot/shared/services/coaching/report-v2/slim-card.template');
const { teacherReportCaption } = require('../../bot/shared/services/observe/observe-teacher-caption');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

const DC = { user_id: 'u-1', observer_user_id: null, observation_type: null };
const VISIT = { user_id: 'u-1', observer_user_id: 'c-1', observation_type: 'leader_observation' };

describe('reportSource: whose report this is', () => {
  test('her own recording (no observer): a DC observation', () => {
    expect(reportSource(DC, {}, 'en')).toBe('DC observation · from your own recording');
    expect(reportSource(DC, {}, 'ur')).toBe('ڈیجیٹل کوچنگ مشاہدہ · آپ کی اپنی ریکارڈنگ سے');
  });

  test("a coach's visit: an Observation by her coach, named", () => {
    const f = { observer: 'Ayesha Khan', observerRole: 'coach' };
    expect(reportSource(VISIT, f, 'en')).toBe('Observation by your coach Ayesha Khan');
    expect(reportSource(VISIT, f, 'ur')).toBe('آپ کے کوچ Ayesha Khan کا مشاہدہ');
  });

  test("a principal's visit says principal", () => {
    const f = { observer: 'Imran Ali', observerRole: 'principal' };
    expect(reportSource(VISIT, f, 'en')).toBe('Observation by your principal Imran Ali');
    expect(reportSource(VISIT, f, 'ur')).toBe('آپ کے پرنسپل Imran Ali کا مشاہدہ');
  });

  test('no name on file: the role alone, never a made-up name', () => {
    expect(reportSource(VISIT, { observerRole: 'coach' }, 'en')).toBe('Observation by your coach');
    expect(reportSource(VISIT, {}, 'ur')).toBe('آپ کے کوچ کا مشاہدہ');
  });

  test('a visit with no observer id but marked as an observation is still an Observation', () => {
    expect(reportSource({ observation_type: 'leader_observation' }, {}, 'en')).toBe('Observation by your coach');
  });
});

function vm(extra = {}) {
  return {
    language: 'en', teacherName: 'Sadia', topic: 'Fractions', date: '2026-08-01',
    score: { overall: 62, marks: 80, max: 128 },
    groups: [{ key: 'A', name: 'Classroom culture', score: 27, max: 48, pct: 56 }],
    narrative: { affirmation: 'Your class was full of questions', moments: [] },
    tryNext: '', trend: [], photoB64: '',
    ...extra,
  };
}

describe('the report image says whose it is', () => {
  test.each(['en', 'ur'])('%s hero: the source line under the name', (language) => {
    const source = reportSource(DC, {}, language);
    const html = buildHeroReportHtml(vm({ language, source }));
    expect(html).toContain('class="who src"');
    expect(html).toContain(language === 'ur' ? 'ڈیجیٹل کوچنگ مشاہدہ' : 'DC observation · from your own recording');
  });

  test('no source: the hero is as before', () => {
    expect(buildHeroReportHtml(vm())).not.toContain('class="who src"');
  });

  test('a title block already names the observer: no second line', () => {
    const title = { text: 'Teacher Observation Report', teacher: 'Sadia', observer: 'Observed by Ayesha · Coach' };
    const html = buildHeroReportHtml(vm({ title, source: 'Observation by your coach Ayesha' }));
    expect(html).toContain('Observed by Ayesha · Coach');
    expect(html).not.toContain('class="who src"');
  });

  test.each(['en', 'ur'])('%s slim card: the source line in its header', (language) => {
    const source = reportSource(DC, {}, language);
    const html = buildSlimCardHtml({ language, header: { name: 'Sadia', meta: 'Grade 3', date: '1 Aug', pct: 62, source }, wells: [], thing: {} });
    expect(html).toContain('class="mt src"');
    expect(html).toContain(language === 'ur' ? 'آپ کی اپنی ریکارڈنگ سے' : 'from your own recording');
  });
});

describe("the DC report's caption says whose it is", () => {
  test('en: the caption, then the source on its own line', () => {
    const source = reportSource(DC, {}, 'en');
    expect(buildReportCaption(vm({ source }))).toBe('📋 Your coaching report · Fractions · 2026-08-01\nDC observation · from your own recording');
  });
  test('ur: the same', () => {
    const source = reportSource(DC, {}, 'ur');
    expect(buildReportCaption(vm({ language: 'ur', source })).split('\n')[1]).toBe('ڈیجیٹل کوچنگ مشاہدہ · آپ کی اپنی ریکارڈنگ سے');
  });
  test('no source: the caption is as before', () => {
    expect(buildReportCaption(vm())).toBe('📋 Your coaching report · Fractions · 2026-08-01');
  });
});

describe("a coach's report caption names the coach as coach or principal", () => {
  test('observerLabel', () => {
    expect(observerLabel('Ayesha Khan', 'coach', 'en')).toBe('your coach Ayesha Khan');
    expect(observerLabel('Imran Ali', 'principal', 'en')).toBe('your principal Imran Ali');
    expect(observerLabel('Ayesha Khan', 'coach', 'ur')).toBe('آپ کے کوچ Ayesha Khan');
    expect(observerLabel('', 'principal', 'ur')).toBe('آپ کے پرنسپل');
    expect(observerLabel('Ayesha', 'coach', 'sw')).toBe('Ayesha'); // other languages: the name, as before
  });

  test('en: "Prepared from your coach Ayesha Khan\'s visit"', () => {
    const c = teacherReportCaption(observeStrings('en'), {}, { name: 'Ayesha Khan', role: 'coach' }, 'en');
    expect(c).toContain("Prepared from your coach Ayesha Khan's visit");
  });

  test('ur: the caption now names the coach (it named nobody)', () => {
    const c = teacherReportCaption(observeStrings('ur'), {}, { name: 'Ayesha Khan', role: 'coach' }, 'ur');
    expect(c).toContain('آپ کے کوچ Ayesha Khan');
    const p = teacherReportCaption(observeStrings('ur'), {}, { name: 'Imran Ali', role: 'principal' }, 'ur');
    expect(p).toContain('آپ کے پرنسپل Imran Ali');
  });

  test('FDE and FICO 6-12 captions name the role too', () => {
    const fde = { framework: 'obs612-gen-v1' };
    const c = teacherReportCaption(observeStrings('en'), fde, { name: 'Imran Ali', role: 'principal' }, 'en');
    expect(c).toContain('your principal Imran Ali');
  });

  test('no coach row: the old placeholder name is never shown with a role', () => {
    const c = teacherReportCaption(observeStrings('en'), {}, null, 'en');
    expect(c).toContain('your coach');
    expect(c).not.toContain('Afisa');
  });
});

// The real path: generateHeroReport with the renderer and LLM stubbed (harness of video-reco/hero-report.video-strip).
describe('generateHeroReport draws the source on both images and in the caption', () => {
  const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
  const COACH = 'c0ac4000-0000-4000-8000-000000000001';
  function load(htmlToImage, users = []) {
    jest.resetModules();
    jest.doMock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
      generateReportNarrative: jest.fn().mockResolvedValue({ affirmation: 'Well done', strength_name: 'Wait time' }),
      subjectUnconfirmedNote: () => '',
    }));
    jest.doMock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn().mockResolvedValue([]) }));
    jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    jest.doMock('../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (table) => ({
        select: () => ({
          in: async () => (table === 'users' ? { data: users, error: null } : { data: [], error: null }),
        }),
      }),
    }));
    return require('../../bot/shared/services/coaching/report-v2/hero-report.service').generateHeroReport;
  }
  const analysis = { framework: 'fico', grade: 3, subject: 'English', topic: 'Nouns', scores: { overall_percentage: 61, overall_marks: 30, max_marks: 49 }, domains: {}, strengths: ['Clear board work'] };
  const base = { teacherName: 'Sana', language: 'en', commitmentAction: 'x', slim: { tryNext: 'x', step: null, tag: null } };

  test('her own recording: "DC observation · from your own recording" on the full and slim image, and in the caption', async () => {
    const htmlToImage = jest.fn(async () => Buffer.from('PNG'));
    const out = await load(htmlToImage)({ id: 's-1', user_id: UID, created_at: '2026-10-19T00:00:00Z', transcript_text: 't' }, analysis, base);
    expect(htmlToImage).toHaveBeenCalledTimes(2);
    for (const [html] of htmlToImage.mock.calls) expect(html).toContain('DC observation · from your own recording');
    expect(out.caption.split('\n')[1]).toBe('DC observation · from your own recording');
  });

  test("a principal's visit (off the HITL switch): her name and role on the image", async () => {
    const htmlToImage = jest.fn(async () => Buffer.from('PNG'));
    const users = [{ id: UID, name: 'Sana' }, { id: COACH, name: 'Imran Ali', role: 'principal' }];
    await load(htmlToImage, users)({ id: 's-2', user_id: UID, observer_user_id: COACH, observation_type: 'leader_observation', created_at: '2026-10-19T00:00:00Z' }, analysis, { ...base, slim: undefined });
    expect(htmlToImage.mock.calls[0][0]).toContain('Observation by your principal Imran Ali');
  });
});
