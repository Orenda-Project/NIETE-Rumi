'use strict';
/**
 * `tag-complete` (contract 8 part 2 section 2; item-tag.md). Hard for shape, soft for the Bloom's split.
 * The rules are read from the schema's own JSON (./item-tag.schema.json, a copy of contracts/tags; the
 * COS places it at A/item-tag.schema.json), never coerced: a wrong value is reported, not repaired.
 *   TAG_MISSING  leaf with no tag; container (or/parts node) with one
 *   TAG_SHAPE    key missing/extra, chapter, difficulty, page, section, codes_extra, or/parts shape
 *   CODE_FORM    code matches none of book / skill / official forms; book code grade, subject or ch<n> off the cell
 *   SLO_FORM     official_slo not null or an AF code ("null" string and "U-12-E-[17]" fail)
 *   BLOOMS_SCALE blooms outside the cell's scale (variant split, else registry tos_default)
 *   TYPE_OFF_CATALOGUE type not in the cell's catalogue (ctx.typesFor, else the schema's closed enum)
 *   TYPE_SLOT    board: type differs from the slot's type
 *   KIND_RULE    kind set on a non srq/erq type, or outside the kinds enum
 * Skipped (design_pending, returned in `skipped`): LO-exists and page-in-range. Pure.
 */
const schema = require('./item-tag.schema.json');
const { walk } = require('./_walk-local');
const { issue, excerpt } = require('./_text-norm');
const { splitReport } = require('./tag-split');

const ID = 'tag-complete';
const D = schema.$defs;
const TAG_KEYS = [...D.tag.required, 'codes_extra'];
const P = D.tag.properties;
const ENUM = {
  type: D.leaf.properties.type.enum,
  kind: D.leaf.properties.kind.enum.filter((k) => k !== null),
  blooms: P.blooms.enum,
  difficulty: P.difficulty.enum,
};
const RE = {
  book: new RegExp(D.book_code.pattern),
  official: new RegExp(D.official_code.pattern),
  slo: new RegExp(P.official_slo.pattern),
};
const SKILLS = new Set(D.skill_code.enum);
const SECTION_MAX = P.section.maxLength;
const EXTRA_MAX = P.codes_extra.maxItems;
const KIND_TYPES = ['srq', 'erq'];

const isInt = (v) => Number.isInteger(v);
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const codeForm = (c) => typeof c === 'string' && (RE.book.test(c) || SKILLS.has(c) || RE.official.test(c));

const scaleOf = (ctx) => {
  const lv = (ctx.variant && ctx.variant.cognitive_split && ctx.variant.cognitive_split.levels)
    || (ctx.subjectConfig && ctx.subjectConfig.tos_default && ctx.subjectConfig.tos_default.levels);
  return lv ? Object.keys(lv) : null;
};
const targetOf = (ctx) => (ctx.variant && ctx.variant.cognitive_split && ctx.variant.cognitive_split.levels
  ? ctx.variant.cognitive_split
  : (ctx.subjectConfig && ctx.subjectConfig.tos_default) || null);

function catalogueOf(ctx) {
  const sc = ctx.subjectConfig;
  if (typeof ctx.typesFor === 'function' && sc) {
    const got = ctx.typesFor(sc.grade, sc.code);
    if (Array.isArray(got)) return new Set(got.map((t) => (t && t.id) || t).filter((t) => t !== 'board_paper'));
  }
  return new Set(ENUM.type);
}

function checkCode(code, tagChapter, sc, withChapter) {
  if (!codeForm(code)) return `code "${excerpt(code)}" matches no book, skill or official form`;
  if (RE.book.test(code) && sc && sc.grade != null && sc.code) {
    const m = /^g(\d+)\.([a-z_]+)\.ch(\d+)\./.exec(code);
    if (Number(m[1]) !== Number(sc.grade) || m[2] !== sc.code) return `code ${code} is not this cell (g${sc.grade}.${sc.code})`;
    if (withChapter && Number(m[3]) !== tagChapter) return `code ${code} has ch${m[3]} but tag.chapter is ${tagChapter}`;
  }
  return null;
}

