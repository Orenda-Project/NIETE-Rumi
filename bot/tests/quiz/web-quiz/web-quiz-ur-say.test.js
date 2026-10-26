'use strict';
/**
 * The one Urdu spelling list for the voice (web-quiz-ur-say.js): the Urdu words a voice reads wrong from their Urdu
 * spelling, and the spelling it is given instead. The screen keeps the Urdu; only the voice's words change.
 *
 * The guard: over the repo's Urdu story text (the child test's Urdu passages, bot/shared/data/child-test/passages; the
 * storybook pages manifest is not in the repo), sayOf changes only listed words: every word it changes is a SAY key,
 * and every other character is as written.
 */
const fs = require('fs');
const path = require('path');
const { SAY, SKIP_FOR, sayOf } = require('../../../shared/services/quiz/web-quiz-ur-say');

describe('sayOf: listed whole words respelled, everything else as written', () => {
  test('ساتھ and کھیر are given to the voice respelled', () => {
    expect(sayOf('بچے ساتھ گئے اور کھیر کھائی۔')).toBe('بچے साथ گئے اور खीर کھائی۔');
  });

  test('the letter name ثے (the RDF letter-names example) is given as से: the voice read it as a "t" word', () => {
    expect(sayOf('ثے')).toBe('से');
    expect(sayOf('اس حرف کا نام ہے: ثے')).toBe('اس حرف کا نام ہے: से');
  });
  test('a word that only contains a listed word is left as it is', () => {
    expect(sayOf('میرا ساتھی آیا')).toBe('میرا ساتھی آیا');
    expect(sayOf('کیلا اور میلاد')).toBe('کیلا اور میلاد');
  });

  test('میلا is मेला as a whole word, wherever it stands', () => {
    expect(sayOf('کیلا کا ہم آواز لفظ میلا ہو گا۔')).toBe('کیلا کا ہم آواز لفظ मेला ہو گا۔');
    expect(sayOf('اس کا کپڑا میلا ہے۔')).toBe('اس کا کپڑا मेला ہے۔');
  });

  test('a listed word written with diacritics or Arabic letter forms still matches', () => {
    expect(sayOf('کھِیر')).toBe('खीर');
    expect(sayOf('كھير')).toBe('खीर');
  });

  test('a line with no listed word, English, empty: unchanged', () => {
    expect(sayOf('ایک دن بارش ہوئی۔')).toBe('ایک دن بارش ہوئی۔');
    expect(sayOf('One day it rained.')).toBe('One day it rained.');
    expect(sayOf('')).toBe('');
  });

  test('every entry is one Urdu word given as one other-script word', () => {
    Object.entries(SAY).forEach(([w, say]) => {
      expect(w).toMatch(/^[؀-ۿ]+$/u);
      expect(say).not.toMatch(/[؀-ۿ]/u);
      expect(say).toMatch(/^[\p{L}\p{M}]+$/u);
    });
    expect(SAY['میلا']).toBe('मेला');
  });
});

describe('guard: over the repo\'s Urdu story text, only listed words change', () => {
  const DIR = path.join(__dirname, '../../../shared/data/child-test/passages');
  const URDU = /[؀-ۿݐ-ݿ‌‍]+/gu;
  const lines = fs.readdirSync(DIR).filter((f) => /^ur\..*\.json$/.test(f)).flatMap((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    return [d.title_ur, d.text].filter((t) => typeof t === 'string' && t).map((t) => [f, t]);
  });
  const keys = new Set(Object.keys(SAY));

  test('the repo has Urdu story text to guard', () => {
    expect(lines.length).toBeGreaterThan(20);
  });

  test('every changed word is a SAY key, said as its listed spelling; the rest is byte for byte', () => {
    let changed = 0;
    lines.forEach(([, text]) => {
      const out = sayOf(text);
      // put every listed respelling back: what is left must be the text as written
      const back = Object.entries(SAY).reduce((s, [w, say]) => s.split(say).join(w), out);
      expect(back.replace(/[ً-ٰٟـ‌‍]/g, '')).toBe(text.replace(/[ً-ٰٟـ‌‍]/g, ''));
      const words = text.match(URDU) || [];
      const said = words.map((w) => sayOf(w));
      words.forEach((w, i) => {
        if (said[i] === w) return;
        changed += 1;
        expect(keys.has(w) || [...keys].some((k) => sayOf(k) === said[i])).toBe(true);
        expect(Object.values(SAY)).toContain(said[i]);
      });
    });
    // ساتھ is in the stories: the guard sees at least one change, so it is not empty
    expect(changed).toBeGreaterThan(0);
  });
});

describe('a voice can be left out of a respelling, by data only (SKIP_FOR: voice id -> words left as written)', () => {
  const T = 'بچے ساتھ گئے اور کھیر کھائی۔';

  test('the list ships with no exception', () => {
    expect(SKIP_FOR).toEqual({});
    expect(Object.isFrozen(SKIP_FOR)).toBe(true);
  });

  test('a listed word is left as written for the voice that skips it, respelled for any other voice', () => {
    const skipFor = { 'voice-a': ['ساتھ'] };
    expect(sayOf(T, { voice: 'voice-a', skipFor })).toBe('بچے ساتھ گئے اور खीर کھائی۔');
    expect(sayOf(T, { voice: 'voice-b', skipFor })).toBe('بچے साथ گئے اور खीर کھائی۔');
    expect(sayOf(T, { skipFor })).toBe('بچے साथ گئے اور खीर کھائی۔');
    // the skipped word matches as the list does: with or without diacritics
    expect(sayOf('ساتھ', { voice: 'voice-a', skipFor: { 'voice-a': ['سَاتھ'] } })).toBe('ساتھ');
  });

  test('golden: with no exception, every Urdu story line is byte for byte what it was without the option', () => {
    const fs = require('fs');
    const path = require('path');
    const DIR = path.join(__dirname, '../../../shared/data/child-test/passages');
    const texts = fs.readdirSync(DIR).filter((f) => /^ur\..*\.json$/.test(f)).flatMap((f) => {
      const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      return [d.title_ur, d.text].filter((t) => typeof t === 'string' && t);
    });
    texts.concat([T, 'کیلا کا ہم آواز لفظ میلا ہو گا۔']).forEach((t) => {
      const plain = sayOf(t);
      expect(sayOf(t, {})).toBe(plain);
      expect(sayOf(t, { voice: 'any-voice' })).toBe(plain);
      expect(sayOf(t, { voice: 'any-voice', skipFor: {} })).toBe(plain);
    });
    expect(sayOf(T)).toBe('بچے साथ گئے اور खीर کھائی۔');
  });
});
