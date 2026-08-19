/**
 * bd-bfy69 — the script guard. Nothing we render may be in Devanagari.
 *
 * The strings below are REAL prod data: the first is the evidence quote a coach
 * saw in the FICO Flow's B1 box on 2026-08-19 (HITL sheet R64's screenshot), the
 * second is from a stored transcript on the same day.
 */

const {
  hasDevanagari, countDevanagari, transliterateToUrdu, ensureNoDevanagari,
} = require('../../bot/shared/utils/devanagari-guard');

// From the coach's screenshot, HITL R64.
const REAL_EVIDENCE = 'तो हमने तीन चीज़ों';
// A code-switched line of the kind these transcripts are full of.
const REAL_MIXED = 'Okay, number 39. बारिश के बारे में बताइए, then write it in your copy.';

describe('bd-bfy69 — detection', () => {
  it('spots Devanagari in the real evidence quote a coach was shown', () => {
    expect(hasDevanagari(REAL_EVIDENCE)).toBe(true);
    expect(countDevanagari(REAL_EVIDENCE)).toBeGreaterThan(10);
  });

  it('does not fire on Urdu, English, digits, or punctuation', () => {
    for (const clean of [
      'آپ نے بچوں کو بہت اچھا خوش آمدید کہا۔',
      'Ask one concise, reflective question.',
      '74% · 110/148 · 2026-08-19',
      '', '   ', 'ریاضی — Mathematics',
    ]) {
      expect(hasDevanagari(clean)).toBe(false);
      expect(ensureNoDevanagari(clean)).toBe(clean);
    }
  });

  it('is not fooled by a non-string', () => {
    for (const v of [null, undefined, 42, {}, []]) {
      expect(hasDevanagari(v)).toBe(false);
      expect(countDevanagari(v)).toBe(0);
    }
  });
});

describe('bd-bfy69 — the guarantee: no output may contain Devanagari', () => {
  const CASES = [
    REAL_EVIDENCE,
    REAL_MIXED,
    'क ख ग घ च छ ज झ ट ठ ड ढ त थ द ध न प फ ब भ म य र ल व श ष स ह',
    'क़ ख़ ग़ ज़ ड़ ढ़ फ़',                      // nukta letters
    'अ आ इ ई उ ऊ ए ऐ ओ औ',                  // independent vowels
    'का कि की कु कू के कै को कौ',              // every matra
    'हिन्दी में लिखा हुआ वाक्य।',                // virama + danda
    '०१२३४५६७८९',                            // Devanagari digits
    'बच्चों ने कहा — "शाबाश!" और फिर 5 minutes.',
  ];

  it.each(CASES)('leaves no Devanagari behind in %p', (input) => {
    const out = ensureNoDevanagari(input);
    expect(hasDevanagari(out)).toBe(false);
    expect(countDevanagari(out)).toBe(0);
  });

  it('is idempotent — guarding twice changes nothing the second time', () => {
    for (const input of CASES) {
      const once = ensureNoDevanagari(input);
      expect(ensureNoDevanagari(once)).toBe(once);
    }
  });

  it('produces something, not an empty string — stripping is NOT the fix', () => {
    // Deleting the script would leave the coach with a blank evidence box,
    // which is the bug we are fixing, not a fix for it.
    const out = transliterateToUrdu(REAL_EVIDENCE);
    expect(out.trim().length).toBeGreaterThan(5);
    expect(out).toMatch(/[؀-ۿ]/); // it is Perso-Arabic now
  });
});

describe('bd-bfy69 — what must survive untouched', () => {
  it('keeps the English half of a code-switched line word-for-word', () => {
    const out = ensureNoDevanagari(REAL_MIXED);
    expect(out).toContain('Okay, number 39.');
    expect(out).toContain('then write it in your copy.');
  });

  it('keeps Latin digits, percentages and dates exactly as they were', () => {
    const out = ensureNoDevanagari('बच्चे 5 में से 3, यानी 60% — 2026-08-19');
    expect(out).toContain('5');
    expect(out).toContain('3');
    expect(out).toContain('60%');
    expect(out).toContain('2026-08-19');
  });

  it('folds Devanagari digits to Latin rather than leaving them undrawable', () => {
    expect(ensureNoDevanagari('०१२३४५६७८९')).toBe('0123456789');
  });

  it('maps aspirates onto do-chashmi he (U+06BE), not the ordinary ہ', () => {
    // کھ, not کہ — an aspirate written with the wrong he reads as a different word.
    expect(transliterateToUrdu('ख')).toBe('کھ');
    expect(transliterateToUrdu('घ')).toBe('گھ');
    expect(transliterateToUrdu('थ')).toBe('تھ');
    expect(transliterateToUrdu('ह')).toBe('ہ'); // plain ha stays the ordinary he
  });

  it('maps the retroflex series to the Urdu retroflex letters', () => {
    expect(transliterateToUrdu('ट')).toBe('ٹ');
    expect(transliterateToUrdu('ड')).toBe('ڈ');
    expect(transliterateToUrdu('ड़')).toBe('ڑ');
  });

  it('turns the danda into an Urdu full stop', () => {
    expect(transliterateToUrdu('।')).toBe('۔');
  });

  it('drops the short-vowel matras, as Urdu orthography does', () => {
    // कि -> ک  (no letter for the short i), whereas की -> کی
    expect(transliterateToUrdu('कि')).toBe('ک');
    expect(transliterateToUrdu('की')).toBe('کی');
  });
});

describe('bd-bfy69 — the guard reports itself', () => {
  it('calls onDetected with a count and a sample when it has to act', () => {
    const seen = [];
    ensureNoDevanagari(REAL_EVIDENCE, { onDetected: (info) => seen.push(info) });
    expect(seen).toHaveLength(1);
    expect(seen[0].count).toBeGreaterThan(10);
    expect(hasDevanagari(seen[0].sample)).toBe(true);
  });

  it('stays silent on clean text', () => {
    const seen = [];
    ensureNoDevanagari('آپ نے اچھا پڑھایا', { onDetected: () => seen.push(1) });
    expect(seen).toHaveLength(0);
  });

  it('still returns clean text if the reporter throws — logging must never eat a transcript', () => {
    const out = ensureNoDevanagari(REAL_EVIDENCE, {
      onDetected: () => { throw new Error('logger exploded'); },
    });
    expect(hasDevanagari(out)).toBe(false);
    expect(out.length).toBeGreaterThan(0);
  });
});
