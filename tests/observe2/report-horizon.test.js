'use strict';
/**
 * /observe2: the teacher's report names the coach's "Work on first" as the area to grow, the same
 * area the brief told the coach to discuss in the debrief (pilot sheet R3, 12 Oct).
 *
 * Prod, 12 Oct: the coach picked "Real group work" before sealing and again at the check, the brief
 * said "Work on first: Real group work", the debrief agreed on group discussion, and the report the
 * teacher received said "Your next horizon: subject vocabulary depth". The report's horizon came from
 * the lowest-scoring FICO section, and the model's own title was printed as it came.
 *
 * Real here: the /observe2 analysis (buildAnalysis), the send worker's preview (processTeacherReport),
 * the hero report, the narrative pass and its prompt, the template, and the narrative store.
 * Mocked at the boundary: the database, the model, the image renderer, storage, WhatsApp.
 */

const COACH_PHONE = '923000000101';
const TEACHER_PHONE = '923000000102';
const SID = 'sess-horizon-1';

// The 12 Oct visit's own levels: the pick (C7) is in High-Leverage Practices, the lowest section is
// Teacher Subject Knowledge (5/12).
const LEVELS = {
  C1: '2', C2: 'NA', C3: '3', C4: '1', C5: 'NA', C6: '2', C7: '1', C8: '3',
  D1: '2', D2: '4', D3: '1', D4: 'IE', D5: '1',
  F1: '3', F2: '1', F3: '1', F4: 'NA',
};

function observe2Form(over = {}) {
  return {
    id: 'form-horizon-1',
    answers: { lp: 'none', priority: 'C7' },
    rumi_moments: { moments: [] },
    evidence_review: { priority_final: 'C7' },
    final_levels: { ...LEVELS },
    ...over,
  };
}

// What the model wrote on prod for that visit: a horizon in the lowest section, not the pick.
const MODEL_REPLY = {
  topic: 'Sir Syed Ahmad Khan',
  affirmation: 'You asked questions all through the lesson.',
  identity: 'You keep the class with you through questions.',
  moments: [{ title: 'Quiet children asked', quote: 'Tell me, what did he do?', why: 'More children spoke.' }],
  strength_name: 'Warm questioning',
  strength_note: 'You picked quiet children too.',
  horizon_title: 'subject vocabulary depth',
  horizon_note: 'Grow your Teacher Subject Knowledge by naming and unpacking specific historical terms.',
  journey_note: 'You keep showing up.',
  score_framing: 'A stage in a journey.',
};

let mockCreate;
let mockHtml;
let mockUpdates;
let mockAnalysis;
let mockTeacherLang;

function wire() {
  jest.resetModules();
  mockUpdates = [];
  mockHtml = [];
  mockCreate = jest.fn(async () => ({ choices: [{ message: { content: JSON.stringify(MODEL_REPLY) } }] }));
  const sessionRow = () => ({
    id: SID, user_id: 'teacher-1', observer_user_id: 'coach-1', observation_type: 'leader_observation',
    status: 'observer_review_complete', debrief_status: 'done', created_at: '2026-10-12T10:32:00Z',
    transcript_text: '[00:10] Teacher: Who was Sir Syed Ahmad Khan?',
    analysis_data: { ...mockAnalysis, teacher_delivery: { teacher_name: 'Azmat', teacher_phone: TEACHER_PHONE, status: 'previewing' } },
    users: { name: 'Azmat', phone_number: TEACHER_PHONE, preferred_language: mockTeacherLang },
  });
  const users = {
    'coach-1': { id: 'coach-1', name: 'Areej', phone_number: COACH_PHONE, preferred_language: 'en', role: 'coach' },
    'teacher-1': { id: 'teacher-1', name: 'Azmat', phone_number: TEACHER_PHONE, preferred_language: mockTeacherLang, role: 'teacher' },
  };
  jest.doMock('../../bot/shared/config/supabase', () => {
    const { chain } = require('../quiz/helpers/supabase-chain');
    const answer = (table) => (calls) => {
      if (table === 'coaching_sessions') return { data: sessionRow(), error: null };
      if (table === 'users') {
        const eq = calls.find((c) => c[0] === 'eq' && c[1] === 'id');
        const u = eq ? users[eq[2]] : null;
        return { data: u ? [u] : [], error: null };
      }
      return { data: null, error: null };
    };
    return {
      from: jest.fn((table) => {
        const c = chain(answer(table));
        const record = (op) => (payload) => { mockUpdates.push({ table, op, payload }); return c; };
        return new Proxy(c, { get(t, p) { return (p === 'update' || p === 'insert' || p === 'upsert') ? record(p) : t[p]; } });
      }),
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    get: jest.fn(async () => null), set: jest.fn(async () => true), setexWithCeiling: jest.fn(async () => true),
    delete: jest.fn(async () => true), del: jest.fn(async () => true), setNX: jest.fn().mockResolvedValue(true), isAvailable: () => true,
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/services/observe/observe-state.service', () => ({
    getState: jest.fn().mockResolvedValue(null), setState: jest.fn().mockResolvedValue(true), clearState: jest.fn().mockResolvedValue(true),
  }));
  // The model, at its boundary: the narrative pass calls openai.chat.completions.create.
  jest.doMock('../../bot/shared/services/gpt5-mini.service', () => ({
    openai: { chat: { completions: { create: (...a) => mockCreate(...a) } } },
    completeJson: jest.fn(async () => { throw new Error('no debrief notes in this test'); }),
  }));
  jest.doMock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn(async () => []) }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn(), uploadImageBuffer: jest.fn(async (_b, key) => key),
  }));
  jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({
    htmlToImage: jest.fn(async (html) => { mockHtml.push(html); return Buffer.from('png'); }),
  }));
  return require('../../bot/shared/services/observe/observe-send.service');
}

