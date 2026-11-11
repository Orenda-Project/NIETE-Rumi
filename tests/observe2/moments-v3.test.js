/**
 * /observe2 on FICO17 v6 — the moments prompt v3, room evidence and the transcript quality gate
 * (spec §8.1, §8.2, §6.3; CONTRACTS §3, §4; bd-qix9oh.64).
 *
 *   v5    a visit stamped 'fico-ict-17-2026-09' builds the prompt byte for byte as at afeab2a69b
 *         (snapshots in fixtures/moments-v2-prompt, captured before any edit), 'observe2-moments-v2';
 *   v3    a v6 visit's prompt carries every §8.1 definition and every new type with its §8.2 definition,
 *         asks for room evidence for C3 C5 C7 D3, 'observe2-moments-v3';
 *   gate  broken → no model call, its own status, the coach told, the quality stored; partial → the gaps
 *         go into the prompt and the moments are read as usual; v5 visits are not gated.
 *
 * Real: the moments module, the quality gate, quote and label checks, rules, store. Mocked at the
 * boundary: the database (in memory), WhatsApp, the logger, the model.
 */
const fs = require('fs');
const path = require('path');
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logToFile } = require('../../bot/shared/utils/logger');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Moments = require('../../bot/shared/services/observe/observe2/moments');
const MT = require('../../bot/shared/services/observe/observe2/moment-types');
const { buildLabelPrompt } = require('../../bot/shared/services/observe/observe2/label-check');
const { parseTranscript } = require('../../bot/shared/services/observe/observe2/quote-check');
const Quality = require('../../bot/shared/services/observe/transcript-quality');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');

const FIX = path.join(__dirname, 'fixtures/moments-v2-prompt');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const V5 = 'fico-ict-17-2026-09';
const V6 = 'fico17_v6';
const cp = (s) => [...s].length;

// §8.1, word for word: the v3 definition of each changed type.
const DEF_81 = {
  probe: "the teacher asks a why or how-do-you-know question about the same child's answer they just gave. A new question to the class, or to another child, does not count.",
  choice: "the children get a real choice about how to do the work or how to explain it, and are allowed to follow it; or the teacher takes up a child's idea and the lesson follows it",
  reasoning: "a child gives reasoning in their own words: says why, compares two things, uses a rule on a new case, or explains a choice. Finishing the teacher's sentence, or repeating a reason the teacher already gave, is long_answer, not reasoning.",
  long_answer: "a child gives an answer longer than a phrase that only repeats what was said or read, or finishes the teacher's sentence",
  beyond: 'a child gives their own example, or links the idea to something else, that the teacher did not say first',
  life_link: 'the teacher explains a link to daily life, another subject, or an earlier lesson',
  link_mentioned: 'the teacher mentions a link to daily life, another subject or an earlier lesson without explaining it',
};
const NOT_A_QUESTION = 'Not a question: asking permission ("May I answer?"), asking for a repeat ("Say it again", "Sorry, what?"), repeating the teacher\'s question ("Why?"), or an unsure answer ("Is it twelve?").';
// §8.2, word for word: the new types, their labels and definitions.
const NEW_82 = {
  resource_shown: ['resource only shown', 'the teacher names a book, the board, a chart, or an object only to show or tell, and does not ask children to use it'],
  resource_used: ['children used resource', 'the teacher asks the children to use a book, the board, or an object themselves, and says how it connects to the idea'],
  // §8.2's label 'child explained with it' is 23 code points, over §8.2's own cap of 22.
  resource_explained: ['child explains with it', 'the teacher asks a child to explain using a book, chart or object, and builds on what the child says'],
  why_handed: ['why handed to children', "the teacher turns a child's question into a short lesson that goes further, or asks the children to give the reason why a rule or step works"],
  child_builds_link: ['child built on link', 'a child adds to, asks about, or explains in their own words a link the teacher made'],
};
// CONTRACTS §4.1: the other new ids and labels.
const NEW_LABELS = { link_mentioned: 'link only mentioned', term_not_explained: 'term not explained', child_used_term: 'child used the term' };
// CONTRACTS §4.3: the room kinds per combined code.
const ROOM = {
  C3: ['name_called', 'pair_talk', 'everyone_write', 'random_pick'],
  C5: ['signal'],
  C7: ['pairs_or_groups', 'shared_task', 'product', 'roles', 'report_back'],
  D3: ['child_agrees_or_adds', 'second_child_named_to_agree'],
};

