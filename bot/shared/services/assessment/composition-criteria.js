'use strict';
/**
 * Fixed marking criteria for written compositions.
 *
 * An application, a letter, a paragraph, a story, a picture description, a
 * mind map, a flow chart or a dialogue is not marked from model output. Its
 * criteria are a fixed template, each summing to the marks FDE gives that task
 * in the 2026-27 model papers, scaled here to the question's marks. Reviewed
 * once, never invented per paper.
 *
 * English names are final copy. Every Urdu line is a draft and needs
 * fluent-Urdu review before teachers see it.
 *
 * Pure: frozen data and two lookups, never throws.
 */

const LANGUAGE_SCALE = Object.freeze({
  en: 'Full marks = only a few small mistakes; half = mistakes but the meaning is always clear; 0 = the meaning is often unclear. Do not count the same mistake twice.',
  ur: 'پورے نمبر = صرف چند معمولی غلطیاں؛ آدھے = غلطیاں ہیں مگر مطلب ہر جگہ واضح ہے؛ ۰ = مطلب اکثر واضح نہیں۔ ایک ہی غلطی پر دوبارہ نمبر نہ کاٹیں۔', // needs fluent-Urdu review
});

// A row's look_for of 'language_scale' prints the scale line in the template's language.
// The length notes are our suggestion, not FDE's; the copy says so without naming us.
const TEMPLATES = deepFreeze({
  application_en: {
    lang: 'en',
    rows: [
      { name: 'Format', marks: 3, look_for: 'To / The Principal / school + date (1) · Subject + Respected Sir/Madam (1) · Yours obediently + name, class, roll no. (1)' },
      { name: 'Content', marks: 4, look_for: 'request stated (1) · reason (1) · details (1) · polite close and thanks (1)' },
      { name: 'Language', marks: 2, look_for: 'language_scale' },
      { name: 'Neatness and length', marks: 1, look_for: 'neat, about 60–100 words (a suggestion; FDE sets no length)' },
    ],
  },
  letter_en: {
    lang: 'en',
    rows: [
      { name: 'Format', marks: 3, look_for: 'address + date (1) · Dear … (1) · Your loving … + name (1)' },
      { name: 'Content', marks: 4, look_for: 'the purpose of the letter (1) · two supporting details (2) · a friendly ending (1)' },
      { name: 'Language', marks: 2, look_for: 'language_scale' },
      { name: 'Neatness and length', marks: 1, look_for: 'neat, about 80–120 words (a suggestion)' },
    ],
  },
  paragraph_en: {
    lang: 'en',
    rows: [
      { name: 'Title or topic sentence', marks: 1 },
      { name: 'Content', marks: 5, look_for: '5 or more relevant ideas, 1 each' },
      { name: 'Language', marks: 3, look_for: 'language_scale' },
      { name: 'Neatness and length', marks: 1, look_for: 'about 8–10 sentences (a suggestion)' },
    ],
  },
  story_outline_en: {
    lang: 'en',
    rows: [
      { name: 'Title', marks: 1 },
      { name: 'Follows the outline in order (beginning, middle, end)', marks: 2 },
      { name: 'Moral', marks: 1 },
      { name: 'Language', marks: 1 },
    ],
  },
  picture_description_en: {
    lang: 'en',
    rows: [
      { name: 'Title', marks: 1 },
      { name: 'Describes what is happening', marks: 2 },
      { name: 'Uses at least 4 word-bank words correctly (½ each)', marks: 2 },
      { name: 'Language', marks: 1 },
    ],
  },
  // One row worth the whole question: 1 per idea, up to its marks.
  mind_map: {
    lang: 'en',
    rows: [
      { name: 'One different, relevant idea per box or branch', marks: 1, look_for: '1 each, up to the question\'s marks' },
    ],
  },
  flow_chart_sst: {
    lang: 'en',
    rows: [
      { name: 'Title box', marks: 1 },
      { name: 'Main boxes (4 × 1)', marks: 4 },
      { name: 'Examples under each (4 × 1)', marks: 4 },
      { name: 'Arrows in order', marks: 1 },
    ],
  },
  // Urdu rows for the Social Studies drawings (Urdu-medium paper).
  mind_map_ur_DRAFT: {
    lang: 'ur',
    rows: [
      { name: 'ہر شاخ میں ایک الگ اور متعلقہ نکتہ', marks: 1, look_for: 'ہر نکتے کا ایک نمبر، سوال کے کل نمبروں تک' }, // needs fluent-Urdu review
    ],
  },
  flow_chart_ur_DRAFT: {
    lang: 'ur',
    rows: [
      { name: 'عنوان کا خانہ', marks: 1 }, // needs fluent-Urdu review
      { name: 'بنیادی خانے (4 × 1)', marks: 4 }, // needs fluent-Urdu review
      { name: 'ہر خانے کے نیچے مثال (4 × 1)', marks: 4 }, // needs fluent-Urdu review
      { name: 'تیر درست ترتیب میں', marks: 1 }, // needs fluent-Urdu review
    ],
  },
  picture_description_ur_DRAFT: {
    lang: 'ur',
    rows: [
      { name: 'عنوان', marks: 1 }, // needs fluent-Urdu review
      { name: 'تصویر کا بیان', marks: 4 }, // needs fluent-Urdu review
      { name: 'مددگار الفاظ کا درست استعمال (ہر لفظ ½)', marks: 3 }, // needs fluent-Urdu review
      { name: 'زبان', marks: 1 }, // needs fluent-Urdu review
      { name: 'صفائی', marks: 1 }, // needs fluent-Urdu review
    ],
  },
  paragraph_ur_DRAFT: {
    lang: 'ur',
    rows: [
      { name: 'عنوان یا ابتدائی جملہ', marks: 1 }, // needs fluent-Urdu review
      { name: 'مواد', marks: 5 }, // needs fluent-Urdu review
      { name: 'زبان', marks: 3 }, // needs fluent-Urdu review
      { name: 'صفائی اور طوالت', marks: 1 }, // needs fluent-Urdu review
    ],
  },
  dialogue_ur_DRAFT: {
    lang: 'ur',
    rows: [
      { name: 'شکل: بولنے والے کا نام، ہر بات نئی سطر میں', marks: 2 }, // needs fluent-Urdu review
      { name: 'مواد: کم از کم آٹھ باتیں اور نتیجہ', marks: 5 }, // needs fluent-Urdu review
      { name: 'زبان', marks: 2 }, // needs fluent-Urdu review
      { name: 'صفائی', marks: 1 }, // needs fluent-Urdu review
    ],
  },
  story_ur_DRAFT: {
    lang: 'ur',
    rows: [
      { name: 'کہانی کی ترتیب: آغاز، درمیان، انجام', marks: 5 }, // needs fluent-Urdu review
      { name: 'نتیجہ', marks: 2 }, // needs fluent-Urdu review
      { name: 'زبان', marks: 2 }, // needs fluent-Urdu review
      { name: 'صفائی اور طوالت', marks: 1 }, // needs fluent-Urdu review
    ],
  },
  letter_ur_DRAFT: {
    lang: 'ur',
    rows: [
      { name: 'شکل: مقام و تاریخ، القاب و آداب، اختتام', marks: 3 }, // needs fluent-Urdu review
      { name: 'مواد', marks: 4 }, // needs fluent-Urdu review
      { name: 'زبان', marks: 2 }, // needs fluent-Urdu review
      { name: 'صفائی', marks: 1 }, // needs fluent-Urdu review
    ],
  },
  application_ur_DRAFT: {
    lang: 'ur',
    rows: [
      { name: 'شکل: بخدمت، عنوان، جنابِ عالی، اختتام', marks: 3 }, // needs fluent-Urdu review
      { name: 'مواد', marks: 4 }, // needs fluent-Urdu review
      { name: 'زبان', marks: 2 }, // needs fluent-Urdu review
      { name: 'صفائی', marks: 1 }, // needs fluent-Urdu review
    ],
  },
});

