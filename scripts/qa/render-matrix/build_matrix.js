#!/usr/bin/env node
'use strict';
/**
 * RENDER MATRIX — generator. Every item SHAPE the web quiz engine can emit, built as
 * quiz_questions rows, turned into page items by the REAL bot code (web-quiz.service
 * questionPayload: figures drawn by the lp-v9 engine, picture options drawn, web items
 * read from media.web), and wrapped in the REAL page shell (dashboard renderQuizPage).
 *
 * The shapes come from the code, not from a hand list:
 *   - every figure kind in vendor/lp-v9/diagrams/types_manifest.json (its minimal_spec),
 *   - every web item type in web-quiz-items (single, picture, listen, multi, tf, order,
 *     match, label),
 *   - × mutations: 2–4 options (the schema's option_a..d; 5–6 cannot be stored), long
 *     stems and options, maths $…$ in stem / options / why, picture options with a
 *     pictogram that does not exist, glyph tiles, emoji options, a figure that cannot be
 *     drawn, a hidden picture, an empty why — in English and in Urdu.
 *
 * Each page is a two-question quiz: question 1 is a plain filler the runner marks as
 * answered (so the page RESUMES straight into question 2, with no identity screens),
 * question 2 is the shape under test.
 *
 * Usage: node build_matrix.js <outDir> [--extra <specs.json>]
 *   writes <outDir>/pages/<id>.html and <outDir>/manifest.json
 *   --extra: a JSON list of {id, lang, figure} real figure specs to add (kept private).
 * Synthetic content only. Needs no network, no database.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'render-matrix';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const WebQuiz = require(path.join(ROOT, 'bot/shared/services/quiz/web-quiz.service'));
const { renderQuizPage } = require(path.join(ROOT, 'dashboard/routes/web-quiz.routes'));
const MANIFEST = require(path.join(ROOT, 'bot/vendor/lp-v9/diagrams/types_manifest.json'));

const LANGS = ['en', 'ur'];
const W = {
  en: {
    stem: 'Which of these is a fruit?',
    opts: ['Apple', 'Chair', 'Pencil', 'Shoe'],
    why: 'An apple grows on a tree and we can eat it.',
    long: 'Read this carefully before you answer: the children in the class planted seeds in small pots, watered them every morning, put some pots in the sun and some in a dark cupboard, and after two weeks they looked again to see which seeds had grown tall and green. Which pots grew best?',
    longOpt: ['The pots that stayed in the sunny place by the window every single day', 'The pots that were kept in the dark cupboard with the door closed', 'The pots that were never watered at all during the two weeks', 'All of the pots grew exactly the same in every way'],
    fig: 'Look at the picture. What does it show?',
    tf: ['True', 'False'],
    order: ['Plant the seed', 'Water the seed', 'A small shoot grows', 'The plant flowers'],
    left: ['cat', 'dog', 'cow', 'duck'], right: ['meow', 'woof', 'moo', 'quack'],
  },
  ur: {
    stem: 'ان میں سے کون سا پھل ہے؟',
    opts: ['سیب', 'کرسی', 'پنسل', 'جوتا'],
    why: 'سیب درخت پر اگتا ہے اور ہم اسے کھاتے ہیں۔',
    long: 'غور سے پڑھیں: کلاس کے بچوں نے چھوٹے گملوں میں بیج بوئے، ہر صبح پانی دیا، کچھ گملے دھوپ میں رکھے اور کچھ اندھیری الماری میں، اور دو ہفتوں کے بعد دوبارہ دیکھا کہ کون سے بیج لمبے اور ہرے ہو گئے ہیں۔ ان میں سے کون سے گملوں میں پودے سب سے اچھے اگے؟ اپنا جواب سوچ کر چنیں۔',
    longOpt: ['وہ گملے جو ہر روز کھڑکی کے پاس دھوپ والی جگہ پر رکھے گئے', 'وہ گملے جو بند دروازے والی اندھیری الماری میں رکھے گئے', 'وہ گملے جنہیں دو ہفتوں میں بالکل پانی نہیں دیا گیا', 'سب گملوں میں پودے بالکل ایک جیسے اگے'],
    fig: 'تصویر کو دیکھیں۔ اس میں کیا دکھایا گیا ہے؟',
    tf: ['درست', 'غلط'],
    order: ['بیج بوئیں', 'بیج کو پانی دیں', 'چھوٹا پودا نکلتا ہے', 'پودے پر پھول آتے ہیں'],
    left: ['بلی', 'کتا', 'گائے', 'بطخ'], right: ['میاؤں', 'بھوں بھوں', 'ماں', 'قیں قیں'],
  },
};
const MATH = {
  stem: 'What is $\\frac{3}{4} + \\frac{1}{4}$? And $12 \\times 3$?',
  opts: ['$1$', '$\\frac{4}{8}$', '$36$', '$x^2 = 16$'],
  why: 'Add the tops: $3 + 1 = 4$, so $\\frac{4}{4} = 1$; and $12 \\times 3 = 36$.',
};

let seq = 0;
const uid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

function row(lang, over = {}) {
  const w = W[lang];
  return {
    id: uid(), external_id: null, sort_order: 2, render_pattern: null,
    question_text: w.stem, option_a: w.opts[0], option_b: w.opts[1], option_c: w.opts[2], option_d: null,
    correct_option: 'A', explanation: w.why,
    option_feedback: { correct: '', wrong: {} },
    media: { language: lang },
    ...over,
  };
}
const webItem = (over) => ({ v: 2, wa: { from: 'projected' }, source: { kind: 'transcript', quote: 'x' }, ...over });

function shapes(lang) {
  const w = W[lang];
  const out = [];
  const add = (id, r, note) => out.push({ id: `${lang}-${id}`, lang, note: note || id, row: r });

  add('single-3', row(lang));
  add('single-2', row(lang, { option_c: null }));
  add('single-4', row(lang, { option_d: w.opts[3] }));
  add('long-stem', row(lang, { question_text: w.long }));
  add('long-options-4', row(lang, { option_a: w.longOpt[0], option_b: w.longOpt[1], option_c: w.longOpt[2], option_d: w.longOpt[3] }));
  add('long-stem-long-options', row(lang, { question_text: w.long, option_a: w.longOpt[0], option_b: w.longOpt[1], option_c: w.longOpt[2], option_d: w.longOpt[3] }));
  add('maths', row(lang, {
    question_text: MATH.stem, option_a: MATH.opts[0], option_b: MATH.opts[1], option_c: MATH.opts[2], option_d: MATH.opts[3], explanation: MATH.why,
  }));
  add('multi', row(lang, { option_d: w.opts[3], correct_option: 'A,C' }));
  add('empty-why', row(lang, { explanation: '' }));
  add('emoji-options', row(lang, { option_a: '🍎', option_b: '🪑', option_c: '✏️', option_d: '👟' }));
  // picture options from the web item (a pictogram; one that does not exist stays a word)
  add('picture-3', row(lang, {
    media: {
      language: lang,
      web: webItem({
        type: 'picture', stem: w.stem, wa: { from: 'same' }, key: 'A',
        options: [{ slot: 'A', text: w.opts[0], name: w.opts[0], pic: { kind: 'pictogram', name: 'apple' } },
          { slot: 'B', text: w.opts[1], name: w.opts[1], pic: { kind: 'pictogram', name: 'chair' } },
          { slot: 'C', text: w.opts[2], name: w.opts[2], pic: { kind: 'pictogram', name: 'pencil' } }],
      }),
    },
  }));
  add('picture-missing-pictogram', row(lang, {
    media: {
      language: lang,
      web: webItem({
        type: 'picture', stem: w.stem, wa: { from: 'same' }, key: 'A',
        options: [{ slot: 'A', text: w.opts[0], name: w.opts[0], pic: { kind: 'pictogram', name: 'apple' } },
          { slot: 'B', text: w.opts[1], name: w.opts[1], pic: { kind: 'pictogram', name: 'no_such_pictogram_xyz' } },
          { slot: 'C', text: w.opts[2], name: w.opts[2], pic: { kind: 'pictogram', name: 'pencil' } }],
      }),
    },
  }));
  const glyphs = lang === 'ur' ? ['بّ', 'بِ', 'بُ'] : ['c_t', 'b', 'd'];
  add('glyph-tiles', row(lang, {
    option_a: glyphs[0], option_b: glyphs[1], option_c: glyphs[2],
    media: {
      language: lang,
      web: webItem({
        type: 'picture', stem: w.stem, wa: { from: 'same' }, key: 'A',
        options: glyphs.map((g, i) => ({ slot: 'ABC'[i], text: g, name: g, pic: { kind: 'glyph', text: g } })),
      }),
    },
  }));
  add('listen', row(lang, {
    media: {
      language: lang,
      web: webItem({
        type: 'listen', stem: w.stem, wa: { from: 'same' }, key: 'A',
        options: [{ slot: 'A', text: w.opts[0], name: w.opts[0], pic: { kind: 'pictogram', name: 'apple' } },
          { slot: 'B', text: w.opts[1], name: w.opts[1], pic: { kind: 'pictogram', name: 'chair' } },
          { slot: 'C', text: w.opts[2], name: w.opts[2], pic: { kind: 'pictogram', name: 'pencil' } }],
      }),
    },
  }));
  add('tf', row(lang, { media: { language: lang, web: webItem({ type: 'tf', stem: w.stem, key: 'A', why: w.why, options: w.tf.map((t, i) => ({ slot: 'AB'[i], text: t })) }) } }));
  [3, 4].forEach((n) => {
    add(`order-${n}`, row(lang, {
      media: {
        language: lang,
        web: webItem({ type: 'order', stem: w.stem, key: 'ABCD'.slice(0, n).split('').join(','), why: w.why, options: w.order.slice(0, n).map((t, i) => ({ slot: 'ABCD'[i], text: t })) }),
      },
    }));
    add(`match-${n}`, row(lang, {
      media: {
        language: lang,
        web: webItem({
          type: 'match', stem: w.stem, key: 'ABCD'.slice(0, n).split('').join(','), why: w.why,
          left: w.left.slice(0, n).map((t) => ({ text: t })),
          options: w.right.slice(0, n).map((t, i) => ({ slot: 'ABCD'[i], text: t })),
        }),
      },
    }));
  });
  add('order-long', row(lang, {
    media: { language: lang, web: webItem({ type: 'order', stem: w.long, key: 'A,B,C,D', why: w.why, options: w.longOpt.map((t, i) => ({ slot: 'ABCD'[i], text: t })) }) },
  }));
  add('match-pictures', row(lang, {
    media: {
      language: lang,
      web: webItem({
        type: 'match', stem: w.stem, key: 'A,B,C', why: w.why,
        left: [{ text: 'P', pic: { kind: 'pictogram', name: 'cat' } }, { text: 'Q', pic: { kind: 'pictogram', name: 'dog' } }, { text: 'R', pic: { kind: 'pictogram', name: 'cow' } }],
        options: w.right.slice(0, 3).map((t, i) => ({ slot: 'ABC'[i], text: t })),
      }),
    },
  }));
  add('label', row(lang, {
    media: {
      language: lang,
      figure: { type: 'count_objects', count: 3, picto: 'apple' },
      web: webItem({
        type: 'label', stem: w.fig, key: 'A', why: w.why,
        options: w.opts.slice(0, 3).map((t, i) => ({ slot: 'ABC'[i], text: t })),
        figure: { spec: { type: 'count_objects', count: 3, picto: 'apple' }, hotspots: [{ slot: 'A', x: 100, y: 100, r: 40 }, { slot: 'B', x: 300, y: 100, r: 40 }, { slot: 'C', x: 500, y: 100, r: 40 }] },
      }),
    },
  }));
  // every figure kind the engine draws, from its own manifest
  (MANIFEST.types || []).forEach((t) => {
    if (!t.minimal_spec) return;
    add(`figure-${t.type}`, row(lang, { question_text: w.fig, media: { language: lang, figure: { ...t.minimal_spec, lang } } }), `figure ${t.type}`);
  });
  add('figure-word_blank-urdu-marks', row(lang, { question_text: w.fig, media: { language: lang, figure: { type: 'word_blank', word: lang === 'ur' ? 'بِلّی' : 'cat', blanks: [1], picto: 'cat', lang } } }));
  add('figure-undrawable-with-image', row(lang, { question_text: w.fig, media: { language: lang, figure: { type: 'no_such_type' }, question_image: 'img/x.png' } }), 'figure spec fails → stored PNG');
  add('figure-undrawable-no-image', row(lang, { question_text: w.stem, media: { language: lang, figure: { type: 'no_such_type' } } }), 'figure spec fails, no PNG → text only');
  add('figure-hidden', row(lang, { question_text: w.stem, media: { language: lang, figure: { type: 'count_objects', count: 3, picto: 'apple' }, picture_check: { verdict: 'contradicts' } } }), 'picture_check hides it');
  add('figure-maths-long', row(lang, {
    question_text: `${w.long} ${MATH.stem}`, option_a: MATH.opts[0], option_b: MATH.opts[1], option_c: MATH.opts[2], option_d: MATH.opts[3], explanation: MATH.why,
    media: { language: lang, figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] } },
  }));
  return out;
}

function filler(lang) {
  return row(lang, { id: uid(), sort_order: 1 });
}

function pageFor(shape, extraFigure = null) {
  const lang = shape.lang;
  const first = filler(lang);
  const r = extraFigure ? row(lang, { question_text: W[lang].fig, media: { language: lang, figure: extraFigure } }) : shape.row;
  const code = 'RM' + String(seq).padStart(4, '0').slice(-4);
  const items = [first, r].map((q, i) => WebQuiz.questionPayload(q, i, code, {}, false));
  // A label item's hotspots sit on the drawing: placed inside the box the engine actually drew.
  const f = items[1].figure;
  if (f && Array.isArray(f.hotspots) && f.w && f.h) {
    f.hotspots = f.hotspots.map((h, k) => ({ ...h, x: f.w * ((2 * k + 1) / (2 * f.hotspots.length)), y: f.h / 2, r: Math.min(f.w, f.h) / 6 }));
  }
  const payload = {
    quiz: {
      id: 'render-matrix', code, topic: lang === 'ur' ? 'پودے اور پھل' : 'Plants and fruit', lang, dir: lang === 'ur' ? 'rtl' : 'ltr',
      grade: '3', subject: 'science', n: 2, questions: items,
    },
    cls: { label: null, teacher: lang === 'ur' ? 'استاد' : 'Teacher', chips: [] },
    live: null, video: null, preview: false, brand: 'niete',
  };
  const html = renderQuizPage({ payload, code, view: 'quiz', origin: 'http://127.0.0.1', assetV: 'rm', url: `http://127.0.0.1/q/${code}` });
  return { code, html, item: items[1], fillerQid: items[0].qid };
}

function main() {
  const outDir = path.resolve(process.argv[2] || path.join(__dirname, 'out'));
  const extraIdx = process.argv.indexOf('--extra');
  const extra = extraIdx > 0 ? JSON.parse(fs.readFileSync(process.argv[extraIdx + 1], 'utf8')) : [];
  fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true });
  const manifest = [];
  const emit = (shape, fig) => {
    const p = pageFor(shape, fig);
    fs.writeFileSync(path.join(outDir, 'pages', `${shape.id}.html`), p.html);
    const it = p.item;
    manifest.push({
      id: shape.id, lang: shape.lang, note: shape.note, code: p.code, filler: p.fillerQid, qid: it.qid,
      kind: it.type || (it.multi ? 'multi' : 'single'),
      n_options: (it.options || []).length,
      has_figure: Boolean(it.figure || it.img),
      figure_type: (it.figure && it.figure.type) || null,
      maths: /\$[^$]+\$/.test([it.text, it.why, ...(it.options || []).map((o) => o.text)].join(' ')),
    });
  };
  LANGS.forEach((lang) => shapes(lang).forEach((s) => emit(s)));
  extra.forEach((e) => emit({ id: e.id, lang: e.lang, note: 'real figure spec', row: null }, e.figure));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  process.stdout.write(`render matrix: ${manifest.length} pages → ${outDir}\n`);
}

if (require.main === module) main();
module.exports = { shapes, pageFor, LANGS };
