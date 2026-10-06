/**
 * The render matrix's generator: every question SHAPE the quiz engine can hand the web page,
 * crossed with the mutations that break layouts, in English and Urdu.
 *
 * A case is a quiz_questions ROW (what the engine writes: option_a..d, correct_option,
 * explanation, option_feedback, media) — never a hand-made page payload. The page payload is
 * made from it by the server's own questionPayload() (see e2.js), so a figure is drawn by the
 * real engine, a picture option by the real pictogram roster, an emoji option becomes the real
 * unnamed tile, a WhatsApp match row the real tap-to-match.
 *
 * Where the shapes come from (the code's own lists, not memory):
 *   - rows with no web item: text options (2-4), multi (key "A,C"), emoji options, option
 *     images, a question image, a figure of every kind transcript-quiz-figure ALLOWED_TYPES
 *     draws, a figure that will not draw (with and without its PNG fallback), a WhatsApp match
 *     figure, a video-bank listen item with a stimulus clip;
 *   - web items (media.web, SCHEMA_v2): every type in web-quiz-items TYPES — single, picture,
 *     listen, multi (SAME_TYPES) and tf, order, match, label (NEW_TYPES) — plus glyph tiles.
 * Options: every path stores at most four (slots A-D: rowOptions, questionPayload, normaliseItem),
 * so there is no 5- or 6-option case to build.
 *
 * Text is synthetic. No real lesson, child or teacher text.
 */
'use strict';

const LANGS = ['en', 'ur'];
const SLOTS = ['A', 'B', 'C', 'D'];

const TEXT = {
  en: {
    stem: 'Which of these is a liquid?',
    opts: ['stone', 'milk', 'air', 'sand'],
    key: 'B',
    why: 'A liquid flows and takes the shape of its cup.',
    fb: ['A stone keeps its own shape.', '', 'Air is a gas: it fills the whole room.', 'Sand is many tiny solid grains.'],
    hint: 'Think about what you can pour into a glass.',
    longStem: 'Our class walked to the school garden after the morning assembly and looked closely at many different things: '
      + 'the water in the tap, the stones on the path, the air that moved the leaves on the big tree, the sand in the corner '
      + 'where the younger children play, and the milk that the cook was warming for the break. The teacher asked us to sort '
      + 'everything we saw into groups. Which of these is a liquid?',
    longOpt: ['a smooth grey stone from the river bank that keeps exactly the same shape in every pot', 'milk that you pour from a jug into a cup, which flows and takes the shape of the cup',
      'the air inside a balloon that spreads out to fill all the space it is given to fill', 'dry sand from the playground corner that is made of many tiny solid grains'],
    multiStem: 'Which TWO of these are liquids?',
    multiOpts: ['water', 'stone', 'milk', 'wood'],
    latin: 'Which of these is a liquid?',
    num: ['3 stones', '12 cups of milk', '5 balloons of air', '7 bags of sand'],
  },
  ur: {
    stem: 'ان میں سے مائع کون سا ہے؟',
    opts: ['پتھر', 'دودھ', 'ہوا', 'ریت'],
    key: 'B',
    why: 'مائع بہتا ہے اور برتن کی شکل لے لیتا ہے۔',
    fb: ['پتھر اپنی شکل نہیں بدلتا۔', '', 'ہوا گیس ہے، پورے کمرے میں پھیل جاتی ہے۔', 'ریت بہت سے چھوٹے ٹھوس دانے ہیں۔'],
    hint: 'سوچیں، گلاس میں کیا ڈالا جا سکتا ہے؟',
    longStem: 'صبح کی اسمبلی کے بعد ہماری جماعت اسکول کے باغ میں گئی اور بہت سی چیزوں کو غور سے دیکھا: نل کا پانی، راستے کے پتھر، '
      + 'وہ ہوا جو بڑے درخت کے پتوں کو ہلا رہی تھی، کونے کی ریت جہاں چھوٹے بچے کھیلتے ہیں، اور وہ دودھ جو باورچی وقفے کے لیے گرم کر رہا تھا۔ '
      + 'استاد نے کہا کہ ہر چیز کو اس کے گروہ میں رکھیں اور پھر سوچیں کہ کون سی چیز بہتی ہے اور برتن کی شکل لیتی ہے۔ ان میں سے مائع کون سا ہے؟',
    longOpt: ['دریا کے کنارے کا ایک چکنا سرمئی پتھر جو ہر برتن میں بالکل اپنی ہی شکل میں رہتا ہے', 'دودھ جو جگ سے پیالے میں ڈالا جائے تو بہتا ہے اور پیالے کی شکل لے لیتا ہے',
      'غبارے کے اندر کی ہوا جو پھیل کر وہ ساری جگہ بھر دیتی ہے جو اسے دی جائے', 'کھیل کے میدان کی سوکھی ریت جو بہت سے چھوٹے ٹھوس دانوں سے بنی ہے'],
    multiStem: 'ان میں سے کون سی دو چیزیں مائع ہیں؟',
    multiOpts: ['پانی', 'پتھر', 'دودھ', 'لکڑی'],
    latin: 'ان میں سے Liquid کون سا ہے؟ (CO2 اور H2O بھی دیکھیں)',
    num: ['۳ پتھر', '12 پیالے دودھ', '5 غبارے', '۷ تھیلے ریت'],
  },
};

