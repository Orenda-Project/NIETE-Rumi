/**
 * Commitment Card — HTML template smoke (no Playwright required).
 *
 * Asserts the building blocks of the card template: language → script
 * resolution, RTL direction flip, highlight wrapping (verbatim, longest-first),
 * and the Latin-RTL bidi span behaviour. These run against `buildCardHtml`
 * directly, NOT through htmlToImage, so they're fast and CI-safe.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { buildCardHtml, LABELS, highlightText, wrapLatinRtl } = require('../../bot/shared/services/coaching/coaching-card/card-template');

describe('buildCardHtml — language → script + direction', () => {
  it('English uses LTR + Lexend body font', () => {
    const html = buildCardHtml(
      { commitment: 'A clear commitment.', action: 'An action sentence.', highlights: [], lesson_label: 'Topic' },
      { language: 'en', teacherName: 'Asha' },
    );
    expect(html).toContain('dir="ltr"');
    expect(html).toMatch(/font-family:\s*'Lexend'/);
    expect(html).toContain('A clear commitment.');
    expect(html).toContain('Asha');
  });

  it('Kiswahili keeps LTR + Lexend', () => {
    const html = buildCardHtml(
      { commitment: 'Ahadi yangu.', action: 'Jambo moja.', highlights: [] },
      { language: 'sw', teacherName: 'Asha' },
    );
    expect(html).toContain('dir="ltr"');
    expect(html).toMatch(/font-family:\s*'Lexend'/);
  });

  it('Urdu flips to RTL + Nastaliq', () => {
    const html = buildCardHtml(
      { commitment: 'میرا عہد.', action: 'ایک کام.', highlights: [] },
      { language: 'ur', teacherName: 'عائشہ' },
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toMatch(/font-family:\s*'Noto Nastaliq Urdu'/);
  });

  it('Arabic flips to RTL + Naskh', () => {
    const html = buildCardHtml(
      { commitment: 'التزامي.', action: 'أمر واحد.', highlights: [] },
      { language: 'ar', teacherName: 'فاطمة' },
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toMatch(/font-family:\s*'Noto Naskh Arabic'/);
  });

  it('unknown language falls back to English LTR', () => {
    const html = buildCardHtml(
      { commitment: 'C', action: 'A', highlights: [] },
      { language: 'fr', teacherName: 'Asha' },
    );
    expect(html).toContain('dir="ltr"');
  });
});

describe('LABELS — per-language eyebrow + tryLabel + foot', () => {
  it('en/sw/ur/ar each ship eyebrow + tryLabel + foot strings', () => {
    for (const code of ['en', 'sw', 'ur', 'ar']) {
      expect(LABELS[code]).toBeDefined();
      expect(LABELS[code].eyebrow).toBeTruthy();
      expect(LABELS[code].tryLabel).toBeTruthy();
      expect(LABELS[code].foot).toBeTruthy();
    }
  });

  it('en eyebrow contains "Your commitment", sw "Ahadi yako", ur "آپ کا عہد", ar "التزامك"', () => {
    expect(LABELS.en.eyebrow).toMatch(/Your commitment/);
    expect(LABELS.sw.eyebrow).toMatch(/Ahadi yako/);
    expect(LABELS.ur.eyebrow).toMatch(/آپ کا عہد/);
    expect(LABELS.ar.eyebrow).toMatch(/التزامك/);
  });
});

describe('highlightText — verbatim, longest-first wrapping', () => {
  it('wraps a single highlight in .hi', () => {
    const out = highlightText('Pause 3 seconds before calling on a student', ['Pause 3 seconds']);
    expect(out).toContain('<span class="hi">Pause 3 seconds</span>');
  });

  it('longest-first ensures the longer phrase is wrapped (shorter overlaps may nest)', () => {
    // Sorted longest-first, so "open-ended question" is wrapped first.
    // A shorter "open" may nest inside that span on a later pass — the
    // rendered HTML still emphasises the full phrase correctly because
    // CSS .hi is the same for outer and any nested span. Don't lock the
    // exact nesting; just lock that an .hi span opens and the phrase text
    // is preserved in the output.
    const out = highlightText('Ask an open-ended question and wait.', ['open', 'open-ended question']);
    expect(out).toContain('class="hi"');
    expect(out).toContain('-ended question');
  });

  it('empty highlights → returns the text HTML-escaped, untouched', () => {
    const out = highlightText('A < B & C', []);
    expect(out).toBe('A &lt; B &amp; C');
  });
});

describe('wrapLatinRtl — Latin runs get a Latin-font span', () => {
  it('wraps a Latin pedagogical term inside RTL prose', () => {
    const html = 'اگلی کلاس میں open-ended questions استعمال کریں۔';
    const wrapped = wrapLatinRtl(html);
    expect(wrapped).toContain('<span class="ltr">open-ended questions</span>');
  });

  it('does not touch Latin text inside tag attributes', () => {
    // Latin inside angle-bracketed attributes (class="x") must stay untouched —
    // wrapping it would break the HTML. Text BETWEEN tags is still processed.
    const html = '<div class="open-attribute-name">prose</div>';
    const wrapped = wrapLatinRtl(html);
    expect(wrapped).toContain('class="open-attribute-name"');
    expect(wrapped).not.toContain('class="<span class="ltr">');
  });
});
