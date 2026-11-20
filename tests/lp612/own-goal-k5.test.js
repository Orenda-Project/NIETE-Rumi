'use strict';
/**
 * bd-snkn32.57 (queue #154) — "Start from a learning goal or topic" for grades 1–5 (Amena 19 Nov: "it should be for 1-5
 * also pls, remember we are an FLN company first"). The goals are the OFFICIAL grade 1–5 learning outcomes: the NIETE
 * curriculum matrix, already loaded as data in assessment_topics (one row per topic: chapter, pages, teaching days, SLO
 * codes and their descriptions, in the book's language). Each outcome names the day it is written over (its stored
 * plan keeps the facts grounded), exactly as a 6–12 goal names its lesson. Urdu, English and Maths first; Science rides
 * along where the matrix has it; a subject with no matrix rows has no list (the typed topic is then "not found").
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const G = require('../../bot/shared/services/lp-k5-own-goal');
const { outcomeList, matchTopic, outcomeOf } = require('../../bot/shared/services/lp612-own-goal');
const { goalRows } = require('../../bot/shared/services/lp612-own-goal.store');
const { parseOwnAnswers } = require('../../bot/shared/services/lp612-own-instruction');
const { k5Messages, checkK5Rewrite } = require('../../bot/shared/services/lp-k5-own');

const lesson = (id, idx, type, pages) => ({ lesson_id: id, segment_index: idx, lp_type: type, pages });
/** A book like the catalogue's: chapter 1 has three days, a worksheet and a revision; chapter 2 two days. */
const BOOK = {
  grade: 1, subject_key: 'urdu', language: 'ur',
  chapters: [
    { number: 1, title: 'حمد', lessons: [lesson('u_ch1_seg1', 1, 'content', [1, 2]), lesson('u_ch1_seg2', 2, 'content', [3]), lesson('u_ch1_seg3', 3, 'content', [4, 5]), lesson('u_ch1_seg995', 995, 'assessment', [1, 5]), lesson('u_ch1_seg990', 990, 'revision', [1, 5])] },
    { number: 2, title: 'نعت', lessons: [lesson('u_ch2_seg1', 1, 'content', [10]), lesson('u_ch2_seg2', 2, 'content', [11, 12])] },
  ],
};
const topic = (o) => ({ grade: 1, subject: 'urdu', curriculum: 'ict', chapter_title: 'حمد', sort_order: 1, pages: [], days: [], slo_codes: ['U-01-OC-01'], ...o });

describe('dayFor: the day an official outcome is written over', () => {
  it('the matrix day (counted through the whole book, worksheets and revisions too) when it is a teaching day of that chapter', () => {
    expect(G.dayFor(topic({ chapter_number: 1, days: [2], pages: [4] }), BOOK).lesson_id).toBe('u_ch1_seg2');
    expect(G.dayFor(topic({ chapter_number: 2, days: [7], pages: [] }), BOOK).lesson_id).toBe('u_ch2_seg2');
  });
  it('else the first teaching day of the chapter whose pages it shares', () => {
    expect(G.dayFor(topic({ chapter_number: 1, days: [4], pages: [5] }), BOOK).lesson_id).toBe('u_ch1_seg3');
  });
  it('else the chapter\'s first teaching day; null for a chapter the book does not have', () => {
    expect(G.dayFor(topic({ chapter_number: 2, days: [], pages: [99] }), BOOK).lesson_id).toBe('u_ch2_seg1');
    expect(G.dayFor(topic({ chapter_number: 9, days: [1], pages: [1] }), BOOK)).toBeNull();
    expect(G.dayFor(topic({ chapter_number: 1 }), null)).toBeNull();
  });
});

