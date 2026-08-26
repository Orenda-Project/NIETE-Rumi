/**
 * bd-1t1wz — the hero template renders the "why" line under each scored bar,
 * label localised (کیوں for ur / Why for en), absent → no line; and the
 * service-level mapper keys whys by domainKey.
 */
const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');
const { attachDomainWhys } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');

const vm = (lang, groups) => ({
  language: lang, brand: 'niete', teacherName: 'Sana', topic: 'ریاضی', date: '2026-08-26',
  score: { overall: 63, marks: 66, max: 104 },
  groups, narrative: { affirmation: 'x', moments: [] }, trend: [],
});

describe('bd-1t1wz — why line rendering', () => {
  it('ur report → «کیوں:» label + the diagnosis text under the bar', () => {
    const html = buildHeroReportHtml(vm('ur', [{
      name: 'Lesson Plan Fidelity (سبق کے منصوبے پر عمل درآمد)', score: 24, max: 40, pct: 60,
      why: 'یہ اسکور بہتر ہے کیونکہ آپ نے آغاز واضح کیا — مکمل نمبر اس لیے نہیں کیونکہ آخری مشق چھوٹ گئی۔',
    }]));
    expect(html).toContain('کیوں');
    expect(html).toContain('class="sc-why"');
    expect(html).toContain('آخری مشق چھوٹ گئی');
  });

  it('en report → "Why:" label', () => {
    const html = buildHeroReportHtml(vm('en', [{
      name: 'Student Engagement', score: 14, max: 28, pct: 50,
      why: 'This is developing because pupils answered in chorus — it is not full marks because individual voices were rarely heard.',
    }]));
    expect(html).toContain('Why');
    expect(html).toContain('individual voices were rarely heard');
  });

  it('a group without a why renders NO sc-why div (fallback-safe)', () => {
    // The .sc-why CSS rule is always in the stylesheet; what must be absent is
    // the rendered element itself.
    const html = buildHeroReportHtml(vm('en', [{ name: 'Teacher Subject Knowledge', score: 20, max: 32, pct: 63 }]));
    expect(html).not.toContain('class="sc-why"');
  });

  it('attachDomainWhys maps by domainKey and leaves unknown keys alone', () => {
    const groups = [
      { key: 'B', domainKey: 'lesson_plan_fidelity', name: 'x' },
      { key: 'C', domainKey: 'high_leverage_practices', name: 'y' },
    ];
    attachDomainWhys(groups, { lesson_plan_fidelity: 'because…', junk_key: 'ignored' });
    expect(groups[0].why).toBe('because…');
    expect(groups[1].why).toBeUndefined();
  });
});