// Which template a kind uses in each language. A missing side falls back to the other.
const KIND_TEMPLATES = deepFreeze({
  application: { en: 'application_en', ur: 'application_ur_DRAFT' },
  letter: { en: 'letter_en', ur: 'letter_ur_DRAFT' },
  paragraph: { en: 'paragraph_en', ur: 'paragraph_ur_DRAFT' },
  story_outline: { en: 'story_outline_en', ur: null },
  story_title: { en: null, ur: 'story_ur_DRAFT' },
  story_opening: { en: null, ur: 'story_ur_DRAFT' },
  picture_description: { en: 'picture_description_en', ur: 'picture_description_ur_DRAFT' },
  mind_map: { en: 'mind_map', ur: 'mind_map_ur_DRAFT' },
  flow_chart: { en: 'flow_chart_sst', ur: 'flow_chart_ur_DRAFT' },
  dialogue: { en: null, ur: 'dialogue_ur_DRAFT' },
});

// A slot with no `kinds` is read by its type.
const TYPE_KINDS = Object.freeze({
  'Mind Map': 'mind_map',
  'Flow Chart': 'flow_chart',
  'Picture Description': 'picture_description',
  'Paragraph Writing': 'paragraph',
  'Story Writing': 'story_outline',
  'Application Writing': 'application',
  'Letter Writing': 'letter',
});

