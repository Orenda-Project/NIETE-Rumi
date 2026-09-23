/*
 * bd-b7txa — the NORMALISER, at unit scale.
 *
 * `religious-marks-latin-honorific.e2e.test.js` proves the ruling end to end on the two shapes the
 * corpus actually prints. This suite covers the shapes an E2E cannot economically enumerate, and
 * above all the ONE that makes adjacency load-bearing rather than decorative:
 *
 *     "SAW" IS ALSO AN ENGLISH VERB.
 *
 * `ABBREV_RE` matches `\b(PBUH|SAW|SAWW)\b` case-SENSITIVELY, which is why an ALL-CAPS heading
 * reading "THE BOY SAW A BIRD" is already a false refusal today. A blind normaliser would turn
 * that into scripture. So the rewrite fires only against a Prophet name the gate itself
 * recognises, and it is case-sensitive for the same reason the gate is: it must never rewrite text
 * the gate would not otherwise have refused.
 *
 * THE INVARIANT THIS SUITE EXISTS TO HOLD: normalising is not clearing. The gate is untouched by
 * bd-b7txa; an abbreviation this function leaves alone is still refused by `ABBREV_RE`, exactly as
 * the operator ruled on 2026-09-17 ("must be our stamp") and tuned on bd-6tfw6 ("go on option 1").
 */
const { normalizeLatinHonorific } = require('../../bot/shared/services/lp612-latin-honorific');

/** Normalise one string by putting it in a document, the way the caller does. */
const one = (text) => {
  const doc = { sections: [{ blocks: [{ type: 'paragraph', text }] }] };
  normalizeLatinHonorific(doc);
  return doc.sections[0].blocks[0].text;
};

describe('the book\'s Latin salutation becomes the stamp', () => {
  it('parenthesised, the two forms the corpus prints', () => {
    expect(one('Hazrat Muhammad (SAW) said so.')).toBe('Hazrat Muhammad ﷺ said so.');
    expect(one('Hazrat Muhammad (PBUH) said so.')).toBe('Hazrat Muhammad ﷺ said so.');
  });

  it('the dotted and bracketed spellings the books also use', () => {
    expect(one('Hazrat Muhammad (P.B.U.H.) said so.')).toBe('Hazrat Muhammad ﷺ said so.');
    expect(one('Hazrat Muhammad [SAWW] said so.')).toBe('Hazrat Muhammad ﷺ said so.');
  });

  it('every Prophet spelling the gate itself matches', () => {
    expect(one('Mohammad (PBUH)')).toBe('Mohammad ﷺ');
    expect(one('Muhammed (PBUH)')).toBe('Muhammed ﷺ');
    expect(one('Rasool (PBUH)')).toBe('Rasool ﷺ');
    expect(one('Rasul (PBUH)')).toBe('Rasul ﷺ');
  });

  it('bare PBUH normalises — it cannot be an English word', () => {
    expect(one('Hazrat Muhammad PBUH said so.')).toBe('Hazrat Muhammad ﷺ said so.');
  });

  it('rewrites every occurrence in the string, not only the first', () => {
    expect(one('Muhammad (PBUH) and Muhammad (SAW)')).toBe('Muhammad ﷺ and Muhammad ﷺ');
  });

  it('walks the whole document — arrays, nesting, and the top level', () => {
    const doc = {
      title: 'Hazrat Muhammad (PBUH)',
      sections: [{ blocks: [{ type: 'key_points', items: ['Muhammad (SAW) taught patience.'] }] }],
    };
    normalizeLatinHonorific(doc);
    expect(doc.title).toBe('Hazrat Muhammad ﷺ');
    expect(doc.sections[0].blocks[0].items[0]).toBe('Muhammad ﷺ taught patience.');
  });
});

describe('ADJACENCY IS THE GUARD — what is deliberately left for the gate to refuse', () => {
  it('bare SAW is NOT rewritten: it is the past tense of "see"', () => {
    // The whole reason the bare arm carries only the unambiguous tokens. Left for ABBREV_RE.
    expect(one('Hazrat Muhammad SAW the caravan approaching.'))
      .toBe('Hazrat Muhammad SAW the caravan approaching.');
  });

  it('an abbreviation with no Prophet name in front of it is untouched', () => {
    expect(one('his companions (PBUH) recorded it')).toBe('his companions (PBUH) recorded it');
    expect(one('THE BOY SAW A BIRD')).toBe('THE BOY SAW A BIRD');
  });

  it('a Prophet name a whole clause away does not license the rewrite', () => {
    const s = 'Muhammad was born in Makkah, and his companions (PBUH) recorded it.';
    expect(one(s)).toBe(s);
  });

  it('case-sensitive, exactly as ABBREV_RE is — it never rewrites what the gate would allow', () => {
    expect(one('Hazrat Muhammad (pbuh) said so.')).toBe('Hazrat Muhammad (pbuh) said so.');
  });

  it('does not touch the fields the gate itself excludes from enforcement', () => {
    // `/slo/text_verbatim` is quoted from the curriculum WORD FOR WORD; rewriting an immutable
    // quote is the defect, not the fix. `human_review_reason` is an internal routing note.
    const doc = {
      slo: { text_verbatim: 'Hazrat Muhammad (PBUH) — as printed in the curriculum' },
      human_review_reason: 'names Hazrat Muhammad (PBUH)',
      provenance: { note: 'Hazrat Muhammad (PBUH)' },
    };
    normalizeLatinHonorific(doc);
    expect(doc.slo.text_verbatim).toContain('(PBUH)');
    expect(doc.human_review_reason).toContain('(PBUH)');
    expect(doc.provenance.note).toContain('(PBUH)');
  });

  it('survives the shapes a model actually emits without throwing', () => {
    expect(() => normalizeLatinHonorific(null)).not.toThrow();
    expect(() => normalizeLatinHonorific('a string')).not.toThrow();
    expect(() => normalizeLatinHonorific({ a: null, b: 3, c: [undefined] })).not.toThrow();
  });
});
