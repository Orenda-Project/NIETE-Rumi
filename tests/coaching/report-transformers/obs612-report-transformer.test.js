'use strict';
/**
 * bd-pni007 — the teacher's report for an FDE (obs612) visit: FDE's own result on FDE's own tool, scored by the coach.
 *
 * What the teacher receives when the coach confirms the send is generateHeroReport's image (observe-send preview →
 * deliver). Since bd-ra8xu.51 (Rifat, 13 Nov) an FDE visit gets the FICO teacher report's page, built from FDE's own
 * scores and the coach's Section 8 notes only (the detail is in obs612-hero-report.test.js):
 *   enur  FDE's % big, the band, 109/148 marks and "79.5 of 108 on FDE's scale", a score row per part (3A., 5., …),
 *         the strongest part + the coach's strengths, the weakest part + the areas, the recommendations as the one
 *         thing to try;
 *   msci  a row per indicator out of 3, the development plan as the horizon and the thing to try, and NO total;
 *   gen   "x/n" per section, the feedback line, no score;
 *   all   footer "Scored by your coach on FDE's tool (Annexure G, 2026-27). Not a FICO score." (Urdu on an Urdu page);
 *         no narrative model call, no FICO journey (the teacher's FICO history never beside it).
 * The reportData transformer (report records, any PDF consumer) and the renderer registry know the three ids too.
 *
 * Set OBS612_RENDER_OUT=<dir> to write each rendered HTML there for a person to read; a plain test run writes nothing.
 */

const fs = require('fs');
const path = require('path');
const F = require('../../fixtures/obs612-visits');

const OUT = process.env.OBS612_RENDER_OUT || null;
const IDS = ['obs612-enur-v1', 'obs612-msci-v1', 'obs612-gen-v1'];
const FOOTER = "Scored by your coach on FDE's tool (Annexure G, 2026-27). Not a FICO score.";

/** The words a reader sees: no <style>, no tags, entities decoded, isolates dropped. */
function textOf(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('report data (transformer)', () => {
  let getReportTransformer;
  let transformOECDToReportData;
  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    ({ getReportTransformer } = require('../../../bot/shared/services/coaching/report-transformers/report-transformer-dispatch'));
    ({ transformOECDToReportData } = require('../../../bot/shared/services/coaching/report-transformers/oecd-report-transformer'));
  });
  const SESSION = { created_at: '2026-11-11T09:31:00Z', users: { region: 'Sihala' } };

  test('each of the three ids has the FDE transformer, never the OECD fallback', () => {
    const t = getReportTransformer('obs612-enur-v1');
    expect(t).not.toBe(transformOECDToReportData);
    for (const id of IDS) expect(getReportTransformer(id)).toBe(t);
    for (const k of ['oecd', 'hots', 'teach', 'fico', 'fico17_v6', 'mewaka']) expect(typeof getReportTransformer(k)).toBe('function');
  });

  test('English & Urdu: FDE total, max and band; one goal per section; items 1-4; Section 8', () => {
    const rd = getReportTransformer('obs612-enur-v1')(SESSION, 'Ayesha Khan', F.enur());
    expect(rd).toMatchObject({
      framework: 'obs612-enur-v1', rubric: 'obs612-enur-v1', rubricLabel: 'FDE v1', teacherName: 'Ayesha Khan',
      totalScore: 109, maxScore: 148, percentage: 73.6, band: 'Proficient', noTotal: false,
    });
    expect(rd.goals).toHaveLength(15);
    const d = rd.goals.find((g) => g.title === 'D. Interest & Motivation');
    expect(d).toMatchObject({ score: 8, maxScore: 8 });
    expect(d.criteria.map((c) => c.score)).toEqual([4, 4]);
    expect(d.criteria[0]).toMatchObject({ name: 'Students show curiosity', max: 4, setBy: 'coach' });
    expect(rd.feedbackSections.map((f) => f.label)).toEqual(['Strengths', 'Areas for Improvement', 'Recommendations', 'Timeline']);
    expect(rd.footer).toBe(FOOTER);
    expect(JSON.stringify(rd)).not.toMatch(/FICO17|NaN/);
  });

  test('Maths & Science: levels per indicator, the 5-student check, the plan, and no total', () => {
    const rd = getReportTransformer('obs612-msci-v1')(SESSION, 'Ali', F.msci());
    expect(rd).toMatchObject({ framework: 'obs612-msci-v1', totalScore: null, maxScore: null, noTotal: true });
    const all = rd.goals.flatMap((g) => g.criteria);
    expect(all.find((c) => c.key === 'i9')).toMatchObject({ name: '9 · Wrapping up the lesson: Level 0', score: 0, max: 3 });
    expect(all.find((c) => c.key === 'i9').evidence).toMatch(/Wrapping up\/concluding the lesson/);
    expect(all.find((c) => c.key === 'students')).toMatchObject({ name: '5 students checked: 3-4 of 5 understood', score: 2 });
    expect(rd.goals.every((g) => g.score === null && g.maxScore === null)).toBe(true);
    expect(rd.developmentPlan[0]).toBe('Wrapping up the lesson: Level 0 → Level 1. Close with a two-minute summary and homework on the board.');
  });

  test('General form: Yes counts per section, the feedback line, no score', () => {
    const rd = getReportTransformer('obs612-gen-v1')(SESSION, 'Bilal', F.gen());
    expect(rd).toMatchObject({ framework: 'obs612-gen-v1', totalScore: null, maxScore: null, noTotal: true, yes: 29, of: 35 });
    const a = rd.goals.find((g) => g.title === 'STUDENT ASSESSMENT PROCESS');
    expect(a).toMatchObject({ yes: 0, of: 2, score: null, maxScore: null });
    expect(a.criteria.map((c) => c.evidence)).toEqual(['No', 'No']);
    expect(rd.feedback).toBe('A good start: add pair work, and check answers at the end.');
  });
});