const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

function deepFreeze(node) {
  if (node && typeof node === 'object' && !Object.isFrozen(node)) {
    Object.freeze(node);
    Object.values(node).forEach(deepFreeze);
  }
  return node;
}

function roundHalf(x) {
  return Math.round(x * 2) / 2;
}

function isUrdu(lang) {
  return typeof lang === 'string' && /^ur(du)?$/i.test(lang.trim());
}

function lookFor(row, lang) {
  if (row.look_for === 'language_scale') return LANGUAGE_SCALE[lang];
  return row.look_for || null;
}

/** The row that takes the rounding difference: Content / مواد, else the largest. */
function balancingRow(rows) {
  const content = rows.findIndex((r) => r.name === 'Content' || r.name === 'مواد' || r.name.startsWith('مواد:')); // needs fluent-Urdu review
  if (content !== -1) return content;
  return rows.reduce((best, r, i) => (r.marks > rows[best].marks ? i : best), 0);
}

/**
 * The criteria rows for one composition: [{ name, marks, look_for }], summing
 * to `marks` exactly. Each template row is scaled by marks / template total and
 * rounded to the nearest half; any difference goes on the balancing row. A mind
 * map is one row worth the whole question. Unknown kind or bad marks → [].
 */
function criteriaFor(kind, marks, lang) {
  try {
    if (!has(KIND_TEMPLATES, kind)) return [];
    if (typeof marks !== 'number' || !Number.isFinite(marks) || marks <= 0) return [];
    const sides = KIND_TEMPLATES[kind];
    const key = isUrdu(lang) ? (sides.ur || sides.en) : (sides.en || sides.ur);
    const template = TEMPLATES[key];
    if (!template) return [];

    if (key === 'mind_map' || key === 'mind_map_ur_DRAFT') {
      const row = template.rows[0];
      return [{ name: row.name, marks, look_for: lookFor(row, template.lang) }];
    }

    const total = template.rows.reduce((t, r) => t + r.marks, 0);
    const rows = template.rows.map((r) => ({
      name: r.name,
      marks: roundHalf((r.marks * marks) / total),
      look_for: lookFor(r, template.lang),
    }));
    const diff = marks - rows.reduce((t, r) => t + r.marks, 0);
    if (diff !== 0) rows[balancingRow(rows)].marks += diff;
    return rows;
  } catch (err) {
    return [];
  }
}

/** The composition kind of a slot's item at `index`: slot.kinds first, then its type; else null. */
function kindFor(slot, index) {
  try {
    if (!slot || typeof slot !== 'object') return null;
    const kinds = slot.kinds;
    if (Array.isArray(kinds) && Number.isInteger(index) && index >= 0 && index < kinds.length
      && typeof kinds[index] === 'string') {
      return kinds[index];
    }
    return has(TYPE_KINDS, slot.type) ? TYPE_KINDS[slot.type] : null;
  } catch (err) {
    return null;
  }
}

module.exports = { criteriaFor, kindFor };
