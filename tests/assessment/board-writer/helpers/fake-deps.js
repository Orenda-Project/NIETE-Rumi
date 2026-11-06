'use strict';
/**
 * A fake `d` for writeBoardPaper and a deterministic, fictional "recorded reply" builder. No network, no LLM.
 * The replies are built from the section's own slot list, so a cell needs no hand-written JSON; every stem,
 * option and passage is made up. Real pieces are used where they are pure: board-checks, prompts-6-12.assemble.
 */
const A = '../../../../bot/shared/services/assessment/';
const Checks = require(`${A}board-checks`);
const { assemble } = require(`${A}prompts-6-12`);
const { leavesOf, eachList } = require(`${A}board-6-12/tree`);

const NOUNS = ['lamp', 'bridge', 'garden', 'kettle', 'ladder', 'market', 'river', 'compass', 'tower', 'basket', 'engine', 'window'];
const EN_LABELS = ['A', 'B', 'C', 'D'];
const UR_LABELS = ['الف', 'ب', 'ج', 'د'];
const DIFF = ['easy', 'medium', 'hard'];

function levelCycle(levels) {
  const out = [];
  Object.keys(levels).forEach((k) => { for (let i = 0; i < Math.max(1, Math.round(levels[k] / 10)); i += 1) out.push(k); });
  return out;
}

const marksOf4 = (m) => Math.round(m * 4);

function points(marks) {
  const whole = Math.floor(marks);
  const list = Array.from({ length: whole }, (_, i) => ({ kind: 'A', text: `valid point ${i + 1}`, marks: 1 }));
  if (marks - whole > 0) list.push({ kind: 'A', text: 'final point', marks: marks - whole });
  return list;
}

function bands(m) {
  const t = Math.ceil((2 * m) / 3);
  const l = Math.ceil(m / 3);
  return [{ hi: m, lo: t, descriptor: 'full' }, { hi: t - 1, lo: l, descriptor: 'partial' }, { hi: l - 1, lo: 0, descriptor: 'little' }];
}

/** The reply for the given slots: one list per slot, items with tags, answers and schemes. `ctx` = {grade, row, levels, style, ur}. */
function buildReply(slots, ctx, state) {
  const cycle = levelCycle(ctx.levels);
  const items = [];
  const tagFor = (n, blooms) => {
    const chapter = 1 + (n % 5);
    return { chapter, section: null, code: `g${ctx.grade}.${ctx.row.code}.ch${chapter}.lo${1 + (n % 3)}`, page: 10 + n, official_slo: null, blooms: blooms || cycle[n % cycle.length], difficulty: DIFF[n % 3] };
  };
  const mcq = (slot, n) => {
    const key = n % 4;
    const opts = [0, 1, 2, 3].map((i) => `${NOUNS[(n + i * 3) % NOUNS.length]} number ${n * 4 + i}`);
    const labels = ctx.ur ? UR_LABELS : EN_LABELS;
    const stem = ctx.ur ? `سوال ${n}: درست جواب منتخب کریں` : `Item ${n}: choose the statement that fits the ${NOUNS[n % NOUNS.length]} case ${n}`;
    return {
      slot: slot.slot, main_question: ctx.ur ? 'درست جواب منتخب کریں' : 'Choose the correct option', question: stem,
      options: opts.map((o, i) => `${labels[i]}) ${o}`), marks: slot.marks_each, lines: 0, answer: `${labels[key]}) ${opts[key]}`, tag: tagFor(n),
    };
  };
  const written = (slot, n, blooms) => ({
    slot: slot.slot, main_question: 'Answer the following', question: `Explain case ${n} of the ${NOUNS[n % NOUNS.length]} study and give your reasons`, marks: slot.marks_each, lines: 6,
    answer: `Case ${n}: the ${NOUNS[(n + 5) % NOUNS.length]} result follows from the stated rule.`,
    scheme: ctx.style === 'holistic_bands' ? { bands: bands(slot.marks_each) } : { points: points(slot.marks_each) }, kind: null,
    tag: tagFor(n, blooms),
  });
  slots.forEach((slot) => {
    if (slot.teacher_marked || slot.project || !(slot.generate > 0)) return;
    const take = Math.max(0, slot.generate - (state.skip[slot.slot] || 0));
    if (slot.stimulus) {
      for (let g = 0; g < slot.stimulus.count; g += 1) {
        const inner = Array.from({ length: slot.stimulus.mcqs_per_stimulus }, () => { state.n += 1; return mcq(slot, state.n); });
        items.push({ slot: slot.slot, stimulus: { text: `A made-up passage ${g + 1} about a ${NOUNS[(state.n + g) % NOUNS.length]} and its use.`, items: inner } });
      }
      return;
    }
    for (let i = 0; i < take; i += 1) {
      state.n += 1;
      if (slot.or) {
        const b = slot.or.branches.map((br, k) => ({ ...written({ ...slot, marks_each: br.marks_each }, state.n * 10 + k, 'U') }));
        items.push({ slot: slot.slot, or: b });
      } else items.push(slot.type === 'mcq' || slot.type === 'scenario' ? mcq(slot, state.n) : written(slot, state.n));
    }
  });
  const obj = items.filter((q) => q.options || (q.stimulus && q.stimulus.items) || false);
  const sub = items.filter((q) => !obj.includes(q));
  return { unseen: { objective: { MCQs: obj }, subjective: { 'Short and Extended': sub } } };
}