/** Maths as the author writes it ($…$ TeX), the commands prod rows actually carry (prod sample 27 Jul–6 Oct 2026). */
const MATH = {
  common: {
    en: { stem: 'What is $\\frac{3}{4}$ of $12$?', opts: ['$9$', '$\\frac{1}{4}$', '$3 \\times 4$', '$12 \\div 4$'], why: '$\\frac{3}{4} \\times 12 = 9$, so the answer is $9$.' },
    ur: { stem: '$12$ کا $\\frac{3}{4}$ کتنا ہے؟', opts: ['$9$', '$\\frac{1}{4}$', '$3 \\times 4$', '$12 \\div 4$'], why: '$\\frac{3}{4} \\times 12 = 9$ ہے۔' },
  },
  rare: {
    en: { stem: 'A lamp has $60\\ \\Omega$. What comes next: $67, 62, 57, 52, \\dots$?', opts: ['$9 \\div 3 \\neq 3 \\div 9$', '$\\begin{array}{rr} & 712 \\\\ - & 460 \\\\ \\hline & \\end{array}$', '$25\\,^\\circ\\text{C}$', '$\\text{Rs } 40$'],
      why: '$14, 16 \\xrightarrow{\\div 2} 7, 8$ and $\\text{CuSO}_4\\cdot5\\text{H}_2\\text{O} \\rightleftharpoons \\text{CuSO}_4 + 5\\text{H}_2\\text{O}$.' },
    ur: { stem: 'ایک بلب میں $60\\ \\Omega$ ہیں۔ آگے کیا آئے گا: $67, 62, 57, 52, \\dots$؟', opts: ['$9 \\div 3 \\neq 3 \\div 9$', '$\\begin{array}{rr} & 712 \\\\ - & 460 \\\\ \\hline & \\end{array}$', '$25\\,^\\circ\\text{C}$', '$\\text{Rs } 40$'],
      why: '$14, 16 \\xrightarrow{\\div 2} 7, 8$ اور $\\text{CuSO}_4\\cdot5\\text{H}_2\\text{O} \\rightleftharpoons \\text{CuSO}_4 + 5\\text{H}_2\\text{O}$۔' },
  },
};

const PICS = { en: ['apple', 'banana', 'carrot', 'mango'], ur: ['سیب', 'کیلا', 'گاجر', 'آم'] };
const PICTO = ['apple', 'banana', 'carrot', 'mango'];
const EMOJI = ['🍎', '🍌', '🥕', '🥭'];
const GLYPHS = { en: ['b', 'd', 'p', 'q'], ur: ['ب', 'پ', 'ت', 'ٹ'] };
const ORDER = { en: ['Seed', 'Sprout', 'Small plant', 'Tree'], ur: ['بیج', 'کونپل', 'چھوٹا پودا', 'درخت'] };
const MATCH_L = { en: ['Cow', 'Hen', 'Bee', 'Sheep'], ur: ['گائے', 'مرغی', 'شہد کی مکھی', 'بھیڑ'] };
const MATCH_R = { en: ['milk', 'eggs', 'honey', 'wool'], ur: ['دودھ', 'انڈے', 'شہد', 'اون'] };

