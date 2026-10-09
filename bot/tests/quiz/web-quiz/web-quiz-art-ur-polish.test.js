/**
 * The share pictures under the Urdu polish switch (app_settings web_quiz_ur_polish): the Urdu lines a step larger — the
 * quiz name is the headline the group reads — and the CTA pill readable at WhatsApp's ~300 px preview. English pictures
 * are byte-identical with or without the switch; with the switch off the picture input (and so its cache key) is today's.
 */
const { renderArt } = require('../../../shared/templates/web-quiz-art.template');
const Art = require('../../../shared/services/quiz/web-quiz-art-input');

const card = { first: 'زمزم', correct: 7, total: 8, topic: 'پودے کے حصے', cls: 'جماعت 3', school: 'Testwala Model School', added: 18 };
// the rule that starts with exactly this selector (not a shared list such as `.top,.main,.side,.cta{…}`)
const css = (html, sel) => { const m = new RegExp('(?:^|[\\n}])' + sel.replace(/[.\\]/g, '\\$&') + '\\{([^}]*)\\}').exec(html); return m ? m[1] : null; };

describe('renderArt under ui.ur2 (Urdu, wide card)', () => {
  const on = renderArt({ kind: 'card', size: 'og', brand: 'niete', lang: 'ur', d: card, ui: { ur2: true } });
  const off = renderArt({ kind: 'card', size: 'og', brand: 'niete', lang: 'ur', d: card });
  test('the topic is the headline (44 px), the kicker 32, the CTA pill 40, the points pill 24 on the wide card / 28 on the square; the wide card Nastaliq name 56/1.7', () => {
    expect(css(on, '.sub')).toMatch(/font-size:44px/);
    expect(css(on, '.kick')).toMatch(/font-size:32px/);
    expect(css(on, '.cta')).toMatch(/font-size:40px/);
    expect(css(on, '.pts')).toMatch(/font-size:24px/);   // the wide card keeps 24 (height budget); the square gets 28 × 1.08
    expect(css(renderArt({ kind: 'card', size: 'sq', brand: 'niete', lang: 'ur', d: card, ui: { ur2: true } }), '.pts')).toMatch(/font-size:30px/);
    expect(on).toContain('.name{font-size:56px;line-height:1.7}');   // the wide card's Nastaliq name
    expect(css(on, '.head')).toMatch(/font-size:40px/);   // the wide card keeps 40 (height budget), at line-height 1.9
  });
  test('without ui the Urdu card is today\'s (32 / 26 / 26 / 24, name 1.55 on the wide card)', () => {
    expect(css(off, '.sub')).toMatch(/font-size:32px/);
    expect(css(off, '.kick')).toMatch(/font-size:26px/);
    expect(css(off, '.cta')).toMatch(/font-size:26px/);
    expect(css(off, '.pts')).toMatch(/font-size:24px/);
    expect(off).toContain('.name{font-size:56px;line-height:1.55}');
  });
  test('the school pill: the school on its own line under the points, never inside the Urdu sentence', () => {
    expect(on).toMatch(/class="pts"[^>]*>[^<]*<span class="num">\+18<\/span>[^<]*پوائنٹس<span class="sch">/);
    expect(off).not.toContain('class="sch"');
  });
  test('the class picture: class + topic on one line, the average on its own — no middots', () => {
    const cls = renderArt({ kind: 'class', size: 'og', brand: 'niete', lang: 'ur', d: { cls: 'جماعت 3', topic: 'پودے کے حصے', played: 2, of: 5, avgPct: 50, rows: [{ place: 1, first: 'ا', correct: 4, total: 5, animal: 'cat', me: true }] }, ui: { ur2: true } });
    expect(cls).toMatch(/class="kick"[^>]*>.*<br>.*کلاس کی اوسط/);
    expect(cls).not.toMatch(/class="kick"[^>]*>[^<]*·/);
  });
});

describe('English pictures never change', () => {
  const en = { first: 'Amal', correct: 7, total: 8, topic: 'Fractions', cls: 'Class 3' };
  test.each(['card', 'invite', 'class'])('%s: byte-identical with and without ui', (kind) => {
    const d = kind === 'class' ? { cls: 'Class 3', topic: 'Fractions', played: 2, of: 5, avgPct: 50, rows: [] } : en;
    for (const size of ['og', 'sq']) {
      expect(renderArt({ kind, size, brand: 'niete', lang: 'en', d, ui: { ur2: true } })).toBe(renderArt({ kind, size, brand: 'niete', lang: 'en', d }));
    }
  });
});

describe('the picture input the cache key is hashed from', () => {
  test('off: no ui key at all (today\'s key); on: ui rides the input', () => {
    const f = { lang: 'ur', d: card };
    expect(Object.prototype.hasOwnProperty.call(Art.artInput('card', 'og', 'niete', f, null), 'ui')).toBe(false);
    expect(Art.artInput('card', 'og', 'niete', f, null)).toEqual({ kind: 'card', size: 'og', brand: 'niete', lang: 'ur', d: card });
    // the polished look has its own version in the input: a change to the polished template (PR 5's school line) must
    // not be served from a picture cached under the earlier look — the key changes only under the switch
    expect(Art.artInput('card', 'og', 'niete', f, { ur2: true }).ui).toEqual({ ur2: true, v: Art.ART_UR2_V });
    expect(Art.ART_UR2_V).toBeGreaterThanOrEqual(2);
  });
});

