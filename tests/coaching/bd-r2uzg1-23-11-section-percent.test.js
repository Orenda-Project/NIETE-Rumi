/**
 * bd-r2uzg1.23.11 (queue #274, call 23A; ICT sheet DC 128): the teacher's report shows each section as a
 * percentage, with its points as a small grey fraction under it ("56%" over "27/48"), so readers stop adding up
 * fractions out of different totals. The operator, 26 Nov ~16:00: "Make these percentages, but do show a small
 * fraction too, greyed out." The headline score is unchanged; a section not assessed is unchanged.
 * The same design as #293's observer score card (percentage big, its points small under it).
 */
const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');

function vm(extra = {}) {
  return {
    language: 'en',
    teacherName: 'Sadia Tabassum',
    topic: 'Fractions',
    date: '2026-08-01',
    score: { overall: 62, marks: 80, max: 128 },
    groups: [
      { key: 'A', name: 'Classroom culture', score: 27, max: 48, pct: 56 },
      { key: 'B', name: 'Lesson Plan Fidelity', score: 22, max: 24, pct: 92 },
      { key: 'F', name: 'Fidelity', score: null, max: null, pct: null, notAssessed: true, notAssessedWords: 'No plan attached' },
    ],
    narrative: {
      affirmation: 'Your class was full of questions',
      strength_name: 'Wait time', strength_note: 'note',
      horizon_title: 'Cold call', horizon_note: 'note',
      moments: [{ quote: 'Three plus seven makes ten', why: 'why' }],
    },
    tryNext: 'Try one thing',
    trend: [{ date: '2026-07-10', pct: 55 }, { date: '2026-07-24', pct: 62 }],
    photoB64: '',
    ...extra,
  };
}

const rows = (html) => [...html.matchAll(/<div class="sc-h">([\s\S]*?)<\/div>/g)].map((m) => m[1]);

describe.each(['en', 'ur'])('%s report image: section scores', (language) => {
  test('each assessed section: the percentage, and its fraction small under it', () => {
    const [a, b] = rows(buildHeroReportHtml(vm({ language })));
    expect(a).toMatch(/<span class="sc-p">56%<\/span>/);
    expect(a).toMatch(/<span class="sc-f">27\/48<\/span>/);
    expect(b).toMatch(/<span class="sc-p">92%<\/span>/);
    expect(b).toMatch(/<span class="sc-f">22\/24<\/span>/);
  });

  test('a section not assessed keeps its words, no percentage', () => {
    const c = rows(buildHeroReportHtml(vm({ language })))[2];
    expect(c).toMatch(/sc-na/);
    expect(c).not.toMatch(/sc-p|%/);
  });

  test('the headline marks line is unchanged', () => {
    expect(buildHeroReportHtml(vm({ language }))).toMatch(/80\/128/);
  });
});

test('a group without pct still gets its percentage from score / max', () => {
  const html = buildHeroReportHtml(vm({ groups: [{ key: 'A', name: 'Classroom culture', score: 27, max: 48 }] }));
  expect(rows(html)[0]).toMatch(/<span class="sc-p">56%<\/span>/);
});

test('the numbers stay left-to-right in an Urdu report, and the fraction is small and grey (CSS)', () => {
  const css = buildHeroReportHtml(vm({ language: 'ur' })).match(/<style>([\s\S]*?)<\/style>/)[1];
  const rule = (sel) => (css.match(new RegExp(`\\${sel}\\{([^}]*)\\}`)) || [])[1] || '';
  expect(rule('.sc-p')).toMatch(/direction:ltr/);
  expect(rule('.sc-p')).toMatch(/unicode-bidi:isolate/);
  expect(rule('.sc-f')).toMatch(/direction:ltr/);
  expect(rule('.sc-f')).toMatch(/unicode-bidi:isolate/);
  expect(rule('.sc-f')).toMatch(/font-size:1[01]px/);
  expect(rule('.sc-f')).toMatch(/color:#9ca3af/);
});

test('a report with no overall score (FDE levels / yes-no forms) keeps its plain fraction and shows no percentage', () => {
  const html = buildHeroReportHtml(vm({ score: { overall: null, marks: null, max: null } }));
  const [a] = rows(html);
  expect(a).toMatch(/<span class="sc-s">27\/48<\/span>/);
  expect(a).not.toMatch(/sc-p|%/);
});
