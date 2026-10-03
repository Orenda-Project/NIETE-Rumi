/**
 * Child-test stimulus (L2, bd-s1oo0.2) — the HTML the child's cards are drawn from.
 *
 * These tests run the real builders against a contract-shaped item bank. They prove what the
 * child is shown, before any browser is involved: the story is connected text whose words come
 * out of the item bank in order, no item numbers reach a child-facing card, Urdu is right to left
 * in the embedded Nastaliq face, and the printable card has the pages the coach expects.
 *
 * The browser half (line wrapping, chunking, pixels, PDF pages) is proved by real-render.test.js
 * and by the legibility proof in the lane folder.
 */

const bank = require('./fixtures/item-bank.fixture.json');
const html = require('../../../bot/shared/services/child-test/render/html');
const sizing = require('../../../bot/shared/services/child-test/render/sizing');

const formOf = (g, f) => bank.grades[String(g)].forms[f];
const PUNCT = /^[.,!?;:"'۔،؟]+|[.,!?;:"'۔،؟]+$/g;

// Visible text of an HTML string: styles and scripts removed, tags removed, entities decoded.
function visibleText(s) {
  return s
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// The story words as the child sees them, in reading order, from the inline source block.
function storyWords(s) {
  return [...s.matchAll(/<span class="w"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
}

// "1." / "12)" / "۳۔" / "4 -" style item markers.
const ITEM_MARKER = /(^|\s)[0-9۰-۹٠-٩]+\s*[.)\]:۔-](\s|$)/;

describe('inline story card (WhatsApp)', () => {
  for (const [grade, block] of [[3, 'english'], [3, 'urdu'], [5, 'english'], [5, 'urdu']]) {
    it(`G${grade} ${block}: every story token appears, in order, as connected text`, () => {
      const form = formOf(grade, 'A');
      const out = html.buildInlineHtml({ grade, formCode: 'A', block, form });
      const words = storyWords(out).map((w) => w.replace(PUNCT, '')).filter(Boolean);
      expect(words.map((w) => w.toLowerCase())).toEqual(form[block].story.tokens.map((t) => t.toLowerCase()));
      // connected text: one flowing paragraph per card, never a grid of boxes
      expect(out).not.toMatch(/class="(cell|num)"/);
      // punctuation stays on its word, it is never a word of its own
      for (const w of storyWords(out)) expect(w.replace(PUNCT, '')).not.toBe('');
    });
  }

  it('Urdu is right to left, in the embedded Nastaliq face', () => {
    const out = html.buildInlineHtml({ grade: 3, formCode: 'A', block: 'urdu', form: formOf(3, 'A') });
    expect(out).toMatch(/<html[^>]*dir="rtl"[^>]*lang="ur"/);
    expect(visibleText(out)).toMatch(/[؀-ۿ]/);
    expect(out).toMatch(/@font-face\{font-family:'CTNastaliq';src:url\(data:font\/ttf;base64,[A-Za-z0-9+/]{1000}/);
    expect(out).toMatch(/\.t\{[^}]*font-family:'CTNastaliq'/);
  });

  it('English is left to right, in the embedded Andika school face', () => {
    const out = html.buildInlineHtml({ grade: 3, formCode: 'A', block: 'english', form: formOf(3, 'A') });
    expect(out).toMatch(/<html[^>]*dir="ltr"[^>]*lang="en"/);
    expect(out).toMatch(/@font-face\{font-family:'CTAndika';src:url\(data:font\/ttf;base64,[A-Za-z0-9+/]{1000}/);
    expect(out).toMatch(/\.t\{[^}]*font-family:'CTAndika'/);
  });

  it('carries the made-up words as big items after the story, without numbers', () => {
    const form = formOf(3, 'A');
    const out = html.buildInlineHtml({ grade: 3, formCode: 'A', block: 'english', form });
    const text = visibleText(out);
    for (const nw of form.english.nonwords) expect(text).toContain(nw.text);
    expect(out).toMatch(/data-part="nonwords"/);
    expect(text).not.toMatch(ITEM_MARKER);
  });

  it('maths: numbers and quick sums are on the card, the answers are not', () => {
    const form = formOf(3, 'A');
    const out = html.buildInlineHtml({ grade: 3, formCode: 'A', block: 'maths', form });
    const text = visibleText(out);
    for (const n of form.maths.numbers) expect(text).toContain(String(n.value));
    for (const q of form.maths.quick_sums) expect(text).toContain(html.mathsDisplay(q.prompt));
    expect(text).not.toContain('=');
    expect(text).not.toMatch(ITEM_MARKER);
  });

  it('fallback variant: letters and words, no story', () => {
    const form = formOf(3, 'A');
    const out = html.buildInlineHtml({ grade: 3, formCode: 'A', block: 'urdu', form, variant: 'fallback' });
    const text = visibleText(out);
    for (const l of form.urdu.fallback.letters) expect(text).toContain(l);
    for (const w of form.urdu.fallback.words) expect(text).toContain(w);
    expect(storyWords(out)).toEqual([]);
  });

  it('oral items stay off the child card: questions and first sounds are the coach\'s', () => {
    const form = formOf(3, 'A');
    const text = visibleText(html.buildInlineHtml({ grade: 3, formCode: 'A', block: 'urdu', form }));
    for (const q of form.urdu.questions) expect(text).not.toContain(q.prompt);
    expect(text).not.toContain(form.urdu.first_sounds[0].word);
  });

  it('no child-facing card carries an item id or a digit-period marker', () => {
    for (const g of [3, 5]) for (const block of ['urdu', 'english', 'maths']) for (const variant of ['main', 'fallback']) {
      if (block === 'maths' && variant === 'fallback') continue;
      const out = html.buildInlineHtml({ grade: g, formCode: 'A', block, form: formOf(g, 'A'), variant });
      const text = visibleText(out);
      expect(text).not.toMatch(ITEM_MARKER);
      expect(text).not.toMatch(/[uem][35][AB]-/);
    }
  });

  it('rejects an unknown block instead of drawing an empty card', () => {
    expect(() => html.buildInlineHtml({ grade: 3, formCode: 'A', block: 'science', form: formOf(3, 'A') })).toThrow(/block/);
  });
});

describe('maths signs', () => {
  it('prints a true minus and times sign, whatever the item bank typed', () => {
    expect(html.mathsDisplay('52 - 17')).toBe('52 − 17');
    expect(html.mathsDisplay('6x3')).toBe('6 × 3');
    expect(html.mathsDisplay('3 + 4')).toBe('3 + 4');
    const form = JSON.parse(JSON.stringify(formOf(3, 'A')));
    form.maths.quick_sums[0].prompt = '9 - 4';
    const text = visibleText(html.buildInlineHtml({ grade: 3, formCode: 'A', block: 'maths', form }));
    expect(text).toContain('9 − 4');
    expect(text).not.toMatch(/\d - \d/);
  });
});

describe('legibility at WhatsApp bubble width', () => {
  it('Grade 3 x-height is at least 3 mm on a 6.1" phone, in both scripts', () => {
    for (const block of ['english', 'urdu']) {
      const l = sizing.legibility({ grade: 3, block, part: 'story' });
      expect(l.xHeightMm).toBeGreaterThanOrEqual(3.0);
      expect(l.bubbleFraction).toBeCloseTo(0.68, 2);
    }
  });

  it('Grade 5 stays at least 2.5 mm (smaller print, longer story)', () => {
    for (const block of ['english', 'urdu']) {
      expect(sizing.legibility({ grade: 5, block, part: 'story' }).xHeightMm).toBeGreaterThanOrEqual(2.5);
    }
  });
});

describe('printable A4 card', () => {
  const form = formOf(3, 'A');
  const out = html.buildPrintableHtml({ grade: 3, formCode: 'A', form });
  const pages = out.split('<section class="page').slice(1);

  it('one page per block, a fallback page, and the maths written strip', () => {
    expect(pages.length).toBe(5);
    expect(pages.map((p) => (p.match(/data-page="([a-z-]+)"/) || [])[1])).toEqual(['urdu', 'english', 'maths', 'fallback', 'maths-strip']);
  });

  it('no item numbers and no answers on any child page', () => {
    const text = visibleText(out);
    expect(text).not.toMatch(ITEM_MARKER);
    for (const w of form.maths.written) expect(text).not.toMatch(new RegExp(`=\\s*${w.answer}`));
    expect(text).not.toContain(form.urdu.questions[0].prompt);
  });

  it('every story token is on the page in order', () => {
    for (const [i, block] of [[0, 'urdu'], [1, 'english']]) {
      const words = storyWords(pages[i]).map((w) => w.replace(PUNCT, '')).filter(Boolean);
      expect(words.map((w) => w.toLowerCase())).toEqual(form[block].story.tokens.map((t) => t.toLowerCase()));
    }
  });

  it('the maths strip: corner code, four sums, the word problem, a child-number box, fiducials', () => {
    const strip = pages[4];
    const text = visibleText(strip);
    expect(text).toContain('G3-A');
    for (const w of form.maths.written) expect(text).toContain(html.mathsDisplay(w.prompt));
    expect(text).toContain(form.maths.word_problem.prompt_ur);
    expect(text).toContain(form.maths.word_problem.prompt_en);
    expect(strip).toMatch(/data-field="child-no"/);
    expect((strip.match(/class="fid /g) || []).length).toBe(4);
  });

  it('Urdu and the Nastaliq face are embedded for the print card too', () => {
    expect(out).toMatch(/font-family:'CTNastaliq';src:url\(data:font\/ttf;base64,/);
    expect(pages[0]).toMatch(/dir="rtl"/);
  });
});

describe('coach sheet', () => {
  const form = formOf(3, 'A');
  const out = html.buildCoachSheetHtml({ grade: 3, formCode: 'A', form, lang: 'ur' });
  const text = visibleText(out);

  it('numbers every story word and lists the keys the child never sees', () => {
    expect(text).toContain(String(form.english.story.tokens.length));
    for (const w of form.maths.written) expect(text).toContain(String(w.answer));
    expect(text).toContain(form.urdu.questions[0].accept[0]);
    expect(text).toContain(form.urdu.first_sounds[0].word);
    expect(text).toContain(String(form.maths.word_problem.answer));
  });

  it('is marked as the coach\'s copy', () => {
    expect(out).toMatch(/data-audience="coach"/);
  });
});