describe('k5GoalRows: the matrix as the goal list', () => {
  const topics = [
    topic({ chapter_number: 2, chapter_title: 'نعت', name: 'ہمارے نبی', days: [6], pages: [10], slo_descriptions: ['نظم سن کر سوالات کے زبانی جوابات دے سکیں۔'] }),
    topic({ chapter_number: 1, name: 'میرا تعارف', days: [1], pages: [1, 2], slo_descriptions: ['اپنے اور اپنے گھر والوں کے بارے میں بات کر سکیں۔'] }),
    topic({ chapter_number: 1, name: 'دہرائی', days: [1], pages: [1], slo_descriptions: ['اپنے اور اپنے گھر والوں کے بارے میں بات کر سکیں۔'] }),
    topic({ chapter_number: 9, name: 'none', days: [1], slo_descriptions: ['x y z'] }),
  ];
  const rows = G.k5GoalRows(topics, BOOK);

  it('one row per topic with a day, in the 6–12 row shape, naming the day', () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(expect.objectContaining({ segment_id: 'u_ch2_seg1', chapter_number: 2, chapter_title: 'نعت', menu_title: 'ہمارے نبی' }));
  });
  it('outcomeList: the official outcomes, in the book\'s order, once each, in the book\'s language', () => {
    expect(outcomeList(rows)).toEqual([
      { segmentId: 'u_ch1_seg1', text: 'اپنے اور اپنے گھر والوں کے بارے میں بات کر سکیں۔' },
      { segmentId: 'u_ch2_seg1', text: 'نظم سن کر سوالات کے زبانی جوابات دے سکیں۔' },
    ]);
  });
  it('an Urdu topic she types finds its day (diacritics do not matter); no shared word is no match', () => {
    expect(matchTopic('گَھر والوں کا تعارف', rows).segment_id).toBe('u_ch1_seg1');
    expect(matchTopic('آتش فشاں', rows)).toBeNull();
  });
  it('the matrix\'s working notes and "I can" never reach her; a topic with no chapter title takes the book\'s', () => {
    const r = G.k5GoalRows([
      topic({ chapter_number: 1, chapter_title: null, days: [1], slo_descriptions: ['نئے الفاظ سمجھ سکیں۔ [DERIVED page-level SLO — opener has none]'] }),
      topic({ chapter_number: 2, days: [6], slo_descriptions: ['I can add up to 4-digit numbers.'] }),
    ], BOOK);
    expect(r.map((x) => [x.chapter_title, x.slo_descriptions[0]])).toEqual([['حمد', 'نئے الفاظ سمجھ سکیں۔'], ['حمد', 'Add up to 4-digit numbers.']]);
  });
  it('"adding" finds "add", "counting" finds "count"', () => {
    const en = [{ segment_id: 'm1', chapter_number: 1, order_index: 1, slo_descriptions: ['Multiply 2-digit numbers by 1-digit numbers'] }, { segment_id: 'm2', chapter_number: 1, order_index: 2, slo_descriptions: ['Add up to 4-digit numbers'] }];
    expect(matchTopic('adding big numbers', en).segment_id).toBe('m2');
  });
  it('English topics still match as before', () => {
    const en = [{ segment_id: 'e1', chapter_number: 1, order_index: 1, slo_descriptions: ['Count objects up to 20'] }, { segment_id: 'e2', chapter_number: 1, order_index: 2, slo_descriptions: ['Add numbers up to 10'] }];
    expect(matchTopic('adding numbers', en).segment_id).toBe('e2');
    expect(outcomeOf(en[0])).toBe('Count objects up to 20');
  });
});

describe('matrixSubject: the catalogue\'s subject key to the matrix\'s', () => {
  it.each([['urdu', 'urdu'], ['english', 'english'], ['math', 'maths'], ['general_science', 'science'], ['islamiat', null], ['general_knowledge', null]])('%s -> %s', (k, want) => {
    expect(G.matrixSubject(k)).toBe(want);
  });
});