/**
 * The wide (1200×630) Urdu picture must hold its whole stack — the last child is the CTA pill, and a stack that
 * overruns the canvas loses exactly that pill. The budget below is arithmetic on the rendered CSS: every block's
 * font-size × line-height × its lines (a line of Nastaliq is ~0.55 em per code point in the 1200 − 64 − 330 − 40 px
 * the stack gets), the stars row, the gaps and the paddings. It is a floor, not a pixel measure — the browser shot
 * sits beside it — and it fails on a template whose stack cannot fit.
 */
describe('the wide Urdu picture keeps its CTA on the canvas (height budget)', () => {
  // the LAST rule for the selector wins, as in the cascade (the wide Urdu card re-declares .name and .big after the base rules)
  const rule = (html, sel) => { const re = new RegExp('(?:^|[\\n}])' + sel.replace(/[.\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g'); let m; let last = ''; while ((m = re.exec(html))) last = m[1]; return last; };
  const px = (css, prop) => { const m = new RegExp(prop + ':(\\d+(?:\\.\\d+)?)px').exec(css); return m ? Number(m[1]) : 0; };
  const lh = (css, fs) => { const m = /line-height:(\d+(?:\.\d+)?)/.exec(css); return m ? Number(m[1]) * fs : fs * 1.2; };
  const LONG_TOPIC = 'کسر اور اعشاریہ: مناسب کسر کی پہچان';        // 35 code points
  const LONG_NAME = 'محمد عبدالرحمٰن';
  const STACK_W = 1200 - 64 - 40 - 330 - 64;                       // padding, gap, the mascot column, padding
  function budget(html, blocks) {
    const art = rule(html, '.art');
    const pad = (px(art, 'padding') || 56) * 2 + (/padding-top:60px/.test(rule(html, '.main')) ? 60 : 0);
    const gap = px(rule(html, '.main'), 'gap') || 14;
    let total = pad + gap * (blocks.length - 1);
    for (const b of blocks) {
      if (b === 'stars') { total += px(rule(html, '.star'), 'width') || 44; continue; }
      const css = rule(html, '.' + b.sel.split(' ').pop().replace(/^\./, ''));
      const fs = px(css, 'font-size');
      const perLine = Math.max(1, Math.floor(STACK_W / (fs * 0.55)));
      const lines = b.cp ? Math.ceil(b.cp / perLine) : 1;
      total += lh(css, fs) * lines + (b.sel === 'cta' ? 8 : 0);
    }
    return total;
  }
  const ui = { ur2: true };
  test('card og: a long topic and a Nastaliq name fit under the switch (and the kicker is not on the wide card)', () => {
    const html = renderArt({ kind: 'card', size: 'og', brand: 'niete', lang: 'ur', d: { first: LONG_NAME, correct: 5, total: 6, topic: LONG_TOPIC, cls: 'جماعت 3' }, ui }, { fonts: false, pictures: false });
    const blocks = [{ sel: 'name', cp: [...LONG_NAME].length }, { sel: 'big' }, 'stars', { sel: 'sub', cp: [...LONG_TOPIC].length }, { sel: 'cta', cp: 14 }];
    if (/class="kick"/.test(html)) blocks.unshift({ sel: 'kick', cp: 20 });
    expect(budget(html, blocks)).toBeLessThanOrEqual(630);
    expect(html).not.toMatch(/class="kick"/);
  });
  test('card og with a school: the points pill (two lines, a long Latin school name) still fits under the switch', () => {
    const d = { first: 'Sobia', correct: 4, total: 5, topic: 'پودے کے حصے', cls: 'جماعت 3', school: 'Testwala Model School (synthetic)', added: 18 };
    const html = renderArt({ kind: 'card', size: 'og', brand: 'niete', lang: 'ur', d, ui }, { fonts: false, pictures: false });
    const pts = rule(html, '.pts'); const sch = rule(html, '.pts .sch');
    expect(sch).toMatch(/font-size:2[0-2]px/);          // the Latin school line is small on the wide card
    const blocks = [{ sel: 'name', cp: 5 }, { sel: 'big' }, 'stars', { sel: 'sub', cp: 11 }, { sel: 'pts', cp: 12 }, { sel: 'pts .sch', cp: 33 }];
    expect(budget(html, blocks)).toBeLessThanOrEqual(630);
    expect(pts).toMatch(/font-size:24px/);
  });
  test('invite og: a two-line headline, the scored line, stars and the pill fit under the switch', () => {
    const html = renderArt({ kind: 'invite', size: 'og', brand: 'niete', lang: 'ur', d: { first: LONG_NAME, correct: 6, total: 6, topic: LONG_TOPIC }, ui }, { fonts: false, pictures: false });
    const blocks = [{ sel: 'head', cp: 34 }, { sel: 'sub', cp: 50 }, 'stars', { sel: 'cta', cp: 22 }];
    if (/class="kick"/.test(html)) blocks.unshift({ sel: 'kick', cp: 14 });
    expect(budget(html, blocks)).toBeLessThanOrEqual(630);
  });
  test('the square keeps the larger sizes (it has the height)', () => {
    const html = renderArt({ kind: 'card', size: 'sq', brand: 'niete', lang: 'ur', d: { first: LONG_NAME, correct: 5, total: 6, topic: LONG_TOPIC, cls: 'جماعت 3' }, ui }, { fonts: false, pictures: false });
    expect(rule(html, '.sub')).toMatch(/font-size:48px/);     // 44 × 1.08
    expect(rule(html, '.cta')).toMatch(/font-size:43px/);     // 40 × 1.08
  });
});
