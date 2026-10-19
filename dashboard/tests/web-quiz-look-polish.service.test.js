/**
 * Two small fixes to the one-button look (html.wq-1b, app_settings web_quiz_one_button): the Urdu Home greeting keeps
 * «السلام علیکم!» on one line (a no-break space, so a narrow phone breaks after the child's name instead), and the
 * grown-ups hold has the same inset at both ends, so its ring and words sit in the pill's middle. Without the look the
 * greeting is today's string. Invented children only.
 */
const fs = require('fs');
const path = require('path');
const F = require('./web-quiz-video-shelf.fixture');

const LOOK = { document: { documentElement: { classList: { contains: (c) => c === 'wq-1b' } } } };
const hello = (h) => (/<span class="wq-hhi">([\s\S]*?)<span class="wq-dots"/.exec(h) || [])[1];
const boot = (lang) => ({ ...F.boot(lang, { href: '/lib/x' }), kids: [{ chip: F.KID, first: 'Noor Testwala', animal: 'owl', grade: '3' }], kid: F.KID, home_v3: 1, head: { dots: 2 } });

describe('the Urdu greeting with the look', () => {
  test('«السلام علیکم!» is joined by a no-break space; the name may still wrap before it', () => {
    const W = F.load({ globals: LOOK });
    const hi = hello(W.WQHOME.html(boot('ur'), { token: F.TOKEN, lang: 'ur' }));
    expect(hi).toContain('السلام علیکم، ');
    expect(hi).not.toContain('السلام علیکم');
    expect(hi).toMatch(/<bdi>Noor Testwala<\/bdi>!<\/span><\/span>$/); // the greeting first, the name after it (web-quiz-greeting-second-try)
  });
  test('without the look, and in English: today\'s words', () => {
    const W = F.load();
    expect(hello(W.WQHOME.html(boot('ur'), { token: F.TOKEN, lang: 'ur' }))).toContain('السلام علیکم!');
    const W2 = F.load({ globals: LOOK });
    expect(hello(W2.WQHOME.html(boot('en'), { token: F.TOKEN, lang: 'en' }))).not.toContain(' ');
  });
});

describe('the grown-ups hold sits in the middle of its pill', () => {
  test('the last word on its inline padding under the look is the same at both ends', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
    const rules = [...css.matchAll(/html\.wq-1b \.wq-btn--hold\{([^}]*)\}/g)].map((m) => m[1]);
    let start = null; let end = null;
    for (const r of rules) {
      for (const d of r.split(';')) {
        const [k, v] = d.split(':').map((x) => (x || '').trim());
        if (k === 'padding') { const p = v.split(/\s+/); start = end = p[1] || p[0]; }
        if (k === 'padding-inline') { const p = v.split(/\s+/); start = p[0]; end = p[1] || p[0]; }
        if (k === 'padding-inline-start') start = v;
        if (k === 'padding-inline-end') end = v;
      }
    }
    expect(start).not.toBeNull();
    expect(start).toBe(end);
  });
});

describe('an Urdu page keeps the wide word gap for Urdu only', () => {
  test('a Latin run (lang=en) inside an Urdu page has normal word spacing; Urdu inside it gets the wide gap back', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
    expect(css).toContain('html.wq-1b[lang=ur] [lang=en]:not(.wq-input){word-spacing:normal}');
    expect(css).toContain('html.wq-1b[lang=ur] [lang=en] [lang=ur]{word-spacing:.2em}');
    expect(css.indexOf('html.wq-1b[lang=ur] [lang=en]:not(.wq-input)')).toBeGreaterThan(css.indexOf('html[lang=ur] body{font-family:var(--fu);word-spacing:.2em}'));
  });
});
