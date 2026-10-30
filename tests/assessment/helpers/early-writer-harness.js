'use strict';
/**
 * The Grade 1-2 writer harness: the model and the service's private helpers faked, the real layout, marking scheme and
 * blueprint check. `run(grade, key, { replies, oralReplies, pictures, book })` returns `{ P, d, calls, go }`; `calls.oral`
 * holds every oral prompt sent, `calls.sections` every section prompt. Extracted from fde-early-writer.test.js for the
 * v34 oral tests (bd-5jmnfj.4.58.6.1). Requires jest globals, so it is loaded from a test file only.
 */

const Patterns = require('../../../bot/shared/services/assessment/patterns');
const { writeEarlyPaper } = require('../../../bot/shared/services/assessment/fde-early-writer');
const { NO_PICTURES } = require('../../../bot/shared/services/assessment/fde-early-prompt');

const SAMPLE = { count: { kind: 'count', name: 'apple', n: 3 }, dots: { kind: 'dots', n: 4 }, shapes: { kind: 'shapes', shapes: [{ shape: 'circle' }] },
  object: { kind: 'object', name: 'cat' }, scene: { kind: 'scene', describe: 'children in a park; the girl on the right waves' }, clock: { kind: 'clock', hour: 3, minute: 0 }, plant: { kind: 'plant' } };

// A slot with an answer rule gets keys that fit it unless a reply gives its own (`keys`: slot -> {question, answer} by item).
const GOOD = {
  'g1.english.B.Q8': (i) => ({ question: `What is child ${i + 1} doing?`, answer: ['running', 'reading', 'eating', 'sleeping'][i] }),
  'g2.english.B.Q6': (i) => ({ question: ['c_t', 'd_g', 's_n'][i], answer: ['cat', 'dog', 'sun'][i] }),
  'g2.english.B.Q10': (i) => ({ question: `Thing ${i + 1} is ____ the box.`, answer: ['in', 'on', 'under', 'near', 'behind'][i] }),
  'g2.english.C.Q14': (i) => ({ question: `Is it hot ${i + 1}`, answer: `Is it hot ${i + 1}?` }),
  'g1.general_knowledge.B.Q10': (i) => ({ answer: i % 2 ? 'پانی' : 'خشکی' }),
  'g1.maths.B.Q8': (i) => ({ question: `Which one is longer ${i + 1}?`, answer: ['the girl', 'the children', 'the park', 'girl', 'children'][i] }),
};

// Every object picture is a different thing unless a reply names it (`names`: slot -> names by item).
function itemsFor(slot, { noPicture = false, names = [], keys = [] } = {}) {
  return Array.from({ length: slot.generate }, (_, i) => ({
    slot: slot.slot, question: `Question ${i + 1} for ${slot.slot}`, marks: slot.marks_each, blooms: 'Remember',
    ...(slot.shape === 'mcq' ? { options: [`a) one${i}`, `b) two${i}`, `c) three${i}`], answer: `a) one${i}` } : { answer: String(i + 1) }),
    ...(keys[i] || (GOOD[slot.slot] ? GOOD[slot.slot](i) : {})),
    scheme: { points: [{ kind: 'A', text: 'correct', marks: slot.marks_each }] },
    ...(slot.picture && !noPicture ? { picture: { ...SAMPLE[slot.picture[0]],
      ...(slot.picture[0] === 'object' ? { name: names[i] || `${slot.slot} thing ${i}` } : {}) } } : {}),
  }));
}

function treeFor(section, opts = {}) {
  const tree = { unseen: { objective: {}, subjective: {} } };
  section.slots.forEach((slot) => {
    const list = itemsFor(slot, { noPicture: (opts.noPicture || []).includes(slot.slot), names: (opts.names || {})[slot.slot], keys: (opts.keys || {})[slot.slot] });
    (tree.unseen[slot.category][slot.type] = tree.unseen[slot.category][slot.type] || []).push(...list);
  });
  return tree;
}