const sumUsage = (u) => ({ prompt_tokens: u.length, completion_tokens: u.length, total_tokens: 2 * u.length, cost: 0, cached_tokens: 0 });

function mergeSections(trees) {
  const out = { unseen: { objective: {}, subjective: {} } };
  trees.forEach((t) => ['objective', 'subjective'].forEach((cat) => Object.entries(((t && t.unseen) || {})[cat] || {}).forEach(([type, list]) => {
    out.unseen[cat][type] = (out.unseen[cat][type] || []).concat(list);
  })));
  return out;
}

/**
 * opts: {row, grade, levels, style, ur, reply(section, call, isTopUp, state) -> tree|undefined (undefined = the default full reply)}
 * Returns {d, calls}; calls = [{section, topUp, system, user}].
 */
function makeDeps(opts) {
  const calls = [];
  const state = { n: 0, skip: {} };
  const ctx = { grade: opts.grade, row: opts.row, levels: opts.levels, style: opts.style, ur: !!opts.ur };
  const d = {
    family: opts.ur ? 'urdu' : 'eng',
    resolveSubject: () => opts.row,
    variantFor: () => { throw new Error('variant should have been passed'); },
    loadPatternContent: async () => ({ content: 'MADE-UP BOOK TEXT about lamps and bridges.', pageReference: 'pp 1-9' }),
    ensureCurrent: async () => null,
    patternModel: () => ({ model: 'test-model', job: 'assessment.generate.test' }),
    resolveModelForJob: () => ({ model: 'own-model' }),
    sectionMessages: ({ system, user }) => [{ role: 'system', content: system }, { role: 'user', content: user }],
    assemble,
    writeSection: async ({ messages, section }) => {
      const user = messages[1].content;
      const topUp = /TOP-UP/.test(user);
      calls.push({ section: section.id, topUp, system: messages[0].content, user });
      const custom = opts.reply && opts.reply(section, calls.length, topUp, state);
      const tree = custom || buildReply(section.slots, ctx, state);
      return { tree, usages: [{ prompt_tokens: 1, completion_tokens: 1 }] };
    },
    mergeSections,
    stripImageKeys: (t) => t,
    normaliseAnswers: (t) => t,
    topUp: (first, second, set) => {
      const keep = JSON.parse(JSON.stringify(second));
      eachList(keep, (list, setList) => setList(list.filter((q) => set.has(q.slot))));
      return mergeSections([first, keep]);
    },
    sumUsage,
    countQuestions: (ex) => leavesOf(ex).length,
    stampSlo: (grade, subject, item) => item,
    checks: Checks,
    fail: (code, message, extra) => Object.assign(new Error(message), { code }, extra || {}),
    logToFile: () => {},
  };
  return { d, calls, state };
}

module.exports = { makeDeps, buildReply, marksOf4 };
