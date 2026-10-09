/**
 * The Urdu polish switch on the child pages (app_settings web_quiz_ur_polish): when the bot's payload carries
 * `ui.ur2`, an Urdu page's root gets ONE class, `wq-ur2`, and preloads the second face; an English page never
 * changes; a payload without `ui` renders exactly as before. The library and closed shells remember the last
 * payload's `ui` the way they remember the brand and the telemetry switch.
 */
const fs = require('fs');
const path = require('path');
const { renderQuizPage, renderHubPage, renderChallengePage, renderLibPage, renderClosedPage } = require('../routes/web-quiz.routes');
const { rule, CSS } = require('./wq-page-harness');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const FONT1 = '/wq/fonts/wq-nastaliq-1.woff2';
const FONT2 = '/wq/fonts/wq-nastaliq-2.woff2';
const Q = (lang, extra = {}) => ({
  quiz: { id: 'q-1', code: 'AB12CD', topic: lang === 'ur' ? 'پودے' : 'Plants', lang, dir: lang === 'ur' ? 'rtl' : 'ltr', grade: '3', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'کون سا؟', options: [{ slot: 'A', text: 'جڑ' }, { slot: 'B', text: 'پتا' }], correct_slot: 'A' }] },
  cls: { label: 'جماعت 3', teacher: 'استاد', chips: [] }, live: {}, video: null, preview: false, ...extra,
});
const htmlTag = (html) => /<html[^>]*>/.exec(html)[0];
const quiz = (lang, extra) => renderQuizPage({ payload: Q(lang, extra), code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' });

describe('web_quiz_ur_polish → one class on the Urdu page root', () => {
  test('an Urdu quiz page with ui.ur2 carries class wq-ur2 and preloads the second face (not the first)', () => {
    const html = quiz('ur', { ui: { ur2: true } });
    expect(htmlTag(html)).toBe('<html lang="ur" dir="rtl" class="wq-ur2">');
    expect(html).toContain(`<link rel="preload" href="${FONT2}" as="font" type="font/woff2" crossorigin>`);
    expect(html).not.toContain(FONT1);
  });
  test('an Urdu quiz page without ui renders exactly as before (no class, the first face)', () => {
    const html = quiz('ur');
    expect(htmlTag(html)).toBe('<html lang="ur" dir="rtl">');
    expect(html).toContain(FONT1);
    expect(html).not.toContain(FONT2);
    expect(html).not.toContain('wq-ur2');
  });
  test('an English page never gets the class or the Urdu font, with or without ui', () => {
    for (const extra of [{}, { ui: { ur2: true } }]) {
      const html = quiz('en', extra);
      expect(htmlTag(html)).toBe('<html lang="en" dir="ltr">');
      expect(html).not.toContain('wq-ur2');
      expect(html).not.toMatch(/wq-nastaliq/);
    }
  });
  test('ui.ur2 false / garbage is off', () => {
    for (const ui of [{ ur2: false }, { ur2: 'yes' }, null, 'true', 1]) {
      expect(htmlTag(quiz('ur', { ui }))).toBe('<html lang="ur" dir="rtl">');
    }
  });
  test('the hub and the challenge pages follow their payload', () => {
    const hubOn = renderHubPage({ payload: { lang: 'ur', kids: [], ui: { ur2: true } }, token: 't', origin: 'https://x', assetV: 'v1' });
    const hubOff = renderHubPage({ payload: { lang: 'ur', kids: [] }, token: 't', origin: 'https://x', assetV: 'v1' });
    expect(htmlTag(hubOn)).toContain('class="wq-ur2"');
    expect(htmlTag(hubOff)).not.toContain('wq-ur2');
    const chOn = renderChallengePage({ menu: { lang: 'ur', exercises: [], ui: { ur2: true } }, token: 't', kid: null, origin: 'https://x', assetV: 'v1', chV: 'c', brandKey: 'niete' });
    expect(htmlTag(chOn)).toContain('class="wq-ur2"');
  });
  test('the library and closed shells take the remembered ui', () => {
    const lib = renderLibPage({ hub: 't', kid: 'k', lang: 'ur', origin: 'https://x', assetV: 'v1', brandKey: 'niete', ui: { ur2: true } });
    expect(htmlTag(lib)).toContain('class="wq-ur2"');
    const closed = renderClosedPage({ lang: 'ur', kind: 'closed', origin: 'https://x', assetV: 'v1', brandKey: 'niete', ui: { ur2: true } });
    expect(htmlTag(closed)).toContain('class="wq-ur2"');
    expect(htmlTag(renderClosedPage({ lang: 'ur', kind: 'closed', origin: 'https://x', assetV: 'v1', brandKey: 'niete' }))).not.toContain('wq-ur2');
  });
});

describe('the polished Urdu look is one scoped block of the stylesheet', () => {
  const block = CSS.slice(CSS.indexOf('/* ===== ur2 ====='));
  const before = CSS.slice(0, CSS.indexOf('/* ===== ur2 ====='));
  test('the block exists and every rule in it is scoped to html.wq-ur2[lang=ur]', () => {
    expect(block.length).toBeGreaterThan(1000);
    const selectors = block.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0].trim()).filter((s) => s && !s.startsWith('@'));
    const bad = selectors.filter((sel) => sel.split(',').some((s) => !/^html\.wq-ur2\[lang=ur\]/.test(s.trim())));
    expect(bad).toEqual([]);
  });
  test('the old look is untouched: no rule before the block mentions wq-ur2, and the first face is still declared as it was', () => {
    expect(before).not.toContain('wq-ur2');
    expect(rule('html[lang=ur] body')).toMatch(/word-spacing:0?\.\d+em/);
    expect(before).toMatch(/@font-face\{font-family:"WQ Nastaliq";src:url\(fonts\/wq-nastaliq-1\.woff2\)/);
  });
  test('the second face: self-hosted woff2 under 120 KB, Regular only, no size-adjust, swap, with its licence', () => {
    const face = /@font-face\{font-family:"WQ Nastaliq 2";src:url\(([^)]+)\) format\("woff2"\);([^}]*)\}/.exec(block);
    expect(face).not.toBeNull();
    expect('/wq/' + face[1]).toBe(FONT2);
    expect(face[2]).toMatch(/font-weight:400/);
    expect(face[2]).toMatch(/font-display:swap/);
    expect(face[2]).not.toMatch(/size-adjust/);
    expect(face[2]).toMatch(/unicode-range:U\+0020/);
    const file = path.join(WQ, face[1]);
    expect(fs.readFileSync(file).slice(0, 4).toString()).toBe('wOF2');
    expect(fs.statSync(file).size).toBeLessThan(120 * 1024);
    expect(fs.readFileSync(path.join(WQ, 'fonts', 'OFL-NotoNastaliqUrdu.txt'), 'utf8')).toMatch(/SIL Open Font License/);
  });
  test('under the class: one weight, no synthetic bold, no word-spacing hack, the Nastaliq line heights', () => {
    const body = rule('html.wq-ur2[lang=ur] body');
    expect(body).toMatch(/font-synthesis-weight:none/);
    expect(body).toMatch(/word-spacing:normal/);
    expect(rule('html.wq-ur2[lang=ur] .wq-qtext')).toMatch(/line-height:var\(--ulh\)/);
    expect(rule('html.wq-ur2[lang=ur]')).toMatch(/--ulh:2\.2;--ulh1:2/);
    expect(rule('html.wq-ur2[lang=ur] .wq-kid-big bdi')).toMatch(/white-space:normal/);
  });
});
