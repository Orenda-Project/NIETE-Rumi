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
  test('the topic is the headline (44 px), the kicker 32, the CTA pill 40, the points pill 28; a Nastaliq name gets line-height 1.9', () => {
    expect(css(on, '.sub')).toMatch(/font-size:44px/);
    expect(css(on, '.kick')).toMatch(/font-size:32px/);
    expect(css(on, '.cta')).toMatch(/font-size:40px/);
    expect(css(on, '.pts')).toMatch(/font-size:28px/);
    expect(css(on, '.name')).toMatch(/line-height:1\.9/);
    expect(css(on, '.head')).toMatch(/font-size:46px/);
  });
  test('without ui the Urdu card is today\'s (32 / 26 / 26 / 24, name 1.55 on the wide card)', () => {
    expect(css(off, '.sub')).toMatch(/font-size:32px/);
    expect(css(off, '.kick')).toMatch(/font-size:26px/);
    expect(css(off, '.cta')).toMatch(/font-size:26px/);
    expect(css(off, '.pts')).toMatch(/font-size:24px/);
    expect(off).toContain('.name{font-size:56px;line-height:1.55}');
  });
  test('the school pill: the school on its own line under the points, never inside the Urdu sentence', () => {
    expect(on).toMatch(/class="pts"[^>]*>[^<]*<span class="num">\+18<\/span>[^<]*پوائنٹس<br>/);
    expect(off).not.toContain('پوائنٹس<br>');
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
    expect(Art.artInput('card', 'og', 'niete', f, { ur2: true }).ui).toEqual({ ur2: true });
  });
});