function checkTag(tag, node, ctx, cat, scale, add) {
  if (!isObj(tag)) { add('TAG_SHAPE', 'tag is not an object'); return; }
  const keys = Object.keys(tag);
  D.tag.required.filter((k) => !(k in tag)).forEach((k) => add('TAG_SHAPE', `tag.${k} is missing`));
  keys.filter((k) => !TAG_KEYS.includes(k)).forEach((k) => add('TAG_SHAPE', `tag.${k} is not a tag key`));
  if ('chapter' in tag && !(isInt(tag.chapter) && tag.chapter >= 1)) add('TAG_SHAPE', `chapter ${excerpt(tag.chapter)} is not an integer >= 1`);
  if ('difficulty' in tag && !ENUM.difficulty.includes(tag.difficulty)) add('TAG_SHAPE', `difficulty ${excerpt(tag.difficulty)} is not easy|medium|hard`);
  if ('section' in tag && !(tag.section === null || (typeof tag.section === 'string' && tag.section.length <= SECTION_MAX))) add('TAG_SHAPE', `section is not null or a string of at most ${SECTION_MAX} characters`);
  const skill = typeof tag.code === 'string' && SKILLS.has(tag.code);
  if ('page' in tag && !((isInt(tag.page) && tag.page >= 1) || (tag.page === null && skill))) add('TAG_SHAPE', `page ${excerpt(tag.page)} must be an integer >= 1 (null only for skill codes)`);
  if ('code' in tag) {
    const bad = checkCode(tag.code, tag.chapter, ctx.subjectConfig, true);
    if (bad) add('CODE_FORM', bad);
  }
  if ('codes_extra' in tag) {
    if (!Array.isArray(tag.codes_extra) || tag.codes_extra.length > EXTRA_MAX || new Set(tag.codes_extra).size !== tag.codes_extra.length) add('TAG_SHAPE', `codes_extra must be a list of at most ${EXTRA_MAX} distinct codes`);
    else tag.codes_extra.forEach((c) => { const bad = checkCode(c, tag.chapter, ctx.subjectConfig, false); if (bad) add('CODE_FORM', `codes_extra: ${bad}`); });
  }
  if ('official_slo' in tag && !(tag.official_slo === null || (typeof tag.official_slo === 'string' && RE.slo.test(tag.official_slo)))) add('SLO_FORM', `official_slo ${JSON.stringify(tag.official_slo)} is not null or an AF code`);
  if ('blooms' in tag && !(scale || ENUM.blooms).includes(tag.blooms)) add('BLOOMS_SCALE', `blooms ${JSON.stringify(tag.blooms)} is outside the cell scale ${(scale || ENUM.blooms).join('')}`);
}

function checkLeaf(node, ctx, cat, scale, add) {
  const it = node.item;
  if (!('kind' in it)) add('TAG_SHAPE', 'kind is missing (null where the type has none)');
  if (!cat.has(it.type)) add('TYPE_OFF_CATALOGUE', `type ${JSON.stringify(it.type)} is not in the catalogue`);
  if (node.slotRow && node.slotRow.type && it.type !== node.slotRow.type) add('TYPE_SLOT', `type ${it.type} differs from the slot's ${node.slotRow.type}`);
  if (it.kind != null && !(KIND_TYPES.includes(it.type) && ENUM.kind.includes(it.kind))) add('KIND_RULE', `kind ${JSON.stringify(it.kind)} is not allowed on type ${it.type}`);
  if (!('tag' in it) || it.tag == null) { add('TAG_MISSING', 'leaf has no tag'); return; }
  checkTag(it.tag, node, ctx, cat, scale, add);
}

function run(examJson, ctx = {}) {
  const c = ctx || {};
  const cat = catalogueOf(c);
  const scale = scaleOf(c);
  const issues = [];
  const nodes = walk(examJson);
  nodes.forEach((node) => {
    const it = node.item;
    const add = (code, msg) => issues.push(issue(ID, code, node.ref, msg, true));
    if (node.container) {
      if ('tag' in it) add('TAG_MISSING', 'a container (or/parts node) must not carry a tag');
      if (Array.isArray(it.or) && it.or.length !== 2) add('TAG_SHAPE', `or node has ${it.or.length} branches, needs exactly 2`);
      if (Array.isArray(it.parts) && it.parts.length < 1) add('TAG_SHAPE', 'parts node has no parts');
      return;
    }
    checkLeaf(node, c, cat, scale, add);
  });
  // an OR node with one branch is walked as a container; a leaf-less malformed `or` is caught above
  const rep = splitReport(nodes.filter((n) => !n.container), targetOf(c));
  issues.push(...rep.issues);
  const out = {
    ok: !issues.some((i) => i.hard),
    issues,
    skipped: [
      { id: 'tag-complete:lo-exists', why: 'design_pending: no LO index exists (slo_index.json is a coverage summary)' },
      { id: 'tag-complete:page-range', why: 'design_pending: ctx carries no textbook_toc page range' },
    ],
  };
  if (rep.split) out.split = rep.split;
  return out;
}

module.exports = { id: ID, name: 'tag-complete', hard: 'shape', modes: ['free', 'board'], LIMITS: {}, run };
