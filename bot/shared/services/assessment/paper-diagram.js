'use strict';
/**
 * bd-ipoxhx.10 — the figure a regular paper DRAWS for a Mind Map, Flow Chart or Label the Diagram
 * question (AG sheet row 27, Rabia: "mind maps and flowcharts should be drawn, not instructions";
 * "picture labelling in Science").
 *
 * The model writes a small `diagram` object on the question; this module turns it into an SVG with
 * the vendored lp-v9 diagram engine (deterministic, no image model) and blanks for the child to fill:
 *
 *   Mind Map          { centre: "Plant", branches: ["Root", "", "Leaf", ""] }   "" = a blank bubble
 *   Flow Chart        { steps: ["Seed", "", "Young plant", ""] }                "" = a blank box
 *   Label the Diagram { figure: "plant_cell" }                                  one of FIGURES
 *
 * A Label the Diagram answer key comes from the figure, never from the model, so it always matches
 * the numbers printed on the drawing. Anything this module cannot draw returns null, and the paper
 * prints the question as text with ruled lines, as it did before.
 */

const { renderDiagram } = require('../../../vendor/lp-v9/diagrams');
const { svgFor } = require('./fde-picture-svg');

const BLANK = '________';
const MAX_NODES = 8;

const hasUrdu = (s) => /[؀-ۿ]/.test(String(s ?? ''));
const words = (list) => (Array.isArray(list) ? list : []).slice(0, MAX_NODES).map((x) => String(x ?? '').trim());

/** The vendored engine's own label words for the cell and leaf figures (bio_schematic LABELS). */
const ENGINE_WORDS = {
  en: { wall: 'cell wall', membrane: 'cell membrane', cytoplasm: 'cytoplasm', nucleus: 'nucleus',
    vacuole: 'central vacuole', chloroplast: 'chloroplast', mitochondrion: 'mitochondrion',
    palisade: 'palisade mesophyll', spongy: 'spongy mesophyll', xylem: 'xylem', phloem: 'phloem', stoma: 'stoma' },
  ur: { wall: 'خلوی دیوار', membrane: 'خلوی جھلی', cytoplasm: 'سائٹوپلازم', nucleus: 'مرکزہ',
    vacuole: 'ویکیوول', chloroplast: 'کلوروپلاسٹ', mitochondrion: 'مائٹوکونڈریا',
    palisade: 'عمودی خلیے', spongy: 'اسفنجی خلیے', xylem: 'زائلم', phloem: 'فلوئم', stoma: 'منفذ' },
};

/** A bio_schematic figure whose named parts print as "1. ________", "2. ________", … */
function engineFigure(spec, parts) {
  return {
    answers: (lang) => parts.map((p) => ENGINE_WORDS[lang][p]),
    draw: (lang) => renderDiagram({ ...spec, lang,
      labelText: Object.fromEntries(parts.map((p, i) => [p, `${i + 1}. ${BLANK}`])) }),
  };
}

// The FDE plant's three blank lines, top to bottom (fde-picture-svg PLANT_BLANKS: y 62/118/200 at x 206).
const PLANT_NUMBERS = [56, 112, 194].map((y, i) => `<text x="208" y="${y}" font-size="13" font-family="sans-serif">${i + 1}.</text>`);
const PLANT_WORDS = { en: ['leaf', 'stem', 'root'], ur: ['پتا', 'تنا', 'جڑ'] };

/** Every figure a Label the Diagram question may name. The key is what the model writes. */
const FIGURES = {
  plant: {
    answers: (lang) => PLANT_WORDS[lang],
    draw: () => svgFor({ kind: 'plant' }).replace('</svg>', `${PLANT_NUMBERS.join('')}</svg>`),
  },
  plant_cell: engineFigure({ type: 'cell', kind: 'plant', parts: ['wall', 'membrane', 'cytoplasm', 'nucleus', 'vacuole', 'chloroplast'] },
    ['wall', 'membrane', 'cytoplasm', 'nucleus', 'vacuole', 'chloroplast']),
  animal_cell: engineFigure({ type: 'cell', kind: 'animal', parts: ['membrane', 'cytoplasm', 'nucleus', 'mitochondrion'] },
    ['membrane', 'cytoplasm', 'nucleus', 'mitochondrion']),
  leaf_cross_section: engineFigure({ type: 'leaf_cross_section' }, ['palisade', 'spongy', 'xylem', 'phloem', 'stoma']),
};

