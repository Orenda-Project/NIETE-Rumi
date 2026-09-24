/**
 * The masculine plural is not neutral.
 *
 * Four NIETE prompts told the model that the "respectful plural" — «آپ کرتے
 * ہیں، آپ چاہتے ہیں» — is the gender-neutral way to speak to a teacher, a coach
 * or a caller. It is the masculine: a woman is «آپ کرتی ہیں». The operator's
 * rule is that Urdu spoken TO the teacher or the coach carries no gender at
 * all — the آپ-imperative or subjunctive, the past with نے (the verb agrees
 * with its object), or an impersonal / obligative form. The quiz lane already
 * writes and checks it that way; these prompts taught the opposite:
 *   - the live-call persona (config/gender-neutral-address.js),
 *   - the debrief guide the coach reads to the teacher,
 *   - the coach-the-coach feedback card,
 *   - the note the teacher reads beside the observation report.
 *
 * This suite pins:
 *   A. the prompt each model RECEIVES names the masculine plural as gendered and
 *      offers the neutral forms instead — and every neutral example it offers
 *      passes the same second-person check the quiz uses;
 *   B. the three observe surfaces run that check on their Urdu output and LOG
 *      what they find (observe.gendered_address) — soft: the guide, the card and
 *      the teacher's note are delivered exactly as before, never failed, never
 *      re-asked for.
 *
 * The LLM is mocked at llm-client; the prompt builders, validators and the
 * services that call them all run for real.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';

const mockCreate = jest.fn();
jest.mock('../../shared/services/llm-client', () => {
  const client = { chat: { completions: { create: (...a) => mockCreate(...a) } } };
  return {
    getClient: () => client,
    getClientForModel: (model) => ({ client, model }),
    getDefaultModel: () => 'test-model',
    getProviderInfo: () => ({ provider: 'test' }),
    withSpendRecording: (c) => c,
    createLLMClient: () => client,
  };
});
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  getState: jest.fn().mockResolvedValue(null),
  setState: jest.fn().mockResolvedValue(true),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/coaching/report-v2/hero-report.service', () => ({
  generateHeroReport: jest.fn().mockResolvedValue({ png: Buffer.from('png'), caption: 'cap' }),
}));
jest.mock('../../shared/storage/r2', () => ({
  uploadImageBuffer: jest.fn().mockResolvedValue('https://r2/x.png'),
  downloadFromR2: jest.fn().mockResolvedValue(Buffer.from('png')),
}));
jest.mock('../../shared/services/quiz/quiz-delivery.service', () => ({
  _hasOpenMessageWindow: jest.fn().mockResolvedValue(true),
}));

// ── a small supabase stand-in: one session row, users by id/phone ───────────
const COACH_ID = 'coach-1';
const TEACHER_ID = 'teacher-1';
const COACH_PHONE = '923200000001';
const TEACHER_PHONE = '923001112222';
const db = { session: null, usersById: {}, usersByPhone: {} };
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => {
    if (table === 'users') {
      let col = null; let val = null;
      const chain = {
        select: () => chain,
        eq: (c, v) => { col = c; val = v; return chain; },
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => {
          const row = col === 'id' ? db.usersById[val] : db.usersByPhone[val];
          return { data: row ? { preferred_language: row } : null, error: null };
        },
        single: async () => ({ data: null, error: { message: 'not found' } }),
      };
      return chain;
    }
    const chain = {
      select: () => chain, eq: () => chain, neq: () => chain, order: () => chain, in: () => chain,
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: db.session, error: null }),
      single: async () => (db.session ? { data: db.session, error: null }
        : { data: null, error: { message: 'not found' } }),
      update: (patch) => {
        if (db.session) db.session = { ...db.session, ...patch };
        const done = { eq: () => done, select: () => done, then: (r) => r({ error: null }) };
        return done;
      },
    };
    return chain;
  }),
}));

const StructuredLogger = require('../../shared/utils/structured-logger');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { GENDER_NEUTRAL_ADDRESS, URDU_ADDRESS_RULE } = require('../../shared/config/gender-neutral-address');
const { buildGuidePrompt } = require('../../shared/services/observe/observe-debrief-guide');
const { buildCoachFeedbackPromptI18n } = require('../../shared/services/observe/observe-coach-feedback');
const { buildDebriefNotesPromptI18n } = require('../../shared/services/observe/observe-teacher-report');
const { addressForms } = require('../../shared/services/quiz/transcript-quiz-address');

const flat = (p) => String(p).replace(/\s+/g, ' ');
const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: {} });
const addressEvents = () => StructuredLogger.logEvent.mock.calls.filter((c) => c[0] === 'observe.gendered_address').map((c) => c[1]);

let logSpy;
beforeEach(() => {
  mockCreate.mockReset();
  jest.clearAllMocks();
  db.session = null; db.usersById = {}; db.usersByPhone = {};
  logSpy = jest.spyOn(StructuredLogger, 'logEvent').mockImplementation(() => {});
});
afterEach(() => logSpy.mockRestore());

// ── A. what the model is told ────────────────────────────────────────────────
const PROMPTS = {
  'the debrief guide': () => buildGuidePrompt({ focus_area: {} }, { language: 'ur' }),
  'the coach-feedback card': () => buildCoachFeedbackPromptI18n('T: transcript', { foName: 'Ali' }, 'ur'),
  'the teacher\'s note': () => buildDebriefNotesPromptI18n('T: transcript', { foName: 'Ali' }, 'ur'),
};

describe('A — the prompt the model receives says the masculine plural is not neutral', () => {
  test.each(Object.keys(PROMPTS))('%s: no longer recommends «آپ کرتے ہیں» as the neutral form', (name) => {
    const p = flat(PROMPTS[name]());
    expect(p).not.toMatch(/respectful plural \(آپ کرتے ہیں/);
    expect(p).not.toMatch(/respectful plural \(کرتے ہیں، چاہتے ہیں\)/);
    expect(p).not.toMatch(/already neutral/);
  });

  test.each(Object.keys(PROMPTS))('%s: carries the one shared rule — both genders banned, the neutral forms named', (name) => {
    const p = flat(PROMPTS[name]());
    expect(p).toContain(flat(URDU_ADDRESS_RULE));
    expect(p).toMatch(/masculine/i);
    expect(p).toContain('آپ کرتے ہیں');      // named as gendered…
    expect(p).toContain('آپ کرتی ہیں');      // …beside its feminine twin
    expect(p).toMatch(/آپ نے/);              // past with نے
    expect(p).toMatch(/کرنا ہوگا|کرنی ہے|جا سکتا ہے/);   // impersonal / obligative
  });

  test('the neutral examples the rule offers all pass the second-person check, and the banned ones are caught', () => {
    const quoted = [...URDU_ADDRESS_RULE.matchAll(/«([^»]+)»/g)].map((m) => m[1]);
    const banned = quoted.filter((q) => /(تے|تی) ہیں|یں (گے|گی)|(رہے|رہی) ہیں|سکتے ہیں|سکتی ہیں/.test(q));
    const neutral = quoted.filter((q) => !banned.includes(q));
    expect(banned.length).toBeGreaterThanOrEqual(6);
    expect(neutral.length).toBeGreaterThanOrEqual(6);
    neutral.forEach((q) => expect([q, addressForms(q, { kind: 'stem' })]).toEqual([q, []]));
    banned.forEach((q) => expect([q, addressForms(q, { kind: 'stem' }).length > 0]).toEqual([q, true]));
  });

  test('the call persona still bans the feminine forms heard on real calls, and shows the neutral way to say them', () => {
    const p = flat(GENDER_NEUTRAL_ADDRESS);
    ['چاہ رہی ہیں', 'آزما سکتی ہیں'].forEach((w) => expect(p).toContain(w));
    expect(p).toContain('بتائیں، کس بارے میں بات کرنی ہے؟');
    expect(addressForms('بتائیں، کس بارے میں بات کرنی ہے؟', { kind: 'stem' })).toEqual([]);
    expect(p).not.toMatch(/\bher record\b/);
  });

  test('a later clause with «ہم» as its subject is not آپ\'s verb (a real teacher-note shape)', () => {
    const note = 'ہم نے بات کی کہ آپ کھلے سوال بھی شامل کریں اور سبق کے آخر میں کل ہم کیا کر سکتے ہیں لکھوائیں۔';
    expect(addressForms(note, { kind: 'feedback' })).toEqual([]);
    expect(addressForms('آپ کلاس میں کھلے سوال شامل کر سکتے ہیں۔', { kind: 'feedback' })).toEqual(['آپ … سکتے ہیں']);
  });

  test('the debrief guide no longer calls the teacher "her" — a prior toward feminine Urdu', () => {
    const p = buildGuidePrompt({ focus_area: {} }, { language: 'ur' });
    expect(p).not.toMatch(/\bHER\b|\bhers\b/);
  });
});

// ── B. what the observe services do with the Urdu the model wrote ───────────
describe('B1 — the debrief guide: checked and logged, still delivered', () => {
  const { startDebrief } = require('../../shared/services/observe/observe-debrief.service');
  const FO = { id: COACH_ID, preferred_language: 'ur' };
  const row = () => ({
    id: 'sess-g', observer_user_id: COACH_ID, observation_type: 'leader_observation',
    status: 'observer_review_complete', debrief_status: 'pending',
    analysis_data: { framework: 'fico', strengths: [{ evidence: 'جوڑیوں میں کام' }], focus_area: { title: 'سوال پوچھنا' } },
  });
  const guide = (sayThis) => ({
    intro: 'یہ رہنمائی سامنے رکھیں۔',
    sections: {
      strengths: { title: 'اچھا لمحہ', body: 'ایک مثال بتائیں۔', say_this: sayThis },
      growth: { title: 'ایک قدم', body: 'ایک بات پر زور دیں۔', say_this: 'اگلی بار سوال کے بعد تھوڑا رکنا مفید ہوگا۔' },
      action: { title: 'اگلا قدم', body: 'دن طے کریں۔', say_this: 'اس ہفتے یہ آزما کر دیکھیں۔' },
    },
    reflection_question: 'اس سبق میں کون سا لمحہ سب سے اچھا لگا؟',
    outro: 'ایک خوبی اور ایک قدم۔',
  });

  test('«آپ … کرتے ہیں» in a say_this line: the event names the surface, the field and the form; the guide still goes out', async () => {
    db.session = row();
    mockCreate.mockResolvedValue(reply(guide('آپ بچوں کو جوڑیوں میں بہت اچھا کام کرواتے ہیں۔')));
    await startDebrief('sess-g', COACH_PHONE, FO);
    expect(mockCreate).toHaveBeenCalledTimes(1);                         // never re-asked
    const sent = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(sent).toContain('جوڑیوں میں بہت اچھا کام');                  // the model's guide, not the fallback
    const ev = addressEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toEqual(expect.objectContaining({ surface: 'debrief_guide', sessionId: 'sess-g', language: 'ur' }));
    expect(ev[0].fields).toEqual(['sections.strengths.say_this']);
    expect(ev[0].forms.join(' ')).toContain('کرواتے ہیں');
  });

  test('a neutral guide logs nothing', async () => {
    db.session = row();
    mockCreate.mockResolvedValue(reply(guide('آپ نے بچوں کو جوڑیوں میں بہت اچھا کام کروایا۔')));
    await startDebrief('sess-g', COACH_PHONE, FO);
    expect(addressEvents()).toEqual([]);
  });
});

describe('B2 — the coach-feedback card: checked and logged, never an extra repair call', () => {
  const { coachFeedbackWithRepair } = require('../../shared/services/observe/observe-debrief.service');
  const RUBRIC = {
    opened_with_specific_praise: true, anchored_in_real_moment: true, asked_and_waited: true,
    one_improvement_only: true, moves_not_teacher: true, elicited_if_then: true,
    righting_reflex_held: true, disparaged_teacher: false,
  };
  const fb = (praise) => ({
    praise_line: praise,
    wins: [{ behaviour: 'آپ نے ٹھہر کر سنا', evidence: '«آپ نے کیا سوچا؟»' }, { behaviour: 'ایک ہی بات', evidence: '«صرف سوال پر بات کریں»' }],
    try: { move: 'جواب کے بعد تین سیکنڈ رکنا', evidence: 'سوال کے فوراً بعد اگلا سوال', instead: 'خاموشی کو وقت دیں' },
    reflection_question: 'اگلی گفتگو میں کس لمحے رکنا مفید ہوگا؟',
    value: null, rubric: { ...RUBRIC },
  });

  test('«آپ … دیتے ہیں» in the praise line is logged; the card is returned as the model wrote it', async () => {
    mockCreate.mockResolvedValue(reply(fb('آپ استاد کو بولنے کا پورا موقع دیتے ہیں۔')));
    const out = await coachFeedbackWithRepair('PROMPT JSON', 'sess-f');
    expect(out.praise_line).toBe('آپ استاد کو بولنے کا پورا موقع دیتے ہیں۔');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const ev = addressEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toEqual(expect.objectContaining({ surface: 'coach_feedback', sessionId: 'sess-f', fields: ['praise_line'] }));
  });

  test('the officer\'s own words quoted as evidence are a record, not the card\'s voice — not checked', async () => {
    const card = fb('آپ نے استاد کو بولنے کا پورا موقع دیا۔');
    card.wins[1].evidence = 'اگلی کلاس میں آپ کلاس میں کھلے سوال پوچھیں گی';   // what the officer really said
    mockCreate.mockResolvedValue(reply(card));
    await coachFeedbackWithRepair('PROMPT JSON', 'sess-f');
    expect(addressEvents()).toEqual([]);
  });

  test('a neutral card logs nothing', async () => {
    mockCreate.mockResolvedValue(reply(fb('آپ نے استاد کو بولنے کا پورا موقع دیا۔')));
    await coachFeedbackWithRepair('PROMPT JSON', 'sess-f');
    expect(addressEvents()).toEqual([]);
  });
});

describe('B3 — the teacher\'s note: checked and logged, the report still ships with it', () => {
  const ObserveSend = require('../../shared/services/observe/observe-send.service');
  const session = () => ({
    id: 'sess-n', user_id: TEACHER_ID, observer_user_id: COACH_ID, observation_type: 'leader_observation',
    status: 'observer_review_complete', debrief_status: 'done',
    users: { phone_number: COACH_PHONE, first_name: 'Coach', preferred_language: 'ur' },
    analysis_data: {
      framework: 'fico',
      observer_debrief: { transcript: 'افسر اور استاد نے سوال پوچھنے پر بات کی۔ '.repeat(20) },
      teacher_delivery: { teacher_name: 'A B', teacher_phone: TEACHER_PHONE, status: 'previewing' },
    },
  });

  test('«آپ … چاہتے ہیں» in the note is logged; the companion note still reaches the preview', async () => {
    db.session = session();
    db.usersById = { [COACH_ID]: 'ur', [TEACHER_ID]: 'ur' };
    db.usersByPhone = { [TEACHER_PHONE]: 'ur' };
    mockCreate.mockResolvedValue(reply({ discussed_sw: 'آپ کلاس میں سوال پوچھنے کا طریقہ بہتر بنانا چاہتے ہیں۔', commitment_sw: null }));
    await ObserveSend.processTeacherReport('sess-n', { phase: 'preview', from: COACH_PHONE });
    const sent = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(sent).toContain('سوال پوچھنے کا طریقہ بہتر بنانا');
    const ev = addressEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toEqual(expect.objectContaining({ surface: 'teacher_notes', sessionId: 'sess-n', language: 'ur', fields: ['discussed_sw'] }));
  });
});
