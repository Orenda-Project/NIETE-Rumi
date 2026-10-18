/**
 * The shared link landing's own small Urdu face (dashboard/lib/web-quiz-landing-face.js): it is cut for a closed list
 * of words (the card's words, the activity marks, the landing's own words), so it can only draw those. This guard is
 * red when a word changes without a rebuild (dashboard/scripts/landing-urdu-face/build.py), when the face and its
 * record disagree, or when the one @font-face line stops being the agreed shape.
 */
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LIB = path.join(__dirname, '..', 'lib');
const { landingStrings, cardLanding } = require('../scripts/landing-urdu-face/strings');
const card = require('../../bot/shared/services/quiz/web-quiz-card-image');
const face = require('../lib/web-quiz-landing-face');

const meta = JSON.parse(fs.readFileSync(path.join(LIB, 'web-quiz-landing-face.json'), 'utf8'));
const woff2 = fs.readFileSync(path.join(LIB, 'web-quiz-landing-face.woff2'));
const routesSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'web-quiz.routes.js'), 'utf8');
const live = () => landingStrings({ card, routesSrc });

describe('the landing face covers every Urdu word the landing and its card draw', () => {
  test('every live string is one the face was built and checked for', () => {
    const missing = live().filter((s) => !meta.strings.includes(s));
    expect(missing).toEqual([]);
  });

  test('every character of every live string is in the face (or is not in the app face either)', () => {
    const have = new Set(meta.codepoints);
    const fallback = new Set(meta.not_in_source);
    const out = [];
    for (const s of live()) for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (!have.has(cp) && !fallback.has(cp)) out.push(`${s} U+${cp.toString(16)}`);
    }
    expect(out).toEqual([]);
    // only the colon after the name, today: the app face has no ':' either, so both pages draw it the same way
    expect(meta.not_in_source.every((cp) => cp < 0x600)).toBe(true);
  });

  test('the card words, the marks and the landing words are all in the list', () => {
    const s = live();
    Object.values(card.COPY.ur).forEach((t) => expect(s).toContain(t));
    expect(s).toContain(card.CARD_RETURN_WORDS.ur);
    Object.values(card.MARK).forEach((m) => expect(s).toContain(m.ur));
    const cl = cardLanding(routesSrc);
    expect(Object.keys(cl.ur).sort()).toEqual(['hint', 'sub']);
    Object.values(cl.ur).forEach((t) => expect(s).toContain(t));
  });

  test('a changed word is caught: an edited card line is not in the face', () => {
    const edited = { ...card, COPY: { ...card.COPY, ur: { ...card.COPY.ur, sticker: 'ایک نیا ستارہ!' } } };
    const missing = landingStrings({ card: edited, routesSrc }).filter((s) => !meta.strings.includes(s));
    expect(missing).toEqual(['ایک نیا ستارہ!']);
  });

  test('the landing words are read from the routes when they are there', () => {
    const src = "const CARD_LANDING = {\n  en: { sub: 'x' },\n  ur: { sub: 'نیا جملہ' },\n};\n";
    expect(cardLanding(src)).toEqual({ en: { sub: 'x' }, ur: { sub: 'نیا جملہ' } });
    expect(cardLanding('nothing here')).toBeNull();
  });
});

describe('the face and its one @font-face line', () => {
  test('the file is the one the record names, and it is small', () => {
    expect(crypto.createHash('sha256').update(woff2).digest('hex')).toBe(meta.sha256);
    expect(woff2.length).toBe(meta.bytes);
    expect(woff2.length).toBeLessThanOrEqual(20 * 1024);
    expect(woff2.subarray(0, 4).toString('latin1')).toBe('wOF2');
  });

  test('built from the app face as it is today', () => {
    const six = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'fonts', 'wq-nastaliq-6.woff2'));
    expect(crypto.createHash('sha256').update(six).digest('hex')).toBe(meta.source_sha256);
  });

  test('one rule: its own family, swap, weight 400, the face inline, a range of exactly its characters', () => {
    const css = face.CSS;
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).toBe(face.fontFace());
    expect(css.startsWith(`@font-face{font-family:"${face.FAMILY}";`)).toBe(true);
    expect(face.FAMILY).toBe('WQ Nastaliq Landing');
    expect(css).toContain('font-display:swap');
    expect(css).toContain('font-weight:400');
    expect(css).not.toMatch(/[<>\n]/);
    const b64 = css.match(/url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\) format\("woff2"\)/)[1];
    expect(Buffer.from(b64, 'base64').equals(woff2)).toBe(true);
    const range = css.match(/unicode-range:([^;}]+)/)[1];
    expect(range).toBe(face.RANGE);
    const cps = [];
    for (const part of range.split(',')) {
      const [a, b] = part.replace('U+', '').split('-').map((h) => parseInt(h, 16));
      for (let c = a; c <= (b || a); c += 1) cps.push(c);
    }
    expect(cps).toEqual(meta.codepoints);
    expect(face.BYTES).toBe(woff2.length);
  });

  test('the lazy full face for open text: wq.css\'s own rule for -6, page-absolute URL, swap, no other change', () => {
    const sheet = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
    const rule = /@font-face\{font-family:"WQ Nastaliq 2";src:url\(fonts\/wq-nastaliq-6\.woff2\)[^}]*\}/.exec(sheet)[0];
    const full = face.fullFace();
    expect(full).toBe(rule.replace('url(fonts/', 'url(/wq/fonts/'));
    expect(full.startsWith('@font-face{font-family:"WQ Nastaliq 2";src:url(/wq/fonts/wq-nastaliq-6.woff2) format("woff2");')).toBe(true);
    expect(full).toContain('font-display:swap');
    expect(full).toMatch(/unicode-range:U\+0020,[^}]*U\+0621-063A/);
    expect(face.FULL_FAMILY).toBe('WQ Nastaliq 2');
    expect(face.faces()).toBe(face.fontFace() + full);
    expect(face.faces().match(/@font-face/g)).toHaveLength(2);
    expect(face.faces()).not.toMatch(/[<>\n]/);
  });

  test('the exported character set: exactly the face\'s range; every built string is inside it', () => {
    expect(face.CODEPOINTS).toEqual(meta.codepoints);
    expect(Object.isFrozen(face.CODEPOINTS)).toBe(true);
    meta.strings.filter((s) => !/:/.test(s)).forEach((s) => expect(face.covers(s)).toBe(true));
    expect(face.covers('Amal')).toBe(false);
    expect(face.covers('چاند کا سفر')).toBe(false); // ف is not in the face: open text never uses it
  });

});