describe('renderer registry', () => {
  test('an FDE visit renders its own report, on the NIETE brand; every other key keeps its renderer', () => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    const { getReportRenderer, heroBrandFor } = require('../../../bot/shared/services/coaching/report-renderers/renderer-registry');
    for (const id of IDS) {
      expect(heroBrandFor(id)).toBe('niete');
      expect(getReportRenderer(id).key).toBe('obs612');
    }
    expect(getReportRenderer('fico').key).toBe('hero-niete');
    expect(getReportRenderer('fico17_v6').key).toBe('hero-niete');
    expect(getReportRenderer('oecd').key).toBe('hero');
    expect(getReportRenderer('obs612-enur-v9').key).toBe('pdfkit');
    expect(heroBrandFor('oecd')).toBeUndefined();
  });
});

describe('generateHeroReport on an FDE visit (the real generator, the page captured)', () => {
  let generateHeroReport;
  let heroBrandFor;
  let captured;
  let narrative;
  let trend;

  beforeAll(() => {
    jest.resetModules();
    captured = [];
    narrative = jest.fn(async () => { throw new Error('the narrative model must not run on an FDE report'); });
    trend = jest.fn(async () => { throw new Error('the FICO journey must not be read for an FDE report'); });
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../../bot/shared/utils/html-to-pdf', () => ({
      htmlToImage: jest.fn(async (html, opts) => { captured.push({ html, opts }); return Buffer.from('png'); }),
    }));
    jest.doMock('../../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
      generateReportNarrative: narrative, subjectUnconfirmedNote: () => '',
    }));
    jest.doMock('../../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: trend, loadPriorAction: jest.fn() }));
    jest.doMock('../../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
    ({ generateHeroReport } = require('../../../bot/shared/services/coaching/report-v2/hero-report.service'));
    ({ heroBrandFor } = require('../../../bot/shared/services/coaching/report-renderers/renderer-registry'));
    if (OUT) fs.mkdirSync(OUT, { recursive: true });
  });

  async function render(analysis, name, language) {
    captured.length = 0;
    const session = F.sessionRow(analysis);
    const out = await generateHeroReport(session, analysis, {
      teacherName: 'Ayesha Khan', language, brand: heroBrandFor(analysis.framework), requireNarrative: true,
    });
    expect(captured).toHaveLength(1);
    const { html, opts } = captured[0];
    if (OUT) fs.writeFileSync(path.join(OUT, `${name}-${language}.html`), html);
    return { out, html, opts, text: textOf(html) };
  }

  const FOOTER_UR = 'یہ FICO اسکور نہیں';
  const common = ({ out, html, opts, text }) => {
    expect(out.narrative).toBeNull();
    expect(Buffer.isBuffer(out.png)).toBe(true);
    expect(opts).toMatchObject({ selector: '.report', width: 794 });
    expect(html).toContain('class="hero"');
    expect(text).toContain('Ayesha Khan');
    expect(text).not.toMatch(/\bNaN\b|\bundefined\b|\bnull\b/);
    const rest = text.replace(FOOTER, '').replace(/آپ کے کوچ نے[^۔]*۔ یہ FICO اسکور نہیں۔/, '');
    expect(rest).not.toMatch(/FICO/);
    expect(text).not.toMatch(/journey/i);
    expect(html).toContain('#47BA7D'); // the NIETE palette
  };

  test('English & Urdu tool, en: the %, the band, FDE\'s arithmetic, a row per part, Section 8', async () => {
    const r = await render(F.enur(), 'enur', 'en');
    common(r);
    expect(r.text).toContain(FOOTER);
    expect(r.text).toContain('74%');
    expect(r.text).toContain('Proficient');
    expect(r.text).toContain('109/148');
    expect(r.text).toContain("79.5 of 108 on FDE's scale");
    expect(r.text).toMatch(/3D\. Interest & Motivation 8\/8/);
    expect(r.text).toMatch(/4C\. Reading Skills 4\/8/);
    expect(r.text).toContain('4D. Writing Skills');
    expect(r.text).toContain('5. Assessment & Feedback');
    expect(r.text).toContain('Ask two why-questions after each paragraph.');
    expect(r.out.caption).toMatch(/Grade 7/);
  });

  test('Maths & Science tool, en: a row per indicator out of 3, the plan, no total', async () => {
    const r = await render(F.msci(), 'msci', 'en');
    common(r);
    expect(r.text).toContain(FOOTER);
    expect(r.text).toMatch(/1\. Written work checked 2\/3/);
    expect(r.text).toMatch(/9\. Wrapping up the lesson 0\/3/);
    expect(r.text).toContain('From Level 0 to Level 1.');
    expect(r.text).toContain('Close with a two-minute summary and homework on the board.');
    expect(r.text).toContain("FDE's tool gives levels, not a total.");
    expect(r.text).not.toMatch(/\d\s*%/);
    expect(r.html).not.toMatch(/class="hscore"/);
  });

  test('General form, en: "x/n" per section, the feedback line, no score', async () => {
    const r = await render(F.gen(), 'gen', 'en');
    common(r);
    expect(r.text).toContain(FOOTER);
    expect(r.text).toMatch(/CLASSROOM ENVIRONMENT 6\/6/);
    expect(r.text).toMatch(/STUDENT ASSESSMENT PROCESS 0\/2/);
    expect(r.text).toContain('A good start: add pair work, and check answers at the end.');
    expect(r.text).toContain('Yes on 29 of 35');
    expect(r.text).not.toMatch(/\d\s*%/);
  });

  // An Urdu teacher gets the FICO report's Urdu page: right to left, Nastaliq first, FICO's English chrome (FEAT-106),
  // the coach's Urdu words as the body, an Urdu footnote, an Urdu caption.
  const URDU = {
    enur: { fb_strengths: 'واضح مقاصد، اور ہر طالب علم کے ساتھ نرم لہجہ۔' },
    msci: { dp_action: 'آخر میں دو منٹ کا خلاصہ کریں اور ہوم ورک بورڈ پر لکھیں۔', obs_i9: 'گھنٹی مثال کے دوران بج گئی۔' },
    gen: { fb_line: 'اچھا آغاز: جوڑیوں میں کام شامل کریں، اور آخر میں جوابات دیکھیں۔' },
  };
  test.each(['enur', 'msci', 'gen'])('%s, ur: the FICO Urdu page, the coach\'s Urdu words, an Urdu footnote', async (tool) => {
    const analysis = tool === 'enur' ? F.enur({ over: URDU.enur }) : F[tool](URDU[tool]);
    const r = await render(analysis, tool, 'ur');
    common(r);
    expect(r.html).toContain('dir="rtl"');
    expect(r.html).toMatch(/font-family:'NastaliqUrdu','NaskhArabic'/);
    expect(r.text).toContain(Object.values(URDU[tool])[0]);
    expect(r.text).toContain(FOOTER_UR);
    expect(r.text).not.toContain(FOOTER);
    expect(r.out.caption).toMatch(/[؀-ۿ]/);
  });

  test('an analysis stamped FDE but missing its answers still renders an FDE page, never 0% or FICO bars', async () => {
    const r = await render({ framework: 'obs612-gen-v1', rubric: 'obs612-gen-v1', scores: { rubric: 'obs612-gen-v1' } }, 'gen-bare', 'en');
    expect(r.text).toContain(FOOTER);
    expect(r.text).not.toMatch(/\b0%|\bNaN\b|\bundefined\b/);
    expect(r.html).not.toMatch(/class="hscore"/);
  });

  test('no narrative model call and no FICO journey read, for any FDE report', () => {
    expect(narrative).not.toHaveBeenCalled();
    expect(trend).not.toHaveBeenCalled();
  });
});
