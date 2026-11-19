'use strict';

/**
 * Queue #184 — Rifat's two prod findings on FICO 6-12 (19 Nov 11:20 and 11:23), for a visit the Digital Coach pre-filled:
 *   1. after the form, a text summary came back ("Principal k form ko edit krny k bad ... text form main show ho rha hy")
 *      → the v6 acknowledgement instead: "Saved" with Debrief now / Later, the report following v6's path;
 *   2. "Debrief notes thek nhi aa rhy ... patteren wohi rakhain jo primary waly coaches k liy humny rakha tha" (the notes
 *      pasted the observer's evidence verbatim) → v6's notes: the same model prompt, its data block the observer's
 *      record by indicator NAME (evidence as submitted, no level, no number), the ONE improvement the observer's chosen
 *      focus, the praise the strongest level they set.
 * A FICO 6-12 visit the Digital Coach did not fill keeps today's guide and summary.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
const mockCompleteJson = jest.fn();
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ completeJson: (...a) => mockCompleteJson(...a) }));
let mockRows = {};
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const q = { _f: {} };
    q.select = () => q;
    q.eq = (c, v) => { q._f[c] = v; return q; };
    q.in = () => q;
    q.order = () => q;
    q.range = () => q;
    q.maybeSingle = async () => ({ data: (mockRows[table] || []).find((r) => Object.entries(q._f).every(([c, v]) => r[c] === v)) || null, error: null });
    q.single = q.maybeSingle;
    q.then = (res, rej) => Promise.resolve({ data: (mockRows[table] || []).filter((r) => Object.entries(q._f).every(([c, v]) => r[c] === v)), error: null }).then(res, rej);
    return q;
  },
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));

const FS = require('../../bot/shared/services/observe/obs612/fico-s-flow');
const Record = require('../../bot/shared/services/observe/obs612/record');
const Guide = require('../../bot/shared/services/observe/observe-debrief-guide');
const WA = require('../../bot/shared/services/whatsapp.service');

const EV = (c) => `[0${c.charCodeAt(0) % 9}:1${c[1]}] "Words for ${c}" and the teacher waited for answers.`;
function draft() {
  const d = {};
  for (const s of FS.SCREENS) {
    for (const f of s.fields) {
      if (f.check === 'level') d[f.key] = f.code === 'C2' ? 'NA' : String((['B3', 'C4'].includes(f.code) ? 4 : f.code === 'C3' ? 1 : 3));
      else if (f.check === 'evidence') d[f.key] = EV(s.code);
    }
  }
  return { ...d, fb_strengths: 'Clear objective and good open questions.', fs_focus: 'C3', fs_action: 'Name two quiet students before each question.', fs_by: '2 December' };
}
const form = (dc) => ({
  id: 'f1', rubric_version: 'fico_s_v1_1', observer_user_id: 'coach-1', teacher_user_id: 't1', coaching_session_id: 'sess-1',
  visit_context: { grade: 7, subject: 'science', via: 'observe' }, answers: dc ? { fico_s_dc: { prompt_version: 'p', levels: { A1: { result: 3 } } } } : {},
});
const analysis = (dc = true) => Record.buildAnalysis(form(dc), draft());

describe('the notes prompt: v6\'s, from the observer\'s FICO 6-12 record', () => {
  const p = Guide.buildGuidePrompt(analysis(), { language: 'en' });
  test('every indicator by its name with the evidence as submitted, by section', () => {
    expect(p).toContain('OBSERVATION DATA (scores removed)');
    expect(p).toContain('"indicator":"Quality of questions"');
    expect(p).toContain(JSON.stringify(EV('C1')).slice(1, -1)); // the data block is JSON
    expect(p).toMatch(/"classroom practice":\[/);
  });
  test('the record fixes the improvement (the observer\'s focus and action) and the praise (the strongest level)', () => {
    expect(p).toContain('"work_on_first" is "Who gets to answer"');
    expect(p).toContain('The action the officer chose: "Name two quiet students before each question."');
    expect(p).toMatch(/The next step up on the rubric: ".+"/);
    expect(p).toContain('come from "Subject language"');
  });
  test('no level, no number, no code, no Rumi record', () => {
    const block = p.slice(p.indexOf('OBSERVATION DATA'));
    expect(block).not.toMatch(/"level"|"answers"|"pct"|"total"|Proficient|Exemplary|fico_s|prompt_version/);
    expect(block).not.toMatch(/"(A|B|C|D|E)[1-8]"/);
  });
  test('Urdu: the same data, the notes asked in Urdu', () => {
    const ur = Guide.buildGuidePrompt(analysis(), { language: 'ur' });
    expect(ur).toContain('Write ALL text in Urdu');
    expect(ur).toContain('"work_on_first" is "Who gets to answer"');
  });
  test('a code the model still wrote becomes the indicator\'s name', () => {
    const g = Guide.plainCodeNames({ intro: 'x', outro: 'y', went_well: ['C4 went well'], work_on_first: { title: 'C3' }, conversation: ['Talk about C3'] }, analysis());
    expect(g.work_on_first.title).toBe('Who gets to answer');
    expect(g.went_well[0]).toBe('Student voice & choice went well');
  });
  test('the fallback names the observer\'s focus and strengths', () => {
    const fb = Guide.buildFallbackGuide(analysis(), { language: 'en' });
    expect(JSON.stringify(fb)).toContain('Who gets to answer');
    expect(JSON.stringify(fb)).toContain('Clear objective and good open questions.');
  });
});

describe('the guide builder and the after-submit message', () => {
  const Debrief = require('../../bot/shared/services/observe/observe-debrief.service');
  const session = (reason, a) => ({ id: 'sess-1', user_id: 't1', framework: 'fico_s_v1_1', framework_selection_reason: reason, analysis_data: a });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRows = {
      users: [{ id: 'coach-1', phone_number: '923000000001', preferred_language: 'en', name: 'Coach Amna' }, { id: 't1', name: 'Rabia' }],
      coaching_sessions: [{ id: 'sess-1', user_id: 't1' }],
    };
  });

  test('a Digital Coach visit: the model writes the notes from v6\'s prompt', async () => {
    mockCompleteJson.mockResolvedValue({ result: {} }); // unusable → the fallback, but the call is what is checked
    const g = await Debrief.buildDebriefGuide(session('fico_s_dc', analysis()), 'en');
    expect(mockCompleteJson).toHaveBeenCalledTimes(1);
    expect(mockCompleteJson.mock.calls[0][0]).toContain('"work_on_first" is "Who gets to answer"');
    expect(mockCompleteJson.mock.calls[0][1]).toMatchObject({ job: 'coaching.observeDebrief' });
    expect(g.kind).not.toBe('obs612_talk');
  });
  test('a FICO 6-12 visit Rumi did not fill: today\'s guide, no model', async () => {
    const g = await Debrief.buildDebriefGuide(session('fico_s_lesson', analysis(false)), 'en');
    expect(mockCompleteJson).not.toHaveBeenCalled();
    expect(g.kind).toBe('obs612_talk');
  });
  test('after Submit, a Digital Coach visit gets v6\'s "Saved" with Debrief now / Later, never the text summary', async () => {
    const { sendCoachSummary } = require('../../bot/shared/services/observe/obs612/summary');
    const r = await sendCoachSummary({ coachUserId: 'coach-1', sessionId: 'sess-1', analysis: analysis() });
    expect(r).toMatchObject({ sent: true, kind: 'v6_ack' });
    const btn = WA.sendInteractiveButtons.mock.calls[0][1];
    expect(btn.buttons.map((b) => b.id)).toEqual(['observe_debrief_now_sess-1', 'observe_debrief_later_sess-1']);
    const all = [...WA.sendMessage.mock.calls.map((c) => c[1]), btn.body].join('\n');
    expect(all).toMatch(/saved/i);
    expect(all).not.toMatch(/FICO 6-12: \d+/);
    expect(all).not.toMatch(/For the talk with the teacher/);
  });
  test('a FICO 6-12 visit Rumi did not fill: the summary as today', async () => {
    const { sendCoachSummary } = require('../../bot/shared/services/observe/obs612/summary');
    await sendCoachSummary({ coachUserId: 'coach-1', sessionId: 'sess-1', analysis: analysis(false) });
    const all = [...WA.sendMessage.mock.calls.map((c) => c[1]), ...WA.sendInteractiveButtons.mock.calls.map((c) => c[1].body)].join('\n');
    expect(all).toMatch(/FICO 6-12: \d+ \/ \d+/);
  });
});