/** A tiny PostgREST stand-in: records every filter, answers `result`. */
function fake(result) {
  const seen = { from: null, eq: [] };
  const q = { select: () => q, eq: (k, v) => { seen.eq.push([k, v]); return q; }, limit: () => Promise.resolve(result) };
  return { seen, client: { from: (t) => { seen.from = t; return q; } } };
}

describe('goalRows for grades 1–5 (the store)', () => {
  const T1 = topic({ chapter_number: 1, name: 'میرا تعارف', days: [1], pages: [1, 2], slo_descriptions: ['اپنے اور اپنے گھر والوں کے بارے میں بات کر سکیں۔'] });

  it('reads the current ICT matrix rows of her grade and subject, mapped onto the real catalogue\'s days', async () => {
    const { client, seen } = fake({ data: [T1], error: null });
    const rows = await goalRows(client, { grade: 1, subject: 'urdu' });
    expect(seen.from).toBe('assessment_topics');
    expect(seen.eq).toEqual(expect.arrayContaining([['is_current', true], ['curriculum', 'ict'], ['grade', 1], ['subject', 'urdu']]));
    expect(rows.map((r) => r.segment_id)).toEqual(['grade_1_urdu_ch1_seg1']);
  });
  it('Maths reads the matrix\'s "maths"', async () => {
    const { client, seen } = fake({ data: [], error: null });
    await goalRows(client, { grade: 2, subject: 'math' });
    expect(seen.eq).toContainEqual(['subject', 'maths']);
  });
  it('a subject with no matrix, no book, or a failed read: [] (no read for the first two)', async () => {
    const none = fake({ data: [T1], error: null });
    expect(await goalRows(none.client, { grade: 1, subject: 'islamiat' })).toEqual([]);
    expect(await goalRows(none.client, { grade: 1, subject: 'klingon' })).toEqual([]);
    expect(none.seen.from).toBeNull();
    expect(await goalRows(fake({ data: null, error: { message: 'x' } }).client, { grade: 1, subject: 'urdu' })).toEqual([]);
  });
});

describe('her answers and the rewrite request', () => {
  const answers = { size: 'over70', resources: ['board'], level: 'behind', way: 'tarl', note: '' };
  const goal = { kind: 'outcome', text: 'Count objects up to 20 and write the number.' };

  it('a grades 1–5 day takes a goal; the class has no textbook', () => {
    const out = parseOwnAnswers({ ...answers, goal });
    expect(out.ok).toBe(true);
    expect(out.answers.goal).toEqual(goal);
    expect(out.answers.resources).toEqual(['board']);
  });

  const SCRIPT = { goal: 'g', meta: { day: 2, minutes: 30 }, hook: { a: 'h' }, iDo: { steps: [{ say: 's' }] }, weDo: { action: 'w' }, youDo: { action: 'y' }, wrap: { homework: ['x'] } };
  const parsed = parseOwnAnswers({ ...answers, resources: [], goal }).answers;
  const text = k5Messages({ script: SCRIPT, answers: parsed, lang: 'en', grade: 1, subject: 'math', bookText: null })[1].content;

  it('k5Messages carries her goal and says the class has no textbook, with the words, letters and sums written in', () => {
    expect(text).toContain('"Count objects up to 20 and write the number."');
    expect(text).toMatch(/NO TEXTBOOK/);
    expect(text).toMatch(/letters, words, sentences|sums/);
    expect(text).not.toMatch(/point to the picture on the book page/);
    expect(text).toMatch(/use their copies instead/);
  });
  it('without a goal the request is as before', () => {
    const plain = k5Messages({ script: SCRIPT, answers: parseOwnAnswers(answers).answers, lang: 'en', grade: 1, subject: 'math' })[1].content;
    expect(plain).not.toMatch(/NO TEXTBOOK/);
    expect(plain).toMatch(/point to the picture on the book page/);
  });
  it('the board refusal of a book-less plan never sends her to a book page', () => {
    const next = { ...SCRIPT, iDo: { steps: [{ say: 'Write it on the board.' }] } };
    const [r] = checkK5Rewrite(SCRIPT, next, { lang: 'en', resources: [], size: 'over70', noBook: true }).filter((x) => /board/.test(x));
    expect(r).toBeDefined();
    expect(r).not.toMatch(/book page/);
  });
});