// A 40-minute lesson, a line at most every 2:30 to 39:00: the gate calls it ok.
const LINES = [
  ['00:30', 'Teacher', 'Ali, what do you think a plant needs to grow?'],
  ['00:45', 'Student', 'I think it needs water and sunlight.'],
  ['02:30', 'Teacher', 'Open your book to page 12 and find the picture of the plant.'],
  ['05:00', 'Teacher', 'Everyone, tell your partner your answer now.'],
  ['07:30', 'Teacher', 'Sara, why do you think the roots are at the bottom?'],
  ['07:50', 'Student', 'Because they take water from the soil.'],
  ['10:00', 'Student', 'I agree with her about the roots.'],
  ['12:30', 'Teacher', 'Pens down, now turn to page twenty please.'],
  ['15:00', 'Teacher', "In your group, make one chart together with everyone's ideas."],
  ['17:30', 'Teacher', 'One of you is the writer, one is the speaker.'],
  ['20:00', 'Teacher', 'Hina, what is your answer for this question?'],
  ['22:30', 'Teacher', 'Omar, can you add to what Hina said?'],
  ['25:00', 'Teacher', 'Bilal, tell us what your group found today.'],
  ['27:30', 'Teacher', 'Ayesha, which part of the plant makes food?'],
  ['30:00', 'Student', 'The leaves make food for the plant.'],
  ['32:30', 'Teacher', 'Zara, what happens to a plant in the dark?'],
  ['35:00', 'Student', 'It cannot make its food without light.'],
  ['37:30', 'Teacher', 'Good thinking, you used what we learned about leaves.'],
  ['39:00', 'Teacher', 'That is the end of our lesson for today.'],
];
const timed = (lines) => lines.map(([t, who, w]) => `[${t}] ${who} (EN): ${w}`).join('\n\n');
const OK_T = timed(LINES);
const PARTIAL_T = timed(LINES.slice(0, 11));            // stops at 20:00 of 40: short
const BROKEN_T = [                                        // one Urdu word from 02:00 to 39:30: loop > 50%
  '[00:30] Teacher (UR): آج ہم پودوں کے بارے میں پڑھیں گے۔',
  ...Array.from({ length: 76 }, (_, i) => {
    const s = 120 + i * 30;
    return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}] Student (UR): ٹھیک ٹھیک ٹھیک`;
  }),
].join('\n\n');

const MODEL_V6 = {
  moments: [
    { moment: 'ask', type: 'open_q_one', minute: '00:30', quote: 'Ali, what do you think a plant needs to grow? — I think it needs water and sunlight.', why: 'An open question a child answered.' },
    { moment: 'explain', type: 'resource_used', minute: '02:30', quote: 'Open your book to page 12 and find the picture of the plant.', why: 'The children used the book.' },
    { moment: 'ask', type: 'reasoning', minute: '07:50', quote: 'Because they take water from the soil.', why: 'A child gave a reason.' },
  ],
  counts: { closed_q: 3, praise_generic: 1 },
  room: [
    { code: 'C3', kind: 'name_called', minute: '33:00', quote: 'Zara, what happens to a plant in the dark?' },
    { code: 'C3', kind: 'name_called', minute: '00:30', quote: 'Ali, what do you think a plant needs to grow?' },
    { code: 'C3', kind: 'pair_talk', minute: '05:00', quote: 'Everyone, tell your partner your answer now.' },
    { code: 'C3', kind: 'name_called', minute: '07:30', quote: 'Sara, why do you think the roots are at the bottom?' },
    { code: 'C3', kind: 'name_called', minute: '20:00', quote: 'Hina, what is your answer for this question?' },
    { code: 'C3', kind: 'name_called', minute: '22:30', quote: 'Omar, can you add to what Hina said?' },
    { code: 'C3', kind: 'name_called', minute: '27:30', quote: 'Ayesha, which part of the plant makes food?' },
    { code: 'C3', kind: 'pointing', minute: '25:00', quote: 'Bilal, tell us what your group found today.' },
    { code: 'C5', kind: 'signal', minute: '12:30', quote: 'Pens down, now turn to page twenty please.', starts: '12:50' },
    { code: 'C7', kind: 'shared_task', minute: '15:00', quote: "In your group, make one chart together with everyone's ideas." },
    { code: 'C7', kind: 'roles', minute: '17:30', quote: 'One of you is the writer, one is the speaker.' },
    { code: 'C7', kind: 'report_back', minute: '25:00', quote: 'Each group will now sing us a long song.' },
    { code: 'D3', kind: 'child_agrees_or_adds', minute: '10:00', quote: 'I agree with her about the roots.' },
    { code: 'D4', kind: 'unsure_answer', minute: '00:45', quote: 'I think it needs water and sunlight.' },
    { code: 'C9', kind: 'signal', minute: '12:30', quote: 'Pens down, now turn to page twenty please.' },
  ],
};
const KEEP_ALL = { verdicts: [1, 2, 3].map((n) => ({ n, verdict: 'keep' })) };

const sessions = () => mockFake.__tables.coaching_sessions || [];
const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const statusesWritten = () => mockFake.__calls
  .filter((c) => c.table === 'coaching_sessions' && c.action === 'update' && c.values && c.values.status)
  .map((c) => c.values.status);

async function linked(transcript, { rubric = V6, sealed = true } = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(formRow(form.id), { period_minutes: 40, rubric_version: rubric, ...(sealed ? { sealed_at: '2026-11-11T05:39:00.000Z' } : {}) });
  mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: transcript, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
  await Store.linkSession(form.id, 'sess-1');
  return form.id;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' }],
  });
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
});
afterAll(() => { delete process.env.OBSERVE2_CHECK_FLOW_ID; });

describe('(a) a v5 visit: the v2 prompt, byte for byte', () => {
  const T = read('transcript.txt');
  const EN = { period_minutes: 40, rubric_version: V5, answers: { lp_ref: { label: 'Grade 4 Science: Plants need light' } } };
  const UR = { period_minutes: 35, rubric_version: V5, answers: {} };

  test('the prompt equals the afeab2a69b snapshot, with or without the rubric option', () => {
    expect(Moments.buildPrompt(T, EN, { lang: 'en' })).toBe(read('en-plan.txt'));
    expect(Moments.buildPrompt(T, UR, { lang: 'ur' })).toBe(read('ur-noplan.txt'));
    expect(Moments.buildPrompt(T, EN, { lang: 'en', rubric: 'fico17' })).toBe(read('en-plan.txt'));
  });

  test('the version, the types, the guide and the slots are untouched', () => {
    expect(Moments.PROMPT_VERSION).toBe('observe2-moments-v2');
    expect(Moments.promptVersionFor('fico17')).toBe('observe2-moments-v2');
    expect(Moments.SLOTS).toBe(8);
    expect(MT.typesFor('fico17')).toBe(MT.TYPES);
    expect(MT.guideFor('fico17')).toBe(MT.TYPE_GUIDE);
    expect(MT.TYPE_GUIDE.join('\n')).toContain("- probe: right after a child's answer, the teacher asks that child (or the class) why or how");
  });

  test('the label check prompt is unchanged for a v5 visit', () => {
    const moments = [
      { moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? Ali? — Because they make food from it.' },
      { moment: 'wrong', type: 'hedged', minute: '21:30', quote: 'I think maybe it is the leaves, but I am not sure.' },
    ];
    expect(buildLabelPrompt(moments, parseTranscript(T), { lang: 'en' })).toBe(read('label-en.txt'));
    expect(buildLabelPrompt(moments, parseTranscript(T), { lang: 'ur', rubric: 'fico17' })).toBe(read('label-ur.txt'));
  });
});

describe('(b) a v6 visit: the v3 prompt', () => {
  const form = { period_minutes: 40, rubric_version: V6, answers: {} };
  const prompt = () => Moments.buildPrompt(OK_T, form, { lang: 'en', rubric: V6 });

  test('every §8.1 definition, word for word, in place of the v2 line', () => {
    const p = prompt();
    for (const [type, def] of Object.entries(DEF_81)) expect(p).toContain(`- ${type}: ${def}`);
    expect(p).toContain(NOT_A_QUESTION);
    expect(p).not.toContain("right after a child's answer, the teacher asks that child (or the class) why or how");
    expect(p).not.toContain('- reasoning: a child gives a reason ("because ...") in their own words\n');
  });

  test('every new type with its §8.2 definition, and in the allowed list', () => {
    const p = prompt();
    for (const [type, [, def]] of Object.entries(NEW_82)) expect(p).toContain(`- ${type}: ${def}`);
    for (const type of [...Object.keys(NEW_82), ...Object.keys(NEW_LABELS)]) {
      expect(p).toMatch(new RegExp(`^- ${type}: `, 'm'));
      expect(MT.GROUP_OF_V6[type]).toBe('explain');
    }
    const allowed = p.split('\n').find((l) => l.startsWith('Allowed types'));
    for (const type of Object.keys(MT.GROUP_OF_V6)) expect(allowed).toContain(type);
  });

  test('room evidence for C3 C5 C7 D3, evidence only, no level', () => {
    const p = prompt();
    expect(p).toMatch(/^ROOM EVIDENCE/m);
    for (const [code, kinds] of Object.entries(ROOM)) {
      const line = p.split('\n').find((l) => l.startsWith(`- ${code} `));
      expect(line).toBeTruthy();
      for (const k of kinds) expect(line).toContain(k);
    }
    expect(p).toContain('"room":[{"code":"C3|C5|C7|D3","kind":"<one kind above>","minute":"MM:SS","quote":"<the words>"');
    expect(p).not.toMatch(/level the transcript alone supports/);
    expect(MT.ROOM_KINDS).toEqual(ROOM);
  });

  test('the version is v3, and v6 is chosen by the rubric, never by the form alone', () => {
    expect(Moments.PROMPT_VERSION_V3).toBe('observe2-moments-v3');
    expect(Moments.promptVersionFor(V6)).toBe('observe2-moments-v3');
    expect(MT.typesFor(V6)).toBe(MT.TYPES_V6);
    expect(MT.guideFor(V6)).toBe(MT.TYPE_GUIDE_V3);
    expect(Moments.buildPrompt(OK_T, form, { lang: 'en' })).not.toMatch(/^ROOM EVIDENCE/m);
  });

  test('every v5 type stays in v6 with its label; the label check reads the v3 guide on v6', () => {
    for (const [g, types] of Object.entries(MT.TYPES)) {
      for (const [type, label] of Object.entries(types)) expect(MT.TYPES_V6[g][type]).toBe(label);
    }
    const lp = buildLabelPrompt([MODEL_V6.moments[1]], parseTranscript(OK_T), { lang: 'en', rubric: V6 });
    expect(lp).toContain(`- resource_used: ${NEW_82.resource_used[1]}`);
    expect(lp).toContain('TYPE: resource_used (children used resource)');
  });
});

describe('(c) labels', () => {
  test('every new label is at most 22 code points and as CONTRACTS §4.1 says', () => {
    const v5 = new Set(Object.keys(MT.GROUP_OF));
    const fresh = Object.entries(MT.TYPES_V6).flatMap(([, t]) => Object.entries(t)).filter(([id]) => !v5.has(id));
    expect(fresh.map(([id]) => id).sort()).toEqual([...Object.keys(NEW_82), ...Object.keys(NEW_LABELS)].sort());
    for (const [id, label] of fresh) {
      expect(cp(label)).toBeLessThanOrEqual(22);
      expect(label).toBe((NEW_82[id] || [NEW_LABELS[id]])[0]);
    }
  });
});

describe('(d) a broken transcript on v6', () => {
  test('no model call, observe2_broken, the coach told, the quality stored, every heard row IE, the check opens', async () => {
    expect(Quality.assess({ transcript: BROKEN_T, periodMinutes: 40 }).status).toBe('broken');
    const id = await linked(BROKEN_T);
    const llm = jest.fn(() => Promise.resolve(MODEL_V6));
    const labelLlm = jest.fn(() => Promise.resolve(KEEP_ALL));
    const out = await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm });
    expect(llm).not.toHaveBeenCalled();
    expect(labelLlm).not.toHaveBeenCalled();
    expect(statusesWritten()).toContain('observe2_broken');
    const S = observe2Strings('en');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923000000001', S.moments_broken || S.moments_failed);
    const f = formRow(id);
    expect(Object.keys(f.rumi_moments.transcript_quality).sort()).toEqual(['coverage', 'issues', 'status']);
    expect(f.rumi_moments.transcript_quality.status).toBe('broken');
    expect(f.rumi_moments).toMatchObject({ moments: [], prompt_version: 'observe2-moments-v3', room_evidence: { C3: [], C5: [], C7: [], D3: [] } });
    expect(f.moments_ready_at).toBeTruthy();
    expect(Object.keys(f.rumi_levels).length).toBeGreaterThan(0);
    for (const row of Object.values(f.rumi_levels)) expect(row).toMatchObject({ level: 'IE', source: 'heard' });
    // The coach still sets the six room levels: the check opens.
    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith('923000000001', expect.objectContaining({ flowId: 'F-CHECK' }));
    expect(sessions()[0].status).toBe('observe2_checking');
    expect(out).toMatchObject({ handled: true, action: 'check_sent' });
  });

  test('a v5 visit is not gated: the same transcript goes to the model as today', async () => {
    const id = await linked(BROKEN_T, { rubric: V5 });
    const llm = jest.fn(() => Promise.resolve({ moments: [], counts: {} }));
    await Moments.runForSession('sess-1', '923000000001', { llm });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(statusesWritten()).not.toContain('observe2_broken');
    expect(formRow(id).rumi_moments).not.toHaveProperty('transcript_quality');
    expect(formRow(id).rumi_moments).not.toHaveProperty('room_evidence');
    expect(formRow(id).rumi_moments.prompt_version).toBe('observe2-moments-v2');
  });
});

describe('(e) a partial transcript on v6', () => {
  test("the gate's block goes into the prompt, and the moments are read and stored", async () => {
    const q = Quality.assess({ transcript: PARTIAL_T, periodMinutes: 40 });
    expect(q.status).toBe('partial');
    const id = await linked(PARTIAL_T);
    const llm = jest.fn(() => Promise.resolve(MODEL_V6));
    await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: jest.fn(() => Promise.resolve(KEEP_ALL)) });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(llm.mock.calls[0][0]).toContain(Quality.promptGaps(q));
    const f = formRow(id);
    expect(f.rumi_moments.transcript_quality).toEqual(Quality.stored(q));
    expect(f.rumi_moments.moments.length).toBeGreaterThan(0);
    expect(f.rumi_moments.prompt_version).toBe('observe2-moments-v3');
  });

  test('an ok transcript has no gaps block, and its quality is stored as ok', async () => {
    const id = await linked(OK_T);
    const llm = jest.fn(() => Promise.resolve(MODEL_V6));
    await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: jest.fn(() => Promise.resolve(KEEP_ALL)) });
    expect(llm.mock.calls[0][0]).not.toContain('TRANSCRIPT GAPS:');
    expect(formRow(id).rumi_moments.transcript_quality.status).toBe('ok');
  });
});

describe('(f) room evidence', () => {
  test('known codes and kinds, quotes found in the transcript, at most 5 per code, ids room_<code>_<n> by minute', async () => {
    const id = await linked(OK_T);
    const labelLlm = jest.fn(() => Promise.resolve(KEEP_ALL));
    await Moments.runForSession('sess-1', '923000000001', { llm: jest.fn(() => Promise.resolve(MODEL_V6)), labelLlm });
    const f = formRow(id);
    const room = f.rumi_moments.room_evidence;
    expect(Object.keys(room).sort()).toEqual(['C3', 'C5', 'C7', 'D3']);
    // Seven good C3 items: the first five the model gave, then sorted by minute; 'pointing' is no kind.
    expect(room.C3.map((r) => r.id)).toEqual(['room_C3_1', 'room_C3_2', 'room_C3_3', 'room_C3_4', 'room_C3_5']);
    expect(room.C3.map((r) => r.minute)).toEqual(['00:30', '05:00', '07:30', '20:00', '32:30']);
    expect(room.C3.find((r) => r.minute === '05:00')).toMatchObject({ kind: 'pair_talk', quote: 'Everyone, tell your partner your answer now.' });
    expect(room.C5).toEqual([{ id: 'room_C5_1', kind: 'signal', minute: '12:30', quote: 'Pens down, now turn to page twenty please.', starts: '12:50' }]);
    // The report-back quote is not in the transcript: dropped by the quote check.
    expect(room.C7.map((r) => r.kind)).toEqual(['shared_task', 'roles']);
    expect(room.D3).toEqual([{ id: 'room_D3_1', kind: 'child_agrees_or_adds', minute: '10:00', quote: 'I agree with her about the roots.' }]);
    // Room items are never moments: nothing to confirm, no rule.
    expect(f.rumi_moments.moments.some((m) => String(m.id).startsWith('room_'))).toBe(false);
    // The v6 moments carry their v6 labels, and the label check ran once, on the moments only.
    expect(f.rumi_moments.moments.find((m) => m.type === 'resource_used')).toMatchObject({ moment: 'explain', label: 'children used resource' });
    expect(labelLlm).toHaveBeenCalledTimes(1);
  });

  test('the explain group on v6 is still capped at SLOTS, and the overflow is logged', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ moment: 'explain', type: i % 2 ? 'resource_shown' : 'why_handed', minute: `${String(10 + i).padStart(2, '0')}:00`, quote: `words ${i}` }));
    const { moments } = Moments.normalise({ moments: many }, { rubric: V6 });
    expect(moments.filter((m) => m.moment === 'explain')).toHaveLength(8);
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/over the slots/), expect.objectContaining({ explain: 3 }), 'warn');
    // v5 drops the v6-only types, as it drops any unknown type.
    expect(Moments.normalise({ moments: many }).moments).toHaveLength(0);
  });
});

describe('(g) rumi_levels on v6', () => {
  // rules-v6 (CONTRACTS §5): heardLevels(moments, counts, [], { rubric: 'fico17_v6' }) gives C8/F2/F3/F4 from
  // moments and dc_result on the combined rows. Until that lands moments.js already passes the rubric through.
  test.todo('v6: rumi_levels = heardLevels(moments, counts, [], { rubric }) (C8 3 from one resource_used, D4 dc_result)');
});