function oralTree(oral, drop = []) {
  return { oral: oral.tasks.filter((t) => !drop.includes(t.id)).map((t) => ({
    id: t.id, script: 'A short story read aloud.', items: Array.from({ length: t.n }, (_, i) => ({ ask: `ask ${i + 1}`, answer: 'yes' })),
  })) };
}

function deps(P, { replies = {}, oralReplies = [], pictures = null, book = 'BOOK' } = {}) {
  const calls = { sections: [], oral: [], prompts: [] };
  const sectionN = {};
  const d = {
    family: 'eng',
    loadPatternContent: jest.fn(async () => ({ content: book, pageReference: '1-50' })),
    ensureCurrent: jest.fn(async () => {}),
    patternModel: () => ({ model: 'test/model', job: 'assessment.generate' }),
    resolveModelForJob: () => ({ model: 'test/model' }),
    buildSystemPrompt: () => 'SYSTEM',
    sectionText: (section, loaded) => ({ content: loaded.content, pageReference: loaded.pageReference }),
    buildPatternUserPrompt: ({ section }) => { calls.prompts.push(section.id); return `PROMPT ${section.id}\n${NO_PICTURES}`; },
    sectionMessages: ({ system, user }) => [{ role: 'system', content: system }, { role: 'user', content: user }],
    warmSharedPrefixes: async () => [],
    writeSection: jest.fn(async ({ messages, section }) => {
      const usages = [{ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.01 }];
      if (section.id === 'oral') {
        calls.oral.push(messages);
        const r = oralReplies[calls.oral.length - 1];
        return { tree: r || oralTree(P.oral), usages };
      }
      calls.sections.push({ id: section.id, user: messages[1].content });
      sectionN[section.id] = (sectionN[section.id] || 0) + 1;
      const opts = (replies[section.id] || [])[sectionN[section.id] - 1] || {};
      return { tree: treeFor(section, opts), usages };
    }),
    mergeSections: (trees) => {
      const out = { unseen: { objective: {}, subjective: {} } };
      trees.forEach((t) => Object.entries(t.unseen).forEach(([cat, types]) => Object.entries(types).forEach(([type, list]) => {
        out.unseen[cat][type] = (out.unseen[cat][type] || []).concat(JSON.parse(JSON.stringify(list)));
      })));
      return out;
    },
    stripImageKeys: () => {},
    normaliseAnswers: () => {},
    emptyQuestionParts: () => [],
    topUp: (first, second) => second,
    sumUsage: (us) => ({ prompt_tokens: us.reduce((n, u) => n + u.prompt_tokens, 0), completion_tokens: 0, total_tokens: 0, cost: us.reduce((n, u) => n + u.cost, 0) }),
    countQuestions: () => 1,
    fail: (code, message, extra) => Object.assign(new Error(message), { code }, extra),
    logToFile: jest.fn(),
    resolvePictures: pictures || jest.fn(async (examJson) => {
      Object.values(examJson.unseen).forEach((t) => Object.values(t).forEach((l) => l.forEach((q) => { if (q.picture) q.picture.src = 'data:x'; })));
      return examJson;
    }),
  };
  return { d, calls };
}

const run = (grade, key, opts) => {
  const P = Patterns.get(`fde_g${grade}_2026`).subjects[key];
  const { d, calls } = deps(P, opts);
  return { P, d, calls, go: () => writeEarlyPaper({ grade, subject: key, pattern: `fde_g${grade}_2026`, P }, d) };
};

const slotOf1 = (id) => Patterns.get('fde_g1_2026').subjects.english.sections.flatMap((s) => s.slots).find((s) => s.slot === id);

const items = (examJson) => Object.values(examJson.unseen).flatMap((t) => Object.values(t)).flat();
module.exports = { SAMPLE, GOOD, itemsFor, treeFor, oralTree, deps, run, slotOf1, items };