// One figure spec per kind the quiz's figure engine accepts (its manifest's minimal specs; synthetic labels).
let FIGS = null;
function figureSpecs() {
  if (FIGS) return FIGS;
  // eslint-disable-next-line global-require
  const manifest = require('../../../bot/vendor/lp-v9/diagrams/types_manifest.json');
  // eslint-disable-next-line global-require
  const { ALLOWED_TYPES } = require('../../../bot/shared/services/quiz/transcript-quiz-figure');
  const list = Array.isArray(manifest) ? manifest : manifest.types;
  FIGS = ALLOWED_TYPES.map((t) => {
    const e = list.find((x) => x.type === t);
    return { type: t, spec: e ? e.minimal_spec : { type: t } };
  });
  return FIGS;
}

const qid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A row with text options. */
function textRow(lang, { n = 3, stem, opts, key, why, fb = true, correct } = {}) {
  const t = TEXT[lang];
  const o = (opts || t.opts).slice(0, n);
  const row = { question_text: stem || t.stem, correct_option: correct || key || t.key, explanation: why === undefined ? t.why : why, media: { language: lang } };
  SLOTS.forEach((s, i) => { row[`option_${s.toLowerCase()}`] = o[i] == null ? null : o[i]; });
  if (fb) {
    const wrong = {};
    o.forEach((_, i) => { if (t.fb[i]) wrong[String(i)] = t.fb[i]; });
    row.option_feedback = { correct: '', wrong };
  }
  return row;
}

/** A SCHEMA_v2 web item in the shape web-quiz-items.normaliseItem builds. */
function webItem(row, type, extra = {}) {
  const lang = row.media.language;
  const opts = [row.option_a, row.option_b, row.option_c, row.option_d].filter((x) => x != null && String(x).trim());
  const options = extra.options || opts.map((text, i) => ({ slot: SLOTS[i], text, name: text }));
  return {
    v: 2, type, stem: extra.stem || row.question_text, options,
    key: extra.key || row.correct_option, why: extra.why === undefined ? row.explanation : extra.why, fb_right: null,
    read: { stem: (extra.stem || row.question_text).replace(/\$/g, ''), opts: options.map((o) => o.name || o.text) },
    wa: { from: ['order', 'match', 'tf', 'label'].includes(type) ? 'projected' : 'same' },
    source: { kind: 'transcript', quote: 'synthetic', at: null },
    grade_fit: { band: '3-5', reading: 'early' },
    ...(extra.left ? { left: extra.left } : {}),
    ...(extra.figure ? { figure: extra.figure } : {}),
    ...(extra.hint ? { hint: extra.hint } : {}),
    lang,
  };
}

// ─── mutations ────────────────────────────────────────────────────────────────
// Each returns the row's text parts for a language; a shape applies the ones that make sense for it.
const MUT = {
  n2: (lang) => ({ n: 2 }),
  n3: (lang) => ({ n: 3 }),
  n4: (lang) => ({ n: 4 }),
  long_stem: (lang) => ({ stem: TEXT[lang].longStem }),
  long_option: (lang) => ({ opts: TEXT[lang].longOpt, n: 3 }),
  math: (lang) => ({ stem: MATH.common[lang].stem, opts: MATH.common[lang].opts, why: MATH.common[lang].why, n: 4, key: 'A', fb: false }),
  math_rare: (lang) => ({ stem: MATH.rare[lang].stem, opts: MATH.rare[lang].opts, why: MATH.rare[lang].why, n: 4, key: 'A', fb: false }),
  empty_why: (lang) => ({ why: '', fb: false }),
  latin_in_urdu: (lang) => ({ stem: TEXT[lang].latin, opts: lang === 'ur' ? ['پتھر', 'Milk (دودھ)', 'ہوا'] : undefined }),
  rtl_number: (lang) => ({ opts: TEXT[lang].num, n: 4 }),
  hint: (lang) => ({ hint: true }),
};
const TEXT_MUTS = ['n2', 'n3', 'n4', 'long_stem', 'long_option', 'math', 'math_rare', 'empty_why', 'latin_in_urdu', 'rtl_number', 'hint'];

