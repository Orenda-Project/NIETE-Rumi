/**
 * bd-v0toag.1.4 — the Urdu word after the score ("62/100 نمبر") painted as tofu boxes.
 *
 * The hero's score sub-line (`.hscore .s`) carries MARKS_WORD[lang], which is Urdu/Arabic
 * script for ur/ar reports, but its rule pinned font-family to Lexend alone. Railway's
 * Chromium has no system fonts, so the Urdu glyphs had nothing to fall back to.
 * (Live 7 Oct G3 Urdu report, 62/100.)
 *
 * There is no headless browser in the unit suite, so this is the template-level guard the
 * bead allows: walk the rendered HTML, and for EVERY text run containing Arabic-script
 * characters work out which CSS rule sets its font-family (most specific matching rule on
 * the nearest element that has one) and require that stack to name an Urdu-capable face.
 * It covers every span the template draws, not just the score line, so the next small-print
 * element that forgets the fallback fails here too.
 */

const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');

const URDU_FACES = /NastaliqUrdu|NaskhArabic/;
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const VOID = new Set(['img', 'meta', 'br', 'hr', 'input', 'link']);

/** The <style> block's rules that set a font-family: [{ classes of the last compound, specificity, family }]. */
function fontRules(html) {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let order = 0;
  while ((m = re.exec(css))) {
    const fam = /font-family:([^;}]+)/.exec(m[2]);
    if (!fam) continue;
    for (const sel of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      if (sel.startsWith('@')) continue;
      const parts = sel.split(/\s+/);
      const last = parts[parts.length - 1];
      const classes = (last.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
      const tag = (/^[a-z]+\d?/i.exec(last) || [''])[0].toLowerCase();
      const specificity = (sel.match(/\.[\w-]+/g) || []).length * 10 + (sel.match(/(^|\s)[a-z]+\d?/gi) || []).length;
      rules.push({ sel, classes, tag, specificity, order: order++, family: fam[1].trim() });
    }
  }
  return rules;
}

/** The font-family the cascade gives this element directly, or null when it only inherits. */
function ownFamily(el, rules) {
  const hits = rules.filter((r) => (r.tag ? r.tag === el.tag : true)
    && r.classes.length + (r.tag ? 1 : 0) > 0
    && r.classes.every((c) => el.classes.includes(c)));
  if (el.inlineFamily) return el.inlineFamily;
  if (!hits.length) return null;
  hits.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  const fam = hits[hits.length - 1].family;
  return fam === 'inherit' ? null : fam;
}

/** Every text run with Arabic-script characters, with the font-family it is drawn in. */
function urduRuns(html) {
  const rules = fontRules(html);
  const body = html.slice(html.indexOf('<body>'));
  const stack = [];
  const runs = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[5] !== undefined) {
      const text = m[5];
      if (!ARABIC_SCRIPT.test(text)) continue;
      let family = null;
      for (let i = stack.length - 1; i >= 0 && !family; i--) family = ownFamily(stack[i], rules);
      runs.push({ text: text.trim(), family, path: stack.map((e) => e.tag + (e.classes.length ? '.' + e.classes.join('.') : '')).join(' > ') });
      continue;
    }
    const [, closing, tagRaw, attrs, selfClose] = m;
    const tag = tagRaw.toLowerCase();
    if (closing) {
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
      continue;
    }
    if (VOID.has(tag) || selfClose) continue;
    const cls = /class="([^"]*)"/.exec(attrs);
    const inline = /style="[^"]*font-family:([^;"]+)/.exec(attrs) || /font-family="([^"]+)"/.exec(attrs);
    stack.push({ tag, classes: cls ? cls[1].split(/\s+/).filter(Boolean) : [], inlineFamily: inline ? inline[1].trim() : null });
  }
  return runs;
}

function urduReport(language) {
  return {
    language,
    brand: 'niete',
    teacherName: 'Teacher B',
    topic: 'سیرت اور معانی',
    date: '2026-10-07',
    score: { overall: 62, marks: 62, max: 100 },
    groups: [
      { name: 'Lesson Plan Fidelity', notAssessed: true, notAssessedWords: 'جانچا نہیں گیا', why: 'سبق کا منصوبہ نہیں دیا گیا' },
      { name: 'High-Leverage Practices', score: 25, max: 48, pct: 52, why: 'سوالات زیادہ تر یادداشت پر مبنی تھے' },
    ],
    tryNext: 'اگلی کلاس میں ایک open-ended سوال پوچھیں',
    uptake: { asked: 'پچھلی بار کا سوال', status: 'partial', line: 'قریب ہے' },
    trend: [{ date: '2026-09-18', pct: 86 }, { date: '2026-10-07', pct: 62 }],
    classroomPhotos: [{ src: 'data:image/jpeg;base64,AAAA', caption: 'From your photo: “بچے کتاب پڑھ رہے ہیں”' }],
    narrative: {
      affirmation: 'آپ نے بچوں کی کہانیاں گرمجوشی سے سنی اور سبق سے جوڑا۔',
      identity: 'آپ ایک محتاط استاد ہیں',
      moments: [{ quote: 'شاباش، بہت خوب', why: 'اچھا لمحہ' }],
      strength_name: 'نرم لہجہ',
      strength_note: 'آپ نے نرم لہجہ استعمال کیا',
      horizon_title: 'کھلے سوالات',
      horizon_note: 'مزید کھلے سوالات کریں',
      journey_note: 'آپ کا سفر جاری ہے',
    },
  };
}

describe('bd-v0toag.1.4 — every Urdu-script span is drawn in an Urdu-capable font', () => {
  describe.each(['ur', 'ar', 'en'])('report language "%s"', (lang) => {
    const html = buildHeroReportHtml(urduReport(lang));
    const runs = urduRuns(html);

    it('finds the Urdu runs it is meant to check (guards against a vacuous pass)', () => {
      expect(runs.length).toBeGreaterThan(10);
      if (lang === 'ur') expect(runs.some((r) => r.text.includes('نمبر'))).toBe(true);
    });

    it('draws none of them in a Latin-only face', () => {
      const bad = runs.filter((r) => !URDU_FACES.test(r.family || fontRules(html).find((x) => x.sel === '.report').family));
      expect(bad.map((r) => `${r.path} :: ${r.family} :: ${r.text}`)).toEqual([]);
    });
  });

  it('the score sub-line names Nastaliq for the Urdu marks word (the 7 Oct report)', () => {
    const html = buildHeroReportHtml(urduReport('ur'));
    const marks = urduRuns(html).find((r) => r.text.includes('نمبر'));
    expect(marks.text).toBe('62/100 نمبر');
    expect(marks.family).toMatch(/NastaliqUrdu/);
  });

  it('keeps Lexend first on the score sub-line so the digits look as they did', () => {
    const html = buildHeroReportHtml(urduReport('ur'));
    expect(urduRuns(html).find((r) => r.text.includes('نمبر')).family).toMatch(/^'Lexend'/);
  });
});
