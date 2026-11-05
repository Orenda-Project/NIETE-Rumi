'use strict';
/**
 * N20 figure-ban (contract 8 part 2 section 1). No G6-12 paper prints a figure (DESIGN R9), so a reference
 * to one is always a defect. Reads only what the child sees; never answer, scheme, tag, calc.
 *   Tier A  hard FIGURE_REF   a reference to something the paper does not print
 *   Tier A  soft FIGURE_TASK  the same, or a bare figure noun, after a task verb in its sentence
 *   Tier B  soft FIGURE_WORD  a bare figure noun
 *   hard FIGURE_KEY           a leftover image/diagram key on an item
 * Urdu tokens are draft: needs fluent-Urdu review. Pure.
 */
const { walk } = require('./_walk-local');
const { childFields } = require('./_child-view');
const { issue, excerpt, str } = require('./_text-norm');

const ID = 'N20';
const AR = '[\\u0600-\\u06FF]';
const ub = (body) => new RegExp(`(?<!${AR})(?:${body})(?!${AR})`, 'u');
const NOUN = 'شکل|تصویر|خاکہ|نقشہ|نقشے|گراف';
const DEICTIC = 'اوپر|نیچے|درج\\s*ذیل|مندرجہ\\s*ذیل|دی\\s*گئی|دیے\\s*گئے|دیئے\\s*گئے|مذکورہ';
const FIG_EN = '(?:figure|diagram|picture|graph|map|image|circuit|chart)';

const TIER_A = [
  /\bfig(?:ure|\.)?\s*\d/i,
  /\blabel the\b/i,
  /\bshown (?:below|above|here|alongside)\b/i,
  new RegExp(`\\b(?:given|following|accompanying|attached|above|below) (?:${FIG_EN}|illustration)\\b`, 'i'),
  new RegExp(`\\b${FIG_EN} (?:shown|given|above|below|alongside|attached)\\b`, 'i'),
  /\b(?:in|from|using|on) the (?:figure|diagram|picture|image|map|graph|circuit)\b/i,
  /\bsee the (?:map|figure|diagram|picture)\b/i,
  /\bgraph shown\b/i,
  /\bgiven graph\b/i,
  ub(`(?:${DEICTIC})\\s*(?:${NOUN})`),
  new RegExp(`(?<!${AR})(?:${NOUN})(?!${AR})\\s*(?:(?:میں|سے)\\s*)?(?:دیکھ|ملاحظہ|دکھا)\\S*`, 'u'),
  ub('نقشہ\\s*دیکھ'),
  ub('شکل\\s*نمبر'),
];
// "use the curve" needs inline data to be answerable (r2-studio F8): a `|` table or a list of 3+ numbers
const CURVE = /\b(?:use|from|study|read|on|in) the (?:curve|graph|table|chart|plot)\b/i;
const INLINE_DATA = /\||\d[\d.]*\s*[,;]\s*\d[\d.]*\s*[,;]\s*\d/;
const TIER_B = [/\b(?:figure|diagram|picture|graph|map|circuit|image|chart|sketch|flowchart)s?\b/i, ub(NOUN)];
const TASK = /\b(?:draw|sketch|construct|plot|make|describe|explain|define|state|write|name)\b/i;
const KEYS = ['image', 'image_description', 'picture', 'diagram', 'figure'];

function firstHit(text) {
  let best = null;
  const consider = (m) => { if (m && (best === null || m.index < best.index)) best = m; };
  TIER_A.forEach((re) => consider(re.exec(text)));
  if (!INLINE_DATA.test(text)) consider(CURVE.exec(text));
  return best;
}

const taskBefore = (text, idx) => {
  const head = text.slice(0, idx);
  const cut = Math.max(head.lastIndexOf('\n'), ...'.?!۔؟'.split('').map((c) => head.lastIndexOf(c)));
  return TASK.test(head.slice(cut + 1));
};

function checkNode(node) {
  const out = [];
  const seen = new Set();
  const add = (code, hard, field, text, at) => {
    if (seen.has(code)) return;
    seen.add(code);
    out.push(issue(ID, code, node.ref, `${field} "${excerpt(text.slice(Math.max(0, at - 10)))}"`, hard));
  };
  childFields(node, { inherit: false }).forEach(({ field, text }) => {
    const a = firstHit(text);
    if (a) {
      const task = taskBefore(text, a.index);
      add(task ? 'FIGURE_TASK' : 'FIGURE_REF', !task, field, text, a.index);
      return;
    }
    for (const re of TIER_B) {
      const b = re.exec(text);
      if (b) { add(taskBefore(text, b.index) ? 'FIGURE_TASK' : 'FIGURE_WORD', false, field, text, b.index); break; }
    }
  });
  KEYS.forEach((k) => {
    const v = node.item[k];
    const present = typeof v === 'object' ? v !== null && Object.keys(v).length > 0 : v != null && v !== '';
    if (present) add('FIGURE_KEY', true, `key ${k}`, str(v), 0);
  });
  return out;
}

function run(examJson) {
  const issues = [];
  walk(examJson).forEach((node) => issues.push(...checkNode(node)));
  return { ok: !issues.some((i) => i.hard), issues };
}

module.exports = { id: ID, name: 'figure-ban', hard: true, modes: ['free', 'board'], LIMITS: {}, run };
