/**
 * bd-snkn32.4 — "Make my own" for grades 1–5: her answers rewrite ONE day's plan (its stored slide script, the
 * grades 1–5 format) in its book's language, checked before it is rendered (lp-k5-own.js, pure), and printed as a
 * phone page in the v10 card's look (lp-k5-own-render.js, pure).
 */
const { k5Messages, checkK5Rewrite, parseK5Reply, NOT_READY_UR } = require('../../bot/shared/services/lp-k5-own');
const { renderK5Own } = require('../../bot/shared/services/lp-k5-own-render');

const ANSWERS = { size: 'over70', resources: ['textbook', 'board'], level: 'behind', way: 'tarl', note: 'Two grades in one room' };

function script(lang = 'en') {
  const ur = lang === 'ur';
  return {
    goal: ur ? 'بچے حروف جوڑ کر لفظ بنائیں۔' : 'Learn that a digit\'s value depends on its place.',
    meta: { day: 2, grade: 3, subject: ur ? 'urdu' : 'math', topic: ur ? 'حروف جوڑنا' : 'Place value', total: 12, minutes: 30 },
    hook: { warmUp: { teacherAsks: ur ? 'گنتی کریں۔' : 'Count by tens.', expectedAnswer: '10, 20' }, keyWords: [{ term: ur ? 'لفظ' : 'tens', def: ur ? 'معنی' : 'groups of ten' }] },
    iDo: { minutes: 7, steps: [{ n: 1, say: ur ? 'سنیں: بَر' : 'One hundred, two tens.', action: ur ? 'بورڈ پر لکھیں' : 'Draw the chart.', sayLocal: 'Ek sau' }], cfu: ur ? 'لفظ کیا بنا؟' : 'What is the 2 worth?' },
    weDo: { minutes: 10, action: ur ? 'مل کر بنائیں' : 'Build 256 together.', cfu: ur ? 'کون سا؟' : 'Which digit?' },
    youDo: { minutes: 9, action: ur ? 'خود کریں' : 'Complete p.4.', problems: [{ n: 1, prompt: ur ? 'جوڑیں' : '602 = ___', answer: '6' }] },
    wrap: { homework: [ur ? 'گھر پر لکھیں' : 'Write 385 in H/T/O'], exitOptions: [{ prompt: ur ? 'بتائیں' : 'Is 470 = 407?' }] },
  };
}

describe('k5Messages — the one rewrite request', () => {
  it('carries her answers, the plan as JSON, and keeps the outcome and sections', () => {
    const [sys, user] = k5Messages({ script: script(), answers: ANSWERS, lang: 'en', grade: 3, subject: 'math' });
    expect(sys.role).toBe('system');
    expect(sys.content).toMatch(/same JSON shape/i);
    expect(sys.content).toMatch(/learning outcome/i);
    expect(user.content).toContain('more than 70 children');
    expect(user.content).toContain('BEHIND');
    expect(user.content).toContain('Two grades in one room');
    expect(user.content).toContain('"goal"');
  });

  it('an Urdu book is rewritten in Urdu, Nastaliq-ready, no Roman Urdu; an English book keeps its local lines', () => {
    const ur = k5Messages({ script: script('ur'), answers: ANSWERS, lang: 'ur', grade: 3, subject: 'urdu' })[0].content;
    expect(ur).toMatch(/Urdu/);
    expect(ur).toMatch(/no Roman Urdu/i);
    const en = k5Messages({ script: script(), answers: ANSWERS, lang: 'en', grade: 3, subject: 'math' })[0].content;
    expect(en).toMatch(/sayLocal/);
  });

  it('TaRL in an early language class groups by sound, letter, word and sentence (the reviewer\'s rule)', () => {
    const u = k5Messages({ script: script('ur'), answers: ANSWERS, lang: 'ur', grade: 2, subject: 'urdu' })[1].content;
    expect(u).toMatch(/sound.*letter.*word.*sentence/i);
    const m = k5Messages({ script: script(), answers: ANSWERS, lang: 'en', grade: 3, subject: 'math' })[1].content;
    expect(m).not.toMatch(/sound.*letter.*word.*sentence/i);
  });

  it('refuses answers that were not parsed', () => {
    expect(() => k5Messages({ script: script(), answers: { size: 'x' }, lang: 'en', grade: 3, subject: 'math' })).toThrow();
  });
});