// ─── shapes ───────────────────────────────────────────────────────────────────
const SHAPES = [
  // Rows with no web item — the only path production plays today (media.web is written only with web_quiz_items_v2 on).
  { id: 'row_text', muts: TEXT_MUTS.filter((m) => m !== 'hint'), build: (lang, m) => textRow(lang, m) },
  { id: 'row_multi', muts: ['n4', 'long_option', 'math', 'empty_why'],
    build: (lang, m) => textRow(lang, { n: 4, stem: TEXT[lang].multiStem, opts: TEXT[lang].multiOpts, ...m, correct: 'A,C' }) },
  { id: 'row_emoji', muts: ['n2', 'n3', 'n4'],
    build: (lang, m) => textRow(lang, { n: m.n, opts: EMOJI, stem: lang === 'ur' ? 'ان میں سے آم کون سا ہے؟' : 'Which one is a MANGO?', key: 'D', correct: m.n === 4 ? 'D' : 'A', fb: false }) },
  { id: 'row_option_images', muts: ['n2', 'n3', 'n4'],
    build: (lang, m) => { const r = textRow(lang, { n: m.n, opts: ['1. Table', '2. Chair', 'Picture 3', '4. Door'], fb: false, correct: 'A' }); r.media.option_images = ['oa', 'ob', 'oc', 'od'].slice(0, m.n); return r; } },
  { id: 'row_question_image', muts: ['n3', 'missing_figure'],
    build: (lang, m) => { const r = textRow(lang, { n: 3, stem: lang === 'ur' ? 'تصویر میں کون سی چیز مائع ہے؟' : 'Look at the picture. Which thing is a liquid?' }); r.media.question_image = m.missing ? 'missing-key' : 'qimg'; return r; } },
  { id: 'row_figure_undrawable', muts: ['no_image', 'with_image'],
    build: (lang, m) => { const r = textRow(lang, { n: 3 }); r.media.figure = { type: 'count_objects', picto: 'no_such_pictogram', count: 7 }; if (m.withImage) r.media.question_image = 'qimg'; return r; } },
  { id: 'row_match_figure', muts: ['n3', 'n4'],
    build: (lang, m) => {
      const n = m.n || 3;
      const codes = n === 3 ? ['A-1, B-2, C-3', 'A-2, B-1, C-3', 'A-3, B-2, C-1'] : ['A-1, B-2, C-3, D-4', 'A-2, B-1, C-4, D-3', 'A-4, B-3, C-2, D-1'];
      const r = textRow(lang, { n: 3, opts: codes, stem: lang === 'ur' ? 'ہر جانور کو اس کی چیز سے ملائیں۔' : 'Match each animal to what it gives us.', correct: 'A', fb: false });
      r.media.figure = { type: 'match', left: MATCH_L.en.slice(0, n).map((w) => ({ picto: w.toLowerCase() })), right: MATCH_R[lang].slice(0, n).map((w) => ({ text: w })) };
      return r;
    } },
  { id: 'row_stim', muts: ['n2', 'n3'],
    build: (lang, m) => { const r = textRow(lang, { n: m.n, opts: GLYPHS[lang], stem: lang === 'ur' ? 'یہ کس کی آواز ہے؟' : 'Which sound is this?', correct: 'A', fb: false }); r.media.stimulus_audio = 'stim'; return r; },
    audio: true },
  ...['word_blank'].map((t) => ({ id: 'row_word_blank', muts: ['n3'],
    build: (lang) => { const r = textRow(lang, { n: 3, opts: lang === 'ur' ? ['ا', 'ب', 'ت'] : ['a', 'o', 'u'], stem: lang === 'ur' ? 'خالی جگہ میں کون سا حرف آئے گا؟' : 'Which letter fills the gap?', correct: 'A', fb: false }); r.media.figure = { type: t, word: lang === 'ur' ? 'آم' : 'cat', blanks: [1], picto: lang === 'ur' ? 'mango' : 'cat' }; return r; } })),

  // Web items (SCHEMA_v2 media.web).
  { id: 'web_single', muts: TEXT_MUTS, build: (lang, m) => { const r = textRow(lang, m); r.media.web = webItem(r, 'single', { hint: m.hint ? { text: TEXT[lang].hint } : null }); return r; } },
  { id: 'web_multi', muts: ['n4', 'long_option', 'math'],
    build: (lang, m) => { const r = textRow(lang, { n: 4, stem: TEXT[lang].multiStem, opts: TEXT[lang].multiOpts, ...m, correct: 'A,C' }); r.media.web = webItem(r, 'multi', { key: 'A,C' }); return r; } },
  { id: 'web_picture', muts: ['n2', 'n3', 'n4', 'bad_pictogram', 'hint'],
    build: (lang, m) => {
      const n = m.n || 3;
      const r = textRow(lang, { n, opts: PICS[lang], stem: lang === 'ur' ? 'ان میں سے آم کون سا ہے؟' : 'Which one is a mango?', correct: 'A', fb: false });
      const options = PICS[lang].slice(0, n).map((text, i) => ({ slot: SLOTS[i], text, name: text, pic: { kind: 'pictogram', name: m.badPic && i === 1 ? 'no_such_pictogram' : PICTO[i] } }));
      r.media.web = webItem(r, 'picture', { options, hint: m.hint ? { text: TEXT[lang].hint } : null });
      return r;
    } },
  { id: 'web_listen', muts: ['n3', 'n4', 'bad_pictogram'],
    build: (lang, m) => {
      const n = m.n || 3;
      const r = textRow(lang, { n, opts: PICS[lang], stem: lang === 'ur' ? 'آم کون سا ہے؟' : 'Which one is a mango?', correct: 'A', fb: false });
      const options = PICS[lang].slice(0, n).map((text, i) => ({ slot: SLOTS[i], text, name: text, pic: { kind: 'pictogram', name: m.badPic && i === 1 ? 'no_such_pictogram' : PICTO[i] } }));
      r.media.web = webItem(r, 'listen', { options });
      return r;
    } },
  { id: 'web_glyph', muts: ['n2', 'n3', 'n4'],
    build: (lang, m) => {
      const n = m.n || 3;
      const r = textRow(lang, { n, opts: GLYPHS[lang], stem: lang === 'ur' ? 'حرف «ب» کون سا ہے؟' : 'Which letter is "b"?', correct: 'A', fb: false });
      const options = GLYPHS[lang].slice(0, n).map((text, i) => ({ slot: SLOTS[i], text, name: text, pic: { kind: 'glyph', text } }));
      r.media.web = webItem(r, 'picture', { options });
      return r;
    } },
  { id: 'web_order', muts: ['n3', 'n4', 'long_option', 'math', 'hint'],
    build: (lang, m) => {
      const n = m.n === 4 || m.math ? 4 : 3;
      const words = m.math ? ['$\\frac{1}{4}$', '$\\frac{1}{2}$', '$\\frac{3}{4}$', '$1$'] : m.long ? TEXT[lang].longOpt.slice(0, 3) : ORDER[lang].slice(0, n);
      const r = textRow(lang, { n: 3 });
      const options = words.map((text, i) => ({ slot: SLOTS[i], text, name: text }));
      const key = n === 4 ? 'B,D,A,C' : 'B,C,A';
      const shuffled = key.split(',').map((s) => options[SLOTS.indexOf(s)]);
      const opts = shuffled.map((o, i) => ({ ...o, slot: SLOTS[i] }));
      const k = options.map((o) => SLOTS[shuffled.indexOf(o)]).join(',');
      r.media.web = webItem(r, 'order', { stem: lang === 'ur' ? 'انہیں درست ترتیب میں رکھیں۔' : 'Put these in the right order.', options: opts, key: k, why: lang === 'ur' ? 'پہلے بیج، پھر پودا۔' : 'First the seed, then the plant.', hint: m.hint ? { text: TEXT[lang].hint } : null });
      return r;
    } },
  { id: 'web_match', muts: ['n3', 'n4', 'long_option', 'math', 'hint'],
    build: (lang, m) => {
      const n = m.n === 4 || m.math ? 4 : 3;
      const left = (m.math ? ['$\\frac{1}{2}$', '$\\frac{1}{4}$', '$\\frac{3}{4}$', '$1$'] : MATCH_L[lang]).slice(0, n).map((text) => ({ text }));
      const right = (m.math ? ['$0.5$', '$0.25$', '$0.75$', '$1.0$'] : m.long ? TEXT[lang].longOpt : MATCH_R[lang]).slice(0, n);
      const perm = n === 4 ? [2, 0, 3, 1] : [2, 0, 1];
      const options = perm.map((j, i) => ({ slot: SLOTS[i], text: right[j], name: right[j] }));
      const key = left.map((_, i) => SLOTS[perm.indexOf(i)]).join(',');
      const r = textRow(lang, { n: 3 });
      r.media.web = webItem(r, 'match', { stem: lang === 'ur' ? 'ہر ایک کا جوڑا ملائیں۔' : 'Match each one to its pair.', options, left, key, why: lang === 'ur' ? 'گائے دودھ دیتی ہے۔' : 'A cow gives us milk.', hint: m.hint ? { text: TEXT[lang].hint } : null });
      return r;
    } },
  { id: 'web_tf', muts: ['n2'],
    build: (lang) => {
      const r = textRow(lang, { n: 2, opts: lang === 'ur' ? ['درست', 'غلط'] : ['True', 'False'], stem: lang === 'ur' ? 'دودھ ایک مائع ہے۔' : 'Milk is a liquid.', correct: 'A', fb: false });
      r.media.web = webItem(r, 'tf');
      return r;
    } },
  { id: 'web_label', muts: ['n3'],
    build: (lang) => {
      const r = textRow(lang, { n: 3, opts: lang === 'ur' ? ['جڑ', 'تنا', 'پتا'] : ['root', 'stem', 'leaf'], stem: lang === 'ur' ? 'پتا کہاں ہے؟' : 'Where is the leaf?', correct: 'C', fb: false });
      const spec = { type: 'fraction_bar', bars: [{ parts: 3, shaded: 1 }] };
      r.media.web = webItem(r, 'label', { figure: { spec, hotspots: [{ slot: 'A', x: 100, y: 60, r: 30 }, { slot: 'B', x: 300, y: 60, r: 30 }, { slot: 'C', x: 500, y: 60, r: 30 }] } });
      return r;
    } },
];

