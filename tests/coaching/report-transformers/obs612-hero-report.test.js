/**
 * bd-ra8xu.51 — the FDE teacher report, as Rifat asked on 13 Nov (pre-approved by the operator):
 *   (2) the FICO teacher report's format, design and order: the hero page, the score, the scorecard, then the
 *       teacher's strength, the area to improve, and one focus for the next lesson;
 *   (3) written to the teacher: no coach-debrief wording ("For the talk with the teacher", "Start with", …);
 *   (1) Urdu notes render in Nastaliq, and a long run with no space stays inside its box.
 * Built from the coach's FDE scores and Section 8 notes only: no narrative model, no FICO journey.
 */
const F = require('../../fixtures/obs612-visits');

let captured;
let generateHeroReport;
let buildHeroReportHtml;

beforeAll(() => {
  jest.resetModules();
  captured = [];
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../../bot/shared/utils/html-to-pdf', () => ({
    htmlToImage: jest.fn(async (html, opts) => { captured.push({ html, opts }); return Buffer.from('png'); }),
  }));
  jest.doMock('../../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
    generateReportNarrative: jest.fn(async () => { throw new Error('the narrative model must not run on an FDE report'); }),
    subjectUnconfirmedNote: () => '',
  }));
  jest.doMock('../../../bot/shared/services/coaching/coaching-trend.service', () => ({
    loadTrendData: jest.fn(async () => { throw new Error('the FICO journey must not be read for an FDE report'); }),
    loadPriorAction: jest.fn(),
  }));
  jest.doMock('../../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
  ({ generateHeroReport } = require('../../../bot/shared/services/coaching/report-v2/hero-report.service'));
  ({ buildHeroReportHtml } = require('../../../bot/shared/services/coaching/report-v2/hero-report.template'));
});

async function render(analysis, language = 'en') {
  captured.length = 0;
  const out = await generateHeroReport(F.sessionRow(analysis), analysis, { teacherName: 'Ayesha Khan', language, requireNarrative: true });
  return { out, html: captured[0].html };
}
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the FDE report is the FICO teacher report', () => {
  test('same page: the hero, the scorecard, then strength, horizon and one thing to try, in that order', async () => {
    const { html } = await render(F.enur());
    expect(html).toContain('class="hero"');
    expect(html).toContain('class="cols"');
    const t = text(html);
    const at = (s) => t.indexOf(s);
    ['Your scores · this lesson', 'Your strength', 'Your next horizon', 'One thing to try next class', 'Made just for you, Ayesha Khan']
      .forEach((s) => expect(at(s)).toBeGreaterThan(-1));
    expect(at('Your strength')).toBeLessThan(at('Your next horizon'));
    expect(at('Your next horizon')).toBeLessThan(at('One thing to try next class'));
  });

  test('the strength, the area to improve and the focus are the coach\'s own Section 8 words, under FDE\'s parts', async () => {
    const { html } = await render(F.enur());
    const t = text(html);
    expect(t).toContain('Clear objectives and a warm tone with every student.');
    expect(t).toContain('Checking reading comprehension during the lesson.');
    expect(t).toContain('Ask two why-questions after each paragraph.');
    expect(t).toContain('Next two weeks');
    expect(t).toContain('D. Interest &amp; Motivation'); // the strongest part, named in the strength
    expect(t).toContain('C. Reading Skills'); // the weakest part, named in the horizon
    expect(t).toMatch(/74%/); // FDE's own percentage, as the FICO report shows its own
    expect(t).toContain('109/148');
    expect(t).toMatch(/79\.5 of 108/);
    expect(t).toContain('Proficient');
  });

  test('it speaks to the teacher: none of the coach\'s debrief wording', async () => {
    const { html } = await render(F.enur());
    const t = text(html);
    for (const s of ['For the talk with the teacher', 'Start with', 'Work on:', 'Agree on', 'Feedback from your coach', 'Your coach noted']) {
      expect(t).not.toContain(s);
    }
  });

  test('Maths & Science and the General form get the same page (no total where FDE gives none)', async () => {
    for (const a of [F.msci(), F.gen()]) {
      const { html } = await render(a);
      const t = text(html);
      expect(html).toContain('class="hero"');
      expect(t).toContain('Your strength');
      expect(t).toContain('One thing to try next class');
      expect(html).not.toMatch(/class="hscore"/);
    }
    const t = text((await render(F.msci())).html);
    expect(t).toContain('Close with a two-minute summary and homework on the board.');
  });
});