const promptOf = () => mockCreate.mock.calls[0][0].messages[0].content;
// The "Your next horizon" block's title, as the template rendered it.
const horizonIn = (html) => {
  // RTL reports wrap Latin runs in spans; the title is the h3's text.
  const m = /class="sh h">[\s\S]*?<h3>([\s\S]*?)<\/h3>/.exec(html || '');
  return m ? m[1].replace(/<[^>]+>/g, '') : null;
};
const storedNarrative = () => mockUpdates
  .filter((u) => u.table === 'coaching_sessions' && u.payload && u.payload.analysis_data && u.payload.analysis_data.report_narrative)
  .map((u) => u.payload.analysis_data.report_narrative).pop();

async function preview(form, teacherLang = 'en') {
  const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');
  mockAnalysis = buildAnalysis(form, { brief: 'brief' });
  mockTeacherLang = teacherLang;
  const Send = wire();
  await Send.processTeacherReport(SID, { from: COACH_PHONE, phase: 'preview' });
}

describe("the teacher's report names the coach's pick as the area to grow", () => {
  test('the model is asked for the pick, never for the lowest section', async () => {
    await preview(observe2Form());
    expect(promptOf()).toContain('MANDATORY horizon focus');
    expect(promptOf()).toContain('(C7)');
    expect(promptOf()).not.toContain('LOWEST-SCORING');
  });

  test("the report shows the pick's own words, whatever the model wrote as the title", async () => {
    await preview(observe2Form());
    expect(mockHtml).toHaveLength(1);
    expect(horizonIn(mockHtml[0])).toBe('Real group work');
  });

  test("the stored narrative (the app's report page) says the same", async () => {
    await preview(observe2Form());
    expect(storedNarrative()).toMatchObject({ horizon_title: 'Real group work' });
  });

  test('an Urdu report carries the same words (concept names stay in English)', async () => {
    await preview(observe2Form(), 'ur');
    expect(horizonIn(mockHtml[0])).toBe('Real group work');
    expect(storedNarrative().horizon_title).toBe('Real group work');
  });

  test("a pick the coach couldn't judge (NA) is still the area to grow", async () => {
    await preview(observe2Form({ final_levels: { ...LEVELS, C7: 'NA' } }));
    expect(promptOf()).toContain('(C7)');
    expect(promptOf()).not.toContain('LOWEST-SCORING');
    expect(horizonIn(mockHtml[0])).toBe('Real group work');
  });

  test('"Following the plan\'s steps" (a pick with no C/D/F row) is the area to grow', async () => {
    await preview(observe2Form({ answers: { lp: 'notfollowed', priority: 'plan' }, evidence_review: { priority_final: 'plan' } }));
    expect(promptOf()).toContain('(plan)');
    expect(promptOf()).not.toContain('LOWEST-SCORING');
    expect(horizonIn(mockHtml[0])).toBe("Following the plan's steps");
  });

  test('a pick changed at the check wins over the one sealed', async () => {
    await preview(observe2Form({ answers: { lp: 'none', priority: 'C3' }, evidence_review: { priority_final: 'D1' } }));
    expect(promptOf()).toContain('(D1)');
    expect(horizonIn(mockHtml[0])).toBe('Children explaining why');
  });
});

describe('every other report is unchanged', () => {
  test("an /observe (not /observe2) analysis keeps the model's own horizon title", async () => {
    mockAnalysis = {
      framework: 'fico',
      domains: { high_leverage_practices: { domain_score: 2, domain_max: 8, indicators: [{ id: 'C3', name: 'Effective Feedback', score: 1, applicable: true }] } },
      focus_area: { indicator: 'C3', title: 'Feedback that names a next step', domain: 'high_leverage_practices' },
      scores: {},
    };
    mockTeacherLang = 'en';
    const Send = wire();
    await Send.processTeacherReport(SID, { from: COACH_PHONE, phase: 'preview' });
    expect(horizonIn(mockHtml[0])).toBe('subject vocabulary depth');
  });
});