describe('parseK5Reply', () => {
  it('reads JSON, fenced or not; anything else is null', () => {
    expect(parseK5Reply('```json\n{"goal":"x"}\n```')).toEqual({ goal: 'x' });
    expect(parseK5Reply('{"goal":"x"}')).toEqual({ goal: 'x' });
    expect(parseK5Reply('not json')).toBeNull();
    expect(parseK5Reply('[1]')).toBeNull();
  });
});

describe('checkK5Rewrite — the gate before it is rendered', () => {
  it('a faithful rewrite passes', () => {
    const next = JSON.parse(JSON.stringify(script()));
    next.weDo.action = 'Pairs build 256 with sticks; choral answer.';
    expect(checkK5Rewrite(script(), next, { lang: 'en' })).toEqual([]);
  });

  it('a lost section, or I Do with no steps, is refused', () => {
    const lost = script(); delete lost.youDo;
    expect(checkK5Rewrite(script(), lost, { lang: 'en' }).join(' ')).toMatch(/youDo/);
    const empty = script(); empty.iDo.steps = [];
    expect(checkK5Rewrite(script(), empty, { lang: 'en' }).join(' ')).toMatch(/iDo/);
  });

  it('the learning outcome and the day may not move', () => {
    const moved = script(); moved.goal = 'Something else';
    expect(checkK5Rewrite(script(), moved, { lang: 'en' }).join(' ')).toMatch(/goal/);
    const day = script(); day.meta.day = 3;
    expect(checkK5Rewrite(script(), day, { lang: 'en' }).join(' ')).toMatch(/day/);
  });

  it('an Urdu plan written in English, or carrying the "not ready" line, is refused', () => {
    const english = script('ur'); english.iDo.steps[0].say = 'Listen and blend the sounds.';
    expect(checkK5Rewrite(script('ur'), english, { lang: 'ur' }).join(' ')).toMatch(/Urdu/);
    const notReady = script('ur'); notReady.weDo.action = NOT_READY_UR;
    expect(checkK5Rewrite(script('ur'), notReady, { lang: 'ur' }).join(' ')).toMatch(/not ready/);
  });

  it('much longer than her day plan is refused (she reads it on a phone before class)', () => {
    const long = script(); long.youDo.action = 'x'.repeat(5000);
    expect(checkK5Rewrite(script(), long, { lang: 'en' }).join(' ')).toMatch(/long/);
  });
});

describe('renderK5Own — the phone page', () => {
  it('English: the five sections in order, her day, the way named once, text escaped', () => {
    const s = script(); s.weDo.action = 'Build <256> & check';
    const html = renderK5Own(s, { lang: 'en', grade: 3, subject: 'Math', way: 'Teach at each child\'s level' });
    const at = (w) => html.indexOf(`<h2>${w}`);
    expect(at('Opening')).toBeGreaterThan(-1);
    expect(at('Opening')).toBeLessThan(at('Explanation · I Do'));
    expect(at('Explanation · I Do')).toBeLessThan(at('We Do'));
    expect(at('We Do')).toBeLessThan(at('You Do'));
    expect(at('You Do')).toBeLessThan(at('Check'));
    expect(at('Check')).toBeLessThan(at('Homework'));
    expect(html).toContain('Day 2');
    expect(html).toContain('Teach at each child');
    expect(html).toContain('Build &lt;256&gt; &amp; check');
    expect(html).toContain('class="page"');
    expect(html).not.toContain('dir="rtl"');
  });

  it('Urdu: right to left, Urdu headings, Nastaliq', () => {
    const html = renderK5Own(script('ur'), { lang: 'ur', grade: 3, subject: 'اردو', way: 'ہر بچے کی سطح پر پڑھائیں' });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ur"');
    expect(html).toMatch(/Nastaliq/);
    expect(html).not.toMatch(/fonts\.googleapis|<link/); // the Railway Chromium fetches nothing: fonts are embedded
    expect(renderK5Own(script('ur'), { lang: 'ur', fontCss: '@font-face{x}' })).toContain('@font-face{x}');
    expect(html).toContain('ہوم ورک');
    expect(renderK5Own(script('ur'), { lang: 'ur', subject: 'Urdu' })).toContain('اردو'); // the catalogue's English name, in Urdu
    expect(html).not.toContain('>Homework<');
  });
});