describe('the job for a grades 1–5 goal start', () => {
  const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');
  const SCRIPT = { goal: 'g', meta: { day: 2 }, hook: { a: 'h' }, iDo: { steps: [{ say: 's' }] }, weDo: { action: 'w' }, youDo: { action: 'y' }, wrap: { homework: ['x'] } };
  it('reads no book text and prints no book pages', async () => {
    const deps = {
      claimOwn: jest.fn(async () => ({ id: 'own-1', user_id: 'u1', lesson_id: 'grade_1_math_ch1_seg2', lang: 'en', template_version: 'k5_own_v1', status: 'authoring',
        answers: { size: 'over70', resources: [], level: 'behind', way: 'tarl', note: '', goal: { kind: 'topic', text: 'Counting to 20' } } })),
      loadSegment: jest.fn(), readStoredDoc: jest.fn(), revise: jest.fn(), render: jest.fn(), readFile: jest.fn(),
      loadK5: jest.fn(async () => ({ script: SCRIPT, lang: 'en', grade: 1, subject: 'math', subjectName: 'Math', pages: { start: 3, end: 4 } })),
      rewriteK5: jest.fn(async () => ({ script: SCRIPT, model: 'm' })),
      renderK5: jest.fn(async () => Buffer.from('%PDF')),
      bookText: jest.fn(async () => 'BOOK PAGE TEXT'),
      upload: jest.fn(async () => {}), patchOwn: jest.fn(async () => {}), sleep: jest.fn(), now: () => 0, log: jest.fn(),
    };
    await createOwnWorker(deps).process({ ownId: 'own-1' });
    expect(deps.bookText).not.toHaveBeenCalled();
    expect(deps.rewriteK5.mock.calls[0][0]).toEqual(expect.objectContaining({ bookText: null, dayPages: null }));
    expect(deps.renderK5.mock.calls[0][0].pages).toBeNull();
    expect(deps.patchOwn.mock.calls.at(-1)[1].status).toBe('ready');
  });
});

describe('the accuracy check names a grades 1–5 plan\'s grade', () => {
  const { createOwnReviewer } = require('../../bot/shared/services/lp612-own-reviewer');
  const { CHECKS } = require('../../bot/shared/services/lp612-own-review');
  it('from the day\'s lesson id', async () => {
    const rubric = { choices: [{ message: { content: JSON.stringify({ checks: CHECKS.map((c) => ({ id: c.id, rating: 4 })) }) } }] };
    const accReply = { choices: [{ message: { content: '{"accurate": true, "errors": []}' } }] };
    const create = jest.fn(async (req) => (req.job === 'lp.ownAccuracy' ? accReply : rubric));
    const patches = [];
    const reviewer = createOwnReviewer({
      selectRow: jest.fn(async () => ({ id: 'own-1', status: 'ready', lang: 'en', segment_id: null, lesson_id: 'grade_3_math_ch2_seg1', r2_key: 'lp612/own-k5/en/x/h.pdf', answers: { goal: { kind: 'topic', text: 'Adding' } } })),
      readPlan: jest.fn(async () => '{"iDo":{"steps":[{"say":"2 + 2 = 4"}]}}'),
      client: { chat: { completions: { create } } }, model: 'm', patchOwn: jest.fn(async (id, f) => { patches.push(f); }), now: () => 't', log: jest.fn(),
    });
    await reviewer.review('own-1');
    const accCall = create.mock.calls.find(([req]) => req.job === 'lp.ownAccuracy')[0];
    expect(JSON.stringify(accCall.messages)).toContain('Grade 3');
    expect(patches[0].review_items.ACC).toBe(4);
  });
});