// Every figure kind the engine accepts, on a plain question.
function figureShapes() {
  return figureSpecs().map(({ type, spec }) => ({
    id: `fig_${type}`, muts: ['n3'],
    build: (lang) => { const r = textRow(lang, { n: 3 }); r.media.figure = spec; return r; },
  }));
}

const MUT_FLAGS = {
  missing_figure: { missing: true }, no_image: {}, with_image: { withImage: true }, bad_pictogram: { badPic: true },
};

/** Every case: { id, shape, mut, lang, row, audio }. */
function cases({ only } = {}) {
  const out = [];
  let n = 0;
  for (const s of [...SHAPES, ...figureShapes()]) {
    if (only && !only.test(s.id)) continue;
    for (const mut of s.muts) {
      for (const lang of LANGS) {
        const m = { ...(MUT[mut] ? MUT[mut](lang) : {}), ...(MUT_FLAGS[mut] || {}) };
        if (mut === 'long_option') m.long = true;
        if (mut === 'math' || mut === 'math_rare') m.math = true;
        if (mut === 'latin_in_urdu' && lang === 'en') continue; // Latin inside Urdu: an Urdu case only
        n += 1;
        const row = s.build(lang, m);
        row.id = qid(n);
        row.external_id = `rm:${s.id}:${mut}`;
        if (m.hint && row.media.web && !row.media.web.hint) row.media.web.hint = { text: TEXT[lang].hint };
        const audio = s.audio ? { [row.id]: { stim: '/rm/stim.ogg' } } : null;
        out.push({ id: `${s.id}.${mut}.${lang}`, shape: s.id, mut, lang, row, audio });
      }
    }
  }
  return out;
}

module.exports = { cases, SHAPES, MUT, TEXT, LANGS, figureSpecs };