describe('Urdu', () => {
  const urNotes = {
    fb_strengths: 'آپ نے سبق کا مقصد واضح طور پر بتایا اور ہر بچے سے نرمی سے بات کی۔',
    fb_areas: 'سبق کے دوران سمجھ کی جانچ کم ہوئی۔',
    fb_recommendations: 'ہر پیراگراف کے بعد دو "کیوں" والے سوال پوچھیں۔',
    fb_timeline: 'اگلے دو ہفتے',
  };

  test('an Urdu report is right to left, Nastaliq first, and carries the coach\'s Urdu words', async () => {
    const { html } = await render(F.enur({ sheet: 'ur', over: urNotes }), 'ur');
    expect(html).toContain('dir="rtl"');
    expect(html).toMatch(/font-family:'NastaliqUrdu','NaskhArabic'/);
    Object.values(urNotes).forEach((s) => expect(html).toContain(s.replace(/"/g, '"')));
  });

  test('a note with no spaces (a held-down key) is allowed to break, so it stays inside its box', async () => {
    const { html } = await render(F.enur({ sheet: 'ur', over: { fb_strengths: 'ھ'.repeat(41) } }), 'ur');
    expect(html).toMatch(/overflow-wrap:anywhere/);
  });

  test('our own Urdu lines use Urdu digits', async () => {
    const { html } = await render(F.enur({ sheet: 'ur', over: urNotes }), 'ur');
    const h1 = (/<h1>([\s\S]*?)<\/h1>/.exec(html) || [])[1] || '';
    expect(h1).not.toMatch(/[٠-٩]/);
  });
});

describe('the FICO report itself is unchanged', () => {
  test('without the FDE flag the page has no new rule', () => {
    const html = buildHeroReportHtml({ language: 'en', teacherName: 'T', narrative: {}, score: { overall: 70, marks: 7, max: 10 }, groups: [] });
    expect(html).not.toMatch(/overflow-wrap:anywhere/);
  });
});

describe('Rifat\'s 13 Nov notes and the rest of the Urdu (bd-ra8xu.51)', () => {
  const { readableNote } = require('../../../bot/shared/services/observe/obs612/view');
  test('a held-down key (one letter 41 times) is broken into short runs that cannot join; real words are untouched', () => {
    const run = 'ھ'.repeat(41);
    const out = readableNote(run);
    expect(out.replace(/[​‌]/g, '')).toBe(run);
    const chunks = out.split('‌​');
    expect(chunks.every((p) => Array.from(p.replace(/\u200C/g, '')).length <= 8)).toBe(true);
    expect(out).not.toMatch(/ھھ/); // no two letters joined
    const words = 'آپ نے سبق کا مقصد واضح طور پر بتایا۔';
    expect(readableNote(words)).toBe(words);
  });

  test('on the page, the notes are broken up the same way', async () => {
    const { html } = await render(F.enur({ sheet: 'ur', over: { fb_strengths: 'ھ'.repeat(41) } }), 'ur');
    expect(html).toContain('‌​');
  });

  test('the parts carry FDE\'s section numbers; the Urdu page names the subject in Urdu and has an Urdu footnote', async () => {
    const { html, out } = await render(F.enur({ sheet: 'ur' }), 'ur');
    const t = text(html);
    expect(t).toContain('3A. Participation');
    expect(t).toContain('4D. Writing Skills');
    expect(t).toContain('5. Assessment');
    expect(t).toContain('اردو');
    expect(t).toContain('یہ FICO اسکور نہیں');
    expect(out.caption).toMatch(/جماعت ۷/);
    expect(out.caption).not.toMatch(/جماعت 7/);
  });

  test('the coach\'s chat summary breaks a held-down key too', () => {
    const { buildCoachSummary } = require('../../../bot/shared/services/observe/obs612/summary');
    const s = buildCoachSummary(F.enur({ sheet: 'ur', over: { fb_strengths: 'ھ'.repeat(41) } }), { lang: 'ur', teacherName: 'T' });
    expect(s).toContain('‌​');
  });
});