const FIGURE_HINTS = {
  plant: 'a flowering plant: leaf, stem, root',
  plant_cell: 'a plant cell',
  animal_cell: 'an animal cell',
  leaf_cross_section: 'a leaf cut across (grades 6+)',
};

function mindMap(d) {
  const branches = words(d && d.branches);
  const centre = String((d && d.centre) ?? '').trim();
  if (!centre || branches.length < 2 || !branches.some(Boolean)) return null;
  return renderDiagram({ type: 'mindmap', lang: hasUrdu(centre) ? 'ur' : 'en', centre: { label: centre },
    branches: branches.map((b) => ({ label: b || BLANK })) });
}

function flowChart(d) {
  const steps = words(d && d.steps);
  if (steps.length < 2 || !steps.some(Boolean)) return null;
  return renderDiagram({ type: 'flow', lang: steps.some(hasUrdu) ? 'ur' : 'en', direction: 'lr',
    steps: steps.map((s) => ({ title: s || BLANK })) });
}

/**
 * What to print for this question: { svg, bank, answer } or null to print it as text.
 * `bank` is a word bank (Label the Diagram only); `answer` replaces the model's answer in the key.
 */
function figureFor(type, question, { rtl = false } = {}) {
  const d = question && typeof question === 'object' ? question.diagram : null;
  if (!d || typeof d !== 'object') return null;
  try {
    if (type === 'Mind Map') { const svg = mindMap(d); return svg ? { svg } : null; }
    if (type === 'Flow Chart') { const svg = flowChart(d); return svg ? { svg } : null; }
    if (type === 'Label the Diagram') {
      const fig = Object.prototype.hasOwnProperty.call(FIGURES, d.figure) ? FIGURES[d.figure] : null;
      if (!fig) return null;
      const lang = rtl ? 'ur' : 'en';
      const answers = fig.answers(lang);
      return { svg: fig.draw(lang), bank: [...answers].sort(),
        answer: answers.map((a, i) => `${i + 1}. ${a}`).join('; ') };
    }
  } catch (_) {
    return null; // the engine refused the spec: print the question as text
  }
  return null;
}

/** The user-prompt lines for the drawn types asked for; '' when none is. */
function promptLine(typeIds) {
  const ids = new Set(typeIds);
  const out = [];
  if (ids.has('Mind Map')) out.push('• For Mind Map: add `"diagram": {"centre": "<topic>", "branches": ["<word>", "", …]}` with 4-6 '
    + 'branches; leave 2-3 branches as "" for the child to fill, and put the missing words in "answer". '
    + 'The paper draws it; the question says "Complete the mind map."');
  if (ids.has('Flow Chart')) out.push('• For Flow Chart: add `"diagram": {"steps": ["<step>", "", …]}` with 4-6 steps in order; '
    + 'leave 2-3 steps as "" for the child to fill, and put the missing steps in "answer". '
    + 'The paper draws it; the question says "Complete the flow chart."');
  if (ids.has('Label the Diagram')) out.push('• For Label the Diagram: add `"diagram": {"figure": "<one of: '
    + `${Object.entries(FIGURE_HINTS).map(([k, v]) => `${k} = ${v}`).join('; ')}>"}\`. The paper draws it with numbered `
    + 'blanks and a word bank; the question says "Label the parts using the words in the box." '
    + 'If none of these figures belongs to these pages, write a Brief Answers question instead.');
  return out.join('\n');
}

module.exports = { BLANK, FIGURES, DRAWN_TYPES: new Set(['Mind Map', 'Flow Chart', 'Label the Diagram']), figureFor, promptLine };
