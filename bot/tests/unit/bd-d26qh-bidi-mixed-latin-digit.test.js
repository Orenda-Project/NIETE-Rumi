/**
 * bd-d26qh — Urdu coaching report: a mixed English+number classroom quote under
 * "Moments worth remembering" renders REVERSED.
 *
 * Reported by Qurat-ul-ain (ICT/NIETE) on the new-format report: the moment line
 * should read "3 plus 7 makes 10" but paints as "10 makes 7 plus 3".
 *
 * ROOT CAUSE (two halves, both required):
 *  1. `wrapLatin`'s regex matches LETTER runs only —
 *     a Latin-letter run with optional inner punctuation, so the digits in
 *     "3 plus 7 makes 10" fall OUTSIDE the spans. The phrase becomes five
 *     separate bidi runs (EN, L, EN, L, EN).
 *  2. `.ltr` sets only font-family/weight — no `unicode-bidi`, no `direction`.
 *     A plain inline span opens no embedding level, so those five runs are laid
 *     out by the Unicode Bidi Algorithm against the inherited RTL base
 *     direction (<html dir="rtl">). UBA rule I2 lifts each L/EN run to level 2,
 *     the spaces between them stay level 1, and L2 reverses the whole line —
 *     painting "10 makes 7 plus 3".
 *
 * THE FIX (per the playwrite-reports skill §3, the bd-2664 lesson):
 *  - Wrap a contiguous Latin+digit+inner-punctuation run as ONE span, gated on
 *    the run containing at least one Latin letter (so standalone numerals —
 *    scores, marks, the journey count — keep today's behaviour exactly).
 *  - `.ltr{...;unicode-bidi:isolate;direction:ltr}`. Both properties: isolate
 *    stops the run disturbing the surrounding Urdu shaping; direction:ltr stops
 *    the run reordering INTERNALLY. Neither alone is sufficient.
 *
 * Red-first: assertions 1 and 2 fail on develop.
 * Created: 2026-08-27
 */

const { buildHeroReportHtml } = require('../../shared/services/coaching/report-v2/hero-report.template');

// The exact phrase from Qurat's report.
const MIXED = '3 plus 7 makes 10';
const QUOTE_UR = `بچوں نے کہا ${MIXED} اور سب نے تالی بجائی۔`;

function vm(extra = {}) {
  return {
    language: 'ur',
    teacherName: 'Sadia Tabassum',
    topic: 'Fractions',
    date: '2026-08-01',
    score: { overall: 75, marks: 111, max: 148 },
    groups: [{ key: 'B', name: 'Lesson Plan Fidelity', score: 31, max: 40, pct: 78 }],
    narrative: {
      affirmation: 'آپ کی کلاس میں سوالوں کی گونج تھی',
      strength_name: 'Wait time',
      strength_note: 'note',
      horizon_title: 'Cold call',
      horizon_note: 'note',
      moments: [{ quote: QUOTE_UR, why: 'why' }],
    },
    tryNext: 'ایک بات آزمائیں',
    trend: [{ date: '2026-07-10', pct: 62 }, { date: '2026-07-24', pct: 75 }],
    photoB64: '',
    ...extra,
  };
}

/** Pull the text of every <span class="ltr">…</span> in render order. */
function ltrSpans(html) {
  return [...html.matchAll(/<span class="ltr">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
}

describe('bd-d26qh · mixed Latin+digit runs are ONE isolated LTR run', () => {
  it('emits "3 plus 7 makes 10" as a SINGLE ltr span, not split around the digits', () => {
    const spans = ltrSpans(buildHeroReportHtml(vm()));
    // The whole arithmetic phrase must survive as one contiguous isolated run.
    expect(spans).toContain(MIXED);
    // And it must NOT have been torn into letter-only fragments.
    expect(spans).not.toContain('plus');
    expect(spans).not.toContain('makes');
  });

  // `direction:ltr` alone is inert on an inline box: CSS only honours `direction`
  // when `unicode-bidi` opens a level (embed/override/isolate). So both are needed.
  //
  // It must be `embed`, NOT `isolate` — verified by rendering, not by reasoning.
  // `isolate` replaces the run with a neutral object for the OUTER algorithm, so a
  // line carrying several sibling .ltr spans ("Your scores · this lesson",
  // "Your journey — 2 lessons together", "Made just for you, <name>") had the SPANS
  // themselves reordered right-to-left by the RTL parent. `embed` keeps the run
  // strong-L to the outside, so sibling spans still coalesce into one L run, while
  // still forcing the run's own content LTR internally.
  it('.ltr carries BOTH unicode-bidi:embed AND direction:ltr (embed, not isolate)', () => {
    const html = buildHeroReportHtml(vm());
    const rule = (html.match(/\.ltr\{[^}]*\}/) || [''])[0];
    expect(rule).toMatch(/direction:\s*ltr/);
    expect(rule).toMatch(/unicode-bidi:\s*embed/);
    // isolate would silently reverse multi-span English chrome lines.
    expect(rule).not.toMatch(/unicode-bidi:\s*isolate/);
  });
});

describe('bd-d26qh · guards — behaviour that must NOT change', () => {
  it('leaves standalone numerals unwrapped (scores, marks, journey count)', () => {
    const spans = ltrSpans(buildHeroReportHtml(vm()));
    // No span is a bare number: gating on "contains a Latin letter" keeps the
    // score/marks/percentage rendering byte-identical to today.
    for (const s of spans) expect(s).toMatch(/[A-Za-z]/);
  });

  it('does not tear an HTML entity apart (bd-2225 regression guard)', () => {
    const html = buildHeroReportHtml(vm({
      narrative: { ...vm().narrative, moments: [{ quote: 'Assessment & Feedback', why: 'why' }] },
    }));
    expect(html).not.toMatch(/&<span class="ltr">amp<\/span>;/);
    expect(html).not.toContain('&amp;amp;');
  });

  it('is a no-op for an LTR (English) report — no ltr spans injected', () => {
    const html = buildHeroReportHtml(vm({ language: 'en' }));
    expect(html).toContain('<html dir="ltr"');
    expect(ltrSpans(html)).toHaveLength(0);
  });

  // NIETE renders CHROME in English by design (template: `const C = CHROME.en`)
  // while layout stays RTL and the LLM-generated BODY stays in `lang`. So the
  // register guard asserts the RTL layout + the Urdu BODY, not Urdu chrome.
  it('keeps the report RTL and the Urdu body intact (bd-2528 register guard)', () => {
    const html = buildHeroReportHtml(vm());
    expect(html).toContain('<html dir="rtl"');
    expect(html).toContain('بچوں نے کہا');       // Urdu body survives
    expect(html).toContain('اور سب نے تالی بجائی۔');
  });
});
