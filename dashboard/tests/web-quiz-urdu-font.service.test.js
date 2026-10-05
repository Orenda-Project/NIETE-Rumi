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

  test('buttons keep the word spacing too (the browser resets word-spacing on <button>, so answers, chips and lists glued words)', () => {
    expect(rule('html[lang=ur] button')).toMatch(/word-spacing:inherit/);
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
