/**
 * Web quiz page, Urdu: the Nastaliq web font is served by the portal itself (one small subset file,
 * preloaded on Urdu pages only) instead of a Google Fonts stylesheet, and the Urdu screens get the
 * spacing rules that keep lines, emoji and badges apart.
 *
 * Why: Android ships no Nastaliq, so until a web font arrives an Urdu page draws Naskh. The Google
 * stylesheet was loaded late (media=print swap) from two more hosts and weighed 271 KB, so the first
 * screens appeared in Naskh and then jumped when Nastaliq landed.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderQuizPage, renderClosedPage } = require('../routes/web-quiz.routes');
const { rule, CSS } = require('./wq-page-harness');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const FONT_URL = '/wq/fonts/wq-nastaliq-1.woff2';

const QUIZ = {
  quiz: { id: 'q-1', code: 'AB12CD', topic: 'پودے', lang: 'ur', dir: 'rtl', grade: '3', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'کون سا؟', options: [{ slot: 'A', text: 'جڑ' }, { slot: 'B', text: 'پتا' }], correct_slot: 'A' }] },
  cls: { label: 'جماعت 3', teacher: 'استاد', chips: [] },
  live: {},
  video: null,
  preview: false,
};
const en = { ...QUIZ, quiz: { ...QUIZ.quiz, lang: 'en', dir: 'ltr', topic: 'Plants' } };

function urdu() { return renderQuizPage({ payload: QUIZ, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' }); }

describe('Urdu pages load the Nastaliq font from the portal, early', () => {
  test('an Urdu quiz page preloads the self-hosted font and links no Google Fonts stylesheet', () => {
    const html = urdu();
    expect(html).toContain(`<link rel="preload" href="${FONT_URL}" as="font" type="font/woff2" crossorigin>`);
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  test('the preload comes before the stylesheet, so the font request starts first', () => {
    const html = urdu();
    expect(html.indexOf(FONT_URL)).toBeGreaterThan(0);
    expect(html.indexOf(FONT_URL)).toBeLessThan(html.indexOf('/wq/wq.css'));
  });

  test('an English page fetches no Urdu font at all', () => {
    const html = renderQuizPage({ payload: en, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' });
    expect(html).not.toContain(FONT_URL);
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
  });

  test('the Urdu "quiz closed" page uses the same font', () => {
    const html = renderClosedPage({ lang: 'ur', kind: 'closed', origin: 'https://x', assetV: 'v1' });
    expect(html).toContain(FONT_URL);
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
  });

  test('the stylesheet declares the face at the same URL the page preloads, and that file ships with its licence', () => {
    const face = /@font-face\{font-family:"WQ Nastaliq";src:url\(([^)]+)\) format\("woff2"\);([^}]*)\}/.exec(CSS);
    expect(face).not.toBeNull();
    expect('/wq/' + face[1]).toBe(FONT_URL);
    expect(face[2]).toMatch(/font-display:swap/);
    expect(face[2]).toMatch(/size-adjust:\d+%/);
    const file = path.join(WQ, face[1]);
    expect(fs.readFileSync(file).slice(0, 4).toString()).toBe('wOF2');
    expect(fs.statSync(file).size).toBeLessThan(80 * 1024);
    expect(fs.readFileSync(path.join(WQ, 'fonts', 'OFL.txt'), 'utf8')).toMatch(/SIL Open Font License/);
  });

  test('the Urdu font stack starts with the self-hosted face', () => {
    expect(rule(':root')).toMatch(/--fu:"WQ Nastaliq",/);
  });

  test('Latin letters and digits in Urdu screens come from the page sans, never a locally installed Nastaliq\'s serif digits', () => {
    // The face covers Urdu only (unicode-range), so 0-9 and A-Z fall to the next family. A phone or Mac with
    // Noto Nastaliq installed drew "8/15" on the scorecard in its serif digits when Noto came second.
    const fu = rule(':root').match(/--fu:([^;]+)/)[1].split(',').map((x) => x.trim().replace(/"/g, ''));
    expect(fu[0]).toBe('WQ Nastaliq');
    const sans = fu.indexOf('system-ui');
    const noto = fu.indexOf('Noto Nastaliq Urdu');
    expect(sans).toBeGreaterThan(0);
    if (noto >= 0) expect(noto).toBeGreaterThan(sans);
  });

  test('the portal serves the font file with a font type and a long cache', async () => {
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => { throw new Error('no network'); } }));
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    try {
      const res = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: srv.address().port, path: FONT_URL }, (r) => {
          const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
        }).on('error', reject);
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/font\/woff2/);
      expect(res.headers['cache-control']).toMatch(/max-age=\d{6,}/);
      expect(res.body.slice(0, 4).toString()).toBe('wOF2');
    } finally {
      srv.close();
    }
  });
});

describe('Urdu spacing rules', () => {
  test('words are spaced apart (the Nastaliq space is narrow; a child needs to see where a word ends)', () => {
    expect(rule('html[lang=ur] body')).toMatch(/word-spacing:0?\.\d+em/);
  });

  test('a 3-line Urdu video title on "more videos" keeps its lines apart (1.9 overlapped by 0.5 px at 360 and 4 px at 412; 2.3 measured clear)', () => {
    expect(rule('html[lang=ur] .wq-vtext b')).toMatch(/line-height:2\.3\b/);
  });

  test('buttons keep the word spacing too (the browser resets word-spacing on <button>, so answers, chips and lists glued words)', () => {
    expect(rule('html[lang=ur] button')).toMatch(/word-spacing:inherit/);
  });

  test('the big score and count numbers sit on the sans baseline (a Nastaliq line box pushed "8/15" into the stars)', () => {
    // .wq-big is also a class on the big mascot (.wq-jug.wq-big), whose speech bubble must keep the Urdu face.
    expect(rule('html[lang=ur] .wq-big:not(.wq-jug)')).toMatch(/font-family:var\(--f\)/);
  });

  test('icons and emoji in Urdu screens keep the emoji font and a tight line box (no Nastaliq line box)', () => {
    const r = rule('html[lang=ur] .wq-icon,html[lang=ur] .wq-spk,html[lang=ur] .wq-emoji,html[lang=ur] .wq-tfi,html[lang=ur] .wq-let,html[lang=ur] .wq-place b');
    expect(r).not.toBeNull();
    expect(r).toMatch(/font-family:var\(--f\)/);
    expect(r).toMatch(/line-height:1(;|$)/);
  });

  test('Urdu labels inside a figure use the same face, over the figure engine\'s inline Noto stack', () => {
    // The engine writes <div lang="ur" style="font-family:'Noto Nastaliq Urdu',…"> inside foreignObject;
    // Android has none of those fonts, so without this the labels fall back to Naskh.
    const r = rule('.wq-svg [lang=ur]');
    expect(r).not.toBeNull();
    expect(r).toMatch(/font-family:var\(--fu\)!important/);
  });

  test('digits and maths inside Urdu text are isolated left-to-right runs', () => {
    expect(rule('.wq-m')).toMatch(/direction:ltr/);
    expect(rule('.wq-m')).toMatch(/unicode-bidi:isolate/);
  });
});

describe('Urdu copy on the after-quiz screens', () => {
  const { page, flush } = require('./wq-page-harness');
  const store = () => ({ wq_s_TEST: { st: 's1', child: { chip: 'c1', first: 'زمزم', animal: 'owl' }, answers: {}, queue: [] } });

  test('the fixed-with-the-mascot line has no stray "+" and a plural verb for the questions', async () => {
    const p = page({ lang: 'ur', store: store(), api: { '/finish': { score: { correct: 4, total: 5 }, counted: true } } });
    p.ctx.__wq.results(2);
    await flush(); await flush();
    const line = (p.html().match(/<p class="wq-sub">([^<]*مشکل سوال[^<]*)<\/p>/) || [])[1];
    expect(line).toBeDefined();
    expect(line).not.toMatch(/^\+/);
    expect(line).toMatch(/ٹھیک کیے$/);
  });

  test('one right answer takes the singular verb («1 درست کیا»), more take the plural', async () => {
    const one = page({ lang: 'ur', store: store(), api: { '/finish': { score: { correct: 1, total: 5 }, counted: true } } });
    one.ctx.__wq.results(0);
    await flush(); await flush();
    expect(one.html()).toMatch(/1 درست کیا</);
    const four = page({ lang: 'ur', store: store(), api: { '/finish': { score: { correct: 4, total: 5 }, counted: true } } });
    four.ctx.__wq.results(0);
    await flush(); await flush();
    expect(four.html()).toMatch(/4 درست کیے</);
  });

  test('the class label on the landing never breaks across lines («جماعت 3 (ب)» keeps its «(ب)»)', () => {
    const p = page({ lang: 'ur', cls: { label: 'جماعت 3 (ب)', teacher: 'استاد Testwala', chips: [] } });
    p.ctx.__wq.landing();
    expect(p.html()).toContain('جماعت\u00A03\u00A0(ب)');
  });

  // The landing bubble sits beside the big mascot, about 170 px wide on a 360 px phone. «…مل کر کوئز
  // کھیلیں۔» wraps so that «کوئز» on line 2 stacks into «علیکم» on line 1 (−7 px, measured); the
  // shorter greeting wraps clear of it (+3.5 px at 360, +7.5 px at 412) and says the same thing.
  test('the landing greeting is the short one, so its two lines never touch', () => {
    const p = page({ lang: 'ur', cls: { label: 'جماعت 3', teacher: 'استاد', chips: [] } });
    p.ctx.__wq.landing();
    expect(p.html()).toContain('<div class="wq-say">السلام علیکم! آئیں، کوئز کھیلیں۔</div>');
  });

  test('"today" in Urdu says "today" once, and its home button says where it goes', () => {
    const p = page({ lang: 'ur', store: store() });
    p.ctx.__wq.today();
    const h = p.html();
    expect(h).toContain('بچوں نے کھیلا');
    expect(h).not.toContain('بچوں نے آج کھیلا');
    expect(h).not.toMatch(/>شروع</);
  });
});
